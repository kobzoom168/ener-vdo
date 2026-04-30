import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import { execSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function resolveFfmpegPath(): string {
  try {
    const sys = execSync("which ffmpeg", { encoding: "utf8" }).trim();
    if (sys) return sys;
  } catch {}
  return ffmpegInstaller.path;
}

ffmpeg.setFfmpegPath(resolveFfmpegPath());

/** Escape path for subtitles='...' / fontsdir='...' inside -vf / -filter_complex. */
function escapePathForSubtitlesFilter(p: string): string {
  let n = p.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(n)) {
    n = `${n[0]}\\:${n.slice(3)}`;
  } else {
    n = n.replace(/:/g, "\\:");
  }
  return n.replace(/'/g, "'\\''");
}

function subtitlesFilterFromSrtPath(srtPath: string): string {
  const srt = escapePathForSubtitlesFilter(srtPath);
  const style =
    "Alignment=2,MarginV=60,MarginL=60,MarginR=60,Fontsize=10,Bold=1,Outline=2,Shadow=1,PrimaryColour=&Hffffff&,OutlineColour=&H000000&,WrapStyle=2";
  return `subtitles='${srt}':charenc=UTF-8:force_style='${style}'`;
}

const OUTPUT_OPTS = [
  "-shortest",
  "-pix_fmt",
  "yuv420p",
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "22",
  "-c:a",
  "aac",
  "-b:a",
  "192k",
] as const;

export async function renderVerticalBrandedMp4(params: {
  mp3Path: string;
  srtPath: string;
  outPath: string;
  backgroundVideoPath?: string;
}): Promise<void> {
  const sub = subtitlesFilterFromSrtPath(params.srtPath);

  await new Promise<void>((resolve, reject) => {
    const cmd = ffmpeg();

    if (params.backgroundVideoPath) {
      const graph = [
        "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[bg]",
        `[bg]${sub}[v]`,
        "[0:a]volume=0.15[ambient]",
        "[1:a]volume=1.0[voice]",
        "[ambient][voice]amix=inputs=2:duration=shortest[a]",
      ].join(";");
      cmd
        .input(params.backgroundVideoPath)
        .inputOptions(["-stream_loop", "-1"])
        .input(params.mp3Path)
        .complexFilter(graph)
        .outputOptions(["-map", "[v]", "-map", "[a]", ...OUTPUT_OPTS])
        .output(params.outPath);
    } else {
      cmd
        .input("color=c=black:s=1080x1920:r=30")
        .inputFormat("lavfi")
        .input(params.mp3Path)
        .outputOptions(["-vf", sub, ...OUTPUT_OPTS])
        .output(params.outPath);
    }

    cmd
      .on("error", (err, _stdout, stderr) => {
        reject(
          new Error(
            `ffmpeg failed: ${err.message}\n${stderr?.slice?.(0, 4000) ?? ""}`
          )
        );
      })
      .on("end", () => resolve())
      .run();
  });
}

export async function renderVerticalBrandedMp4FromBuffers(params: {
  mp3: Buffer;
  srtUtf8: string;
  backgroundVideoBuffer?: Buffer;
}): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "ener-vdo-"));
  try {
    const mp3Path = join(dir, "voice.mp3");
    const srtPath = join(dir, "subs.srt");
    const outPath = join(dir, "final.mp4");
    await writeFile(mp3Path, params.mp3);
    await writeFile(srtPath, params.srtUtf8, "utf8");
    let backgroundVideoPath: string | undefined;
    if (params.backgroundVideoBuffer?.length) {
      backgroundVideoPath = join(dir, "background.mp4");
      await writeFile(backgroundVideoPath, params.backgroundVideoBuffer);
    }
    await renderVerticalBrandedMp4({
      mp3Path,
      srtPath,
      outPath,
      backgroundVideoPath,
    });
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
