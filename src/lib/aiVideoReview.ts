import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import type { VideoQcAiReviewJson, VideoQcIssue } from "./videoJobTypes.js";

function heuristicReview(): VideoQcAiReviewJson {
  return {
    passed: true,
    score: 72,
    issues: [],
    summary:
      "AI review แบบ vision ยังไม่ได้รัน (ใช้โหมดสำรอง) — ระบบจะพึ่งการตรวจเสียง/ซับ/วิดีโอเป็นหลัก",
    recommendations: [],
  };
}

function parseJsonFromAssistant(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : trimmed;
  return JSON.parse(raw) as unknown;
}

/**
 * Optional vision-based review. Never required for pipeline; on failure returns heuristic.
 */
export async function runAiVideoReview(params: {
  framePaths: string[];
  scriptText: string | null;
  subtitleSnippet: string;
  anthropicApiKey: string | null;
}): Promise<VideoQcAiReviewJson> {
  if (!params.anthropicApiKey || params.framePaths.length === 0) {
    return heuristicReview();
  }

  try {
    const images: Array<{
      type: "image";
      source: { type: "base64"; media_type: "image/png" | "image/jpeg"; data: string };
    }> = [];
    for (const p of params.framePaths) {
      const buf = await readFile(p);
      const b64 = buf.toString("base64");
      const isPng = p.toLowerCase().endsWith(".png");
      const media_type: "image/png" | "image/jpeg" = isPng ? "image/png" : "image/jpeg";
      images.push({
        type: "image",
        source: {
          type: "base64",
          media_type,
          data: b64,
        },
      });
    }

    const client = new Anthropic({ apiKey: params.anthropicApiKey });
    const userText =
      "คุณเป็นผู้ตรวจคุณภาพคลิปสั้นแนวตั้ง (ไทย) ก่อนส่งมนุษย์\n" +
      "ดูภาพ keyframe ที่แนบ + script + ตัวอย่างซับ แล้วตอบเป็น JSON เท่านั้น (ไม่มี markdown นอก JSON)\n" +
      "รูปแบบ:\n" +
      '{"passed":boolean,"score":0-100,"summary":"ภาษาไทยสั้นๆ","issues":[{"severity":"error"|"warning","code":"STRING","message":"ภาษาไทย"}],"recommendations":["ภาษาไทย"],"severe":boolean}\n' +
      "severe=true เมื่อคลิปใช้ไม่ได้จริงๆ (ภาพพังทั้งคลิป/สับสนอย่างรุนแรง)\n\n" +
      `script (อาจย่อ):\n${(params.scriptText ?? "").slice(0, 1200)}\n\n` +
      `ตัวอย่างซับ:\n${params.subtitleSnippet.slice(0, 1500)}`;

    const msg = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 1200,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            ...images,
          ],
        },
      ],
    });

    const block = msg.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("no text from model");
    const parsed = parseJsonFromAssistant(block.text) as Record<string, unknown>;
    const issues = (Array.isArray(parsed.issues) ? parsed.issues : []) as VideoQcIssue[];
    const recommendations = (Array.isArray(parsed.recommendations)
      ? parsed.recommendations
      : []
    ).map(String);
    const severe = parsed.severe === true;
    const score = Math.min(100, Math.max(0, Number(parsed.score) || 60));
    let passed = parsed.passed !== false;
    if (severe) passed = false;

    return {
      passed,
      score,
      issues,
      summary: String(parsed.summary ?? ""),
      recommendations,
    };
  } catch {
    const h = heuristicReview();
    h.summary =
      "AI review ข้าม: เรียกโมเดลไม่สำเร็จ — " + h.summary;
    h.issues.push({
      severity: "warning",
      code: "AI_REVIEW_SKIPPED",
      message: "ไม่สามารถวิเคราะห์ภาพด้วย AI ได้ในครั้งนี้",
    });
    return h;
  }
}
