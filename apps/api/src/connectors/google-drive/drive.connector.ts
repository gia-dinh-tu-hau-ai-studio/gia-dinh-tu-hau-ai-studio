import { Injectable } from "@nestjs/common";
import { google, drive_v3 } from "googleapis";
import { Readable } from "node:stream";
import { createDriveOAuthClient } from "../../google/google-auth";

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

  async downloadBuffer(fileId: string) {
    const drive = this.createClient();
    const response = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
    return Buffer.from(response.data as ArrayBuffer);
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
