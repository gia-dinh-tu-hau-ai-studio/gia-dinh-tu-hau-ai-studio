import { DriveConnector, extractGoogleDriveFileId } from "../connectors/google-drive/drive.connector";
import { RunwayPilotProvider } from "./short-film-pilot.providers";
import { spawn } from "node:child_process";

export type RunwayAssetCache = Record<string, { uri: string; expires_at: string; md5_checksum?: string }>;

export const LOCKED_FACE_CROP_FILTER = "crop='min(iw,ih/2)':'min(iw,ih/2)':'(iw-min(iw,ih/2))/2':0,scale=1024:1024:flags=lanczos";

async function createLockedFaceDerivative(content: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vf", LOCKED_FACE_CROP_FILTER, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], { stdio: ["pipe", "pipe", "pipe"] });
    const output: Buffer[] = [], errors: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(Buffer.concat(output)) : reject(new Error(`LOCKED_FACE_CROP_FAILED:${Buffer.concat(errors).toString("utf8").slice(0, 300)}`)));
    child.stdin.end(content);
  });
}

export async function preparePrivateRunwayKeyframe(input: {
  referenceUrl: string;
  cache: RunwayAssetCache;
  drive: DriveConnector;
  runway: RunwayPilotProvider;
  now?: Date;
}) {
  const fileId = extractGoogleDriveFileId(input.referenceUrl);
  const now = input.now ?? new Date();
  const cached = input.cache[fileId];
  if (cached?.uri.startsWith("runway://") && Date.parse(cached.expires_at) - now.getTime() > 5 * 60_000) return cached.uri;
  const image = await input.drive.downloadPrivateRunwayImage(input.referenceUrl);
  const uploaded = await input.runway.uploadImage({
    content: image.content,
    fileName: image.fileName,
    mimeType: image.mimeType,
  });
  input.cache[fileId] = {
    uri: uploaded.uri,
    expires_at: new Date(now.getTime() + 23 * 60 * 60_000).toISOString(),
    md5_checksum: image.md5Checksum,
  };
  return uploaded.uri;
}

export async function preparePrivateRunwayCharacterFace(input: {
  faceReferenceUrl: string;
  bodyReferenceUrl: string;
  cache: RunwayAssetCache;
  drive: DriveConnector;
  runway: RunwayPilotProvider;
  now?: Date;
}) {
  if (input.faceReferenceUrl !== input.bodyReferenceUrl) {
    return preparePrivateRunwayKeyframe({ referenceUrl: input.faceReferenceUrl, cache: input.cache, drive: input.drive, runway: input.runway, now: input.now });
  }
  const fileId = extractGoogleDriveFileId(input.faceReferenceUrl);
  const cacheKey = `${fileId}:FACE_DERIVATIVE_V1`;
  const now = input.now ?? new Date();
  const cached = input.cache[cacheKey];
  if (cached?.uri.startsWith("runway://") && Date.parse(cached.expires_at) - now.getTime() > 5 * 60_000) return cached.uri;
  const image = await input.drive.downloadPrivateRunwayImage(input.faceReferenceUrl);
  const derivative = await createLockedFaceDerivative(image.content);
  if (derivative.length < 512) throw new Error("LOCKED_FACE_DERIVATIVE_EMPTY");
  const uploaded = await input.runway.uploadImage({ content: derivative, fileName: `${fileId}_LOCKED_FACE_DERIVATIVE_V1.png`, mimeType: "image/png" });
  input.cache[cacheKey] = { uri: uploaded.uri, expires_at: new Date(now.getTime() + 23 * 60 * 60_000).toISOString(), md5_checksum: image.md5Checksum };
  return uploaded.uri;
}
