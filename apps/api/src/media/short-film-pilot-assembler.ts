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

async function hasAudio(path: string) {
  return new Promise<boolean>((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path]);
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(Boolean(output.trim())) : reject(new Error("ffprobe failed")));
  });
}

export async function assembleVideoBuffers(inputs: Buffer[]) {
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
    return await readFile(result);
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
