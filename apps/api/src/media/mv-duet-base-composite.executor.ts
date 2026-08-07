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
export const RP015_MASTER_AUDIO_START_SECONDS = 362;
export const RP015_DUET_CUT_POINTS_SECONDS = [1.92, 3.84, 5.76, 7.68] as const;
export const RP015_MIN_AUDIO_MEAN_DB = -45;
export const RP015_MIN_AUDIO_MAX_DB = -40;

type VideoProbe = {
  width: number;
  height: number;
  duration_seconds: number;
};

export type VoiceReferenceEvaluation = {
  duration_seconds: number;
  sample_rate_hz: number;
  channels: number;
  mean_volume_db: number;
  max_volume_db: number;
  technical_status: "REFERENCE_CANDIDATE" | "NOT_USABLE";
};

export function classifyVoiceReference(durationSeconds: number, meanDb: number, maxDb: number) {
  return durationSeconds >= 20 && Number.isFinite(meanDb) && Number.isFinite(maxDb) && meanDb >= -45 && maxDb >= -40
    ? "REFERENCE_CANDIDATE" as const
    : "NOT_USABLE" as const;
}

export async function extractAndEvaluateVoiceReference(
  videoInputPath: string,
  wavOutputPath: string,
): Promise<VoiceReferenceEvaluation> {
  const probe = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels:format=duration", "-of", "json", videoInputPath],
    { timeout: 30_000, maxBuffer: 1024 * 1024, encoding: "utf8" },
  );
  const data = JSON.parse(probe.stdout) as { streams?: Array<{ sample_rate?: string; channels?: number }>; format?: { duration?: string } };
  const stream = data.streams?.[0];
  const durationSeconds = Number(data.format?.duration ?? 0);
  if (!stream || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { duration_seconds: durationSeconds || 0, sample_rate_hz: 0, channels: 0, mean_volume_db: -Infinity, max_volume_db: -Infinity, technical_status: "NOT_USABLE" };
  }
  await execFileAsync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-i", videoInputPath, "-vn", "-t", String(Math.min(30, durationSeconds)), "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", wavOutputPath],
    { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
  );
  const loudness = await execFileAsync(
    "ffmpeg",
    ["-hide_banner", "-i", wavOutputPath, "-af", "volumedetect", "-f", "null", "-"],
    { timeout: 30_000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" },
  );
  const meanDb = Number(loudness.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/)?.[1]);
  const maxDb = Number(loudness.stderr.match(/max_volume:\s*(-?[\d.]+) dB/)?.[1]);
  return {
    duration_seconds: durationSeconds,
    sample_rate_hz: Number(stream.sample_rate ?? 0),
    channels: Number(stream.channels ?? 0),
    mean_volume_db: meanDb,
    max_volume_db: maxDb,
    technical_status: classifyVoiceReference(durationSeconds, meanDb, maxDb),
  };
}

export function buildVoiceReferenceCleanupFfmpegArgs(inputPath: string, outputPath: string) {
  return [
    "-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, "-vn",
    "-af",
    "highpass=f=80,lowpass=f=12000,afftdn=nf=-30:tn=1,acompressor=threshold=-20dB:ratio=3:attack=10:release=100,loudnorm=I=-16:TP=-1.5:LRA=7",
    "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", outputPath,
  ];
}

export async function cleanAndEvaluateVoiceReference(
  inputPath: string,
  outputPath: string,
): Promise<VoiceReferenceEvaluation> {
  await execFileAsync(
    "ffmpeg",
    buildVoiceReferenceCleanupFfmpegArgs(inputPath, outputPath),
    { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 },
  );
  const probe = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels:format=duration", "-of", "json", outputPath],
    { timeout: 30_000, maxBuffer: 1024 * 1024, encoding: "utf8" },
  );
  const data = JSON.parse(probe.stdout) as { streams?: Array<{ sample_rate?: string; channels?: number }>; format?: { duration?: string } };
  const stream = data.streams?.[0];
  const durationSeconds = Number(data.format?.duration ?? 0);
  const loudness = await execFileAsync(
    "ffmpeg",
    ["-hide_banner", "-i", outputPath, "-af", "volumedetect", "-f", "null", "-"],
    { timeout: 30_000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" },
  );
  const meanDb = Number(loudness.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/)?.[1]);
  const maxDb = Number(loudness.stderr.match(/max_volume:\s*(-?[\d.]+) dB/)?.[1]);
  return {
    duration_seconds: durationSeconds,
    sample_rate_hz: Number(stream?.sample_rate ?? 0),
    channels: Number(stream?.channels ?? 0),
    mean_volume_db: meanDb,
    max_volume_db: maxDb,
    technical_status: classifyVoiceReference(durationSeconds, meanDb, maxDb),
  };
}

