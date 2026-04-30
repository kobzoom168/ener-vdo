import "dotenv/config";
import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { env } from "../config/env.js";
import {
  FOOTAGE_CLIP_TYPES,
  FOOTAGE_STATUSES,
  type FootageClipType,
  type FootageStatus,
} from "../lib/footageTypes.js";
import {
  getFootageClipById,
  insertFootageClip,
  listFootageClips,
  updateFootageClip,
} from "../lib/footageClipsDb.js";
import { createSignedUrlForRef } from "../lib/signedPreviewUrl.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { createSignedUrlForObject } from "../lib/signedPreviewUrl.js";
import { VIDEO_ASSETS_BUCKET } from "../lib/videoJobTypes.js";
import { uploadBytesToBucket } from "../lib/storageUpload.js";
import type { VideoJobSourceType } from "../lib/videoJobTypes.js";
import {
  getVideoJobById,
  insertVideoJob,
  listVideoJobs,
  updateVideoJob,
} from "../lib/videoJobsDb.js";

const ADMIN_KEY = process.env.ADMIN_API_KEY;
if (!ADMIN_KEY) {
  throw new Error("Missing ADMIN_API_KEY (required for admin API process)");
}

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(join(process.cwd(), "src", "admin", "public")));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxFootageUploadMb() * 1024 * 1024 },
});

