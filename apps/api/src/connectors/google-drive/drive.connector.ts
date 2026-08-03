import { Injectable } from "@nestjs/common";
import { google, drive_v3 } from "googleapis";

@Injectable()
export class DriveConnector {
  private createClient(): drive_v3.Drive {
    const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const auth = rawCredentials
      ? new google.auth.GoogleAuth({
          credentials: JSON.parse(rawCredentials) as Record<string, unknown>,
          scopes: ["https://www.googleapis.com/auth/drive"],
        })
      : new google.auth.GoogleAuth({
          scopes: ["https://www.googleapis.com/auth/drive"],
        });

    return google.drive({ version: "v3", auth });
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
