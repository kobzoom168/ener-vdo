export const FOOTAGE_CLIP_TYPES = [
  "temple_exterior",
  "buddha_image",
  "incense",
  "walking",
  "market",
  "amulet_table",
  "generic_spiritual",
] as const;

export type FootageClipType = (typeof FOOTAGE_CLIP_TYPES)[number];

export const FOOTAGE_STATUSES = ["active", "hidden", "deleted"] as const;
export type FootageStatus = (typeof FOOTAGE_STATUSES)[number];

export type FootageClipRow = {
  id: string;
  temple_name: string | null;
  clip_type: FootageClipType;
  scene_label: string | null;
  storage_bucket: string;
  storage_path: string;
  duration_sec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  has_audio: boolean;
  ambient_audio_enabled: boolean;
  status: FootageStatus;
  created_at: string;
  updated_at: string;
};
