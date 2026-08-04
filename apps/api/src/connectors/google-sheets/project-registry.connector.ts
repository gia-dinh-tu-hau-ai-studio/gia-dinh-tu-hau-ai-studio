import { Injectable } from "@nestjs/common";
import type { NormalizedProjectIntake } from "@tu-hau/contracts";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { drive_v3, google, sheets_v4 } from "googleapis";
import {
  createDriveOAuthClient,
  createServiceAuth,
  GoogleDriveOAuthConfigurationError,
} from "../../google/google-auth";

export class ProjectRegistryNotConfiguredError extends Error {}
export class ProjectRegistryUnavailableError extends Error {}
export class ProjectRegistryProjectNotFoundError extends Error {}
export class ProjectRegistryInvalidStateError extends Error {}

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

export type ApprovedContract = {
  project_id: string;
  approval_status: "APPROVED";
  current_stage: "PRE_PRODUCTION";
  next_action: "PREPARE_MV_PRODUCTION";
  approved_at: string;
  idempotent_replay: boolean;
};

export type PreparedMvProductionPlan = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "APPROVE_MV_PRODUCTION_PLAN";
  job_id: string;
  job_status: "AWAITING_APPROVAL";
  approval_id: string;
  approval_status: "PENDING";
  manifest_file_id: string;
  manifest_file_url: string;
  prepared_at: string;
  idempotent_replay: boolean;
};

type MvProductionPreparationTransition = {
  project_id: string;
  submission_id: string;
  project_name: string;
  project_folder_id: string;
  contract: Record<string, unknown>;
  job_id: string;
  prepared_at: string;
  idempotent_replay: boolean;
};

type DriveFolderMetadata = {
  id?: string | null;
  mimeType?: string | null;
  parents?: string[] | null;
  trashed?: boolean | null;
};

const MV_PRODUCTION_PLAN_JOB_TYPE = "MV_PRODUCTION_PLAN";
const MV_PRODUCTION_PLAN_FILE_PREFIX = "MV_PRODUCTION_PLAN_V1";

export function planContractApproval(
  row: string[],
  now = new Date(),
): Omit<ApprovedContract, "idempotent_replay"> & { idempotent_replay: boolean } {
  const projectId = String(row[1] ?? "").trim();
  const contractStatus = String(row[16] ?? "").trim();
  const approvalStatus = String(row[17] ?? "").trim();
  const nextAction = String(row[19] ?? "").trim();
  const approvedAt = String(row[23] ?? "").trim() || now.toISOString();

  if (!projectId) {
    throw new ProjectRegistryInvalidStateError("Dòng PROJECTS không có project_id");
  }
  if (contractStatus !== "CONFIRMED") {
    throw new ProjectRegistryInvalidStateError(
      `Hợp đồng ${projectId} chưa ở trạng thái CONFIRMED`,
    );
  }
  if (approvalStatus === "APPROVED") {
    return {
      project_id: projectId,
      approval_status: "APPROVED",
      current_stage: "PRE_PRODUCTION",
      next_action: "PREPARE_MV_PRODUCTION",
      approved_at: approvedAt,
      idempotent_replay: true,
    };
  }
  if (approvalStatus !== "PENDING" || nextAction !== "APPROVE_CONTRACT") {
    throw new ProjectRegistryInvalidStateError(
      `Hợp đồng ${projectId} không thể duyệt từ ${approvalStatus || "EMPTY"}/${nextAction || "EMPTY"}`,
    );
  }

  return {
    project_id: projectId,
    approval_status: "APPROVED",
    current_stage: "PRE_PRODUCTION",
    next_action: "PREPARE_MV_PRODUCTION",
    approved_at: now.toISOString(),
    idempotent_replay: false,
  };
}