export type MvDuetCompositeUnit = {
  render_unit_id: string;
  start_seconds: number;
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
  durationSeconds = RP015_DURATION_SECONDS,
) {
  const requiredEnd = startSeconds + durationSeconds;
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
  options?: {
    durationSeconds: number;
    tuongVyOffset: number;
    phuongAnOffset: number;
  },
) {
  const durationSeconds = options?.durationSeconds ?? RP015_DURATION_SECONDS;
  const tuongVyOffset = options?.tuongVyOffset ?? RP015_TUONG_VY_SOURCE_START_SECONDS;
  const phuongAnOffset = options?.phuongAnOffset ?? RP015_PHUONG_AN_SOURCE_START_SECONDS;
  const loopInputs = Boolean(options);
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
    ...(loopInputs ? ["-stream_loop", "-1"] : []),
    "-ss",
    String(tuongVyOffset),
    "-t",
    String(durationSeconds),
    "-i",
    tuongVyInputPath,
    ...(loopInputs ? ["-stream_loop", "-1"] : []),
    "-ss",
    String(phuongAnOffset),
    "-t",
    String(durationSeconds),
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

export function selectRolloutSourceOffset(
  timelineStartSeconds: number,
  sourceDurationSeconds: number,
  outputDurationSeconds: number,
  pilotSourceOffsetSeconds: number,
) {
  if (
    !Number.isFinite(sourceDurationSeconds) || sourceDurationSeconds <= 0 ||
    !Number.isFinite(outputDurationSeconds) || outputDurationSeconds <= 0
  ) {
    throw new Error("Thời lượng nguồn hoặc render unit rollout không hợp lệ");
  }
  const usableWindow = sourceDurationSeconds - outputDurationSeconds;
  if (usableWindow <= 0) return 0;
  if (usableWindow === 0) return 0;
  return Number(((timelineStartSeconds + pilotSourceOffsetSeconds) % usableWindow).toFixed(3));
}

export async function executeMvDuetBaseCompositeUnit(
  unit: MvDuetCompositeUnit,
  tuongVyInputPath: string,
  phuongAnInputPath: string,
  outputPath: string,
) {
  if (
    !unit.render_unit_id ||
    unit.render_unit_id === "RP015" ||
    !Number.isFinite(unit.start_seconds) ||
    !Number.isFinite(unit.duration_seconds) ||
    unit.duration_seconds <= 0
  ) {
    throw new Error("Render unit rollout không hợp lệ");
  }
  const [tuongVyProbe, phuongAnProbe] = await Promise.all([
    probeVideo(tuongVyInputPath),
    probeVideo(phuongAnInputPath),
  ]);
  const tuongVyOffset = selectRolloutSourceOffset(
    unit.start_seconds,
    tuongVyProbe.duration_seconds,
    unit.duration_seconds,
    RP015_TUONG_VY_SOURCE_START_SECONDS,
  );
  const phuongAnOffset = selectRolloutSourceOffset(
    unit.start_seconds,
    phuongAnProbe.duration_seconds,
    unit.duration_seconds,
    RP015_PHUONG_AN_SOURCE_START_SECONDS,
  );
  if (
    tuongVyProbe.width <= 0 || tuongVyProbe.height <= 0 ||
    phuongAnProbe.width <= 0 || phuongAnProbe.height <= 0
  ) {
    throw new Error("Nguồn rollout không có video stream hợp lệ");
  }
  const args = buildMvDuetBaseCompositeFfmpegArgs(
    tuongVyInputPath,
    phuongAnInputPath,
    outputPath,
    { durationSeconds: unit.duration_seconds, tuongVyOffset, phuongAnOffset },
  );
  await execFileAsync("ffmpeg", args, {
    timeout: RP015_FFMPEG_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  const outputProbe = await probeVideo(outputPath);
  if (
    outputProbe.width !== RP015_OUTPUT_WIDTH ||
    outputProbe.height !== RP015_OUTPUT_HEIGHT ||
    !Number.isFinite(outputProbe.duration_seconds) ||
    Math.abs(outputProbe.duration_seconds - unit.duration_seconds) > 0.2
  ) {
    throw new Error(
      `${unit.render_unit_id} composite output không đạt 1920x1080/${unit.duration_seconds}s`,
    );
  }
  return {
    ...outputProbe,
    source_offsets: {
      tuong_vy_start_seconds: tuongVyOffset,
      phuong_an_start_seconds: phuongAnOffset,
    },
  };
}

export function buildRp015FinalProofFfmpegArgs(
  tuongVyInputPath: string,
  phuongAnInputPath: string,
  vocalMasterInputPath: string,
  outputPath: string,
) {
  const filter = [
    "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,split=3[tv0][tv1][tv2]",
    "[1:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,split=2[pa0][pa1]",
    "[tv0]trim=start=0:end=1.92,setpts=PTS-STARTPTS[c0]",
    "[pa0]trim=start=1.92:end=3.84,setpts=PTS-STARTPTS[c1]",
    "[tv1]trim=start=3.84:end=5.76,setpts=PTS-STARTPTS[c2]",
    "[pa1]trim=start=5.76:end=7.68,setpts=PTS-STARTPTS[c3]",
    "[tv2]trim=start=7.68:end=9.62,setpts=PTS-STARTPTS[c4]",
    "[c0][c1][c2][c3][c4]concat=n=5:v=1:a=0[outv]",
  ].join(";");
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", String(RP015_TUONG_VY_SOURCE_START_SECONDS), "-t", String(RP015_DURATION_SECONDS), "-i", tuongVyInputPath,
    "-ss", String(RP015_PHUONG_AN_SOURCE_START_SECONDS), "-t", String(RP015_DURATION_SECONDS), "-i", phuongAnInputPath,
    "-ss", String(RP015_MASTER_AUDIO_START_SECONDS),
    "-t", String(RP015_DURATION_SECONDS),
    "-i", vocalMasterInputPath,
    "-filter_complex", filter,
    "-map", "[outv]", "-map", "2:a:0",
    "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-shortest", "-movflags", "+faststart", outputPath,
  ];
}

export async function executeRp015FinalProof(
  tuongVyInputPath: string,
  phuongAnInputPath: string,
  vocalMasterInputPath: string,
  outputPath: string,
) {
  await execFileAsync(
    "ffmpeg",
    buildRp015FinalProofFfmpegArgs(tuongVyInputPath, phuongAnInputPath, vocalMasterInputPath, outputPath),
    { timeout: RP015_FFMPEG_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
  );
  const probe = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration", "-of", "json", outputPath],
    { timeout: 30_000, maxBuffer: 1024 * 1024, encoding: "utf8" },
  );
  const data = JSON.parse(probe.stdout) as {
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const video = data.streams?.find((stream) => stream.codec_type === "video");
  const audio = data.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(data.format?.duration);
  if (
    video?.width !== RP015_OUTPUT_WIDTH || video?.height !== RP015_OUTPUT_HEIGHT ||
    audio?.codec_name !== "aac" || !Number.isFinite(duration) || Math.abs(duration - RP015_DURATION_SECONDS) > 0.2
  ) throw new Error("RP015 final proof không đạt 1920x1080, audio AAC hoặc thời lượng 9.62 giây");
  const loudness = await execFileAsync(
    "ffmpeg",
    ["-hide_banner", "-i", outputPath, "-vn", "-af", "volumedetect", "-f", "null", "-"],
    { timeout: 30_000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" },
  );
  const meanDb = Number(loudness.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/)?.[1]);
  const maxDb = Number(loudness.stderr.match(/max_volume:\s*(-?[\d.]+) dB/)?.[1]);
  if (!Number.isFinite(meanDb) || !Number.isFinite(maxDb) || meanDb < RP015_MIN_AUDIO_MEAN_DB || maxDb < RP015_MIN_AUDIO_MAX_DB) {
    throw new Error(`RP015 vocal master không nghe được: mean=${meanDb}dB, max=${maxDb}dB`);
  }
  return { width: video.width, height: video.height, duration_seconds: duration, has_audio: true as const, audio_mean_db: meanDb, audio_max_db: maxDb };
}
