import { env } from "../config/env.js";
import { generateThaiScriptFromContext } from "../lib/generateThaiScript.js";
import { buildScanResultPromptContext } from "../lib/scanResultContext.js";
import { withRetry } from "../lib/retry.js";
import {
  markJobFailed,
  rpcClaimScriptJob,
  updateVideoJob,
} from "../lib/videoJobsDb.js";
import type { VideoJobRow } from "../lib/videoJobTypes.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function buildContext(job: VideoJobRow): Promise<string> {
  if (job.source_type === "scan_result") {
    if (!job.source_id) {
      throw new Error("scan_result jobs require source_id");
    }
    return await buildScanResultPromptContext(job.source_id);
  }
  return JSON.stringify(
    { temple_footage: job.source_metadata ?? {} },
    null,
    2
  );
}

async function processJob(job: VideoJobRow): Promise<void> {
  const ctx = await buildContext(job);
  const script = await generateThaiScriptFromContext(ctx);
  await updateVideoJob(job.id, { status: "voicing", script_text: script });
}

async function main(): Promise<void> {
  const poll = env.workerPollMs();
  const maxAttempts = env.workerMaxRetries();
  const baseBackoff = env.workerBaseBackoffMs();

  for (;;) {
    const job = await rpcClaimScriptJob();
    if (!job) {
      await sleep(poll);
      continue;
    }

    try {
      await withRetry(() => processJob(job), {
        maxAttempts,
        baseDelayMs: baseBackoff,
        label: `video-script:${job.id}`,
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
