import { env } from "../config/env.js";
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

async function processJob(job: VideoJobRow): Promise<void> {
  const mp3 = await downloadRef(job.voice_url, "voice");
  const srtBuf = await downloadRef(job.subtitle_url, "subtitle");
  const mp4 = await renderVerticalBrandedMp4FromBuffers({
    mp3,
    srtUtf8: srtBuf.toString("utf8"),
  });

  const videoRef = await uploadBytes({
    objectPath: finalVideoObjectKey(job.id),
    body: mp4,
    contentType: "video/mp4",
  });

  await updateVideoJob(job.id, {
    status: "ready_review",
    video_url: videoRef,
  });
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