const corsOrigins = env.adminCorsOrigins();
if (corsOrigins.length) {
  app.use((req, res, next) => {
    const origin = req.header("origin");
    if (origin && corsOrigins.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key");
      res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
}

function requireAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const key =
    req.header("x-admin-key") ??
    (req.header("authorization")?.startsWith("Bearer ")
      ? req.header("authorization")!.slice("Bearer ".length)
      : undefined);
  if (!key || key !== ADMIN_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/admin/video-jobs", requireAdmin, async (req, res) => {
  try {
    const source_type = req.body?.source_type as VideoJobSourceType | undefined;
    if (source_type !== "scan_result" && source_type !== "temple_footage") {
      res.status(400).json({ error: "source_type must be scan_result|temple_footage" });
      return;
    }
    const source_id =
      typeof req.body?.source_id === "string" ? req.body.source_id : null;
    const source_metadata =
      typeof req.body?.source_metadata === "object" && req.body.source_metadata
        ? (req.body.source_metadata as Record<string, unknown>)
        : null;
    const background_url =
      typeof req.body?.background_url === "string" ? req.body.background_url : null;
    const footage_clip_id =
      typeof req.body?.footage_clip_id === "string" && req.body.footage_clip_id.trim()
        ? req.body.footage_clip_id.trim()
        : null;

    if (footage_clip_id) {
      const clip = await getFootageClipById(footage_clip_id);
      if (!clip || clip.status !== "active") {
        res.status(400).json({ error: "footage_clip_id must reference an active footage clip" });
        return;
      }
    }

    if (source_type === "scan_result" && !source_id) {
      res.status(400).json({ error: "scan_result requires source_id" });
      return;
    }

    const row = await insertVideoJob({
      source_type,
      source_id,
      source_metadata,
      background_url,
      footage_clip_id,
    });
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.patch("/admin/video-jobs/:id/footage", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await getVideoJobById(id);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const footage_clip_id =
      typeof req.body?.footage_clip_id === "string" && req.body.footage_clip_id.trim()
        ? req.body.footage_clip_id.trim()
        : null;
    if (footage_clip_id) {
      const clip = await getFootageClipById(footage_clip_id);
      if (!clip || clip.status !== "active") {
        res.status(400).json({ error: "footage_clip_id must reference an active footage clip" });
        return;
      }
    }
    await updateVideoJob(id, { footage_clip_id });
    res.json({ ok: true, id, footage_clip_id });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/admin/video-jobs", requireAdmin, async (_req, res) => {
  try {
    const jobs = await listVideoJobs();
    res.json({ jobs });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.patch("/admin/video-jobs/:id/approve", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await getVideoJobById(id);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (existing.status !== "ready_review") {
      res
        .status(409)
        .json({ error: `approve only allowed from ready_review (got ${existing.status})` });
      return;
    }
    await updateVideoJob(id, { status: "approved" });
    res.json({ ok: true, id, status: "approved" });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/admin/video-jobs/:id/preview", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await getVideoJobById(id);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const signed = await createSignedUrlForRef(existing.video_url, 60 * 60);
    if (!signed) {
      res.status(409).json({ error: "No video_url yet" });
      return;
    }
    res.json({ video_url: signed, storage_ref: existing.video_url });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.patch("/admin/video-jobs/:id/retry", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await getVideoJobById(id);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const from = typeof req.body?.from === "string" ? req.body.from : "queued";
    const subtitle_fontsize =
      typeof req.body?.subtitle_fontsize === "number"
        ? Math.min(30, Math.max(6, req.body.subtitle_fontsize))
        : null;
    if (from !== "queued") {
      res.status(400).json({ error: "from must be 'queued' (only supported reset)" });
      return;
    }

    const resettable = new Set([
      "failed",
      "scripting",
      "voicing",
      "rendering",
      "ready_review",
    ]);
    if (!resettable.has(existing.status)) {
      res.status(409).json({ error: `cannot retry from status ${existing.status}` });
      return;
    }

    await updateVideoJob(id, {
      status: "queued",
      error_message: null,
      script_text: null,
      voice_url: null,
      subtitle_url: null,
      video_url: null,
      ...(subtitle_fontsize !== null ? { subtitle_fontsize } : {}),
    });
    res.json({ ok: true, id, status: "queued" });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.patch("/admin/video-pipeline/settings", requireAdmin, async (req, res) => {
  try {
    const enabled = req.body?.auto_video_job_on_scan_result;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "auto_video_job_on_scan_result boolean required" });
      return;
    }
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("video_pipeline_settings").upsert(
      { key: "auto_video_job_on_scan_result", value: enabled },
      { onConflict: "key" }
    );
    if (error) throw new Error(error.message);
    res.json({ ok: true, auto_video_job_on_scan_result: enabled });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post(
  "/admin/footage-clips",
  requireAdmin,
  upload.single("video"),
  async (req, res) => {
    try {
      const clip_type = req.body?.clip_type as FootageClipType;
      if (!FOOTAGE_CLIP_TYPES.includes(clip_type)) {
        res.status(400).json({ error: "Invalid clip_type" });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: "video file is required (multipart field: video)" });
        return;
      }
      if (!req.file.mimetype.startsWith("video/")) {
        res.status(400).json({ error: "Only video uploads are allowed" });
        return;
      }

      const id = randomUUID();
      const storage_bucket = VIDEO_ASSETS_BUCKET;
      const storage_path = `footage/${id}/source.mp4`;
      await uploadBytesToBucket({
        bucket: storage_bucket,
        objectPath: storage_path,
        body: req.file.buffer,
        contentType: req.file.mimetype || "video/mp4",
      });

      const ambient_audio_enabled =
        req.body?.ambient_audio_enabled === "false" || req.body?.ambient_audio_enabled === false
          ? false
          : true;
      const temple_name =
        typeof req.body?.temple_name === "string" ? req.body.temple_name.trim() : null;
      const scene_label =
        typeof req.body?.scene_label === "string" ? req.body.scene_label.trim() : null;

      const row = await insertFootageClip({
        id,
        temple_name: temple_name || null,
        clip_type,
        scene_label: scene_label || null,
        storage_bucket,
        storage_path,
        ambient_audio_enabled,
      });
      res.status(201).json(row);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }
);

app.get("/admin/footage-clips", requireAdmin, async (req, res) => {
  try {
    const statusRaw = typeof req.query.status === "string" ? req.query.status : undefined;
    const clipTypeRaw = typeof req.query.clip_type === "string" ? req.query.clip_type : undefined;
    const temple_name =
      typeof req.query.temple_name === "string" ? req.query.temple_name : undefined;
    const include_deleted = req.query.include_deleted === "true";

    const status = FOOTAGE_STATUSES.includes(statusRaw as FootageStatus)
      ? (statusRaw as FootageStatus)
      : undefined;
    const clip_type = FOOTAGE_CLIP_TYPES.includes(clipTypeRaw as FootageClipType)
      ? (clipTypeRaw as FootageClipType)
      : undefined;

    const clips = await listFootageClips({ status, clip_type, temple_name, include_deleted });
    res.json({ clips });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/admin/footage-clips/:id/preview", requireAdmin, async (req, res) => {
  try {
    const clip = await getFootageClipById(req.params.id);
    if (!clip || clip.status === "deleted") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const signedUrl = await createSignedUrlForObject(clip.storage_bucket, clip.storage_path, 3600);
    res.json({ preview_url: signedUrl });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.patch("/admin/footage-clips/:id", requireAdmin, async (req, res) => {
  try {
    const clip = await getFootageClipById(req.params.id);
    if (!clip) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const patch: Parameters<typeof updateFootageClip>[1] = {};
    if (typeof req.body?.temple_name === "string" || req.body?.temple_name === null) {
      patch.temple_name = req.body.temple_name;
    }
    if (typeof req.body?.scene_label === "string" || req.body?.scene_label === null) {
      patch.scene_label = req.body.scene_label;
    }
    if (typeof req.body?.ambient_audio_enabled === "boolean") {
      patch.ambient_audio_enabled = req.body.ambient_audio_enabled;
    }
    if (
      typeof req.body?.clip_type === "string" &&
      FOOTAGE_CLIP_TYPES.includes(req.body.clip_type as FootageClipType)
    ) {
      patch.clip_type = req.body.clip_type as FootageClipType;
    }
    if (
      typeof req.body?.status === "string" &&
      FOOTAGE_STATUSES.includes(req.body.status as FootageStatus)
    ) {
      patch.status = req.body.status as FootageStatus;
    }
    const updated = await updateFootageClip(req.params.id, patch);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete("/admin/footage-clips/:id", requireAdmin, async (req, res) => {
  try {
    const clip = await getFootageClipById(req.params.id);
    if (!clip) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const updated = await updateFootageClip(req.params.id, { status: "deleted" });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

const port = Number(process.env.PORT ?? "8080");
app.listen(port, () => {
  console.log(`admin listening on :${port}`);
});
