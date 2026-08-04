import { Injectable } from "@nestjs/common";
import { google, drive_v3 } from "googleapis";
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
}
