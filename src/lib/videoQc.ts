import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { runAiVideoReview } from "./aiVideoReview.js";
import type {
  VideoQcIssue,
  VideoQcNextAction,
  VideoQcResultJson,
  VideoQcStageJson,
} from "./videoJobTypes.js";

const execFileAsync = promisify(execFile);

function ffmpegBin(): string {
  return ffmpegInstaller.path;
}

function ffprobeBin(): string | null {
  const d = dirname(ffmpegBin());
  const name = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  const p = join(d, name);
  return existsSync(p) ? p : null;
}

type ProbeResult = {
  durationSec: number;
  videoWidth: number | null;
  videoHeight: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  audioDurationSec: number | null;
};

async function probeMedia(filePath: string): Promise<ProbeResult> {
  const probe = ffprobeBin();
  if (probe) {
    const { stdout } = await execFileAsync(
      probe,
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
    );
    const j = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
    };
    const dur = Number(j.format?.duration ?? 0) || 0;
    let vw: number | null = null;
    let vh: number | null = null;
    let hasV = false;
    let hasA = false;
    let audioDur: number | null = null;
    for (const s of j.streams ?? []) {
      if (s.codec_type === "video") {
        hasV = true;
        vw = s.width ?? vw;
        vh = s.height ?? vh;
      }
      if (s.codec_type === "audio") {
        hasA = true;
        const ad = Number(s.duration);
        if (Number.isFinite(ad)) audioDur = ad;
      }
    }
    return {
      durationSec: dur,
      videoWidth: vw,
      videoHeight: vh,
      hasVideo: hasV,
      hasAudio: hasA,
      audioDurationSec: audioDur,
    };
  }

  let stderr = "";
  try {
    await execFileAsync(ffmpegBin(), ["-hide_banner", "-i", filePath], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (e: unknown) {
    stderr =
      e && typeof e === "object" && "stderr" in e ? String((e as { stderr: string }).stderr) : "";
  }
  const durM = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  let durationSec = 0;
  if (durM) {
    durationSec =
      Number(durM[1]) * 3600 + Number(durM[2]) * 60 + Number(durM[3]);
  }
  const vm = stderr.match(/Video:.*?\s(\d{2,5})x(\d{2,5})/);
  const hasV = /Stream.*Video:/.test(stderr);
  const hasA = /Stream.*Audio:/.test(stderr);
  return {
    durationSec,
    videoWidth: vm ? Number(vm[1]) : null,
    videoHeight: vm ? Number(vm[2]) : null,
    hasVideo: hasV,
    hasAudio: hasA,
    audioDurationSec: null,
  };
}

function stage(pass: boolean, score: number, issues: VideoQcIssue[]): VideoQcStageJson {
  return { passed: pass, score: Math.min(100, Math.max(0, score)), issues };
}

export async function runAudioQc(params: {
  probe: ProbeResult;
  jobId: string;
}): Promise<VideoQcStageJson> {
  const issues: VideoQcIssue[] = [];
  let score = 100;
  if (!params.probe.hasAudio) {
    issues.push({
      severity: "error",
      code: "NO_AUDIO_STREAM",
      message: "ไม่พบช่องเสียงในวิดีโอ",
    });
    console.log("VIDEO_QC_AUDIO_RESULT", { job_id: params.jobId, passed: false, score: 0 });
    return stage(false, 0, issues);
  }
  const ad = params.probe.audioDurationSec ?? params.probe.durationSec;
  if (ad <= 3) {
    issues.push({
      severity: "error",
      code: "AUDIO_TOO_SHORT",
      message: `ความยาวเสียงสั้นเกินไป (${ad.toFixed(1)}s)`,
    });
    console.log("VIDEO_QC_AUDIO_RESULT", { job_id: params.jobId, passed: false, score: 15 });
    return stage(false, 15, issues);
  }
  const vd = params.probe.durationSec;
  if (vd > 1 && ad < vd * 0.55) {
    issues.push({
      severity: "warning",
      code: "AUDIO_SHORTER_THAN_VIDEO",
      message: "ความยาวเสียงสั้นกว่าวิดีโอมาก — อาจขาดท้ายคลิป",
    });
    score -= 18;
  }
  const hasErr = issues.some((i) => i.severity === "error");
  console.log("VIDEO_QC_AUDIO_RESULT", {
    job_id: params.jobId,
    passed: !hasErr,
    score,
  });
  return stage(!hasErr, score, issues);
}

function parseSrtTimestamp(t: string): number {
  const [h, m, rest] = t.trim().split(":");
  const [s, ms] = rest.split(",");
  return (
    Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000
  );
}

type ParsedCue = {
  start: number;
  end: number;
  lines: string[];
};

function parseSrt(content: string): ParsedCue[] {
  const cues: ParsedCue[] = [];
  const norm = content.replace(/\r\n/g, "\n").trim();
  if (!norm) return cues;
  const blocks = norm.split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trimEnd());
    if (lines.length < 2) continue;
    let idx = 0;
    if (/^\d+$/.test(lines[0] ?? "")) idx = 1;
    const timeLine = lines[idx] ?? "";
    const m = timeLine.match(
      /^(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/
    );
    if (!m) continue;
    const start = parseSrtTimestamp(m[1]);
    const end = parseSrtTimestamp(m[2]);
    const textLines = lines.slice(idx + 1).filter((l) => l.length > 0);
    cues.push({ start, end, lines: textLines });
  }
  return cues;
}

