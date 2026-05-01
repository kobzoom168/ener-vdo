type Alignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

export type SrtSegmentationOptions = {
  maxCharsPerLine: number;
  maxLines: number;
  minCueSec: number;
  maxCueSec: number;
};

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function pad3(n: number): string {
  return n.toString().padStart(3, "0");
}

function toSrtTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds)) seconds = 0;
  const whole = Math.max(0, seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = Math.floor(whole % 60);
  const ms = Math.min(999, Math.round((whole - Math.floor(whole)) * 1000));
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
}

/** Wrap Thai/other text into at most `maxLines` lines, ~`maxPerLine` codepoints each. */
function wrapCueText(text: string, maxPerLine: number, maxLines: number): string {
  const t = text.trim();
  const chars = Array.from(t);
  if (chars.length === 0) return "";
  if (chars.length <= maxPerLine || maxLines < 2) {
    return chars.slice(0, maxPerLine * maxLines).join("");
  }
  const first = chars.slice(0, maxPerLine).join("");
  const rest = chars.slice(maxPerLine, maxPerLine * maxLines);
  return `${first}\n${rest.join("")}`;
}

function compactLen(s: string): number {
  return Array.from(s.replace(/\s+/g, "")).length;
}

/**
 * Build SRT from ElevenLabs character alignment.
 * Tuned for Thai vertical shorts: max 2 lines, bounded line length, cue duration bounds.
 */
export function alignmentToSrt(
  alignment: Alignment,
  opts?: Partial<SrtSegmentationOptions>
): string {
  const maxCharsPerLine = opts?.maxCharsPerLine ?? 17;
  const maxLines = Math.min(2, Math.max(1, opts?.maxLines ?? 2));
  const minCueSec = opts?.minCueSec ?? 0.5;
  const maxCueSec = opts?.maxCueSec ?? 6;
  const maxCompactPerCue = maxCharsPerLine * maxLines;

  const chars = alignment.characters ?? [];
  const starts = alignment.character_start_times_seconds ?? [];
  const ends = alignment.character_end_times_seconds ?? [];
  const n = Math.min(chars.length, starts.length, ends.length);
  if (n === 0) return "";

  let i = 0;
  let cue = 1;
  const blocks: string[] = [];

  while (i < n) {
    const lineStart = starts[i] ?? 0;
    let buf = "";
    let lastEnd = ends[i] ?? lineStart;

    while (i < n) {
      buf += chars[i] ?? "";
      lastEnd = ends[i] ?? lastEnd;
      i++;

      const span = lastEnd - lineStart;
      const compact = compactLen(buf);
      if (compact >= maxCompactPerCue) break;
      if (span >= maxCueSec && compact >= 6) break;
      if (span >= maxCueSec * 0.85 && compact >= 10) break;
      if (/[.!?…]$/.test(buf.trimEnd()) && buf.trim().length >= 12 && span >= 1.2) break;
    }

    let t = buf.trim();
    if (!t || Array.from(t).length <= 1) continue;

    let endT = lastEnd;
    if (endT - lineStart < minCueSec) {
      endT = Math.min(lineStart + minCueSec, lineStart + maxCueSec);
    }

    const wrapped = wrapCueText(t, maxCharsPerLine, maxLines);
    if (wrapped.replace(/\n/g, "").trim().length <= 2) continue;

    blocks.push(
      `${cue++}\n${toSrtTimestamp(lineStart)} --> ${toSrtTimestamp(endT)}\n${wrapped}\n`
    );
  }

  return blocks.join("\n").trimEnd();
}
