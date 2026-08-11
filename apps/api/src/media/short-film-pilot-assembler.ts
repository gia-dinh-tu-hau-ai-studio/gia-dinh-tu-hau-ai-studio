import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

function run(command: string, args: string[], timeoutMs = 180_000) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", (chunk) => { error += String(chunk).slice(-4_000); });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${command} timeout`)); }, timeoutMs);
    child.on("error", reject);
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${error.slice(-2_000)}`)); });
  });
}

export type VideoTechnicalEvidence = {
  duration_seconds: number;
  width: number;
  height: number;
  has_audio: boolean;
};

async function probeVideo(path: string): Promise<VideoTechnicalEvidence> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", path]);
    let output = "", error = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { error += String(chunk).slice(-2_000); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${error.slice(-1_000)}`));
      try {
        const parsed = JSON.parse(output) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> };
        const video = parsed.streams?.find((stream) => stream.codec_type === "video");
        resolve({
          duration_seconds: Number(parsed.format?.duration ?? 0),
          width: Number(video?.width ?? 0),
          height: Number(video?.height ?? 0),
          has_audio: Boolean(parsed.streams?.some((stream) => stream.codec_type === "audio")),
        });
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

export async function probeVideoBuffer(input: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), "tuhau-probe-"));
  try {
    const source = join(directory, "source.mp4");
    await writeFile(source, input);
    return await probeVideo(source);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function hasAudio(path: string) {
  return new Promise<boolean>((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path]);
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(Boolean(output.trim())) : reject(new Error("ffprobe failed")));
  });
}

export async function assembleVideoBuffers(inputs: Buffer[], expectedDurationSeconds?: number) {
  if (inputs.length === 0) throw new Error("VIDEO_INPUTS_REQUIRED");
  const directory = await mkdtemp(join(tmpdir(), "tuhau-pilot-"));
  try {
    const normalized: string[] = [];
    for (let index = 0; index < inputs.length; index += 1) {
      const input = join(directory, `input-${index}.mp4`);
      const output = join(directory, `normalized-${index}.mp4`);
      await writeFile(input, inputs[index]);
      const common = ["-y", "-i", input];
      const video = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,fps=30";
      if (await hasAudio(input)) {
        await run("ffmpeg", [...common, "-vf", video, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-ar", "48000", "-ac", "2", output]);
      } else {
        await run("ffmpeg", [...common, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-vf", video, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-shortest", output]);
      }
      normalized.push(output);
    }
    const list = join(directory, "concat.txt");
    await writeFile(list, normalized.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join("\n"));
    const result = join(directory, "pilot-sample.mp4");
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", result]);
    const evidence = await probeVideo(result);
    if (expectedDurationSeconds !== undefined && Math.abs(evidence.duration_seconds - expectedDurationSeconds) > 0.25) {
      throw new Error(`VIDEO_ASSEMBLY_DURATION_MISMATCH:expected=${expectedDurationSeconds}:actual=${evidence.duration_seconds.toFixed(3)}`);
    }
    return await readFile(result);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function trimVideoBuffer(input: Buffer, durationSeconds: number) {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 30) throw new Error("VIDEO_TRIM_DURATION_INVALID");
  const directory = await mkdtemp(join(tmpdir(), "tuhau-trim-"));
  try {
    const source = join(directory, "source.mp4");
    const output = join(directory, "trimmed.mp4");
    await writeFile(source, input);
    const sourceEvidence = await probeVideo(source);
    if (sourceEvidence.duration_seconds + 0.25 < durationSeconds) {
      throw new Error(`VIDEO_SOURCE_TOO_SHORT:expected=${durationSeconds}:actual=${sourceEvidence.duration_seconds.toFixed(3)}`);
    }
    await run("ffmpeg", ["-y", "-i", source, "-t", String(durationSeconds), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", output]);
    const outputEvidence = await probeVideo(output);
    if (Math.abs(outputEvidence.duration_seconds - durationSeconds) > 0.25) {
      throw new Error(`VIDEO_TRIM_DURATION_MISMATCH:expected=${durationSeconds}:actual=${outputEvidence.duration_seconds.toFixed(3)}`);
    }
    return await readFile(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function fitAudioBuffer(input: Buffer, durationSeconds: number) {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 30) throw new Error("AUDIO_FIT_DURATION_INVALID");
  const directory = await mkdtemp(join(tmpdir(), "tuhau-audio-fit-"));
  try {
    const source = join(directory, "source.mp3");
    const output = join(directory, "fitted.mp3");
    await writeFile(source, input);
    await run("ffmpeg", ["-y", "-i", source, "-af", `apad=whole_dur=${durationSeconds}`, "-t", String(durationSeconds), "-c:a", "libmp3lame", "-ar", "44100", "-ac", "1", output]);
    return await readFile(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function assemblePilotSample(urls: string[], fetcher: typeof fetch = fetch) {
  const inputs: Buffer[] = [];
  for (const url of urls) {
    const response = await fetcher(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`PILOT_OUTPUT_DOWNLOAD_HTTP_${response.status}`);
    inputs.push(Buffer.from(await response.arrayBuffer()));
  }
  return assembleVideoBuffers(inputs);
}