export async function runSubtitleQc(params: {
  srtUtf8: string;
  videoDurationSec: number;
  jobId: string;
  maxCharsPerLine: number;
}): Promise<VideoQcStageJson> {
  const issues: VideoQcIssue[] = [];
  const cues = parseSrt(params.srtUtf8);
  if (cues.length === 0) {
    issues.push({
      severity: "error",
      code: "NO_SRT",
      message: "ไม่มีซับหรือ parse SRT ไม่ได้",
    });
    console.log("VIDEO_QC_SUBTITLE_RESULT", { job_id: params.jobId, passed: false });
    return stage(false, 0, issues);
  }

  let badLines = 0;
  let totalLines = 0;
  let overTwoLines = 0;
  let tinyFragments = 0;
  let badDuration = 0;

  for (const c of cues) {
    if (c.lines.length > 2) overTwoLines++;
    const dur = c.end - c.start;
    if (dur < 0.5 && c.lines.join("").replace(/\s/g, "").length > 4) badDuration++;
    if (dur > 6.2) badDuration++;
    for (const line of c.lines) {
      totalLines++;
      const len = Array.from(line).length;
      if (len > params.maxCharsPerLine) badLines++;
      if (len > 0 && len <= 2) tinyFragments++;
    }
  }

  const ratioBadLines = totalLines ? badLines / totalLines : 0;
  const ratioTiny = totalLines ? tinyFragments / totalLines : 0;
  const ratioOver2 = cues.length ? overTwoLines / cues.length : 0;
  const ratioBadDur = cues.length ? badDuration / cues.length : 0;

  if (ratioOver2 > 0.2) {
    issues.push({
      severity: "error",
      code: "SRT_TOO_MANY_MULTILINE",
      message: "มีซับเกิน 2 บรรทัดต่อช่วงมากเกินไป",
    });
  }
  if (ratioBadLines > 0.22) {
    issues.push({
      severity: "error",
      code: "SRT_LINE_TOO_LONG",
      message: "มีบรรทัดยาวเกินขีดจำกัดมากเกินไป",
    });
  }
  if (ratioTiny > 0.18) {
    issues.push({
      severity: "error",
      code: "BROKEN_THAI_FRAGMENT",
      message: "พบซับที่ถูกตัดเป็นคำสั้นเกินไปหลายจุด",
    });
  }
  if (ratioBadDur > 0.35) {
    issues.push({
      severity: "warning",
      code: "SRT_BAD_CUE_DURATION",
      message: "หลายช่วงซับสั้นหรือยาวผิดปกติ",
    });
  }

  const lastEnd = cues.length ? cues[cues.length - 1].end : 0;
  if (params.videoDurationSec > 8 && lastEnd < params.videoDurationSec * 0.35) {
    issues.push({
      severity: "warning",
      code: "SRT_LOW_COVERAGE",
      message: "ซับครอบคลุมเวลาวิดีโอน้อยกว่าที่ควร",
    });
  }

  const hard = issues.filter((i) => i.severity === "error");
  const passed = hard.length === 0;
  const score = passed ? Math.round(100 - ratioBadLines * 40 - ratioTiny * 35) : 40;
  console.log("VIDEO_QC_SUBTITLE_RESULT", { job_id: params.jobId, passed, score });
  return stage(passed, score, issues);
}

