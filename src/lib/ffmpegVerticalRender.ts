import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

function escapeFfmpegPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\\\:").replace(/'/g, "'\\\\''");
}

export async function renderVerticalBrandedMp4(params: {
  mp3Path: string;
  srtPath: string;
  outPath: string;
}): Promise<void> {
  const srtForFilter = escapeFfmpegPath(params.srtPath);
  const vf = [
    `subtitles='${srtForFilter}':charenc=UTF-8:force_style='Alignment=2,MarginV=140,Fontsize=20,Outline=2,Shadow=1'`,
    `drawtext=text='Ener Scan':fontcolor=white@0.9:fontsize=52:x=(w-text_w)/2:y=96:box=1:boxcolor=black@0.45:boxborderw=18`,
  ].join(",");

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input("color=c=black:s=1080x1920:r=30")
      .inputFormat("lavfi")
      .input(params.mp3Path)
      .outputOptions([
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
      ])
      .videoFilters(vf)
      .output(params.outPath)
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
}): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "ener-vdo-"));
  try {
    const mp3Path = join(dir, "voice.mp3");
    const srtPath = join(dir, "subs.srt");
    const outPath = join(dir, "final.mp4");
    await writeFile(mp3Path, params.mp3);
    await writeFile(srtPath, params.srtUtf8, "utf8");
    await renderVerticalBrandedMp4({ mp3Path, srtPath, outPath });
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
