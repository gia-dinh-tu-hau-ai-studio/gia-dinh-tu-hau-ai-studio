import { Injectable } from "@nestjs/common";
import type { NormalizedProjectIntake } from "@tu-hau/contracts";
import { randomUUID } from "node:crypto";
import { drive_v3, google, sheets_v4 } from "googleapis";

export class ProjectRegistryNotConfiguredError extends Error {}
export class ProjectRegistryUnavailableError extends Error {}

export type RegisteredProject = {
  project_id: string;
  project_name: string;
  project_type: string;
  project_folder_id: string;
  project_folder_url: string;
  current_stage: "CONTRACT";
  next_action: "APPROVE_CONTRACT";
  idempotent_replay: boolean;
};

function requiredSetting(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ProjectRegistryNotConfiguredError(`Thiếu cấu hình ${name}`);
  }
  return value;
}

function createAuth(scopes: string[]) {
  const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  return rawCredentials
    ? new google.auth.GoogleAuth({
        credentials: JSON.parse(rawCredentials) as Record<string, unknown>,
        scopes,
      })
    : new google.auth.GoogleAuth({ scopes });
}

function projectTypeCode(contract: NormalizedProjectIntake) {
  if (contract.project_subtype === "SHORT_MUSIC_CLIP") return "CLIP";
  return contract.project_type === "MUSIC_VIDEO" ? "MV" : "FILM";
}

export function buildProjectId(
  contract: NormalizedProjectIntake,
  now = new Date(),
  suffix = randomUUID().slice(0, 4).toUpperCase(),
) {
  const stamp = now.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  return `GDTH-${projectTypeCode(contract)}-${stamp}-${suffix}`;
}

function safeFolderName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
}

@Injectable()
export class ProjectRegistryConnector {
  private createSheetsClient(): sheets_v4.Sheets {
    return google.sheets({
      version: "v4",
      auth: createAuth(["https://www.googleapis.com/auth/spreadsheets"]),
    });
  }

  private createDriveClient(): drive_v3.Drive {
    return google.drive({
      version: "v3",
      auth: createAuth(["https://www.googleapis.com/auth/drive"]),
    });
  }

  async createProject(
    contract: NormalizedProjectIntake,
    submissionId: string,
  ): Promise<RegisteredProject> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const projectsFolderId = requiredSetting("GIA_DINH_TU_HAU_PROJECTS_FOLDER_ID");
    const sheets = this.createSheetsClient();
    const drive = this.createDriveClient();

    try {
      const existing = await this.findExistingProject(sheets, spreadsheetId, submissionId);
      if (existing) return { ...existing, idempotent_replay: true };

      const projectId = buildProjectId(contract);
      const createdAt = new Date().toISOString();
      const projectFolder = await drive.files.create({
        requestBody: {
          name: `${projectId}_${safeFolderName(contract.project_name)}`,
          mimeType: "application/vnd.google-apps.folder",
          parents: [projectsFolderId],
        },
        fields: "id,name,webViewLink",
        supportsAllDrives: true,
      });
      const projectFolderId = projectFolder.data.id;
      if (!projectFolderId) throw new Error("Google Drive không trả project folder id");

      await Promise.all([
        "00_HOP_DONG",
        "01_NHAN_VAT",
        "02_SAN_XUAT_MV",
        "03_ORIGINAL_FACE_COMPOSITE",
        "04_DUYET_NOI_DUNG",
        "05_KET_QUA",
      ].map((name) => drive.files.create({
        requestBody: {
          name,
          mimeType: "application/vnd.google-apps.folder",
          parents: [projectFolderId],
        },
        fields: "id",
        supportsAllDrives: true,
      })));

      const projectFolderUrl = projectFolder.data.webViewLink ??
        `https://drive.google.com/drive/folders/${projectFolderId}`;
      await this.appendProjectRows(sheets, spreadsheetId, {
        contract, submissionId, projectId, projectFolderId, projectFolderUrl, createdAt,
      });

      return {
        project_id: projectId,
        project_name: contract.project_name,
        project_type: contract.project_type,
        project_folder_id: projectFolderId,
        project_folder_url: projectFolderUrl,
        current_stage: "CONTRACT",
        next_action: "APPROVE_CONTRACT",
        idempotent_replay: false,
      };
    } catch (error) {
      if (error instanceof ProjectRegistryNotConfiguredError) throw error;
      throw new ProjectRegistryUnavailableError(
        error instanceof Error ? error.message : "Không tạo được dự án Gia Đình Tư Hậu",
      );
    }
  }

  private async findExistingProject(
    sheets: sheets_v4.Sheets,
    spreadsheetId: string,
    submissionId: string,
  ): Promise<Omit<RegisteredProject, "idempotent_replay"> | undefined> {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'PROJECTS'!A:Y",
    });
    const row = (response.data.values ?? []).slice(1).find((candidate) => candidate[0] === submissionId);
    if (!row) return undefined;
    return {
      project_id: String(row[1] ?? ""),
      project_name: String(row[2] ?? ""),
      project_type: String(row[3] ?? ""),
      project_folder_id: String(row[20] ?? ""),
      project_folder_url: String(row[21] ?? ""),
      current_stage: "CONTRACT",
      next_action: "APPROVE_CONTRACT",
    };
  }

  private async appendProjectRows(
    sheets: sheets_v4.Sheets,
    spreadsheetId: string,
    input: {
      contract: NormalizedProjectIntake;
      submissionId: string;
      projectId: string;
      projectFolderId: string;
      projectFolderUrl: string;
      createdAt: string;
    },
  ) {
    const { contract, submissionId, projectId, projectFolderId, projectFolderUrl, createdAt } = input;
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "'PROJECTS'!A:Y",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[
        submissionId, projectId, contract.project_name, contract.project_type,
        contract.client_name, contract.phone, contract.email, contract.project_subtype ?? "",
        contract.priority ?? "NORMAL", contract.execution_mode ?? "STANDARD", contract.language,
        contract.content_rating, contract.target_audience, contract.duration_target,
        contract.aspect_ratio, JSON.stringify(contract.platforms), "CONFIRMED", "PENDING",
        "CONTRACT", "APPROVE_CONTRACT", projectFolderId, projectFolderUrl, createdAt, createdAt,
        JSON.stringify(contract),
      ]] },
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "'PROJECT_CHARACTERS'!A:N",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: contract.characters.map((character) => [
        submissionId, projectId, character.character_id, character.project_role,
        character.performance_role, JSON.stringify(character.selected_costume_ids),
        character.costume_approval_status ?? "", character.voice_required,
        character.voice_approval_status ?? "", character.lip_sync_required,
        character.identity_mode, character.original_video_file_id ?? "", createdAt, createdAt,
      ]) },
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "'AUDIT_LOG'!A:H",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[
        randomUUID(), projectId, submissionId, "PROJECT_CREATED", "SUCCEEDED",
        "AI_EXECUTOR_WEB", "Đã tạo hợp đồng đầu vào và cấu trúc Drive cho Gia Đình Tư Hậu.",
        createdAt,
      ]] },
    });
  }
}
