export const VISUAL_ASSET_TYPES = [
  "opening_card",
  "transition_card",
  "explainer_card",
  "cta_card",
  "product_support",
  "motion_background",
] as const;

export type VisualAssetType = (typeof VISUAL_ASSET_TYPES)[number];

export const VISUAL_ASSET_STATUSES = [
  "queued",
  "generating",
  "ready",
  "failed",
  "rejected",
  "used",
] as const;

export type VisualAssetStatus = (typeof VISUAL_ASSET_STATUSES)[number];

export const VISUAL_INSERT_POSITIONS = ["intro", "middle", "before_cta", "outro"] as const;

export type VisualInsertPosition = (typeof VISUAL_INSERT_POSITIONS)[number];

export type VisualAssetRow = {
  id: string;
  video_job_id: string | null;
  content_session_id: string | null;
  asset_type: VisualAssetType;
  prompt_text: string;
  storage_bucket: string | null;
  storage_path: string | null;
  asset_url: string | null;
  status: VisualAssetStatus;
  generation_provider: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type VideoJobVisualAssetLinkRow = {
  id: string;
  video_job_id: string;
  visual_asset_id: string;
  insert_position: VisualInsertPosition;
  duration_sec: number;
  sort_order: number;
  created_at: string;
};

export type JobVisualAssetListItem = VideoJobVisualAssetLinkRow & {
  visual_asset: VisualAssetRow;
};
