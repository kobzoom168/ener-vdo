import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { VIDEO_ASSETS_BUCKET } from "./videoJobTypes.js";
import { formatStorageRef } from "./storagePaths.js";

export async function uploadBytes(params: {
  objectPath: string;
  body: Buffer;
  contentType: string;
}): Promise<string> {
  return uploadBytesToBucket({
    bucket: VIDEO_ASSETS_BUCKET,
    objectPath: params.objectPath,
    body: params.body,
    contentType: params.contentType,
  });
}

export async function uploadBytesToBucket(params: {
  bucket: string;
  objectPath: string;
  body: Buffer;
  contentType: string;
}): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage
    .from(params.bucket)
    .upload(params.objectPath, params.body, {
      contentType: params.contentType,
      upsert: true,
    });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return formatStorageRef(params.bucket, params.objectPath);
}

export async function downloadStorageObject(
  bucket: string,
  objectPath: string
): Promise<Buffer> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(bucket)
    .download(objectPath);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}
