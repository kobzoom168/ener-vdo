import { getSupabaseAdmin } from "./supabaseAdmin.js";
import type { VideoJobRow, VideoJobSourceType } from "./videoJobTypes.js";

export async function rpcClaimScriptJob(): Promise<VideoJobRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("claim_next_video_job_script");
  if (error) throw new Error(`claim_next_video_job_script: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return (row as VideoJobRow | undefined) ?? null;
}

export async function rpcClaimVoiceJob(): Promise<VideoJobRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("claim_next_video_job_voice");
  if (error) throw new Error(`claim_next_video_job_voice: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return (row as VideoJobRow | undefined) ?? null;
}

export async function rpcClaimRenderJob(): Promise<VideoJobRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("claim_next_video_job_render");
  if (error) throw new Error(`claim_next_video_job_render: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return (row as VideoJobRow | undefined) ?? null;
}

export async function updateVideoJob(
  id: string,
  patch: Partial<
    Pick<
      VideoJobRow,
      | "status"
      | "script_text"
      | "voice_url"
      | "video_url"
      | "background_url"
      | "footage_clip_id"
      | "subtitle_fontsize"
      | "subtitle_url"
      | "error_message"
      | "qc_result_json"
      | "qc_error_message"
      | "qc_checked_at"
    >
  >
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("video_jobs")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(`video_jobs update failed: ${error.message}`);
}

export async function markJobFailed(id: string, message: string): Promise<void> {
  await updateVideoJob(id, { status: "failed", error_message: message });
}

export async function insertVideoJob(params: {
  source_type: VideoJobSourceType;
  source_id?: string | null;
  source_metadata?: Record<string, unknown> | null;
  background_url?: string | null;
  footage_clip_id?: string | null;
  subtitle_fontsize?: number | null;
}): Promise<VideoJobRow> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("video_jobs")
    .insert({
      source_type: params.source_type,
      source_id: params.source_id ?? null,
      source_metadata: params.source_metadata ?? null,
      background_url: params.background_url ?? null,
      footage_clip_id: params.footage_clip_id ?? null,
      subtitle_fontsize: params.subtitle_fontsize ?? null,
      status: "queued",
    })
    .select("*")
    .single();
  if (error) throw new Error(`video_jobs insert failed: ${error.message}`);
  return data as VideoJobRow;
}

export async function listVideoJobs(): Promise<VideoJobRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("video_jobs")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`video_jobs list failed: ${error.message}`);
  return (data as VideoJobRow[]) ?? [];
}

export async function getVideoJobById(id: string): Promise<VideoJobRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("video_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`video_jobs fetch failed: ${error.message}`);
  return (data as VideoJobRow | null) ?? null;
}
