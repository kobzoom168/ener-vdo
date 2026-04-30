import "dotenv/config";
import express from "express";
import { join } from "node:path";
import { env } from "../config/env.js";
import { createSignedUrlForRef } from "../lib/signedPreviewUrl.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
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

    if (source_type === "scan_result" && !source_id) {
      res.status(400).json({ error: "scan_result requires source_id" });
      return;
    }

    const row = await insertVideoJob({
      source_type,
      source_id,
      source_metadata,
      background_url,
    });
    res.status(201).json(row);
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

const port = Number(process.env.PORT ?? "8080");
app.listen(port, () => {
  console.log(`admin listening on :${port}`);
});
