import { env } from "../config/env.js";
import { synthesizeThaiWithSubtitles } from "../lib/elevenLabsTts.js";
import { withRetry } from "../lib/retry.js";
import { subtitleObjectKey, voiceObjectKey } from "../lib/storagePaths.js";
import { uploadBytes } from "../lib/storageUpload.js";
import {
  markJobFailed,
  rpcClaimVoiceJob,
  updateVideoJob,
} from "../lib/videoJobsDb.js";
import type { VideoJobRow } from "../lib/videoJobTypes.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function processJob(job: VideoJobRow): Promise<void> {
  if (!job.script_text?.trim()) {
    throw new Error("Missing script_text for voicing");
  }

  const { mp3, srt } = await synthesizeThaiWithSubtitles(job.script_text);

  const voiceRef = await uploadBytes({
    objectPath: voiceObjectKey(job.id),
    body: mp3,
    contentType: "audio/mpeg",
  });
  const subtitleRef = await uploadBytes({
    objectPath: subtitleObjectKey(job.id),
    body: Buffer.from(srt, "utf8"),
    contentType: "text/plain; charset=utf-8",
  });

  await updateVideoJob(job.id, {
    status: "rendering",
    voice_url: voiceRef,
    subtitle_url: subtitleRef,
  });
}

async function main(): Promise<void> {
  const poll = env.workerPollMs();
  const maxAttempts = env.workerMaxRetries();
  const baseBackoff = env.workerBaseBackoffMs();

  for (;;) {
    const job = await rpcClaimVoiceJob();
    if (!job) {
      await sleep(poll);
      continue;
    }

    try {
      await withRetry(() => processJob(job), {
        maxAttempts,
        baseDelayMs: baseBackoff,
        label: `video-voice:${job.id}`,
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