function parseObject(value: unknown, fieldName: string) {
  try {
    const parsed = JSON.parse(String(value ?? "")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ProjectRegistryInvalidStateError(`${fieldName} không phải JSON object hợp lệ`);
  }
}

function parseStringArray(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function contractCharacters(contract: Record<string, unknown>) {
  if (!Array.isArray(contract.characters) || contract.characters.length === 0) {
    throw new ProjectRegistryInvalidStateError(
      "Hợp đồng MV chưa có nhân vật để lập kế hoạch sản xuất",
    );
  }

  return contract.characters.map((character) => {
    if (!character || typeof character !== "object" || Array.isArray(character)) {
      throw new ProjectRegistryInvalidStateError("Dữ liệu nhân vật trong hợp đồng không hợp lệ");
    }
    return character as Record<string, unknown>;
  });
}

export function planMvProductionPreparation(
  row: string[],
  existingJobRow: string[] | undefined,
  now = new Date(),
  jobId: string = randomUUID(),
): MvProductionPreparationTransition {
  const projectId = String(row[1] ?? "").trim();
  const projectName = String(row[2] ?? "").trim();
  const projectType = String(row[3] ?? "").trim();
  const contractStatus = String(row[16] ?? "").trim();
  const approvalStatus = String(row[17] ?? "").trim();
  const currentStage = String(row[18] ?? "").trim();
  const nextAction = String(row[19] ?? "").trim();
  const projectFolderId = String(row[20] ?? "").trim();
  const contract = parseObject(row[24], "contract_json");

  if (!projectId) {
    throw new ProjectRegistryInvalidStateError("Dòng PROJECTS không có project_id");
  }
  if (projectType !== "MUSIC_VIDEO" || contract.project_type !== "MUSIC_VIDEO") {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId} không phải MUSIC_VIDEO`,
    );
  }
  if (contractStatus !== "CONFIRMED" || approvalStatus !== "APPROVED") {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId} chưa có hợp đồng APPROVED`,
    );
  }
  if (currentStage !== "PRE_PRODUCTION") {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId} không ở giai đoạn PRE_PRODUCTION`,
    );
  }
  if (!projectFolderId) {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId} chưa có thư mục Drive`,
    );
  }

  for (const character of contractCharacters(contract)) {
    if (
      character.identity_mode !== "ORIGINAL_FACE_COMPOSITE" ||
      !String(character.original_video_file_id ?? "").trim()
    ) {
      throw new ProjectRegistryInvalidStateError(
        `Dự án ${projectId} chỉ được lập kế hoạch với ORIGINAL_FACE_COMPOSITE và video gốc`,
      );
    }
    if (character.voice_required === true && character.voice_approval_status !== "APPROVED") {
      throw new ProjectRegistryInvalidStateError(
        `Dự án ${projectId} có voice chưa APPROVED`,
      );
    }
  }

  if (existingJobRow) {
    if (
      String(existingJobRow[3] ?? "").trim() !== MV_PRODUCTION_PLAN_JOB_TYPE ||
      String(existingJobRow[4] ?? "").trim() !== "AWAITING_APPROVAL"
    ) {
      throw new ProjectRegistryInvalidStateError(
        `Kế hoạch MV hiện có của ${projectId} không ở trạng thái AWAITING_APPROVAL`,
      );
    }
    if (nextAction !== "APPROVE_MV_PRODUCTION_PLAN") {
      throw new ProjectRegistryInvalidStateError(
        `Dự án ${projectId} có kế hoạch nhưng next_action không khớp`,
      );
    }
    return {
      project_id: projectId,
      submission_id: String(row[0] ?? ""),
      project_name: projectName,
      project_folder_id: projectFolderId,
      contract,
      job_id: String(existingJobRow[0] ?? ""),
      prepared_at: String(existingJobRow[12] ?? "").trim() || now.toISOString(),
      idempotent_replay: true,
    };
  }

  if (nextAction !== "PREPARE_MV_PRODUCTION") {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId} không thể lập kế hoạch từ next_action ${nextAction || "EMPTY"}`,
    );
  }

  return {
    project_id: projectId,
    submission_id: String(row[0] ?? ""),
    project_name: projectName,
    project_folder_id: projectFolderId,
    contract,
    job_id: jobId,
    prepared_at: now.toISOString(),
    idempotent_replay: false,
  };
}

export function assertProjectFolderWithinRoot(
  folder: DriveFolderMetadata,
  projectsRootFolderId: string,
  projectId: string,
) {
  if (
    folder.mimeType !== "application/vnd.google-apps.folder" ||
    folder.trashed === true ||
    !folder.parents?.includes(projectsRootFolderId)
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Thư mục Drive của ${projectId} nằm ngoài GIA_DINH_TU_HAU_PROJECTS_FOLDER_ID`,
    );
  }
}

