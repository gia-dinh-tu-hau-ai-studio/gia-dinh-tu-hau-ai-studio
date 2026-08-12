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
    for (let index = 0; index < inputs.length; index += 1) {
      await writeFile(join(directory, `input-${index}.mp4`), inputs[index]);
    }
    const result = join(directory, "pilot-sample.mp4");
    await assembleVideoFiles(inputs.map((_, index) => join(directory, `input-${index}.mp4`)), result, expectedDurationSeconds);
    return await readFile(result);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Assemble from disk so a full film never keeps every source clip in memory. */
export async function assembleVideoFiles(inputs: string[], outputPath: string, expectedDurationSeconds?: number) {
  if (inputs.length === 0) throw new Error("VIDEO_INPUTS_REQUIRED");
  const directory = await mkdtemp(join(tmpdir(), "tuhau-film-assembly-"));
  try {
    const normalized: string[] = [];
    for (let index = 0; index < inputs.length; index += 1) {
      const output = join(directory, `normalized-${index}.mp4`);
      const common = ["-y", "-i", inputs[index]];
      const video = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,fps=30";
      if (await hasAudio(inputs[index])) {
        await run("ffmpeg", [...common, "-vf", video, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-ar", "48000", "-ac", "2", output]);
      } else {
        await run("ffmpeg", [...common, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-vf", video, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-shortest", output]);
      }
      normalized.push(output);
    }
    const list = join(directory, "concat.txt");
    await writeFile(list, normalized.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join("\n"));
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", outputPath], 900_000);
    const evidence = await probeVideo(outputPath);
    if (expectedDurationSeconds !== undefined && Math.abs(evidence.duration_seconds - expectedDurationSeconds) > 0.25) {
      throw new Error(`VIDEO_ASSEMBLY_DURATION_MISMATCH:expected=${expectedDurationSeconds}:actual=${evidence.duration_seconds.toFixed(3)}`);
    }
    return evidence;
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

export async function createPurposefulCoverageClip(input: Buffer, purpose: "PHONE_EVIDENCE_INSERT" | "LISTENER_REACTION" | "LOCATION_CONTEXT", durationSeconds: number) {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 10) throw new Error("COVERAGE_DURATION_INVALID");
  const directory = await mkdtemp(join(tmpdir(), "tuhau-coverage-"));
  try {
    const source = join(directory, "source.png"), output = join(directory, "coverage.mp4"); await writeFile(source, input);
    const base = "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='min(zoom+0.0005,1.04)':d=1:s=1920x1080:fps=30";
    const filter = purpose === "PHONE_EVIDENCE_INSERT"
      ? `${base},drawbox=x=570:y=90:w=780:h=900:color=black@0.82:t=fill,drawbox=x=610:y=170:w=700:h=130:color=white@0.94:t=fill,drawbox=x=610:y=330:w=700:h=360:color=white@0.94:t=fill,drawbox=x=610:y=735:w=700:h=130:color=0xC62828@0.95:t=fill,drawtext=text='VIEC NHE - LUONG CAO':fontcolor=black:fontsize=42:x=650:y=210,drawtext=text='YEU CAU CHUYEN TIEN GIU CHO':fontcolor=0xC62828:fontsize=37:x=650:y=455,drawtext=text='CANH BAO LUA DAO':fontcolor=white:fontsize=44:x=720:y=775`
      : purpose === "LISTENER_REACTION"
        ? `${base},crop=1500:1080:210:0,scale=1920:1080`
        : `${base},eq=brightness=-0.05:saturation=0.85`;
    await run("ffmpeg", ["-y", "-loop", "1", "-i", source, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-vf", filter, "-t", String(durationSeconds), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", output]);
    const evidence = await probeVideo(output); if (Math.abs(evidence.duration_seconds - durationSeconds) > 0.25 || evidence.width !== 1920 || evidence.height !== 1080 || !evidence.has_audio) throw new Error(`COVERAGE_TECHNICAL_QC_FAILED:${purpose}`);
    return await readFile(output);
  } finally { await rm(directory, { recursive: true, force: true }); }
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
