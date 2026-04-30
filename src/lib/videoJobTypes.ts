export type VideoJobSourceType = "scan_result" | "temple_footage";

export type VideoJobStatus =
  | "queued"
  | "scripting"
  | "voicing"
  | "rendering"
  | "ready_review"
  | "approved"
  | "published"
  | "failed";

export type TempleFootageMetadata = {
  temple_name?: string;
  scene?: string;
  date?: string;
  notes?: string;
};

export type VideoJobRow = {
  id: string;
  source_type: VideoJobSourceType;
  source_id: string | null;
  source_metadata: TempleFootageMetadata | Record<string, unknown> | null;
  script_text: string | null;
  voice_url: string | null;
  video_url: string | null;
  background_url: string | null;
  subtitle_fontsize: number | null;
  subtitle_url: string | null;
  status: VideoJobStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export const VIDEO_ASSETS_BUCKET = "video-assets";
