export type VideoJobSourceType = "scan_result" | "temple_footage";

export type VideoJobStatus =
  | "queued"
  | "scripting"
  | "voicing"
  | "rendering"
  | "qc_checking"
  | "qc_failed"
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

/** Stored in video_jobs.qc_result_json after QC pipeline. */
export type VideoQcIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  timestamp?: string;
};

export type VideoQcStageJson = {
  passed: boolean;
  score: number;
  issues: VideoQcIssue[];
};

export type VideoQcAiReviewJson = VideoQcStageJson & {
  summary: string;
  recommendations: string[];
};

export type VideoQcNextAction =
  | "ready_review"
  | "regenerate_voice"
  | "regenerate_subtitle_and_rerender"
  | "rerender"
  | "retry_script"
  | "manual_review";

export type VideoQcResultJson = {
  passed: boolean;
  overall_score: number;
  audio: VideoQcStageJson;
  subtitle: VideoQcStageJson;
  video: VideoQcStageJson;
  ai_review: VideoQcAiReviewJson;
  next_action: VideoQcNextAction;
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
  footage_clip_id: string | null;
  subtitle_fontsize: number | null;
  subtitle_url: string | null;
  status: VideoJobStatus;
  error_message: string | null;
  qc_result_json: VideoQcResultJson | Record<string, unknown> | null;
  qc_error_message: string | null;
  qc_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

export const VIDEO_ASSETS_BUCKET = "video-assets";
