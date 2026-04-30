import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listReadyVisualSegmentsForRender,
  splitVisualSegmentsForConcat,
  type ReadyVisualSegment,
} from "./visualAssetsDb.js";
import {
  concatMp4FilesSequential,
  imageToVerticalVideoSegment,
  probeAudioSampleRate,
} from "./ffmpegConcatWithVisuals.js";
import { downloadStorageObject } from "./storageUpload.js";

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function encodeVisualBucket(params: {
  jobId: string;
  segments: ReadyVisualSegment[];
  workDir: string;
  sampleRate: number;
  prefix: string;
}): Promise<string[]> {
  const out: string[] = [];
  for (const s of params.segments) {
    console.log("VIDEO_VISUAL_ASSET_SELECTED", {
      job_id: params.jobId,
      link_id: s.link_id,
      visual_asset_id: s.visual_asset_id,
      insert_position: s.insert_position,
      sort_order: s.sort_order,
    });
    try {
      const bytes = await downloadStorageObject(s.storage_bucket, s.storage_path);
      const pngPath = join(params.workDir, `${params.prefix}-${s.visual_asset_id}.png`);
      const mp4Path = join(params.workDir, `${params.prefix}-${s.visual_asset_id}.mp4`);
      await writeFile(pngPath, bytes);
      await imageToVerticalVideoSegment({
        pngPath,
        outMp4Path: mp4Path,
        durationSec: s.duration_sec,
        sampleRate: params.sampleRate,
      });
      out.push(mp4Path);
      console.log("VIDEO_VISUAL_ASSET_RENDER_INSERTED", {
        job_id: params.jobId,
        visual_asset_id: s.visual_asset_id,
        insert_position: s.insert_position,
      });
    } catch (e) {
      console.warn("VIDEO_VISUAL_ASSET_DOWNLOAD_FAILED", {
        job_id: params.jobId,
        visual_asset_id: s.visual_asset_id,
        error: errMessage(e),
      });
      console.log("VIDEO_VISUAL_ASSET_RENDER_SKIPPED", {
        job_id: params.jobId,
        visual_asset_id: s.visual_asset_id,
      });
    }
  }
  return out;
}

/**
 * If the job has ready visual assets, prepend/append motion segments around the main branded MP4.
 * Failures in visual download/encode never throw; the original main buffer is returned.
 */
export async function maybeConcatVisualSupplements(params: {
  jobId: string;
  mainMp4Buffer: Buffer;
}): Promise<Buffer> {
  const segs = await listReadyVisualSegmentsForRender(params.jobId);
  if (!segs.length) return params.mainMp4Buffer;

  const workDir = await mkdtemp(join(tmpdir(), "ener-vdo-vis-"));
  try {
    const mainPath = join(workDir, "main.mp4");
    await writeFile(mainPath, params.mainMp4Buffer);
    const sampleRate = await probeAudioSampleRate(mainPath);
    const { intro, middle, before_cta, outro } = splitVisualSegmentsForConcat(segs);

    const introPaths = await encodeVisualBucket({
      jobId: params.jobId,
      segments: intro,
      workDir,
      sampleRate,
      prefix: "intro",
    });
    const middlePaths = await encodeVisualBucket({
      jobId: params.jobId,
      segments: middle,
      workDir,
      sampleRate,
      prefix: "mid",
    });
    const beforeCtaPaths = await encodeVisualBucket({
      jobId: params.jobId,
      segments: before_cta,
      workDir,
      sampleRate,
      prefix: "precta",
    });
    const outroPaths = await encodeVisualBucket({
      jobId: params.jobId,
      segments: outro,
      workDir,
      sampleRate,
      prefix: "outro",
    });

    const extraCount =
      introPaths.length + middlePaths.length + beforeCtaPaths.length + outroPaths.length;
    if (extraCount === 0) {
      return params.mainMp4Buffer;
    }

    const concatInputs = [
      ...introPaths,
      mainPath,
      ...middlePaths,
      ...beforeCtaPaths,
      ...outroPaths,
    ];
    const outPath = join(workDir, "final-concat.mp4");
    await concatMp4FilesSequential(concatInputs, outPath);
    return await readFile(outPath);
  } catch (e) {
    console.warn("VIDEO_VISUAL_CONCAT_FAILED", {
      job_id: params.jobId,
      error: errMessage(e),
    });
    return params.mainMp4Buffer;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
