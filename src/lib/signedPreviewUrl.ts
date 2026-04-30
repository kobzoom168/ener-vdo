import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { parseStorageRef } from "./storagePaths.js";

export async function createSignedUrlForRef(
  ref: string | null,
  expiresSec: number
): Promise<string | null> {
  const parsed = parseStorageRef(ref);
  if (!parsed) return null;
  return createSignedUrlForObject(parsed.bucket, parsed.objectPath, expiresSec);
}

export async function createSignedUrlForObject(
  bucket: string,
  objectPath: string,
  expiresSec: number
): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(objectPath, expiresSec);
  if (error) throw new Error(`createSignedUrl failed: ${error.message}`);
  return data.signedUrl;
}
