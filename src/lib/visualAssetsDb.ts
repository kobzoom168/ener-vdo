import { getSupabaseAdmin } from "./supabaseAdmin.js";
import type {
  JobVisualAssetListItem,
  VideoJobVisualAssetLinkRow,
  VisualAssetRow,
  VisualAssetStatus,
  VisualAssetType,
  VisualInsertPosition,
} from "./visualAssetTypes.js";

export async function insertVisualAssetLinkedToJob(params: {
  video_job_id: string;
  content_session_id?: string | null;
  asset_type: VisualAssetType;
  prompt_text: string;
  insert_position: VisualInsertPosition;
  duration_sec: number;
  sort_order: number;
}): Promise<JobVisualAssetListItem> {
  const supabase = getSupabaseAdmin();
  const { data: asset, error: aErr } = await supabase
    .from("visual_assets")
    .insert({
      video_job_id: params.video_job_id,
      content_session_id: params.content_session_id ?? null,
      asset_type: params.asset_type,
      prompt_text: params.prompt_text,
      status: "queued",
    })
    .select("*")
    .single();
  if (aErr) throw new Error(`visual_assets insert failed: ${aErr.message}`);
  const assetRow = asset as VisualAssetRow;

  const { data: link, error: lErr } = await supabase
    .from("video_job_visual_assets")
    .insert({
      video_job_id: params.video_job_id,
      visual_asset_id: assetRow.id,
      insert_position: params.insert_position,
      duration_sec: params.duration_sec,
      sort_order: params.sort_order,
    })
    .select("*")
    .single();
  if (lErr) throw new Error(`video_job_visual_assets insert failed: ${lErr.message}`);

  const linkRow = link as VideoJobVisualAssetLinkRow;
  return {
    ...linkRow,
    duration_sec: Number(linkRow.duration_sec),
    visual_asset: assetRow,
  };
}

export async function listJobVisualAssets(
  video_job_id: string
): Promise<JobVisualAssetListItem[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("video_job_visual_assets")
    .select("*, visual_assets(*)")
    .eq("video_job_id", video_job_id);
  if (error) throw new Error(`list video_job_visual_assets failed: ${error.message}`);
  type Raw = VideoJobVisualAssetLinkRow & { visual_assets: VisualAssetRow };
  const rows = (data ?? []) as unknown as Raw[];
  const items: JobVisualAssetListItem[] = rows.map((r) => {
    const { visual_assets: va, ...link } = r;
    const lr = link as VideoJobVisualAssetLinkRow;
    return { ...lr, duration_sec: Number(lr.duration_sec), visual_asset: va };
  });
  items.sort((a, b) => {
    const po = POSITION_ORDER[a.insert_position] - POSITION_ORDER[b.insert_position];
    if (po !== 0) return po;
    return a.sort_order - b.sort_order;
  });
  return items;
}

export async function getVisualAssetById(id: string): Promise<VisualAssetRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("visual_assets")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`visual_assets fetch failed: ${error.message}`);
  return (data as VisualAssetRow | null) ?? null;
}

export async function updateVisualAsset(
  id: string,
  patch: Partial<
    Pick<
      VisualAssetRow,
      "prompt_text" | "status" | "asset_type" | "storage_bucket" | "storage_path" | "asset_url" | "generation_provider" | "error_message"
    >
  >
): Promise<VisualAssetRow> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("visual_assets")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`visual_assets update failed: ${error.message}`);
  return data as VisualAssetRow;
}

export type ReadyVisualSegment = {
  link_id: string;
  visual_asset_id: string;
  insert_position: VisualInsertPosition;
  sort_order: number;
  duration_sec: number;
  storage_bucket: string;
  storage_path: string;
};

const POSITION_ORDER: Record<VisualInsertPosition, number> = {
  intro: 0,
  middle: 1,
  before_cta: 2,
  outro: 3,
};

export async function listReadyVisualSegmentsForRender(
  video_job_id: string
): Promise<ReadyVisualSegment[]> {
  const items = await listJobVisualAssets(video_job_id);
  const ready = items.filter(
    (i) =>
      i.visual_asset.status === "ready" &&
      i.visual_asset.storage_bucket &&
      i.visual_asset.storage_path
  );
  ready.sort((a, b) => {
    const po = POSITION_ORDER[a.insert_position] - POSITION_ORDER[b.insert_position];
    if (po !== 0) return po;
    return a.sort_order - b.sort_order;
  });
  return ready.map((i) => ({
    link_id: i.id,
    visual_asset_id: i.visual_asset_id,
    insert_position: i.insert_position,
    sort_order: i.sort_order,
    duration_sec: Number(i.duration_sec),
    storage_bucket: i.visual_asset.storage_bucket as string,
    storage_path: i.visual_asset.storage_path as string,
  }));
}

export function splitVisualSegmentsForConcat(
  segments: ReadyVisualSegment[]
): {
  intro: ReadyVisualSegment[];
  middle: ReadyVisualSegment[];
  before_cta: ReadyVisualSegment[];
  outro: ReadyVisualSegment[];
} {
  return {
    intro: segments.filter((s) => s.insert_position === "intro"),
    middle: segments.filter((s) => s.insert_position === "middle"),
    before_cta: segments.filter((s) => s.insert_position === "before_cta"),
    outro: segments.filter((s) => s.insert_position === "outro"),
  };
}

export function isVisualAssetStatus(v: string): v is VisualAssetStatus {
  return (
    v === "queued" ||
    v === "generating" ||
    v === "ready" ||
    v === "failed" ||
    v === "rejected" ||
    v === "used"
  );
}

export function isVisualAssetType(v: string): v is VisualAssetType {
  return (
    v === "opening_card" ||
    v === "transition_card" ||
    v === "explainer_card" ||
    v === "cta_card" ||
    v === "product_support" ||
    v === "motion_background"
  );
}

export function isVisualInsertPosition(v: string): v is VisualInsertPosition {
  return v === "intro" || v === "middle" || v === "before_cta" || v === "outro";
}
