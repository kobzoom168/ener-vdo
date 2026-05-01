import "dotenv/config";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function opt(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  supabaseUrl: () => req("SUPABASE_URL"),
  supabaseServiceRoleKey: () => req("SUPABASE_SERVICE_ROLE_KEY"),

  anthropicApiKey: () => req("ANTHROPIC_API_KEY"),
  /** Optional for workers that do not need Claude (e.g. QC vision off). */
  anthropicApiKeyOptional: (): string | null => {
    const v = process.env.ANTHROPIC_API_KEY;
    return v && v.trim() ? v.trim() : null;
  },
  elevenLabsApiKey: () => req("ELEVENLABS_API_KEY"),
  elevenLabsVoiceId: () => req("ELEVENLABS_VOICE_ID"),
  subtitleFontSize: () => optInt("SUBTITLE_FONTSIZE", 8),
  subtitleMaxCharsPerLine: () => optInt("SUBTITLE_MAX_CHARS_PER_LINE", 17),
  subtitleMaxLines: () => optInt("SUBTITLE_MAX_LINES", 2),
  subtitleMinCueSec: () => {
    const raw = process.env.SUBTITLE_MIN_CUE_SEC;
    if (raw === undefined || raw === "") return 0.5;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0.5;
  },
  subtitleMaxCueSec: () => {
    const raw = process.env.SUBTITLE_MAX_CUE_SEC;
    if (raw === undefined || raw === "") return 6;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 6;
  },
  maxFootageUploadMb: () => optInt("MAX_FOOTAGE_UPLOAD_MB", 200),

  workerPollMs: () => optInt("WORKER_POLL_MS", 3000),
  workerMaxRetries: () => optInt("WORKER_MAX_RETRIES", 5),
  workerBaseBackoffMs: () => optInt("WORKER_BASE_BACKOFF_MS", 2000),

  adminCorsOrigins: () =>
    opt("ADMIN_CORS_ORIGINS", "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
};
