import { Injectable } from "@nestjs/common";
import { google, drive_v3 } from "googleapis";
import { Readable } from "node:stream";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createDriveOAuthClient } from "../../google/google-auth";

const RUNWAY_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const RUNWAY_IMAGE_MAX_BYTES = 200 * 1024 * 1024;
export type RunwayImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export function extractGoogleDriveFileId(reference: string) {
  const url = new URL(reference);
  if (!["drive.google.com", "drive.usercontent.google.com"].includes(url.hostname)) {
    throw new Error("APPROVED_KEYFRAME_MUST_BE_GOOGLE_DRIVE");
  }
  const pathMatch = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
  const fileId = pathMatch?.[1] ?? url.searchParams.get("id");
  if (!fileId || !/^[A-Za-z0-9_-]{10,}$/.test(fileId)) throw new Error("APPROVED_KEYFRAME_DRIVE_ID_INVALID");
  return fileId;
}

@Injectable()
export class DriveConnector {
  private createClient(): drive_v3.Drive {
    return google.drive({ version: "v3", auth: createDriveOAuthClient() });
  }

  async getFolder(folderId: string) {
    const drive = this.createClient();
    const response = await drive.files.get({
      fileId: folderId,
      fields: "id,name,mimeType,webViewLink",
      supportsAllDrives: true,
    });
    return response.data;
  }

  async findChildFolder(parentId: string, name: string) {
    const drive = this.createClient();
    const escaped = name.replace(/'/g, "\\'");
    const response = await drive.files.list({
      q: `'${parentId}' in parents and name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id,name,webViewLink)", supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    const folder = response.data.files?.[0];
    if (!folder?.id) throw new Error(`Không tìm thấy thư mục ${name}`);
    return folder;
  }

  async uploadBuffer(parentId: string, name: string, mimeType: string, content: Buffer) {
    const drive = this.createClient();
    const response = await drive.files.create({
      requestBody: { name, mimeType, parents: [parentId] },
      media: { mimeType, body: Readable.from(content) },
      fields: "id,name,mimeType,size,webViewLink,webContentLink",
      supportsAllDrives: true,
    });
    if (!response.data.id) throw new Error(`Drive không trả file id cho ${name}`);
    return response.data;
  }

  async uploadPilotArtifact(projectFolderId: string, name: string, mimeType: string, content: Buffer) {
    const folder = await this.findChildFolder(projectFolderId, "04_PILOT");
    return this.uploadBuffer(folder.id as string, name, mimeType, content);
  }

  async uploadFullFilmArtifact(projectFolderId: string, name: string, mimeType: string, content: Buffer) {
    const folder = await this.findChildFolder(projectFolderId, "05_SAN_XUAT_PHIM");
    return this.uploadBuffer(folder.id as string, name, mimeType, content);
  }

  async uploadFullFilmArtifactFromFile(projectFolderId: string, name: string, mimeType: string, filePath: string) {
    const folder = await this.findChildFolder(projectFolderId, "05_SAN_XUAT_PHIM");
    const drive = this.createClient();
    const response = await drive.files.create({
      requestBody: { name, mimeType, parents: [folder.id as string] },
      media: { mimeType, body: createReadStream(filePath) },
      fields: "id,name,mimeType,size,webViewLink,webContentLink",
      supportsAllDrives: true,
    });
    if (!response.data.id) throw new Error(`Drive không trả file id cho ${name}`);
    return response.data;
  }

  async downloadBuffer(fileId: string) {
    const drive = this.createClient();
    const response = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
    return Buffer.from(response.data as ArrayBuffer);
  }

  async downloadToFile(fileId: string, filePath: string) {
    const drive = this.createClient();
    const response = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "stream" },
    );
    await pipeline(response.data as unknown as Readable, createWriteStream(filePath));
    return filePath;
  }

  async downloadPrivateRunwayImage(reference: string) {
    const fileId = extractGoogleDriveFileId(reference);
    const drive = this.createClient();
    const metadata = await drive.files.get({
      fileId,
      fields: "id,name,mimeType,size,md5Checksum",
      supportsAllDrives: true,
    });
    const mimeType = metadata.data.mimeType ?? "";
    const declaredSize = Number(metadata.data.size ?? 0);
    if (!RUNWAY_IMAGE_MIME_TYPES.has(mimeType)) throw new Error(`RUNWAY_KEYFRAME_MIME_UNSUPPORTED:${mimeType || "MISSING"}`);
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 512 || declaredSize > RUNWAY_IMAGE_MAX_BYTES) {
      throw new Error(`RUNWAY_KEYFRAME_SIZE_INVALID:${declaredSize}`);
    }
    const content = await this.downloadBuffer(fileId);
    if (content.length < 512 || content.length > RUNWAY_IMAGE_MAX_BYTES) throw new Error(`RUNWAY_KEYFRAME_SIZE_INVALID:${content.length}`);
    const extension = mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : ".jpg";
    const baseName = (metadata.data.name ?? `keyframe-${fileId}`).replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80) || `keyframe-${fileId}`;
    return { fileId, fileName: `${baseName}${extension}`, mimeType: mimeType as RunwayImageMimeType, content, md5Checksum: metadata.data.md5Checksum ?? undefined };
  }

  async readPilotJson<T>(projectFolderId: string, name: string): Promise<{ fileId: string; value: T } | null> {
    const drive = this.createClient();
    const folder = await this.findChildFolder(projectFolderId, "04_PILOT");
    const escaped = name.replace(/'/g, "\\'");
    const listed = await drive.files.list({
      q: `'${folder.id}' in parents and name='${escaped}' and trashed=false`, fields: "files(id)",
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    const fileId = listed.data.files?.[0]?.id;
    if (!fileId) return null;
    const response = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "text" });
    return { fileId, value: JSON.parse(String(response.data)) as T };
  }

  async writePilotJson(projectFolderId: string, name: string, value: unknown) {
    const drive = this.createClient();
    const content = Buffer.from(JSON.stringify(value, null, 2));
    const existing = await this.readPilotJson<unknown>(projectFolderId, name);
    if (existing) {
      await drive.files.update({ fileId: existing.fileId, media: { mimeType: "application/json", body: Readable.from(content) }, supportsAllDrives: true });
      return existing.fileId;
    }
    const file = await this.uploadPilotArtifact(projectFolderId, name, "application/json", content);
    return file.id as string;
  }
}
