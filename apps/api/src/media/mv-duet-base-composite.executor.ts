import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const RP015_START_SECONDS = 362;
export const RP015_DURATION_SECONDS = 9.62;
export const RP015_OUTPUT_WIDTH = 1920;
export const RP015_OUTPUT_HEIGHT = 1080;

export function buildMvDuetBaseCompositeFfmpegArgs(
  tuongVyInputPath: string,
  phuongAnInputPath: string,
  outputPath: string,
) {
  const filter = [
    "[0:v]scale=960:1080:force_original_aspect_ratio=decrease",
    "pad=960:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1[left]",
    "[1:v]scale=960:1080:force_original_aspect_ratio=decrease",
    "pad=960:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1[right]",
    "[left][right]hstack=inputs=2[outv]",
  ].join(";");

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    String(RP015_START_SECONDS),
    "-t",
    String(RP015_DURATION_SECONDS),
    "-i",
    tuongVyInputPath,
    "-ss",
    String(RP015_START_SECONDS),
    "-t",
    String(RP015_DURATION_SECONDS),
    "-i",
    phuongAnInputPath,
    "-filter_complex",
    filter,
    "-map",
    "[outv]",
    "-an",
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

export async function executeMvDuetBaseComposite(
  tuongVyInputPath: string,
  phuongAnInputPath: string,
  outputPath: string,
) {
  const args = buildMvDuetBaseCompositeFfmpegArgs(
    tuongVyInputPath,
    phuongAnInputPath,
    outputPath,
  );
  await execFileAsync("ffmpeg", args, {
    timeout: 240_000,
    maxBuffer: 4 * 1024 * 1024,
  });

  const probe = await execFileAsync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height:format=duration",
      "-of",
      "json",
      outputPath,
    ],
    { timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  const data = JSON.parse(probe.stdout) as {
    streams?: Array<{ width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const stream = data.streams?.[0];
  const duration = Number(data.format?.duration);
  if (
    stream?.width !== RP015_OUTPUT_WIDTH ||
    stream?.height !== RP015_OUTPUT_HEIGHT ||
    !Number.isFinite(duration) ||
    Math.abs(duration - RP015_DURATION_SECONDS) > 0.2
  ) {
    throw new Error(
      `RP015 composite output không đạt 1920x1080/9.62s: ${stream?.width ?? 0}x${stream?.height ?? 0}/${duration || 0}s`,
    );
  }
  return {
    width: stream.width,
    height: stream.height,
    duration_seconds: duration,
  };
}
