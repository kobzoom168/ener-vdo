import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { execFile } from "node:child_process";
import { copyFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function ffmpegBin(): string {
  return ffmpegInstaller.path;
}

export async function probeAudioSampleRate(mediaPath: string): Promise<number> {
  try {
    await execFileAsync(ffmpegBin(), ["-hide_banner", "-i", mediaPath], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (e: unknown) {
    const stderr =
      e && typeof e === "object" && "stderr" in e ? String((e as { stderr: string }).stderr) : "";
    const m = stderr.match(/(\d{4,5})\s*Hz/);
    if (m) return parseInt(m[1], 10);
  }
  return 44100;
}

/**
 * Turn a still PNG into a short vertical H.264 clip with silent stereo audio (for concat).
 */
export async function imageToVerticalVideoSegment(opts: {
  pngPath: string;
  outMp4Path: string;
  durationSec: number;
  sampleRate: number;
}): Promise<void> {
  const dur = Math.max(0.5, opts.durationSec);
  const fadeOutSt = Math.max(0.12, dur - 0.18);
  const zFrames = Math.max(1, Math.round(dur * 30));
  const vf = [
    "scale=1080:1920:force_original_aspect_ratio=decrease",
    "pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
    "format=yuv420p",
    `zoompan=z='min(zoom+0.0012,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${zFrames}:s=1080x1920:fps=30`,
    `fade=t=in:st=0:d=0.12,fade=t=out:st=${fadeOutSt}:d=0.12`,
  ].join(",");
  const args = [
    "-y",
    "-loop",
    "1",
    "-i",
    opts.pngPath,
    "-f",
    "lavfi",
    "-i",
    `anullsrc=r=${opts.sampleRate}:cl=stereo`,
    "-t",
    String(dur),
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    opts.outMp4Path,
  ];
  await execFileAsync(ffmpegBin(), args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

export async function concatMp4FilesSequential(
  inputPaths: string[],
  outputPath: string
): Promise<void> {
  if (!inputPaths.length) throw new Error("concatMp4FilesSequential: no inputs");
  if (inputPaths.length === 1) {
    await copyFile(inputPaths[0], outputPath);
    return;
  }
  const args = ["-y"];
  for (const p of inputPaths) {
    args.push("-i", p);
  }
  const n = inputPaths.length;
  let filter = "";
  for (let i = 0; i < n; i++) {
    filter += `[${i}:v][${i}:a]`;
  }
  filter += `concat=n=${n}:v=1:a=1[outv][outa]`;
  args.push(
    "-filter_complex",
    filter,
    "-map",
    "[outv]",
    "-map",
    "[outa]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    outputPath
  );
  await execFileAsync(ffmpegBin(), args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}