export async function runVideoTechnicalQc(params: {
  probe: ProbeResult;
  jobId: string;
}): Promise<VideoQcStageJson> {
  const issues: VideoQcIssue[] = [];
  if (!params.probe.hasVideo) {
    issues.push({
      severity: "error",
      code: "NO_VIDEO_STREAM",
      message: "ไม่พบช่องวิดีโอ",
    });
    console.log("VIDEO_QC_VIDEO_RESULT", { job_id: params.jobId, passed: false });
    return stage(false, 0, issues);
  }
  const w = params.probe.videoWidth ?? 0;
  const h = params.probe.videoHeight ?? 0;
  if (w > 0 && h > 0) {
    const r = w / h;
    const target = 9 / 16;
    if (Math.abs(r - target) > 0.07) {
      issues.push({
        severity: "error",
        code: "NOT_VERTICAL_9_16",
        message: `สัดส่วนภาพ ${w}x${h} ไม่ใกล้ 9:16`,
      });
    }
  }
  if (params.probe.durationSec <= 5) {
    issues.push({
      severity: "error",
      code: "VIDEO_TOO_SHORT",
      message: `ความยาววิดีโอสั้นเกินไป (${params.probe.durationSec.toFixed(1)}s)`,
    });
  }
  const hard = issues.filter((i) => i.severity === "error");
  const passed = hard.length === 0;
  const score = passed ? 88 : 25;
  console.log("VIDEO_QC_VIDEO_RESULT", { job_id: params.jobId, passed, score });
  return stage(passed, score, issues);
}

async function extractKeyframePaths(videoPath: string, workDir: string): Promise<string[]> {
  const probe = await probeMedia(videoPath);
  const dur = Math.max(1, probe.durationSec);
  const n = 5;
  const paths: string[] = [];
  for (let k = 0; k < n; k++) {
    const t = dur * (0.05 + (k * 0.9) / Math.max(1, n - 1));
    const out = join(workDir, `qc_frame_${k}.jpg`);
    await execFileAsync(
      ffmpegBin(),
      ["-y", "-ss", String(t), "-i", videoPath, "-frames:v", "1", "-q:v", "3", out],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
    );
    paths.push(out);
  }
  return paths;
}

function computeNextAction(
  audio: VideoQcStageJson,
  subtitle: VideoQcStageJson,
  video: VideoQcStageJson
): VideoQcNextAction {
  if (!audio.passed) return "regenerate_voice";
  if (!subtitle.passed) return "regenerate_subtitle_and_rerender";
  if (!video.passed) return "rerender";
  return "ready_review";
}

function overallScore(
  a: VideoQcStageJson,
  s: VideoQcStageJson,
  v: VideoQcStageJson,
  ai: { score: number }
): number {
  return Math.round(a.score * 0.3 + s.score * 0.35 + v.score * 0.25 + ai.score * 0.1);
}

export type RunVideoQcParams = {
  jobId: string;
  mp4Path: string;
  srtUtf8: string;
  scriptText: string | null;
  subtitleMaxCharsPerLine: number;
  anthropicApiKey: string | null;
};

export async function runVideoQc(params: RunVideoQcParams): Promise<VideoQcResultJson> {
  console.log("VIDEO_QC_STARTED", { job_id: params.jobId });
  const probe = await probeMedia(params.mp4Path);

  const audio = await runAudioQc({ probe, jobId: params.jobId });
  const subtitle = await runSubtitleQc({
    srtUtf8: params.srtUtf8,
    videoDurationSec: probe.durationSec,
    jobId: params.jobId,
    maxCharsPerLine: params.subtitleMaxCharsPerLine,
  });
  const video = await runVideoTechnicalQc({ probe, jobId: params.jobId });

  const workDir = await mkdtemp(join(tmpdir(), "ener-qc-ai-"));
  try {
    await mkdir(workDir, { recursive: true });
    const framePaths = await extractKeyframePaths(params.mp4Path, workDir);
    const ai = await runAiVideoReview({
      framePaths,
      scriptText: params.scriptText,
      subtitleSnippet: params.srtUtf8.slice(0, 2500),
      anthropicApiKey: params.anthropicApiKey,
    });
    console.log("VIDEO_QC_AI_REVIEW_RESULT", {
      job_id: params.jobId,
      passed: ai.passed,
      score: ai.score,
    });

    const hardPass = audio.passed && subtitle.passed && video.passed;
    const passed = hardPass;
    const next = computeNextAction(audio, subtitle, video);
    const overall = overallScore(audio, subtitle, video, ai);

    const result: VideoQcResultJson = {
      passed,
      overall_score: overall,
      audio,
      subtitle,
      video,
      ai_review: ai,
      next_action: passed ? "ready_review" : next,
    };
    if (passed) console.log("VIDEO_QC_PASSED", { job_id: params.jobId, overall_score: overall });
    else console.log("VIDEO_QC_FAILED", { job_id: params.jobId, next_action: next });
    console.log("VIDEO_QC_RESULT_SAVED", { job_id: params.jobId });
    return result;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Write buffer to temp file for probing (caller may delete). */
export async function writeTempMp4(buf: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ener-qc-vid-"));
  const p = join(dir, "clip.mp4");
  await writeFile(p, buf);
  return p;
}

export async function removeTempMp4Path(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
