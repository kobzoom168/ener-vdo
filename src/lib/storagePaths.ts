import { VIDEO_ASSETS_BUCKET } from "./videoJobTypes.js";

/** Object key inside bucket (no leading slash). */
export function voiceObjectKey(jobId: string): string {
  return `${jobId}/voice.mp3`;
}

export function subtitleObjectKey(jobId: string): string {
  return `${jobId}/subtitles.srt`;
}

export function finalVideoObjectKey(jobId: string): string {
  return `${jobId}/final.mp4`;
}

export function parseStorageRef(ref: string | null): {
  bucket: string;
  objectPath: string;
} | null {
  if (!ref) return null;
  if (ref.startsWith("supabase://")) {
    const rest = ref.slice("supabase://".length);
    const slash = rest.indexOf("/");
    if (slash === -1) return null;
    return { bucket: rest.slice(0, slash), objectPath: rest.slice(slash + 1) };
  }
  return { bucket: VIDEO_ASSETS_BUCKET, objectPath: ref };
}

export function formatStorageRef(bucket: string, objectPath: string): string {
  return `supabase://${bucket}/${objectPath}`;
}
