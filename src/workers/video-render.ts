import { env } from "../config/env.js";
import {
  removeTempMp4Path,
  runVideoQc,
  writeTempMp4,
} from "../lib/videoQc.js";
import {
  findActiveFootageClipByPriority,
  getActiveFootageClipById,
} from "../lib/footageClipsDb.js";
import { maybeConcatVisualSupplements } from "../lib/applyVisualSupplementsToRender.js";
import { renderVerticalBrandedMp4FromBuffers } from "../lib/ffmpegVerticalRender.js";
import {
  finalVideoObjectKey,
  parseStorageRef,
} from "../lib/storagePaths.js";
import { downloadStorageObject, uploadBytes } from "../lib/storageUpload.js";
import { withRetry } from "../lib/retry.js";
import {
  markJobFailed,
  rpcClaimRenderJob,
  updateVideoJob,
} from "../lib/videoJobsDb.js";
import type { VideoJobRow } from "../lib/videoJobTypes.js";
import type { FootageClipRow } from "../lib/footageTypes.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function downloadRef(ref: string | null, label: string): Promise<Buffer> {
  const parsed = parseStorageRef(ref);
  if (!parsed) throw new Error(`Missing storage ref for ${label}`);
  return await downloadStorageObject(parsed.bucket, parsed.objectPath);
}

