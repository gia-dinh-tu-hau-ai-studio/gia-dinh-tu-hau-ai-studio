import { Injectable } from "@nestjs/common";
import {
  calculateProjectProgress,
  createShortFilmResumeSnapshot,
  shortFilmMediaExecutionDecision,
  shortFilmNextAction,
  shortFilmScriptApprovalIsFresh,
  ShortFilmWorkflowSchema,
  type NormalizedProjectIntake,
  type ShortFilmResumeSnapshot,
  type ShortFilmWorkflow,
} from "@tu-hau/contracts";
import { randomUUID } from "node:crypto";
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
  project_type: "SHORT_FILM";
  project_folder_id: string;
  project_folder_url: string;
  current_stage: "CONTRACT";
  next_action: "APPROVE_CONTRACT";
  idempotent_replay: boolean;
};

export type StoredShortFilmWorkflow = {
  project_id: string;
  project_type: "SHORT_FILM";
  workflow: ShortFilmWorkflow;
  resume_snapshot: ShortFilmResumeSnapshot;
  next_action: ReturnType<typeof shortFilmNextAction>;
  media_execution: ReturnType<typeof shortFilmMediaExecutionDecision>;
  updated_at: string;
};

export type ApprovedContract = {
  project_id: string;
  approval_status: "APPROVED";
  current_stage: "PRE_PRODUCTION";
  next_action: "REVIEW_SHORT_FILM_SCRIPT";
  approved_at: string;
  idempotent_replay: boolean;
};

function requiredSetting(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new ProjectRegistryNotConfiguredError(`Thiếu cấu hình ${name}`);
  return value;
}

function safeFolderName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
}

function parseObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProjectRegistryInvalidStateError(`${fieldName} trống`);
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new ProjectRegistryInvalidStateError(`${fieldName} không phải JSON object hợp lệ`);
  }
}

export function buildProjectId(contract: Pick<NormalizedProjectIntake, "project_name">, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const slug = safeFolderName(contract.project_name).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "PROJECT";
  return `GDTH-FILM-${stamp}-${slug}`;
}

export function planContractApproval(row: string[], now = new Date()): ApprovedContract {
  const projectId = String(row[1] ?? "").trim();
  if (!projectId) throw new ProjectRegistryInvalidStateError("PROJECTS row thiếu project_id");
  if (String(row[3] ?? "").trim() !== "SHORT_FILM") {
    throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} không thuộc pipeline phim`);
  }
  const approval = String(row[17] ?? "").trim();
  const stage = String(row[18] ?? "").trim();
  const next = String(row[19] ?? "").trim();
  if (approval === "APPROVED" && stage === "PRE_PRODUCTION" && next === "REVIEW_SHORT_FILM_SCRIPT") {
    return { project_id: projectId, approval_status: "APPROVED", current_stage: "PRE_PRODUCTION", next_action: "REVIEW_SHORT_FILM_SCRIPT", approved_at: String(row[23] ?? now.toISOString()), idempotent_replay: true };
  }
  if (approval !== "PENDING" || stage !== "CONTRACT" || next !== "APPROVE_CONTRACT") {
    throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} không thể duyệt hợp đồng từ trạng thái hiện tại`);
  }
  return { project_id: projectId, approval_status: "APPROVED", current_stage: "PRE_PRODUCTION", next_action: "REVIEW_SHORT_FILM_SCRIPT", approved_at: now.toISOString(), idempotent_replay: false };
}

@Injectable()
export class ProjectRegistryConnector {
  private createSheetsClient(): sheets_v4.Sheets {
    return google.sheets({ version: "v4", auth: createServiceAuth(["https://www.googleapis.com/auth/spreadsheets"]) });
  }

  private createDriveClient(): drive_v3.Drive {
    try {
      return google.drive({ version: "v3", auth: createDriveOAuthClient() });
    } catch (error) {
      if (error instanceof GoogleDriveOAuthConfigurationError) throw new ProjectRegistryNotConfiguredError(error.message);
      throw error;
    }
  }

