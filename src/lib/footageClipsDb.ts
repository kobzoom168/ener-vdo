import { getSupabaseAdmin } from "./supabaseAdmin.js";
import type { FootageClipRow, FootageClipType, FootageStatus } from "./footageTypes.js";

export async function insertFootageClip(input: {
  id?: string;
  temple_name?: string | null;
  clip_type: FootageClipType;
  scene_label?: string | null;
  storage_bucket: string;
  storage_path: string;
  ambient_audio_enabled: boolean;
  has_audio?: boolean;
}): Promise<FootageClipRow> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("footage_clips")
    .insert({
      id: input.id,
      temple_name: input.temple_name ?? null,
      clip_type: input.clip_type,
      scene_label: input.scene_label ?? null,
      storage_bucket: input.storage_bucket,
      storage_path: input.storage_path,
      ambient_audio_enabled: input.ambient_audio_enabled,
      has_audio: input.has_audio ?? false,
      status: "active",
    })
    .select("*")
    .single();
  if (error) throw new Error(`footage_clips insert failed: ${error.message}`);
  return data as FootageClipRow;
}

export async function listFootageClips(filters: {
  status?: FootageStatus;
  clip_type?: FootageClipType;
  temple_name?: string;
  include_deleted?: boolean;
}): Promise<FootageClipRow[]> {
  const supabase = getSupabaseAdmin();
  let q = supabase.from("footage_clips").select("*").order("created_at", { ascending: false });
  if (!filters.include_deleted) q = q.neq("status", "deleted");
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.clip_type) q = q.eq("clip_type", filters.clip_type);
  if (filters.temple_name) q = q.ilike("temple_name", `%${filters.temple_name}%`);
  const { data, error } = await q;
  if (error) throw new Error(`footage_clips list failed: ${error.message}`);
  return (data as FootageClipRow[]) ?? [];
}

export async function getFootageClipById(id: string): Promise<FootageClipRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("footage_clips")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`footage_clips fetch failed: ${error.message}`);
  return (data as FootageClipRow | null) ?? null;
}

export async function getActiveFootageClipById(id: string): Promise<FootageClipRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("footage_clips")
    .select("*")
    .eq("id", id)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`footage_clips active fetch failed: ${error.message}`);
  return (data as FootageClipRow | null) ?? null;
}

export async function findActiveFootageClipByPriority(input: {
  temple_name?: string | null;
  clip_type_priority: FootageClipType[];
}): Promise<FootageClipRow | null> {
  const supabase = getSupabaseAdmin();
  const temple = input.temple_name?.trim();
  for (const clipType of input.clip_type_priority) {
    let q = supabase
      .from("footage_clips")
      .select("*")
      .eq("status", "active")
      .eq("clip_type", clipType)
      .order("created_at", { ascending: false })
      .limit(1);
    if (temple) q = q.eq("temple_name", temple);
    const { data, error } = await q;
    if (error) throw new Error(`footage_clips priority lookup failed: ${error.message}`);
    const row = (data as FootageClipRow[] | null)?.[0];
    if (row) return row;
  }
  return null;
}

export async function updateFootageClip(
  id: string,
  patch: Partial<
    Pick<
      FootageClipRow,
      "temple_name" | "clip_type" | "scene_label" | "ambient_audio_enabled" | "status"
    >
  >
): Promise<FootageClipRow> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("footage_clips")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`footage_clips update failed: ${error.message}`);
  return data as FootageClipRow;
}
