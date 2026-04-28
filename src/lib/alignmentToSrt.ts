type Alignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
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

export function alignmentToSrt(alignment: Alignment): string {
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
      const compact = buf.replace(/\s+/g, "").length;
      if (compact >= 34) break;
      if (span >= 4.2 && compact >= 10) break;
      if (/[.!?…]$/.test(buf.trimEnd()) && buf.trim().length >= 12) break;
    }

    const t = buf.trim();
    if (t) {
      blocks.push(
        `${cue++}\n${toSrtTimestamp(lineStart)} --> ${toSrtTimestamp(lastEnd)}\n${t}\n`
      );
    }
  }

  return blocks.join("\n").trimEnd();
}