function requiredSetting(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ProjectRegistryNotConfiguredError(`Thiếu cấu hình ${name}`);
  }
  return value;
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
      auth: createServiceAuth(["https://www.googleapis.com/auth/spreadsheets"]),
    });
  }

  private createDriveClient(): drive_v3.Drive {
    try {
      return google.drive({
        version: "v3",
        auth: createDriveOAuthClient(),
      });
    } catch (error) {
      if (error instanceof GoogleDriveOAuthConfigurationError) {
        throw new ProjectRegistryNotConfiguredError(error.message);
      }
      throw error;
    }
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

  async approveContract(projectId: string): Promise<ApprovedContract> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const sheets = this.createSheetsClient();

    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "'PROJECTS'!A:Y",
      });
      const rows = response.data.values ?? [];
      const rowIndex = rows.findIndex(
        (row, index) => index > 0 && String(row[1] ?? "").trim() === projectId,
      );
      if (rowIndex < 0) {
        throw new ProjectRegistryProjectNotFoundError(
          `Không tìm thấy project_id ${projectId}`,
        );
      }

      const transition = planContractApproval(rows[rowIndex].map(String));
      if (transition.idempotent_replay) return transition;

      const sheetRow = rowIndex + 1;
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            { range: `'PROJECTS'!R${sheetRow}`, values: [[transition.approval_status]] },
            { range: `'PROJECTS'!S${sheetRow}`, values: [[transition.current_stage]] },
            { range: `'PROJECTS'!T${sheetRow}`, values: [[transition.next_action]] },
            { range: `'PROJECTS'!X${sheetRow}`, values: [[transition.approved_at]] },
          ],
        },
      });

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "'AUDIT_LOG'!A:H",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: [[
            randomUUID(),
            transition.project_id,
            String(rows[rowIndex][0] ?? ""),
            "CONTRACT_APPROVED",
            "SUCCEEDED",
            "AI_EXECUTOR_WEB",
            "Hợp đồng đã được duyệt; dự án chuyển sang chuẩn bị sản xuất MV.",
            transition.approved_at,
          ]],
        },
      });

      return transition;
    } catch (error) {
      if (
        error instanceof ProjectRegistryNotConfiguredError ||
        error instanceof ProjectRegistryProjectNotFoundError ||
        error instanceof ProjectRegistryInvalidStateError
      ) {
        throw error;
      }
      throw new ProjectRegistryUnavailableError(
        error instanceof Error ? error.message : "Không duyệt được hợp đồng Gia Đình Tư Hậu",
      );
    }
  }

  async prepareMvProduction(projectId: string): Promise<PreparedMvProductionPlan> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const projectsRootFolderId = requiredSetting("GIA_DINH_TU_HAU_PROJECTS_FOLDER_ID");
    const sheets = this.createSheetsClient();
    const drive = this.createDriveClient();

    try {
      const [projectsResponse, jobsResponse, approvalsResponse, auditResponse] =
        await Promise.all([
          sheets.spreadsheets.values.get({
            spreadsheetId,
            range: "'PROJECTS'!A:Y",
          }),
          sheets.spreadsheets.values.get({
            spreadsheetId,
            range: "'PRODUCTION_JOBS'!A:N",
          }),
          sheets.spreadsheets.values.get({
            spreadsheetId,
            range: "'APPROVALS'!A:J",
          }),
          sheets.spreadsheets.values.get({
            spreadsheetId,
            range: "'AUDIT_LOG'!A:H",
          }),
        ]);

      const projectRows = projectsResponse.data.values ?? [];
      const projectRowIndex = projectRows.findIndex(
        (row, index) => index > 0 && String(row[1] ?? "").trim() === projectId,
      );
      if (projectRowIndex < 0) {
        throw new ProjectRegistryProjectNotFoundError(
          `Không tìm thấy project_id ${projectId}`,
        );
      }

      const jobRows = jobsResponse.data.values ?? [];
      const existingJobRow = jobRows.find(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[3] ?? "").trim() === MV_PRODUCTION_PLAN_JOB_TYPE,
      );
      const transition = planMvProductionPreparation(
        projectRows[projectRowIndex].map(String),
        existingJobRow?.map(String),
      );

      if (transition.idempotent_replay) {
        return await this.readExistingMvProductionPlan(
          drive,
          transition,
          existingJobRow?.map(String) ?? [],
          approvalsResponse.data.values ?? [],
        );
      }

      const projectFolder = await drive.files.get({
        fileId: transition.project_folder_id,
        fields: "id,mimeType,parents,trashed",
        supportsAllDrives: true,
      });
      assertProjectFolderWithinRoot(
        projectFolder.data,
        projectsRootFolderId,
        transition.project_id,
      );

      const productionFolder = await this.findChildFolder(
        drive,
        transition.project_folder_id,
        "02_SAN_XUAT_MV",
      );
      const inputFileIds = this.mvProductionInputFileIds(transition.contract);
      const manifestName = `${MV_PRODUCTION_PLAN_FILE_PREFIX}_${transition.project_id}.json`;
      const manifest = {
        schema_version: "1.0",
        project_id: transition.project_id,
        project_name: transition.project_name,
        stage: "PRE_PRODUCTION",
        production_priority: "MUSIC_VIDEO_FIRST",
        face_identity_pipeline: "ORIGINAL_FACE_COMPOSITE",
        provider_execution_allowed: false,
        render_allowed: false,
        inputs: {
          input_file_ids: inputFileIds,
          song_title: transition.contract.song_title,
          song_topic: transition.contract.song_topic,
          music_genre: transition.contract.music_genre,
          lyrics_source_mode: transition.contract.lyrics_source_mode,
          lyrics: transition.contract.lyrics,
          music_source_mode: transition.contract.music_source_mode,
          vocal_source_mode: transition.contract.vocal_source_mode,
          duration_target: transition.contract.duration_target,
          aspect_ratio: transition.contract.aspect_ratio,
          platforms: transition.contract.platforms,
        },
        characters: contractCharacters(transition.contract),
        visual_constraints: [String(transition.contract.visual_direction ?? "").trim()].filter(
          Boolean,
        ),
        approval_gate: {
          approval_status: "PENDING",
          next_action: "APPROVE_MV_PRODUCTION_PLAN",
        },
        prepared_at: transition.prepared_at,
      };
      const manifestFile = await this.createOrReuseJsonFile(
        drive,
        productionFolder.id,
        manifestName,
        manifest,
      );
      const approvalId = randomUUID();
      const approvalRows = approvalsResponse.data.values ?? [];
      const auditRows = auditResponse.data.values ?? [];
      const projectSheetRow = projectRowIndex + 1;
      const jobSheetRow = jobRows.length + 1;
      const approvalSheetRow = approvalRows.length + 1;
      const auditSheetRow = auditRows.length + 1;

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            {
              range: `'PROJECTS'!S${projectSheetRow}:T${projectSheetRow}`,
              values: [["PRE_PRODUCTION", "APPROVE_MV_PRODUCTION_PLAN"]],
            },
            {
              range: `'PROJECTS'!X${projectSheetRow}`,
              values: [[transition.prepared_at]],
            },
            {
              range: `'PRODUCTION_JOBS'!A${jobSheetRow}:N${jobSheetRow}`,
              values: [[
                transition.job_id,
                transition.project_id,
                "PRE_PRODUCTION",
                MV_PRODUCTION_PLAN_JOB_TYPE,
                "AWAITING_APPROVAL",
                "",
                JSON.stringify(inputFileIds),
                JSON.stringify([manifestFile.id]),
                "",
                0,
                transition.prepared_at,
                "",
                transition.prepared_at,
                transition.prepared_at,
              ]],
            },
            {
              range: `'APPROVALS'!A${approvalSheetRow}:J${approvalSheetRow}`,
              values: [[
                approvalId,
                transition.project_id,
                MV_PRODUCTION_PLAN_JOB_TYPE,
                transition.job_id,
                "PENDING",
                "",
                "",
                "Chờ duyệt kế hoạch PRE_PRODUCTION trước khi render hoặc gọi provider.",
                transition.prepared_at,
                transition.prepared_at,
              ]],
            },
            {
              range: `'AUDIT_LOG'!A${auditSheetRow}:H${auditSheetRow}`,
              values: [[
                randomUUID(),
                transition.project_id,
                transition.submission_id,
                "MV_PRODUCTION_PLAN_PREPARED",
                "SUCCEEDED",
                "AI_EXECUTOR_WEB",
                "Đã tạo kế hoạch PRE_PRODUCTION; chưa render và chưa gọi provider.",
                transition.prepared_at,
              ]],
            },
          ],
        },
      });

      return {
        project_id: transition.project_id,
        current_stage: "PRE_PRODUCTION",
        next_action: "APPROVE_MV_PRODUCTION_PLAN",
        job_id: transition.job_id,
        job_status: "AWAITING_APPROVAL",
        approval_id: approvalId,
        approval_status: "PENDING",
        manifest_file_id: manifestFile.id,
        manifest_file_url: manifestFile.webViewLink,
        prepared_at: transition.prepared_at,
        idempotent_replay: false,
      };
    } catch (error) {
      if (
        error instanceof ProjectRegistryNotConfiguredError ||
        error instanceof ProjectRegistryProjectNotFoundError ||
        error instanceof ProjectRegistryInvalidStateError
      ) {
        throw error;
      }
      throw new ProjectRegistryUnavailableError(
        error instanceof Error
          ? error.message
          : "Không lập được kế hoạch PRE_PRODUCTION Gia Đình Tư Hậu",
      );
    }
  }

  private async findChildFolder(
    drive: drive_v3.Drive,
    parentFolderId: string,
    name: string,
  ) {
    const response = await drive.files.list({
      q: `'${parentFolderId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id,name,webViewLink)",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    const folder = response.data.files?.[0];
    if (!folder?.id) {
      throw new ProjectRegistryInvalidStateError(
        `Thiếu thư mục ${name} trong dự án`,
      );
    }
    return { id: folder.id, webViewLink: folder.webViewLink ?? "" };
  }

  private mvProductionInputFileIds(contract: Record<string, unknown>) {
    const characters = contractCharacters(contract);
    const fileIds = characters.map((character) =>
      String(character.original_video_file_id ?? "").trim(),
    );
    const lyrics = String(contract.lyrics ?? "").trim();
    const lyricsMatch = lyrics.match(/\/d\/([^/]+)/);
    if (lyricsMatch?.[1]) fileIds.push(lyricsMatch[1]);
    return [...new Set(fileIds.filter(Boolean))];
  }

  private async createOrReuseJsonFile(
    drive: drive_v3.Drive,
    parentFolderId: string,
    name: string,
    content: Record<string, unknown>,
  ) {
    const existing = await drive.files.list({
      q: `'${parentFolderId}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`,
      fields: "files(id,name,webViewLink)",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    const existingFile = existing.data.files?.[0];
    if (existingFile?.id) {
      return {
        id: existingFile.id,
        webViewLink:
          existingFile.webViewLink ??
          `https://drive.google.com/file/d/${existingFile.id}/view`,
      };
    }

    const response = await drive.files.create({
      requestBody: {
        name,
        mimeType: "application/json",
        parents: [parentFolderId],
      },
      media: {
        mimeType: "application/json",
        body: Readable.from([`${JSON.stringify(content, null, 2)}\n`]),
      },
      fields: "id,name,webViewLink",
      supportsAllDrives: true,
    });
    if (!response.data.id) {
      throw new Error("Google Drive không trả manifest file id");
    }
    return {
      id: response.data.id,
      webViewLink:
        response.data.webViewLink ??
        `https://drive.google.com/file/d/${response.data.id}/view`,
    };
  }

  private async readExistingMvProductionPlan(
    drive: drive_v3.Drive,
    transition: MvProductionPreparationTransition,
    existingJobRow: string[],
    approvalRows: unknown[][],
  ): Promise<PreparedMvProductionPlan> {
    const outputFileIds = parseStringArray(existingJobRow[7]);
    const manifestFileId = outputFileIds[0];
    if (!manifestFileId) {
      throw new ProjectRegistryInvalidStateError(
        `Kế hoạch MV ${transition.job_id} chưa có manifest`,
      );
    }
    const approvalRow = approvalRows.find(
      (row, index) =>
        index > 0 &&
        String(row[1] ?? "").trim() === transition.project_id &&
        String(row[3] ?? "").trim() === transition.job_id,
    );
    if (!approvalRow || String(approvalRow[4] ?? "").trim() !== "PENDING") {
      throw new ProjectRegistryInvalidStateError(
        `Kế hoạch MV ${transition.job_id} chưa có approval PENDING`,
      );
    }
    const manifest = await drive.files.get({
      fileId: manifestFileId,
      fields: "id,webViewLink",
      supportsAllDrives: true,
    });
    return {
      project_id: transition.project_id,
      current_stage: "PRE_PRODUCTION",
      next_action: "APPROVE_MV_PRODUCTION_PLAN",
      job_id: transition.job_id,
      job_status: "AWAITING_APPROVAL",
      approval_id: String(approvalRow[0] ?? ""),
      approval_status: "PENDING",
      manifest_file_id: manifestFileId,
      manifest_file_url:
        manifest.data.webViewLink ??
        `https://drive.google.com/file/d/${manifestFileId}/view`,
      prepared_at: transition.prepared_at,
      idempotent_replay: true,
    };
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