function getTempleNameFromSourceMetadata(
  sourceMetadata: VideoJobRow["source_metadata"]
): string | null {
  if (!sourceMetadata || typeof sourceMetadata !== "object") return null;
  const t = (sourceMetadata as Record<string, unknown>).temple_name;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

async function resolveFootageForJob(job: VideoJobRow): Promise<{
  clip: FootageClipRow | null;
  manual: boolean;
}> {
  if (job.footage_clip_id) {
    const clip = await getActiveFootageClipById(job.footage_clip_id);
    if (!clip) {
      throw new Error(`Manual footage_clip_id not found/active: ${job.footage_clip_id}`);
    }
    console.log("VIDEO_FOOTAGE_MANUAL_SELECTED", {
      job_id: job.id,
      footage_clip_id: clip.id,
    });
    return { clip, manual: true };
  }

  if (job.source_type === "temple_footage") {
    const templeName = getTempleNameFromSourceMetadata(job.source_metadata);
    if (!templeName) return { clip: null, manual: false };
    const clip = await findActiveFootageClipByPriority({
      temple_name: templeName,
      clip_type_priority: [
        "buddha_image",
        "temple_exterior",
        "incense",
        "walking",
        "generic_spiritual",
      ],
    });
    if (clip) {
      console.log("VIDEO_FOOTAGE_SELECTED", {
        job_id: job.id,
        footage_clip_id: clip.id,
        source_type: job.source_type,
        temple_name: templeName,
      });
    }
    return { clip, manual: false };
  }

  if (job.source_type === "scan_result") {
    const clip = await findActiveFootageClipByPriority({
      clip_type_priority: ["amulet_table", "generic_spiritual"],
    });
    if (clip) {
      console.log("VIDEO_FOOTAGE_SELECTED", {
        job_id: job.id,
        footage_clip_id: clip.id,
        source_type: job.source_type,
      });
    }
    return { clip, manual: false };
  }

  return { clip: null, manual: false };
}

async function processJob(job: VideoJobRow): Promise<void> {
  const mp3 = await downloadRef(job.voice_url, "voice");
  const srtBuf = await downloadRef(job.subtitle_url, "subtitle");
  let backgroundVideoBuffer: Buffer | undefined;
  let enableAmbientAudio = false;

  const resolved = await resolveFootageForJob(job);
  if (!resolved.clip) {
    if (job.background_url) {
      try {
        backgroundVideoBuffer = await downloadRef(job.background_url, "background");
        console.log("VIDEO_FOOTAGE_SELECTED", {
          job_id: job.id,
          source_type: "legacy_background_url",
        });
      } catch (e) {
        console.warn("VIDEO_FOOTAGE_DOWNLOAD_FAILED", {
          job_id: job.id,
          source_type: "legacy_background_url",
          error: errMessage(e),
        });
      }
    }
    if (!backgroundVideoBuffer) {
      console.log("VIDEO_FOOTAGE_FALLBACK_BLACK", { job_id: job.id });
    }
  } else {
    try {
      backgroundVideoBuffer = await downloadStorageObject(
        resolved.clip.storage_bucket,
        resolved.clip.storage_path
      );
      enableAmbientAudio =
        resolved.clip.ambient_audio_enabled === true && resolved.clip.has_audio === true;
      console.log("VIDEO_FOOTAGE_RENDER_WITH_BACKGROUND", {
        job_id: job.id,
        footage_clip_id: resolved.clip.id,
        ambient_audio_enabled: enableAmbientAudio,
      });
    } catch (e) {
      console.warn("VIDEO_FOOTAGE_DOWNLOAD_FAILED", {
        job_id: job.id,
        footage_clip_id: resolved.clip.id,
        error: errMessage(e),
      });
      if (resolved.manual) {
        throw new Error(
          `Manual footage download failed for ${resolved.clip.id}: ${errMessage(e)}`
        );
      }
      console.log("VIDEO_FOOTAGE_FALLBACK_BLACK", { job_id: job.id });
      backgroundVideoBuffer = undefined;
      enableAmbientAudio = false;
    }
  }

  const mainMp4 = await renderVerticalBrandedMp4FromBuffers({
    mp3,
    srtUtf8: srtBuf.toString("utf8"),
    backgroundVideoBuffer,
    enableAmbientAudio,
    subtitleFontSize: job.subtitle_fontsize ?? undefined,
  });

  const mp4 = await maybeConcatVisualSupplements({
    jobId: job.id,
    mainMp4Buffer: mainMp4,
  });

  const videoRef = await uploadBytes({
    objectPath: finalVideoObjectKey(job.id),
    body: mp4,
    contentType: "video/mp4",
  });

  await updateVideoJob(job.id, {
    status: "qc_checking",
    video_url: videoRef,
  });

  const tmpPath = await writeTempMp4(mp4);
  try {
    const qcResult = await runVideoQc({
      jobId: job.id,
      mp4Path: tmpPath,
      srtUtf8: srtBuf.toString("utf8"),
      scriptText: job.script_text,
      subtitleMaxCharsPerLine: env.subtitleMaxCharsPerLine(),
      anthropicApiKey: env.anthropicApiKeyOptional(),
    });
    const checkedAt = new Date().toISOString();
    if (qcResult.passed) {
      await updateVideoJob(job.id, {
        status: "ready_review",
        qc_result_json: qcResult as unknown as Record<string, unknown>,
        qc_error_message: null,
        qc_checked_at: checkedAt,
      });
    } else {
      const short =
        qcResult.subtitle.issues.find((i) => i.severity === "error")?.message ??
        qcResult.video.issues.find((i) => i.severity === "error")?.message ??
        qcResult.audio.issues.find((i) => i.severity === "error")?.message ??
        "QC ไม่ผ่าน";
      await updateVideoJob(job.id, {
        status: "qc_failed",
        qc_result_json: qcResult as unknown as Record<string, unknown>,
        qc_error_message: short,
        qc_checked_at: checkedAt,
      });
    }
  } catch (e) {
    const msg = errMessage(e);
    const failJson = {
      passed: false,
      overall_score: 0,
      next_action: "manual_review" as const,
      audio: {
        passed: false,
        score: 0,
        issues: [
          {
            severity: "error" as const,
            code: "QC_CRASH",
            message: msg,
          },
        ],
      },
      subtitle: { passed: true, score: 0, issues: [] },
      video: { passed: true, score: 0, issues: [] },
      ai_review: {
        passed: true,
        score: 0,
        issues: [],
        summary: "",
        recommendations: [],
      },
    };
    await updateVideoJob(job.id, {
      status: "qc_failed",
      qc_error_message: msg,
      qc_result_json: failJson as unknown as Record<string, unknown>,
      qc_checked_at: new Date().toISOString(),
    });
  } finally {
    await removeTempMp4Path(tmpPath);
  }
}

async function main(): Promise<void> {
  const poll = env.workerPollMs();
  const maxAttempts = env.workerMaxRetries();
  const baseBackoff = env.workerBaseBackoffMs();

  for (;;) {
    const job = await rpcClaimRenderJob();
    if (!job) {
      await sleep(poll);
      continue;
    }

    try {
      await withRetry(() => processJob(job), {
        maxAttempts,
        baseDelayMs: baseBackoff,
        label: `video-render:${job.id}`,
      });
    } catch (e) {
      await markJobFailed(job.id, errMessage(e));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
