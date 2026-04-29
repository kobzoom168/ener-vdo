import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";

const SYSTEM =
  "คุณเป็นผู้เชี่ยวชาญด้านพลังงานวัตถุมงคล เขียน script ภาษาไทยสำหรับคลิปสั้น 45-60 วินาที จากข้อมูลพลังงานที่ให้มา ไม่ต้องระบุชื่อพระหรือเครื่องราง พูดถึงพลังงานและความเหมาะสมกับผู้ใช้";

function sanitizeClaudeScript(raw: string): string {
  return raw
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .map((line) => line.replace(/\*\*/g, "").replace(/\*/g, ""))
    .join("\n")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

export async function generateThaiScriptFromContext(
  userContextJson: string
): Promise<string> {
  const client = new Anthropic({ apiKey: env.anthropicApiKey() });
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "ข้อมูลอ้างอิง (JSON):\n" +
              userContextJson +
              "\n\nเขียนเฉพาะบทพูดฉบับเดียว ไม่มีหัวข้อ ไม่มีเลขบรรทัด ไม่มีคำอธิบายเพิ่ม ใช้ภาษาไทยล้วน",
          },
        ],
      },
    ],
  });

  const parts = msg.content.filter((b) => b.type === "text") as Array<{
    type: "text";
    text: string;
  }>;
  const text = sanitizeClaudeScript(parts.map((p) => p.text).join("\n"));
  if (!text) throw new Error("Claude returned empty script");
  return text;
}
