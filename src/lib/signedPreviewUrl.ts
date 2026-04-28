import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { parseStorageRef } from "./storagePaths.js";

export async function createSignedUrlForRef(
  ref: string | null,
  expiresSec: number
): Promise<string | null> {
  const parsed = parseStorageRef(ref);
  if (!parsed) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.objectPath, expiresSec);
  if (error) throw new Error(`createSignedUrl failed: ${error.message}`);
  return data.signedUrl;
}