  async createProject(contract: NormalizedProjectIntake, submissionId: string): Promise<RegisteredProject> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const projectsFolderId = requiredSetting("GIA_DINH_TU_HAU_PROJECTS_FOLDER_ID");
    const sheets = this.createSheetsClient();
    const drive = this.createDriveClient();
    try {
      const existing = await this.findExistingProject(sheets, spreadsheetId, submissionId);
      if (existing) return { ...existing, idempotent_replay: true };
      const projectId = buildProjectId(contract);
      const createdAt = new Date().toISOString();
      const folder = await drive.files.create({ requestBody: { name: `${projectId}_${safeFolderName(contract.project_name)}`, mimeType: "application/vnd.google-apps.folder", parents: [projectsFolderId] }, fields: "id,name,webViewLink", supportsAllDrives: true });
      const projectFolderId = folder.data.id;
      if (!projectFolderId) throw new Error("Google Drive không trả project folder id");
      await Promise.all(["00_HOP_DONG", "01_NHAN_VAT", "02_KICH_BAN", "03_SHOT_PLAN", "04_PILOT", "05_SAN_XUAT_PHIM", "06_QC_DUYET_PHIM", "07_XUAT_BAN"].map((name) => drive.files.create({ requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [projectFolderId] }, fields: "id", supportsAllDrives: true })));
      const projectFolderUrl = folder.data.webViewLink ?? `https://drive.google.com/drive/folders/${projectFolderId}`;
      await this.appendProjectRows(sheets, spreadsheetId, { contract, submissionId, projectId, projectFolderId, projectFolderUrl, createdAt });
      return { project_id: projectId, project_name: contract.project_name, project_type: "SHORT_FILM", project_folder_id: projectFolderId, project_folder_url: projectFolderUrl, current_stage: "CONTRACT", next_action: "APPROVE_CONTRACT", idempotent_replay: false };
    } catch (error) {
      if (error instanceof ProjectRegistryNotConfiguredError) throw error;
      throw new ProjectRegistryUnavailableError(error instanceof Error ? error.message : "Không tạo được dự án phim");
    }
  }

  async getShortFilmWorkflow(projectId: string): Promise<StoredShortFilmWorkflow> {
    const { row, contract } = await this.readProject(projectId);
    const resume = createShortFilmResumeSnapshot(contract);
    const workflow = resume.short_film_workflow;
    return { project_id: projectId, project_type: "SHORT_FILM", workflow, resume_snapshot: resume, next_action: shortFilmNextAction(workflow), media_execution: shortFilmMediaExecutionDecision(workflow), updated_at: String(row[23] ?? row[22] ?? "") };
  }

  async getShortFilmExecutionContext(projectId: string) {
    const { row, contract } = await this.readProject(projectId);
    const projectFolderId = String(row[20] ?? "").trim();
    if (!projectFolderId) throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} thiếu project_folder_id`);
    return { project_id: projectId, project_folder_id: projectFolderId, workflow: ShortFilmWorkflowSchema.parse(contract.short_film_workflow), provider_budget: contract.provider_budget };
  }

  async getProjectProgress(projectId: string) {
    const { row } = await this.readProject(projectId);
    const nextAction = String(row[19] ?? "").trim();
    return { project_id: projectId, project_name: String(row[2] ?? "").trim(), project_type: "SHORT_FILM", current_stage: String(row[18] ?? "").trim(), next_action: nextAction, updated_at: String(row[23] ?? row[22] ?? ""), ...calculateProjectProgress("SHORT_FILM", nextAction) };
  }

  async saveShortFilmWorkflow(projectId: string, input: unknown): Promise<StoredShortFilmWorkflow> {
    const workflow = ShortFilmWorkflowSchema.parse(input);
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const sheets = this.createSheetsClient();
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" });
    const rows = response.data.values ?? [];
    const rowIndex = rows.findIndex((candidate, index) => index > 0 && String(candidate[1] ?? "").trim() === projectId);
    if (rowIndex < 0) throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
    const row = rows[rowIndex];
    if (String(row[3] ?? "").trim() !== "SHORT_FILM") throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} không thuộc pipeline phim`);
    const contract = parseObject(row[24], "contract_json");
    const existing = contract.short_film_workflow ? ShortFilmWorkflowSchema.parse(contract.short_film_workflow) : undefined;
    if (existing?.script_review.decision === "APPROVE" && !shortFilmScriptApprovalIsFresh(existing, workflow)) throw new ProjectRegistryInvalidStateError("Kịch bản đã thay đổi phải được review lại");
    const nextAction = shortFilmNextAction(workflow);
    const updatedAt = new Date().toISOString();
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [{ range: `'PROJECTS'!T${rowIndex + 1}`, values: [[nextAction]] }, { range: `'PROJECTS'!X${rowIndex + 1}:Y${rowIndex + 1}`, values: [[updatedAt, JSON.stringify({ ...contract, short_film_workflow: workflow })]] }] } });
    await sheets.spreadsheets.values.append({ spreadsheetId, range: "'AUDIT_LOG'!A:H", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: [[randomUUID(), projectId, String(row[0] ?? ""), "SHORT_FILM_WORKFLOW_UPDATED", "SUCCEEDED", "AI_EXECUTOR_WEB", `Workflow phim cập nhật; next_action=${nextAction}.`, updatedAt]] } });
    const resume = createShortFilmResumeSnapshot({ ...contract, short_film_workflow: workflow });
    return { project_id: projectId, project_type: "SHORT_FILM", workflow, resume_snapshot: resume, next_action: nextAction, media_execution: shortFilmMediaExecutionDecision(workflow), updated_at: updatedAt };
  }

  async approveContract(projectId: string): Promise<ApprovedContract> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const sheets = this.createSheetsClient();
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" });
    const rows = response.data.values ?? [];
    const rowIndex = rows.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId);
    if (rowIndex < 0) throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
    const transition = planContractApproval(rows[rowIndex].map(String));
    if (transition.idempotent_replay) return transition;
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [{ range: `'PROJECTS'!R${rowIndex + 1}:T${rowIndex + 1}`, values: [[transition.approval_status, transition.current_stage, transition.next_action]] }, { range: `'PROJECTS'!X${rowIndex + 1}`, values: [[transition.approved_at]] }] } });
    await sheets.spreadsheets.values.append({ spreadsheetId, range: "'AUDIT_LOG'!A:H", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: [[randomUUID(), projectId, String(rows[rowIndex][0] ?? ""), "CONTRACT_APPROVED", "SUCCEEDED", "AI_EXECUTOR_WEB", "Hợp đồng đã duyệt; chuyển sang review kịch bản phim. Provider và sản xuất vẫn khóa.", transition.approved_at]] } });
    return transition;
  }

  private async readProject(projectId: string) {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    try {
      const response = await this.createSheetsClient().spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" });
      const row = (response.data.values ?? []).find((candidate, index) => index > 0 && String(candidate[1] ?? "").trim() === projectId);
      if (!row) throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      if (String(row[3] ?? "").trim() !== "SHORT_FILM") throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} không thuộc pipeline phim`);
      return { row, contract: parseObject(row[24], "contract_json") };
    } catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError || error instanceof ProjectRegistryInvalidStateError) throw error;
      throw new ProjectRegistryUnavailableError(error instanceof Error ? error.message : "Không đọc được dự án phim");
    }
  }

  private async findExistingProject(sheets: sheets_v4.Sheets, spreadsheetId: string, submissionId: string): Promise<Omit<RegisteredProject, "idempotent_replay"> | undefined> {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" });
    const row = (response.data.values ?? []).slice(1).find((candidate) => candidate[0] === submissionId);
    if (!row) return undefined;
    if (String(row[3] ?? "").trim() !== "SHORT_FILM") throw new ProjectRegistryInvalidStateError("Submission cũ không thuộc pipeline phim");
    return { project_id: String(row[1] ?? ""), project_name: String(row[2] ?? ""), project_type: "SHORT_FILM", project_folder_id: String(row[20] ?? ""), project_folder_url: String(row[21] ?? ""), current_stage: "CONTRACT", next_action: "APPROVE_CONTRACT" };
  }

  private async appendProjectRows(sheets: sheets_v4.Sheets, spreadsheetId: string, input: { contract: NormalizedProjectIntake; submissionId: string; projectId: string; projectFolderId: string; projectFolderUrl: string; createdAt: string }) {
    const { contract, submissionId, projectId, projectFolderId, projectFolderUrl, createdAt } = input;
    await sheets.spreadsheets.values.append({ spreadsheetId, range: "'PROJECTS'!A:Y", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: [[submissionId, projectId, contract.project_name, "SHORT_FILM", contract.client_name, contract.phone, contract.email, contract.project_subtype ?? "", contract.priority ?? "NORMAL", contract.execution_mode ?? "STANDARD", contract.language, contract.content_rating, contract.target_audience, contract.duration_target, contract.aspect_ratio, JSON.stringify(contract.platforms), "CONFIRMED", "PENDING", "CONTRACT", "APPROVE_CONTRACT", projectFolderId, projectFolderUrl, createdAt, createdAt, JSON.stringify(contract)]] } });
    if (contract.characters.length) await sheets.spreadsheets.values.append({ spreadsheetId, range: "'PROJECT_CHARACTERS'!A:N", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: contract.characters.map((character) => [submissionId, projectId, character.character_id, character.project_role, character.performance_role, JSON.stringify(character.selected_costume_ids), character.costume_approval_status ?? "", character.voice_required, character.voice_approval_status ?? "", character.lip_sync_required, character.identity_mode, character.original_video_file_id ?? "", createdAt, createdAt]) } });
    await sheets.spreadsheets.values.append({ spreadsheetId, range: "'AUDIT_LOG'!A:H", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: [[randomUUID(), projectId, submissionId, "PROJECT_CREATED", "SUCCEEDED", "AI_EXECUTOR_WEB", "Đã tạo hợp đồng đầu vào và cấu trúc Drive cho dự án phim.", createdAt]] } });
  }
}
