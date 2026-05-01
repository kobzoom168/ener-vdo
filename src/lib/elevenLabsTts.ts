import { env } from "../config/env.js";
import { alignmentToSrt } from "./alignmentToSrt.js";

type TimestampsResponse = {
  audio_base64: string;
  alignment?: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  } | null;
  normalized_alignment?: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  } | null;
};

export type ElevenLabsAudioArtifacts = {
  mp3: Buffer;
  srt: string;
};

export async function synthesizeThaiWithSubtitles(
  scriptText: string
): Promise<ElevenLabsAudioArtifacts> {
  const voiceId = env.elevenLabsVoiceId();
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": env.elevenLabsApiKey(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      text: scriptText,
      model_id: "eleven_v3",
      apply_text_normalization: "auto",
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${t.slice(0, 500)}`);
  }

  const data = (await res.json()) as TimestampsResponse;
  const mp3 = Buffer.from(data.audio_base64, "base64");
  const align = data.alignment ?? data.normalized_alignment;
  if (!align) {
    throw new Error("ElevenLabs response missing alignment for subtitles");
  }
  const srt = alignmentToSrt(align, {
    maxCharsPerLine: env.subtitleMaxCharsPerLine(),
    maxLines: env.subtitleMaxLines(),
    minCueSec: env.subtitleMinCueSec(),
    maxCueSec: env.subtitleMaxCueSec(),
  });
  if (!srt.trim()) {
    throw new Error("Failed to build SRT from alignment");
  }
  return { mp3, srt };
}
