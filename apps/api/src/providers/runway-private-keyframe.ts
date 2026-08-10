import { DriveConnector, extractGoogleDriveFileId } from "../connectors/google-drive/drive.connector";
import { RunwayPilotProvider } from "./short-film-pilot.providers";

export type RunwayAssetCache = Record<string, { uri: string; expires_at: string; md5_checksum?: string }>;

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
