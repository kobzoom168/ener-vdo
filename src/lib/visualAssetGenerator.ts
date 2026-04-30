import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { VisualAssetRow } from "./visualAssetTypes.js";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapPromptLines(text: string, maxChars: number): string[] {
  const t = text.trim() || "…";
  const lines: string[] = [];
  let cur = "";
  for (const ch of Array.from(t)) {
    if (cur.length >= maxChars) {
      lines.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur.length) lines.push(cur);
  return lines.slice(0, 14);
}

/**
 * Placeholder 9:16 card (1080×1920 PNG). Swap implementation later for a real image provider.
 */
export async function generateVisualAsset(
  asset: Pick<VisualAssetRow, "asset_type" | "prompt_text" | "id">
): Promise<Buffer> {
  const fontPath = join(process.cwd(), "assets", "fonts", "NotoSansThai-Regular.ttf");
  const fontB64 = readFileSync(fontPath).toString("base64");
  const lines = wrapPromptLines(asset.prompt_text, 18);
  const tspans = lines
    .map((line, i) => {
      const y = 700 + i * 68;
      return `<tspan x="540" y="${y}" text-anchor="middle">${escapeXml(line)}</tspan>`;
    })
    .join("\n");
  const typeLabel = asset.asset_type.replace(/_/g, " ");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style type="text/css"><![CDATA[
      @font-face {
        font-family: 'EnerThai';
        src: url('data:font/ttf;base64,${fontB64}') format('truetype');
        font-weight: normal;
        font-style: normal;
      }
      .head { font-family: 'EnerThai', 'Noto Sans Thai', sans-serif; font-size: 26px; fill: rgba(245,230,200,0.55); }
      .body { font-family: 'EnerThai', 'Noto Sans Thai', sans-serif; font-size: 42px; fill: #f5e6c8; }
      .foot { font-family: 'EnerThai', sans-serif; font-size: 24px; fill: #c9a227; }
    ]]></style>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1a1208"/>
      <stop offset="55%" stop-color="#120c06"/>
      <stop offset="100%" stop-color="#0a0603"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="18%" r="70%">
      <stop offset="0%" stop-color="#5c4010" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#bg)"/>
  <rect width="1080" height="1920" fill="url(#glow)"/>
  <rect x="72" y="420" width="936" height="3" fill="#8b6914" opacity="0.9"/>
  <text class="head" x="540" y="360" text-anchor="middle">${escapeXml(typeLabel)}</text>
  <text class="body" xml:space="preserve">${tspans}</text>
  <text class="foot" x="540" y="1840" text-anchor="middle">Ener · ภาพประกอบเชิงบรรยากาศ</text>
</svg>`;

  return await sharp(Buffer.from(svg)).png().toBuffer();
}
