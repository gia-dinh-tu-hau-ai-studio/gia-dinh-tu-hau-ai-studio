import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const RP015_START_SECONDS = 362;
export const RP015_DURATION_SECONDS = 9.62;
export const RP015_TUONG_VY_SOURCE_START_SECONDS = 16.22;
export const RP015_PHUONG_AN_SOURCE_START_SECONDS = 15.42;
export const RP015_OUTPUT_WIDTH = 1920;
export const RP015_OUTPUT_HEIGHT = 1080;
export const RP015_FFMPEG_TIMEOUT_MS = 720_000;

type VideoProbe = {
  width: number;
  height: number;
  duration_seconds: number;
};

async function probeVideo(path: string): Promise<VideoProbe> {
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
      path,
    ],
    { timeout: 30_000, maxBuffer: 1024 * 1024, encoding: "utf8" },
  );
  const data = JSON.parse(probe.stdout) as {
    streams?: Array<{ width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const stream = data.streams?.[0];
  return {
    width: Number(stream?.width ?? 0),
    height: Number(stream?.height ?? 0),
    duration_seconds: Number(data.format?.duration),
  };
}

function assertSourceWindow(
  label: string,
  probe: VideoProbe,
  startSeconds: number,
) {
  const requiredEnd = startSeconds + RP015_DURATION_SECONDS;
  if (
    probe.width <= 0 ||
    probe.height <= 0 ||
    !Number.isFinite(probe.duration_seconds) ||
    probe.duration_seconds + 0.05 < requiredEnd
  ) {
    throw new Error(
      `Nguồn ${label} không đủ cho RP015: cần đến ${requiredEnd.toFixed(2)}s, thực tế ${probe.duration_seconds || 0}s/${probe.width}x${probe.height}`,
    );
  }
}

export function buildMvDuetBaseCompositeFfmpegArgs(
  tuongVyInputPath: string,
  phuongAnInputPath: string,
  outputPath: string,
) {
  const filter = [
    "[0:v]scale=960:1080:force_original_aspect_ratio=decrease,pad=960:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1[left]",
    "[1:v]scale=960:1080:force_original_aspect_ratio=decrease,pad=960:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1[right]",
    "[left][right]hstack=inputs=2[outv]",
  ].join(";");

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    String(RP015_TUONG_VY_SOURCE_START_SECONDS),
    "-t",
    String(RP015_DURATION_SECONDS),
    "-i",
    tuongVyInputPath,
    "-ss",
    String(RP015_PHUONG_AN_SOURCE_START_SECONDS),
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
  const [tuongVyProbe, phuongAnProbe] = await Promise.all([
    probeVideo(tuongVyInputPath),
    probeVideo(phuongAnInputPath),
  ]);
  assertSourceWindow(
    "Tường Vy",
    tuongVyProbe,
    RP015_TUONG_VY_SOURCE_START_SECONDS,
  );
  assertSourceWindow(
    "Phương An",
    phuongAnProbe,
    RP015_PHUONG_AN_SOURCE_START_SECONDS,
  );

  const args = buildMvDuetBaseCompositeFfmpegArgs(
    tuongVyInputPath,
    phuongAnInputPath,
    outputPath,
  );
  const startedAt = Date.now();
  console.log(JSON.stringify({
    event: "MV_DUET_BASE_COMPOSITE_FFMPEG_STARTED",
    render_unit_id: "RP015",
    timeout_ms: RP015_FFMPEG_TIMEOUT_MS,
    source_offsets: {
      tuong_vy_start_seconds: RP015_TUONG_VY_SOURCE_START_SECONDS,
      phuong_an_start_seconds: RP015_PHUONG_AN_SOURCE_START_SECONDS,
    },
    source_durations: {
      tuong_vy_seconds: tuongVyProbe.duration_seconds,
      phuong_an_seconds: phuongAnProbe.duration_seconds,
    },
  }));
  try {
    await execFileAsync("ffmpeg", args, {
      timeout: RP015_FFMPEG_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    const failure = error as Error & {
      stderr?: string;
      killed?: boolean;
      signal?: string;
    };
    const detail = [failure.message, failure.stderr]
      .filter(Boolean)
      .join(" | ")
      .replace(/\/tmp\/[^\s'"]+/g, "<temporary-file>")
      .replace(/\s+/g, " ")
      .slice(0, 2_000);
    console.error(JSON.stringify({
      event: "MV_DUET_BASE_COMPOSITE_FFMPEG_FAILED",
      render_unit_id: "RP015",
      elapsed_ms: Date.now() - startedAt,
      killed: Boolean(failure.killed),
      signal: failure.signal ?? null,
      error: detail,
    }));
    throw new Error(`FFmpeg RP015 thất bại: ${detail || "không có stderr"}`);
  }
  console.log(JSON.stringify({
    event: "MV_DUET_BASE_COMPOSITE_FFMPEG_COMPLETED",
    render_unit_id: "RP015",
    elapsed_ms: Date.now() - startedAt,
  }));

  const outputProbe = await probeVideo(outputPath);
  if (
    outputProbe.width !== RP015_OUTPUT_WIDTH ||
    outputProbe.height !== RP015_OUTPUT_HEIGHT ||
    !Number.isFinite(outputProbe.duration_seconds) ||
    Math.abs(outputProbe.duration_seconds - RP015_DURATION_SECONDS) > 0.2
  ) {
    throw new Error(
      `RP015 composite output không đạt 1920x1080/9.62s: ${outputProbe.width}x${outputProbe.height}/${outputProbe.duration_seconds || 0}s`,
    );
  }
  return {
    width: outputProbe.width,
    height: outputProbe.height,
    duration_seconds: outputProbe.duration_seconds,
    source_offsets: {
      tuong_vy_start_seconds: RP015_TUONG_VY_SOURCE_START_SECONDS,
      phuong_an_start_seconds: RP015_PHUONG_AN_SOURCE_START_SECONDS,
    },
    source_durations: {
      tuong_vy_seconds: tuongVyProbe.duration_seconds,
      phuong_an_seconds: phuongAnProbe.duration_seconds,
    },
  };
}
