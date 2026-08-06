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

export type ApprovedMvProductionPlan = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "PREPARE_MV_ASSETS";
  job_id: string;
  job_status: "APPROVED";
  approval_id: string;
  approval_status: "APPROVED";
  approved_at: string;
  idempotent_replay: boolean;
};

export type PreparedMvAssets = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "APPROVE_MV_ASSETS";
  job_id: string;
  job_status: "AWAITING_APPROVAL";
  approval_id: string;
  approval_status: "PENDING";
  manifest_file_id: string;
  manifest_file_url: string;
  prepared_at: string;
  idempotent_replay: boolean;
};

export type ApprovedMvAssets = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "PREPARE_MV_SHOT_PLAN";
  job_id: string;
  job_status: "APPROVED";
  approval_id: string;
  approval_status: "APPROVED";
  approved_at: string;
  idempotent_replay: boolean;
};

export type PreparedMvShotPlan = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "APPROVE_MV_SHOT_PLAN";
  job_id: string;
  job_status: "AWAITING_APPROVAL";
  approval_id: string;
  approval_status: "PENDING";
  manifest_file_id: string;
  manifest_file_url: string;
  prepared_at: string;
  idempotent_replay: boolean;
};

export type ApprovedMvShotPlan = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "PREPARE_MV_TIMECODE_ALIGNMENT";
  job_id: string;
  job_status: "APPROVED";
  approval_id: string;
  approval_status: "APPROVED";
  approved_at: string;
  idempotent_replay: boolean;
};

export type PreparedMvTimecodeAlignment = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "APPROVE_MV_TIMECODE_ALIGNMENT";
  job_id: string;
  job_status: "AWAITING_APPROVAL";
  approval_id: string;
  approval_status: "PENDING";
  manifest_file_id: string;
  manifest_file_url: string;
  prepared_at: string;
  idempotent_replay: boolean;
};

export type ApprovedMvTimecodeAlignment = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "PREPARE_MV_RENDER_PLAN";
  job_id: string;
  job_status: "APPROVED";
  approval_id: string;
  approval_status: "APPROVED";
  approved_at: string;
  idempotent_replay: boolean;
};

export type PreparedMvRenderPlan = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "APPROVE_MV_RENDER_PLAN";
  job_id: string;
  job_status: "AWAITING_APPROVAL";
  approval_id: string;
  approval_status: "PENDING";
  manifest_file_id: string;
  manifest_file_url: string;
  prepared_at: string;
  idempotent_replay: boolean;
};

export type ApprovedMvRenderPlan = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "PREPARE_MV_RENDER_EXECUTION";
  job_id: string;
  job_status: "APPROVED";
  approval_id: string;
  approval_status: "APPROVED";
  approved_at: string;
  idempotent_replay: boolean;
};

export type PreparedMvRenderExecution = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "APPROVE_MV_RENDER_EXECUTION";
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

type MvAssetPreparationTransition = {
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
const MV_ASSET_PREPARATION_JOB_TYPE = "MV_ASSET_PREPARATION";
const MV_ASSET_MANIFEST_FILE_PREFIX = "MV_ASSET_MANIFEST_V1";
const MV_SHOT_PLAN_JOB_TYPE = "MV_SHOT_PLAN";
const MV_SHOT_PLAN_FILE_PREFIX = "MV_SHOT_PLAN_V1";
const MV_TIMECODE_ALIGNMENT_JOB_TYPE = "MV_TIMECODE_ALIGNMENT";
const MV_TIMECODE_ALIGNMENT_FILE_PREFIX = "MV_TIMECODE_ALIGNMENT_V1";
const MV_RENDER_PLAN_JOB_TYPE = "MV_RENDER_PLAN";
const MV_RENDER_PLAN_FILE_PREFIX = "MV_RENDER_PLAN_V1";
const MV_RENDER_EXECUTION_JOB_TYPE = "MV_RENDER_EXECUTION";
const MV_RENDER_EXECUTION_FILE_PREFIX = "MV_RENDER_EXECUTION_V1";
const TEMPORARY_CLOSE_UP_LOCK_CHARACTER_IDS = new Set(["GDTH-CHAR-001"]);

export function buildMvRenderExecutionManifest(
  projectId: string,
  projectName: string,
  renderPlanFileId: string,
  renderPlan: Record<string, unknown>,
  preparedAt: string,
) {
  const units = Array.isArray(renderPlan.render_units)
    ? (renderPlan.render_units as Array<Record<string, unknown>>)
    : [];
  const safe = units.length === 15 && units.every((unit, index) => {
    const framing = (unit.framing_constraints ?? {}) as Record<string, unknown>;
    const performer = String(unit.performer ?? "");
    const tuongVy = performer === "TUONG_VY_EM" || performer === "SONG_CA";
    return Number(unit.cue_order) === index + 1 &&
      String(unit.execution_status) === "BLOCKED_PENDING_EXECUTION_PREPARATION" &&
      unit.provider_execution_allowed === false && unit.render_allowed === false &&
      (!tuongVy || (framing.close_up_allowed === false && framing.preserve_microphone === true));
  });
  if (!safe || String(renderPlan.render_plan_status) !== "APPROVED") {
    throw new ProjectRegistryInvalidStateError("Render plan đã duyệt không an toàn để chuẩn bị thực thi");
  }
  return {
    schema_version: "1.0",
    project_id: projectId,
    project_name: projectName,
    stage: "PRE_PRODUCTION",
    source_references: { approved_render_plan_file_id: renderPlanFileId },
    execution_status: "AWAITING_APPROVAL",
    provider_execution_allowed: false,
    render_allowed: false,
    render_units: units.map((unit) => ({
      ...unit,
      execution_status: "BLOCKED_PENDING_EXECUTION_APPROVAL",
      provider_execution_allowed: false,
      render_allowed: false,
    })),
    approval_gate: { approval_status: "PENDING", next_action: "APPROVE_MV_RENDER_EXECUTION" },
    prepared_at: preparedAt,
  };
}

export function buildMvRenderPlanManifest(
  projectId: string,
  projectName: string,
  timecodeManifestFileId: string,
  timecodeManifest: Record<string, unknown>,
  preparedAt: string,
) {
  const cues = Array.isArray(timecodeManifest.cues)
    ? (timecodeManifest.cues as Array<Record<string, unknown>>)
    : [];
  const continuous =
    cues.length === 15 &&
    cues.every((cue, index) => {
      const start = Number(cue.start_seconds);
      const expectedStart = index === 0 ? 0 : Number(cues[index - 1].end_seconds);
      return Number.isFinite(start) && Math.abs(start - expectedStart) <= 0.001;
    }) &&
    Math.abs(Number(cues.at(-1)?.end_seconds) - 371.62) <= 0.001;
  if (!continuous) {
    throw new ProjectRegistryInvalidStateError(
      "Timecode đã duyệt không đủ 15 cue liên tục đến 371.62 giây",
    );
  }

  const renderUnits = cues.map((cue, index) => {
    const performer = String(cue.performer ?? "").trim();
    const includesTuongVy = performer === "TUONG_VY_EM" || performer === "SONG_CA";
    const startSeconds = Number(cue.start_seconds);
    const endSeconds = Number(cue.end_seconds);
    return {
      render_unit_id: `RP${String(index + 1).padStart(3, "0")}`,
      cue_order: Number(cue.order),
      section_order: Number(cue.section_order),
      section: String(cue.section ?? ""),
      performer,
      start_seconds: startSeconds,
      end_seconds: endSeconds,
      duration_seconds: Number((endSeconds - startSeconds).toFixed(2)),
      face_identity_pipeline: "ORIGINAL_FACE_COMPOSITE",
      execution_status: "BLOCKED_PENDING_APPROVAL",
      provider_execution_allowed: false,
      render_allowed: false,
      framing_constraints: includesTuongVy
        ? {
            close_up_allowed: false,
            allowed_framings: ["MEDIUM", "FULL_BODY"],
            preserve_microphone: true,
          }
        : {
            close_up_allowed: true,
            allowed_framings: ["CLOSE_UP", "MEDIUM", "FULL_BODY"],
            preserve_microphone: false,
          },
    };
  });

  return {
    schema_version: "1.0",
    project_id: projectId,
    project_name: projectName,
    stage: "PRE_PRODUCTION",
    production_priority: "MUSIC_VIDEO_FIRST",
    face_identity_pipeline: "ORIGINAL_FACE_COMPOSITE",
    target_duration: "06:11.62",
    target_duration_seconds: 371.62,
    source_references: {
      approved_timecode_manifest_file_id: timecodeManifestFileId,
    },
    provider_execution_allowed: false,
    render_allowed: false,
    render_plan_status: "AWAITING_APPROVAL",
    render_units: renderUnits,
    safety_summary: {
      total_render_units: renderUnits.length,
      tuong_vy_locked_units: renderUnits.filter(
        (unit) => unit.framing_constraints.close_up_allowed === false,
      ).length,
      all_units_blocked: renderUnits.every(
        (unit) =>
          unit.execution_status === "BLOCKED_PENDING_APPROVAL" &&
          unit.provider_execution_allowed === false &&
          unit.render_allowed === false,
      ),
    },
    approval_gate: {
      approval_status: "PENDING",
      next_action: "APPROVE_MV_RENDER_PLAN",
    },
    prepared_at: preparedAt,
  };
}

export function planMvRenderPlanApproval(
  projectRow: string[],
  jobRow: string[] | undefined,
  approvalRow: string[] | undefined,
  now = new Date(),
): ApprovedMvRenderPlan & { submission_id: string } {
  const submissionId = String(projectRow[0] ?? "").trim();
  const projectId = String(projectRow[1] ?? "").trim();
  const nextAction = String(projectRow[19] ?? "").trim();
  if (
    !projectId ||
    String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" ||
    String(projectRow[16] ?? "").trim() !== "CONFIRMED" ||
    String(projectRow[17] ?? "").trim() !== "APPROVED" ||
    String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION"
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId || "EMPTY"} chưa đủ điều kiện duyệt render plan MV`,
    );
  }
  if (!jobRow) {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId} chưa có PRODUCTION_JOBS/MV_RENDER_PLAN`,
    );
  }
  const jobId = String(jobRow[0] ?? "").trim();
  const jobStatus = String(jobRow[4] ?? "").trim();
  if (
    !jobId ||
    String(jobRow[1] ?? "").trim() !== projectId ||
    String(jobRow[2] ?? "").trim() !== "PRE_PRODUCTION" ||
    String(jobRow[3] ?? "").trim() !== MV_RENDER_PLAN_JOB_TYPE
  ) {
    throw new ProjectRegistryInvalidStateError(
      `PRODUCTION_JOBS của ${projectId} không khớp render plan MV`,
    );
  }
  if (!approvalRow) {
    throw new ProjectRegistryInvalidStateError(
      `Render plan MV ${jobId} chưa có dòng APPROVALS`,
    );
  }
  const approvalId = String(approvalRow[0] ?? "").trim();
  const approvalStatus = String(approvalRow[4] ?? "").trim();
  const approvedAt = String(approvalRow[6] ?? "").trim() || now.toISOString();
  if (
    !approvalId ||
    String(approvalRow[1] ?? "").trim() !== projectId ||
    String(approvalRow[2] ?? "").trim() !== MV_RENDER_PLAN_JOB_TYPE ||
    String(approvalRow[3] ?? "").trim() !== jobId
  ) {
    throw new ProjectRegistryInvalidStateError(
      `APPROVALS của ${projectId} không khớp render plan MV ${jobId}`,
    );
  }
  if (
    nextAction === "PREPARE_MV_RENDER_EXECUTION" &&
    jobStatus === "APPROVED" &&
    approvalStatus === "APPROVED"
  ) {
    return {
      submission_id: submissionId,
      project_id: projectId,
      current_stage: "PRE_PRODUCTION",
      next_action: "PREPARE_MV_RENDER_EXECUTION",
      job_id: jobId,
      job_status: "APPROVED",
      approval_id: approvalId,
      approval_status: "APPROVED",
      approved_at: approvedAt,
      idempotent_replay: true,
    };
  }
  if (
    nextAction !== "APPROVE_MV_RENDER_PLAN" ||
    jobStatus !== "AWAITING_APPROVAL" ||
    approvalStatus !== "PENDING"
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Render plan MV ${jobId} không thể duyệt từ ${nextAction || "EMPTY"}/${jobStatus || "EMPTY"}/${approvalStatus || "EMPTY"}`,
    );
  }
  return {
    submission_id: submissionId,
    project_id: projectId,
    current_stage: "PRE_PRODUCTION",
    next_action: "PREPARE_MV_RENDER_EXECUTION",
    job_id: jobId,
    job_status: "APPROVED",
    approval_id: approvalId,
    approval_status: "APPROVED",
    approved_at: now.toISOString(),
    idempotent_replay: false,
  };
}

export function buildMvTimecodeAlignmentManifest(
  projectId: string,
  projectName: string,
  beatMasterFileId: string,
  shotPlanFileId: string,
  identityConstraints: Array<Record<string, unknown>>,
  preparedAt: string,
) {
  const sections = [
    [1, "Ngâm", 0, 49.83],
    [2, "Vọng Kim Lang", 49.83, 145.03],
    [3, "Vọng Cổ", 145.03, 223.52],
    [4, "Lý Đêm Trăng", 223.52, 257.32],
    [5, "Tiếp Vọng Cổ", 257.32, 304.18],
    [6, "Long Thanh", 304.18, 371.62],
  ].map(([order, label, start, end]) => ({ order, label, start_seconds: start, end_seconds: end }));
  const cueData: Array<[number, number, string, string, number, number]> = [
    [1, 1, "Ngâm", "SONG_CA", 0, 49.83],
    [2, 2, "Vọng Kim Lang", "TUONG_VY_EM", 49.83, 74.84],
    [3, 2, "Vọng Kim Lang", "PHUONG_AN_CHI", 74.84, 119.98],
    [4, 2, "Vọng Kim Lang", "SONG_CA", 119.98, 145.03],
    [5, 3, "Vọng Cổ", "PHUONG_AN_CHI", 145.03, 223.52],
    [6, 4, "Lý Đêm Trăng", "PHUONG_AN_CHI", 223.52, 232.9],
    [7, 4, "Lý Đêm Trăng", "PHUONG_AN_CHI", 232.9, 243.02],
    [8, 4, "Lý Đêm Trăng", "SONG_CA", 243.02, 257.32],
    [9, 5, "Tiếp Vọng Cổ", "PHUONG_AN_CHI", 257.32, 293.99],
    [10, 5, "Tiếp Vọng Cổ", "TUONG_VY_EM", 293.99, 304.18],
    [11, 6, "Long Thanh", "TUONG_VY_EM", 304.18, 320.2],
    [12, 6, "Long Thanh", "SONG_CA", 320.2, 338.22],
    [13, 6, "Long Thanh", "SONG_CA", 338.22, 350.6],
    [14, 6, "Long Thanh", "PHUONG_AN_CHI", 350.6, 362],
    [15, 6, "Long Thanh", "SONG_CA", 362, 371.62],
  ];
  const cues = cueData.map(([order, sectionOrder, section, performer, start, end]) => ({
    order,
    section_order: sectionOrder,
    section,
    performer,
    start_seconds: start,
    end_seconds: end,
    ...(performer === "TUONG_VY_EM"
      ? { framing_constraints: { close_up_allowed: false, allowed_framing: ["MEDIUM", "FULL_BODY"], preserve_microphone: true } }
      : {}),
  }));
  for (let index = 0; index < cues.length; index += 1) {
    const expectedStart = index === 0 ? 0 : cues[index - 1].end_seconds;
    if (Math.abs(cues[index].start_seconds - expectedStart) > 0.001) {
      throw new ProjectRegistryInvalidStateError("Timecode cue bị hở hoặc chồng thời gian");
    }
  }
  if (Math.abs(cues[cues.length - 1].end_seconds - 371.62) > 0.001) {
    throw new ProjectRegistryInvalidStateError("Timecode chưa phủ đủ thời lượng beat master");
  }
  return {
    schema_version: "1.0",
    project_id: projectId,
    project_name: projectName,
    stage: "PRE_PRODUCTION",
    production_priority: "MUSIC_VIDEO_FIRST",
    face_identity_pipeline: "ORIGINAL_FACE_COMPOSITE",
    target_duration: "06:11.62",
    target_duration_seconds: 371.62,
    provider_execution_allowed: false,
    render_allowed: false,
    alignment_status: "AWAITING_APPROVAL",
    analysis: {
      method: "WAVEFORM_SECTION_CHANGE_AND_PHRASE_VALLEY",
      tempo_bpm: 80.75,
      beat_master_file_id: beatMasterFileId,
      approved_shot_plan_file_id: shotPlanFileId,
    },
    identity_constraints: identityConstraints,
    sections,
    cues,
    approval_gate: { approval_status: "PENDING", next_action: "APPROVE_MV_TIMECODE_ALIGNMENT" },
    prepared_at: preparedAt,
  };
}

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

export function normalizeDriveFileIdInput(value: unknown) {
  const input = String(value ?? "").trim();
  const match = input.match(/\/d\/([^/?#]+)/);
  const fileId = (match?.[1] ?? input).trim();
  if (!/^[A-Za-z0-9_-]{10,}$/.test(fileId)) {
    throw new ProjectRegistryInvalidStateError(
      "instrumental_master_file_id phải là Drive file ID hoặc link Drive hợp lệ",
    );
  }
  return fileId;
}

function extractContractDriveFileId(value: unknown, fieldName: string) {
  const input = String(value ?? "").trim();
  const match = input.match(/\/d\/([^/?#]+)/);
  if (!match?.[1]) {
    throw new ProjectRegistryInvalidStateError(
      `${fieldName} chưa có link Google Drive hợp lệ`,
    );
  }
  return match[1];
}

function characterSourceIsTemporary(
  character: Record<string, unknown>,
  visualDirection: string,
) {
  const characterId = String(character.character_id ?? "").trim();
  if (TEMPORARY_CLOSE_UP_LOCK_CHARACTER_IDS.has(characterId)) return true;
  const explicitStatus = String(
    character.original_video_status ?? character.source_status ?? "",
  ).toUpperCase();
  if (explicitStatus === "TEMPORARY") return true;
  const characterName = String(character.character_name ?? "").toLocaleLowerCase("vi");
  const direction = visualDirection.toLocaleLowerCase("vi");
  return (
    characterName.includes("tường vy") &&
    direction.includes("tường vy") &&
    (direction.includes("tạm") || direction.includes("temporary"))
  );
}

export function applyMvAssetCharacterSafetyLocks(value: unknown) {
  if (!Array.isArray(value)) {
    throw new ProjectRegistryInvalidStateError(
      "MV_ASSET_MANIFEST thiếu source_assets.character_sources",
    );
  }
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ProjectRegistryInvalidStateError(
        "MV_ASSET_MANIFEST có character source không hợp lệ",
      );
    }
    const source = item as Record<string, unknown>;
    const characterId = String(source.character_id ?? "").trim();
    if (!characterId) {
      throw new ProjectRegistryInvalidStateError(
        "MV_ASSET_MANIFEST có character source thiếu character_id",
      );
    }
    if (!TEMPORARY_CLOSE_UP_LOCK_CHARACTER_IDS.has(characterId)) return source;
    return {
      ...source,
      temporary_source: true,
      close_up_allowed: false,
    };
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

export function planMvProductionPlanApproval(
  projectRow: string[],
  jobRow: string[] | undefined,
  approvalRow: string[] | undefined,
  now = new Date(),
): ApprovedMvProductionPlan & { submission_id: string } {
  const submissionId = String(projectRow[0] ?? "").trim();
  const projectId = String(projectRow[1] ?? "").trim();
  const projectType = String(projectRow[3] ?? "").trim();
  const contractStatus = String(projectRow[16] ?? "").trim();
  const contractApprovalStatus = String(projectRow[17] ?? "").trim();
  const currentStage = String(projectRow[18] ?? "").trim();
  const nextAction = String(projectRow[19] ?? "").trim();

  if (!projectId) {
    throw new ProjectRegistryInvalidStateError("Dòng PROJECTS không có project_id");
  }
  if (
    projectType !== "MUSIC_VIDEO" ||
    contractStatus !== "CONFIRMED" ||
    contractApprovalStatus !== "APPROVED" ||
    currentStage !== "PRE_PRODUCTION"
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId} chưa đủ điều kiện duyệt kế hoạch MV PRE_PRODUCTION`,
    );
  }
  if (!jobRow) {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId} chưa có PRODUCTION_JOBS/MV_PRODUCTION_PLAN`,
    );
  }

  const jobId = String(jobRow[0] ?? "").trim();
  const jobProjectId = String(jobRow[1] ?? "").trim();
  const jobStage = String(jobRow[2] ?? "").trim();
  const jobType = String(jobRow[3] ?? "").trim();
  const jobStatus = String(jobRow[4] ?? "").trim();

  if (
    !jobId ||
    jobProjectId !== projectId ||
    jobStage !== "PRE_PRODUCTION" ||
    jobType !== MV_PRODUCTION_PLAN_JOB_TYPE
  ) {
    throw new ProjectRegistryInvalidStateError(
      `PRODUCTION_JOBS của ${projectId} không khớp kế hoạch MV PRE_PRODUCTION`,
    );
  }
  if (!approvalRow) {
    throw new ProjectRegistryInvalidStateError(
      `Kế hoạch MV ${jobId} chưa có dòng APPROVALS`,
    );
  }

  const approvalId = String(approvalRow[0] ?? "").trim();
  const approvalProjectId = String(approvalRow[1] ?? "").trim();
  const approvalItemType = String(approvalRow[2] ?? "").trim();
  const approvalItemId = String(approvalRow[3] ?? "").trim();
  const planApprovalStatus = String(approvalRow[4] ?? "").trim();
  const approvedAt = String(approvalRow[6] ?? "").trim() || now.toISOString();

  if (
    !approvalId ||
    approvalProjectId !== projectId ||
    approvalItemType !== MV_PRODUCTION_PLAN_JOB_TYPE ||
    approvalItemId !== jobId
  ) {
    throw new ProjectRegistryInvalidStateError(
      `APPROVALS của ${projectId} không khớp kế hoạch MV ${jobId}`,
    );
  }

  if (
    nextAction === "PREPARE_MV_ASSETS" &&
    jobStatus === "APPROVED" &&
    planApprovalStatus === "APPROVED"
  ) {
    return {
      submission_id: submissionId,
      project_id: projectId,
      current_stage: "PRE_PRODUCTION",
      next_action: "PREPARE_MV_ASSETS",
      job_id: jobId,
      job_status: "APPROVED",
      approval_id: approvalId,
      approval_status: "APPROVED",
      approved_at: approvedAt,
      idempotent_replay: true,
    };
  }

  if (
    nextAction !== "APPROVE_MV_PRODUCTION_PLAN" ||
    jobStatus !== "AWAITING_APPROVAL" ||
    planApprovalStatus !== "PENDING"
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Kế hoạch MV ${jobId} không thể duyệt từ ${nextAction || "EMPTY"}/${jobStatus || "EMPTY"}/${planApprovalStatus || "EMPTY"}`,
    );
  }

  return {
    submission_id: submissionId,
    project_id: projectId,
    current_stage: "PRE_PRODUCTION",
    next_action: "PREPARE_MV_ASSETS",
    job_id: jobId,
    job_status: "APPROVED",
    approval_id: approvalId,
    approval_status: "APPROVED",
    approved_at: now.toISOString(),
    idempotent_replay: false,
  };
}

export function planMvAssetPreparation(
  projectRow: string[],
  approvedPlanJobRow: string[] | undefined,
  planApprovalRow: string[] | undefined,
  existingAssetJobRow: string[] | undefined,
  now = new Date(),
  jobId: string = randomUUID(),
): MvAssetPreparationTransition {
  const submissionId = String(projectRow[0] ?? "").trim();
  const projectId = String(projectRow[1] ?? "").trim();
  const projectName = String(projectRow[2] ?? "").trim();
  const projectType = String(projectRow[3] ?? "").trim();
  const contractStatus = String(projectRow[16] ?? "").trim();
  const contractApprovalStatus = String(projectRow[17] ?? "").trim();
  const currentStage = String(projectRow[18] ?? "").trim();
  const nextAction = String(projectRow[19] ?? "").trim();
  const projectFolderId = String(projectRow[20] ?? "").trim();
  const contract = parseObject(projectRow[24], "contract_json");

  if (!projectId || !projectFolderId) {
    throw new ProjectRegistryInvalidStateError(
      "PROJECTS thiếu project_id hoặc project_folder_id",
    );
  }
  if (
    projectType !== "MUSIC_VIDEO" ||
    contract.project_type !== "MUSIC_VIDEO" ||
    contractStatus !== "CONFIRMED" ||
    contractApprovalStatus !== "APPROVED" ||
    currentStage !== "PRE_PRODUCTION"
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId} chưa đủ điều kiện chuẩn bị tài sản MV`,
    );
  }
  if (
    !approvedPlanJobRow ||
    String(approvedPlanJobRow[1] ?? "").trim() !== projectId ||
    String(approvedPlanJobRow[2] ?? "").trim() !== "PRE_PRODUCTION" ||
    String(approvedPlanJobRow[3] ?? "").trim() !== MV_PRODUCTION_PLAN_JOB_TYPE ||
    String(approvedPlanJobRow[4] ?? "").trim() !== "APPROVED"
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Kế hoạch PRE_PRODUCTION của ${projectId} chưa APPROVED`,
    );
  }
  const approvedPlanJobId = String(approvedPlanJobRow[0] ?? "").trim();
  if (
    !planApprovalRow ||
    String(planApprovalRow[1] ?? "").trim() !== projectId ||
    String(planApprovalRow[2] ?? "").trim() !== MV_PRODUCTION_PLAN_JOB_TYPE ||
    String(planApprovalRow[3] ?? "").trim() !== approvedPlanJobId ||
    String(planApprovalRow[4] ?? "").trim() !== "APPROVED"
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Approval kế hoạch PRE_PRODUCTION của ${projectId} chưa APPROVED`,
    );
  }

  for (const character of contractCharacters(contract)) {
    if (
      character.identity_mode !== "ORIGINAL_FACE_COMPOSITE" ||
      !String(character.original_video_file_id ?? "").trim()
    ) {
      throw new ProjectRegistryInvalidStateError(
        `Dự án ${projectId} chỉ được chuẩn bị tài sản với ORIGINAL_FACE_COMPOSITE và video gốc`,
      );
    }
  }

  if (existingAssetJobRow) {
    if (
      String(existingAssetJobRow[1] ?? "").trim() !== projectId ||
      String(existingAssetJobRow[3] ?? "").trim() !== MV_ASSET_PREPARATION_JOB_TYPE ||
      String(existingAssetJobRow[4] ?? "").trim() !== "AWAITING_APPROVAL" ||
      nextAction !== "APPROVE_MV_ASSETS"
    ) {
      throw new ProjectRegistryInvalidStateError(
        `Tài sản MV hiện có của ${projectId} không ở trạng thái AWAITING_APPROVAL`,
      );
    }
    return {
      project_id: projectId,
      submission_id: submissionId,
      project_name: projectName,
      project_folder_id: projectFolderId,
      contract,
      job_id: String(existingAssetJobRow[0] ?? "").trim(),
      prepared_at: String(existingAssetJobRow[12] ?? "").trim() || now.toISOString(),
      idempotent_replay: true,
    };
  }

  if (nextAction !== "PREPARE_MV_ASSETS") {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId} không thể chuẩn bị tài sản từ next_action ${nextAction || "EMPTY"}`,
    );
  }

  return {
    project_id: projectId,
    submission_id: submissionId,
    project_name: projectName,
    project_folder_id: projectFolderId,
    contract,
    job_id: jobId,
    prepared_at: now.toISOString(),
    idempotent_replay: false,
  };
}

export function planMvAssetApproval(
  projectRow: string[],
  jobRow: string[] | undefined,
  approvalRow: string[] | undefined,
  now = new Date(),
): ApprovedMvAssets & { submission_id: string } {
  const submissionId = String(projectRow[0] ?? "").trim();
  const projectId = String(projectRow[1] ?? "").trim();
  const projectType = String(projectRow[3] ?? "").trim();
  const contractStatus = String(projectRow[16] ?? "").trim();
  const contractApprovalStatus = String(projectRow[17] ?? "").trim();
  const currentStage = String(projectRow[18] ?? "").trim();
  const nextAction = String(projectRow[19] ?? "").trim();

  if (
    !projectId ||
    projectType !== "MUSIC_VIDEO" ||
    contractStatus !== "CONFIRMED" ||
    contractApprovalStatus !== "APPROVED" ||
    currentStage !== "PRE_PRODUCTION"
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId || "EMPTY"} chưa đủ điều kiện duyệt tài sản MV`,
    );
  }
  if (!jobRow) {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId} chưa có PRODUCTION_JOBS/MV_ASSET_PREPARATION`,
    );
  }

  const jobId = String(jobRow[0] ?? "").trim();
  const jobStatus = String(jobRow[4] ?? "").trim();
  if (
    !jobId ||
    String(jobRow[1] ?? "").trim() !== projectId ||
    String(jobRow[2] ?? "").trim() !== "PRE_PRODUCTION" ||
    String(jobRow[3] ?? "").trim() !== MV_ASSET_PREPARATION_JOB_TYPE
  ) {
    throw new ProjectRegistryInvalidStateError(
      `PRODUCTION_JOBS của ${projectId} không khớp tài sản MV`,
    );
  }
  if (!approvalRow) {
    throw new ProjectRegistryInvalidStateError(
      `Tài sản MV ${jobId} chưa có dòng APPROVALS`,
    );
  }

  const approvalId = String(approvalRow[0] ?? "").trim();
  const approvalStatus = String(approvalRow[4] ?? "").trim();
  const approvedAt = String(approvalRow[6] ?? "").trim() || now.toISOString();
  if (
    !approvalId ||
    String(approvalRow[1] ?? "").trim() !== projectId ||
    String(approvalRow[2] ?? "").trim() !== MV_ASSET_PREPARATION_JOB_TYPE ||
    String(approvalRow[3] ?? "").trim() !== jobId
  ) {
    throw new ProjectRegistryInvalidStateError(
      `APPROVALS của ${projectId} không khớp tài sản MV ${jobId}`,
    );
  }

  if (
    nextAction === "PREPARE_MV_SHOT_PLAN" &&
    jobStatus === "APPROVED" &&
    approvalStatus === "APPROVED"
  ) {
    return {
      submission_id: submissionId,
      project_id: projectId,
      current_stage: "PRE_PRODUCTION",
      next_action: "PREPARE_MV_SHOT_PLAN",
      job_id: jobId,
      job_status: "APPROVED",
      approval_id: approvalId,
      approval_status: "APPROVED",
      approved_at: approvedAt,
      idempotent_replay: true,
    };
  }

  if (
    nextAction !== "APPROVE_MV_ASSETS" ||
    jobStatus !== "AWAITING_APPROVAL" ||
    approvalStatus !== "PENDING"
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Tài sản MV ${jobId} không thể duyệt từ ${nextAction || "EMPTY"}/${jobStatus || "EMPTY"}/${approvalStatus || "EMPTY"}`,
    );
  }

  return {
    submission_id: submissionId,
    project_id: projectId,
    current_stage: "PRE_PRODUCTION",
    next_action: "PREPARE_MV_SHOT_PLAN",
    job_id: jobId,
    job_status: "APPROVED",
    approval_id: approvalId,
    approval_status: "APPROVED",
    approved_at: now.toISOString(),
    idempotent_replay: false,
  };
}

export function planMvShotPlanApproval(
  projectRow: string[],
  jobRow: string[] | undefined,
  approvalRow: string[] | undefined,
  now = new Date(),
): ApprovedMvShotPlan & { submission_id: string } {
  const submissionId = String(projectRow[0] ?? "").trim();
  const projectId = String(projectRow[1] ?? "").trim();
  const projectType = String(projectRow[3] ?? "").trim();
  const contractStatus = String(projectRow[16] ?? "").trim();
  const contractApprovalStatus = String(projectRow[17] ?? "").trim();
  const currentStage = String(projectRow[18] ?? "").trim();
  const nextAction = String(projectRow[19] ?? "").trim();

  if (
    !projectId ||
    projectType !== "MUSIC_VIDEO" ||
    contractStatus !== "CONFIRMED" ||
    contractApprovalStatus !== "APPROVED" ||
    currentStage !== "PRE_PRODUCTION"
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId || "EMPTY"} chưa đủ điều kiện duyệt shot plan MV`,
    );
  }
  if (!jobRow) {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId} chưa có PRODUCTION_JOBS/MV_SHOT_PLAN`,
    );
  }

  const jobId = String(jobRow[0] ?? "").trim();
  const jobStatus = String(jobRow[4] ?? "").trim();
  if (
    !jobId ||
    String(jobRow[1] ?? "").trim() !== projectId ||
    String(jobRow[2] ?? "").trim() !== "PRE_PRODUCTION" ||
    String(jobRow[3] ?? "").trim() !== MV_SHOT_PLAN_JOB_TYPE
  ) {
    throw new ProjectRegistryInvalidStateError(
      `PRODUCTION_JOBS của ${projectId} không khớp shot plan MV`,
    );
  }
  if (!approvalRow) {
    throw new ProjectRegistryInvalidStateError(
      `Shot plan MV ${jobId} chưa có dòng APPROVALS`,
    );
  }

  const approvalId = String(approvalRow[0] ?? "").trim();
  const approvalStatus = String(approvalRow[4] ?? "").trim();
  const approvedAt = String(approvalRow[6] ?? "").trim() || now.toISOString();
  if (
    !approvalId ||
    String(approvalRow[1] ?? "").trim() !== projectId ||
    String(approvalRow[2] ?? "").trim() !== MV_SHOT_PLAN_JOB_TYPE ||
    String(approvalRow[3] ?? "").trim() !== jobId
  ) {
    throw new ProjectRegistryInvalidStateError(
      `APPROVALS của ${projectId} không khớp shot plan MV ${jobId}`,
    );
  }

  if (
    nextAction === "PREPARE_MV_TIMECODE_ALIGNMENT" &&
    jobStatus === "APPROVED" &&
    approvalStatus === "APPROVED"
  ) {
    return {
      submission_id: submissionId,
      project_id: projectId,
      current_stage: "PRE_PRODUCTION",
      next_action: "PREPARE_MV_TIMECODE_ALIGNMENT",
      job_id: jobId,
      job_status: "APPROVED",
      approval_id: approvalId,
      approval_status: "APPROVED",
      approved_at: approvedAt,
      idempotent_replay: true,
    };
  }

  if (
    nextAction !== "APPROVE_MV_SHOT_PLAN" ||
    jobStatus !== "AWAITING_APPROVAL" ||
    approvalStatus !== "PENDING"
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Shot plan MV ${jobId} không thể duyệt từ ${nextAction || "EMPTY"}/${jobStatus || "EMPTY"}/${approvalStatus || "EMPTY"}`,
    );
  }

  return {
    submission_id: submissionId,
    project_id: projectId,
    current_stage: "PRE_PRODUCTION",
    next_action: "PREPARE_MV_TIMECODE_ALIGNMENT",
    job_id: jobId,
    job_status: "APPROVED",
    approval_id: approvalId,
    approval_status: "APPROVED",
    approved_at: now.toISOString(),
    idempotent_replay: false,
  };
}

export function planMvTimecodeAlignmentApproval(
  projectRow: string[],
  jobRow: string[] | undefined,
  approvalRow: string[] | undefined,
  now = new Date(),
): ApprovedMvTimecodeAlignment & { submission_id: string } {
  const submissionId = String(projectRow[0] ?? "").trim();
  const projectId = String(projectRow[1] ?? "").trim();
  const nextAction = String(projectRow[19] ?? "").trim();
  if (!projectId || String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" || String(projectRow[16] ?? "").trim() !== "CONFIRMED" || String(projectRow[17] ?? "").trim() !== "APPROVED" || String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION") {
    throw new ProjectRegistryInvalidStateError(`Dự án ${projectId || "EMPTY"} chưa đủ điều kiện duyệt timecode MV`);
  }
  if (!jobRow) throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} chưa có PRODUCTION_JOBS/MV_TIMECODE_ALIGNMENT`);
  const jobId = String(jobRow[0] ?? "").trim();
  const jobStatus = String(jobRow[4] ?? "").trim();
  if (!jobId || String(jobRow[1] ?? "").trim() !== projectId || String(jobRow[2] ?? "").trim() !== "PRE_PRODUCTION" || String(jobRow[3] ?? "").trim() !== MV_TIMECODE_ALIGNMENT_JOB_TYPE) {
    throw new ProjectRegistryInvalidStateError(`PRODUCTION_JOBS của ${projectId} không khớp timecode MV`);
  }
  if (!approvalRow) throw new ProjectRegistryInvalidStateError(`Timecode MV ${jobId} chưa có dòng APPROVALS`);
  const approvalId = String(approvalRow[0] ?? "").trim();
  const approvalStatus = String(approvalRow[4] ?? "").trim();
  const approvedAt = String(approvalRow[6] ?? "").trim() || now.toISOString();
  if (!approvalId || String(approvalRow[1] ?? "").trim() !== projectId || String(approvalRow[2] ?? "").trim() !== MV_TIMECODE_ALIGNMENT_JOB_TYPE || String(approvalRow[3] ?? "").trim() !== jobId) {
    throw new ProjectRegistryInvalidStateError(`APPROVALS của ${projectId} không khớp timecode MV ${jobId}`);
  }
  if (nextAction === "PREPARE_MV_RENDER_PLAN" && jobStatus === "APPROVED" && approvalStatus === "APPROVED") {
    return { submission_id: submissionId, project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "PREPARE_MV_RENDER_PLAN", job_id: jobId, job_status: "APPROVED", approval_id: approvalId, approval_status: "APPROVED", approved_at: approvedAt, idempotent_replay: true };
  }
  if (nextAction !== "APPROVE_MV_TIMECODE_ALIGNMENT" || jobStatus !== "AWAITING_APPROVAL" || approvalStatus !== "PENDING") {
    throw new ProjectRegistryInvalidStateError(`Timecode MV ${jobId} không thể duyệt từ ${nextAction || "EMPTY"}/${jobStatus || "EMPTY"}/${approvalStatus || "EMPTY"}`);
  }
  return { submission_id: submissionId, project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "PREPARE_MV_RENDER_PLAN", job_id: jobId, job_status: "APPROVED", approval_id: approvalId, approval_status: "APPROVED", approved_at: now.toISOString(), idempotent_replay: false };
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

  async approveMvProductionPlan(projectId: string): Promise<ApprovedMvProductionPlan> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
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
      const jobRowIndex = jobRows.findIndex(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[3] ?? "").trim() === MV_PRODUCTION_PLAN_JOB_TYPE,
      );
      const approvalRows = approvalsResponse.data.values ?? [];
      const jobId = jobRowIndex > 0 ? String(jobRows[jobRowIndex][0] ?? "").trim() : "";
      const approvalRowIndex = approvalRows.findIndex(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[2] ?? "").trim() === MV_PRODUCTION_PLAN_JOB_TYPE &&
          String(row[3] ?? "").trim() === jobId,
      );

      const transition = planMvProductionPlanApproval(
        projectRows[projectRowIndex].map(String),
        jobRowIndex > 0 ? jobRows[jobRowIndex].map(String) : undefined,
        approvalRowIndex > 0 ? approvalRows[approvalRowIndex].map(String) : undefined,
      );
      const result: ApprovedMvProductionPlan = {
        project_id: transition.project_id,
        current_stage: transition.current_stage,
        next_action: transition.next_action,
        job_id: transition.job_id,
        job_status: transition.job_status,
        approval_id: transition.approval_id,
        approval_status: transition.approval_status,
        approved_at: transition.approved_at,
        idempotent_replay: transition.idempotent_replay,
      };
      if (transition.idempotent_replay) return result;

      const projectSheetRow = projectRowIndex + 1;
      const jobSheetRow = jobRowIndex + 1;
      const approvalSheetRow = approvalRowIndex + 1;
      const auditSheetRow = (auditResponse.data.values ?? []).length + 1;

      await this.markMvProductionManifestApproved(
        drive,
        String(projectRows[projectRowIndex][20] ?? "").trim(),
        jobRows[jobRowIndex].map(String),
        transition,
      );

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            {
              range: `'PROJECTS'!S${projectSheetRow}:T${projectSheetRow}`,
              values: [[transition.current_stage, transition.next_action]],
            },
            {
              range: `'PROJECTS'!X${projectSheetRow}`,
              values: [[transition.approved_at]],
            },
            {
              range: `'PRODUCTION_JOBS'!E${jobSheetRow}`,
              values: [[transition.job_status]],
            },
            {
              range: `'PRODUCTION_JOBS'!L${jobSheetRow}`,
              values: [[transition.approved_at]],
            },
            {
              range: `'PRODUCTION_JOBS'!N${jobSheetRow}`,
              values: [[transition.approved_at]],
            },
            {
              range: `'APPROVALS'!E${approvalSheetRow}:G${approvalSheetRow}`,
              values: [[transition.approval_status, "PROJECT_OWNER", transition.approved_at]],
            },
            {
              range: `'APPROVALS'!H${approvalSheetRow}`,
              values: [[
                "Đã duyệt kế hoạch PRE_PRODUCTION; tiếp theo chuẩn bị tài sản MV. Chưa render và chưa gọi provider.",
              ]],
            },
            {
              range: `'APPROVALS'!J${approvalSheetRow}`,
              values: [[transition.approved_at]],
            },
            {
              range: `'AUDIT_LOG'!A${auditSheetRow}:H${auditSheetRow}`,
              values: [[
                randomUUID(),
                transition.project_id,
                transition.submission_id,
                "MV_PRODUCTION_PLAN_APPROVED",
                "SUCCEEDED",
                "AI_EXECUTOR_WEB",
                "Kế hoạch PRE_PRODUCTION đã được chủ dự án duyệt; chưa render và chưa gọi provider.",
                transition.approved_at,
              ]],
            },
          ],
        },
      });

      return result;
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
          : "Không duyệt được kế hoạch MV PRE_PRODUCTION Gia Đình Tư Hậu",
      );
    }
  }

  async prepareMvAssets(
    projectId: string,
    instrumentalMasterFileIdInput: string,
  ): Promise<PreparedMvAssets> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const projectsRootFolderId = requiredSetting("GIA_DINH_TU_HAU_PROJECTS_FOLDER_ID");
    const instrumentalMasterFileId = normalizeDriveFileIdInput(
      instrumentalMasterFileIdInput,
    );
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
      const approvedPlanJobRow = jobRows.find(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[3] ?? "").trim() === MV_PRODUCTION_PLAN_JOB_TYPE,
      );
      const approvedPlanJobId = String(approvedPlanJobRow?.[0] ?? "").trim();
      const approvalRows = approvalsResponse.data.values ?? [];
      const planApprovalRow = approvalRows.find(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[2] ?? "").trim() === MV_PRODUCTION_PLAN_JOB_TYPE &&
          String(row[3] ?? "").trim() === approvedPlanJobId,
      );
      const existingAssetJobRow = jobRows.find(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[3] ?? "").trim() === MV_ASSET_PREPARATION_JOB_TYPE,
      );
      const transition = planMvAssetPreparation(
        projectRows[projectRowIndex].map(String),
        approvedPlanJobRow?.map(String),
        planApprovalRow?.map(String),
        existingAssetJobRow?.map(String),
      );

      if (transition.idempotent_replay) {
        return await this.readExistingMvAssetPreparation(
          drive,
          transition,
          existingAssetJobRow?.map(String) ?? [],
          approvalRows,
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
      await this.assertApprovedMvProductionManifest(
        drive,
        transition.project_folder_id,
        approvedPlanJobRow?.map(String) ?? [],
        transition.project_id,
      );

      const productionFolder = await this.findChildFolder(
        drive,
        transition.project_folder_id,
        "02_SAN_XUAT_MV",
      );
      const instrumentalResponse = await drive.files.get({
        fileId: instrumentalMasterFileId,
        fields: "id,name,mimeType,size,trashed,webViewLink",
        supportsAllDrives: true,
      });
      const instrumental = instrumentalResponse.data;
      if (
        !instrumental.id ||
        instrumental.trashed === true ||
        !(
          String(instrumental.mimeType ?? "").startsWith("audio/") ||
          instrumental.mimeType === "application/mp3"
        ) ||
        Number(instrumental.size ?? 0) <= 0
      ) {
        throw new ProjectRegistryInvalidStateError(
          `Beat/instrumental ${instrumentalMasterFileId} không phải file audio hợp lệ`,
        );
      }

      const visualDirection = String(
        transition.contract.visual_direction ?? "",
      ).trim();
      const characters = contractCharacters(transition.contract);
      const characterSources = await Promise.all(
        characters.map(async (character) => {
          const fileId = String(character.original_video_file_id ?? "").trim();
          const response = await drive.files.get({
            fileId,
            fields: "id,name,mimeType,size,trashed,webViewLink",
            supportsAllDrives: true,
          });
          const source = response.data;
          if (
            !source.id ||
            source.trashed === true ||
            !String(source.mimeType ?? "").startsWith("video/") ||
            Number(source.size ?? 0) <= 0
          ) {
            throw new ProjectRegistryInvalidStateError(
              `Video gốc ${fileId} của ${String(character.character_name ?? character.character_id ?? "nhân vật")} không hợp lệ`,
            );
          }
          const temporarySource = characterSourceIsTemporary(
            character,
            visualDirection,
          );
          return {
            character_id: character.character_id,
            character_name: character.character_name,
            identity_mode: "ORIGINAL_FACE_COMPOSITE",
            file_id: source.id,
            file_name: source.name,
            mime_type: source.mimeType,
            size_bytes: Number(source.size ?? 0),
            temporary_source: temporarySource,
            close_up_allowed: !temporarySource,
          };
        }),
      );

      const lyricsFileId = extractContractDriveFileId(
        transition.contract.lyrics,
        "lyrics",
      );
      const lyricsResponse = await drive.files.get({
        fileId: lyricsFileId,
        fields: "id,name,mimeType,size,trashed,webViewLink",
        supportsAllDrives: true,
      });
      const lyrics = lyricsResponse.data;
      const acceptedLyricsMimeTypes = new Set([
        "application/vnd.google-apps.document",
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
      ]);
      if (
        !lyrics.id ||
        lyrics.trashed === true ||
        !acceptedLyricsMimeTypes.has(String(lyrics.mimeType ?? ""))
      ) {
        throw new ProjectRegistryInvalidStateError(
          `Lyrics master ${lyricsFileId} không phải tài liệu hợp lệ`,
        );
      }

      const inputFileIds = [
        instrumentalMasterFileId,
        lyricsFileId,
        ...characterSources.map((source) => String(source.file_id)),
      ];
      const manifestName = `${MV_ASSET_MANIFEST_FILE_PREFIX}_${transition.project_id}.json`;
      const manifest = {
        schema_version: "1.0",
        project_id: transition.project_id,
        project_name: transition.project_name,
        stage: "PRE_PRODUCTION",
        production_priority: "MUSIC_VIDEO_FIRST",
        face_identity_pipeline: "ORIGINAL_FACE_COMPOSITE",
        provider_execution_allowed: false,
        render_allowed: false,
        source_assets: {
          instrumental_master: {
            file_id: instrumental.id,
            file_name: instrumental.name,
            mime_type: instrumental.mimeType,
            size_bytes: Number(instrumental.size ?? 0),
          },
          lyrics_master: {
            file_id: lyrics.id,
            file_name: lyrics.name,
            mime_type: lyrics.mimeType,
          },
          character_sources: characterSources,
        },
        asset_checks: {
          instrumental_master: "VALIDATED",
          lyrics_master: "VALIDATED",
          original_face_sources: "VALIDATED",
          source_files_copied: false,
        },
        visual_constraints: [visualDirection].filter(Boolean),
        approval_gate: {
          approval_status: "PENDING",
          next_action: "APPROVE_MV_ASSETS",
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
      const projectSheetRow = projectRowIndex + 1;
      const jobSheetRow = jobRows.length + 1;
      const approvalSheetRow = approvalRows.length + 1;
      const auditSheetRow = (auditResponse.data.values ?? []).length + 1;

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            {
              range: `'PROJECTS'!S${projectSheetRow}:T${projectSheetRow}`,
              values: [["PRE_PRODUCTION", "APPROVE_MV_ASSETS"]],
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
                MV_ASSET_PREPARATION_JOB_TYPE,
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
                MV_ASSET_PREPARATION_JOB_TYPE,
                transition.job_id,
                "PENDING",
                "",
                "",
                "Chờ duyệt tài sản MV trước khi lập shot plan, render hoặc gọi provider.",
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
                "MV_ASSETS_PREPARED",
                "SUCCEEDED",
                "AI_EXECUTOR_WEB",
                "Đã kiểm tra beat, lyrics và video gốc; chưa render và chưa gọi provider.",
                transition.prepared_at,
              ]],
            },
          ],
        },
      });

      return {
        project_id: transition.project_id,
        current_stage: "PRE_PRODUCTION",
        next_action: "APPROVE_MV_ASSETS",
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
          : "Không chuẩn bị được tài sản MV Gia Đình Tư Hậu",
      );
    }
  }

  async prepareMvShotPlan(projectId: string): Promise<PreparedMvShotPlan> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const projectsRootFolderId = requiredSetting("GIA_DINH_TU_HAU_PROJECTS_FOLDER_ID");
    const sheets = this.createSheetsClient();
    const drive = this.createDriveClient();

    try {
      const [projectsResponse, jobsResponse, approvalsResponse, auditResponse] =
        await Promise.all([
          sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" }),
          sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" }),
          sheets.spreadsheets.values.get({ spreadsheetId, range: "'APPROVALS'!A:J" }),
          sheets.spreadsheets.values.get({ spreadsheetId, range: "'AUDIT_LOG'!A:H" }),
        ]);

      const projectRows = projectsResponse.data.values ?? [];
      const projectRowIndex = projectRows.findIndex(
        (row, index) => index > 0 && String(row[1] ?? "").trim() === projectId,
      );
      if (projectRowIndex < 0) {
        throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      }
      const projectRow = projectRows[projectRowIndex].map(String);
      const projectType = String(projectRow[3] ?? "").trim();
      const contractStatus = String(projectRow[16] ?? "").trim();
      const contractApproval = String(projectRow[17] ?? "").trim();
      const currentStage = String(projectRow[18] ?? "").trim();
      const nextAction = String(projectRow[19] ?? "").trim();
      const projectFolderId = String(projectRow[20] ?? "").trim();
      if (
        projectType !== "MUSIC_VIDEO" ||
        contractStatus !== "CONFIRMED" ||
        contractApproval !== "APPROVED" ||
        currentStage !== "PRE_PRODUCTION"
      ) {
        throw new ProjectRegistryInvalidStateError(
          `Dự án ${projectId} chưa đủ điều kiện lập shot plan MV`,
        );
      }

      const jobRows = jobsResponse.data.values ?? [];
      const approvalRows = approvalsResponse.data.values ?? [];
      const assetJob = jobRows.find(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[3] ?? "").trim() === MV_ASSET_PREPARATION_JOB_TYPE,
      )?.map(String);
      const assetJobId = String(assetJob?.[0] ?? "").trim();
      const assetApproval = approvalRows.find(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[2] ?? "").trim() === MV_ASSET_PREPARATION_JOB_TYPE &&
          String(row[3] ?? "").trim() === assetJobId,
      )?.map(String);
      if (
        !assetJob ||
        String(assetJob[4] ?? "").trim() !== "APPROVED" ||
        !assetApproval ||
        String(assetApproval[4] ?? "").trim() !== "APPROVED"
      ) {
        throw new ProjectRegistryInvalidStateError(
          `Tài sản MV của ${projectId} chưa được duyệt`,
        );
      }

      const existingJob = jobRows.find(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[3] ?? "").trim() === MV_SHOT_PLAN_JOB_TYPE,
      )?.map(String);
      if (existingJob) {
        const existingJobId = String(existingJob[0] ?? "").trim();
        const existingApproval = approvalRows.find(
          (row, index) =>
            index > 0 &&
            String(row[1] ?? "").trim() === projectId &&
            String(row[2] ?? "").trim() === MV_SHOT_PLAN_JOB_TYPE &&
            String(row[3] ?? "").trim() === existingJobId,
        )?.map(String);
        const manifestFileId = parseStringArray(existingJob[7])[0];
        if (
          nextAction !== "APPROVE_MV_SHOT_PLAN" ||
          String(existingJob[4] ?? "").trim() !== "AWAITING_APPROVAL" ||
          String(existingApproval?.[4] ?? "").trim() !== "PENDING" ||
          !manifestFileId
        ) {
          throw new ProjectRegistryInvalidStateError(
            `Shot plan của ${projectId} đã tồn tại nhưng không ở trạng thái chờ duyệt`,
          );
        }
        const metadata = await drive.files.get({
          fileId: manifestFileId,
          fields: "id,webViewLink,trashed",
          supportsAllDrives: true,
        });
        if (metadata.data.trashed === true) {
          throw new ProjectRegistryInvalidStateError(`Shot plan ${manifestFileId} đã bị xóa`);
        }
        return {
          project_id: projectId,
          current_stage: "PRE_PRODUCTION",
          next_action: "APPROVE_MV_SHOT_PLAN",
          job_id: existingJobId,
          job_status: "AWAITING_APPROVAL",
          approval_id: String(existingApproval?.[0] ?? "").trim(),
          approval_status: "PENDING",
          manifest_file_id: manifestFileId,
          manifest_file_url:
            metadata.data.webViewLink ?? `https://drive.google.com/file/d/${manifestFileId}/view`,
          prepared_at: String(existingJob[12] ?? "").trim(),
          idempotent_replay: true,
        };
      }
      if (nextAction !== "PREPARE_MV_SHOT_PLAN") {
        throw new ProjectRegistryInvalidStateError(
          `Dự án ${projectId} không thể lập shot plan từ ${nextAction || "EMPTY"}`,
        );
      }

      const projectFolder = await drive.files.get({
        fileId: projectFolderId,
        fields: "id,mimeType,parents,trashed",
        supportsAllDrives: true,
      });
      assertProjectFolderWithinRoot(projectFolder.data, projectsRootFolderId, projectId);
      const approvedAssetManifest = await this.readApprovedMvAssetManifest(
        drive,
        projectFolderId,
        assetJob,
        projectId,
      );
      const productionFolder = await this.findChildFolder(
        drive,
        projectFolderId,
        "02_SAN_XUAT_MV",
      );
      const preparedAt = new Date().toISOString();
      const jobId = randomUUID();
      const approvalId = randomUUID();
      const assetManifestId = parseStringArray(assetJob[7])[0];
      const sourceAssets = approvedAssetManifest.source_assets as Record<string, unknown>;
      const lyricsMaster = sourceAssets.lyrics_master as Record<string, unknown>;
      const characterSources = sourceAssets.character_sources as Array<Record<string, unknown>>;
      const manifest = {
        schema_version: "1.0",
        project_id: projectId,
        project_name: String(projectRow[2] ?? "").trim(),
        stage: "PRE_PRODUCTION",
        production_priority: "MUSIC_VIDEO_FIRST",
        face_identity_pipeline: "ORIGINAL_FACE_COMPOSITE",
        target_duration: "06:11.62",
        target_aspect_ratio: "16:9",
        provider_execution_allowed: false,
        render_allowed: false,
        timeline_status: "TIMECODE_ALIGNMENT_REQUIRED",
        source_references: {
          approved_asset_manifest_file_id: assetManifestId,
          lyrics_master_file_id: lyricsMaster.file_id,
        },
        identity_constraints: characterSources.map((source) => ({
          character_id: source.character_id,
          character_name: source.character_name,
          temporary_source: source.temporary_source === true,
          close_up_allowed: source.close_up_allowed === true,
          allowed_framing:
            source.temporary_source === true ? ["MEDIUM", "FULL_BODY"] : ["CLOSE_UP", "MEDIUM", "FULL_BODY"],
        })),
        lyrical_sections: [
          { order: 1, label: "Ngâm", performers: ["SONG_CA"], visual_intent: "Giới thiệu tình chị em và hành trình tiếp nối" },
          { order: 2, label: "Vọng Kim Lang", performers: ["TUONG_VY_EM", "PHUONG_AN_CHI", "SONG_CA"], visual_intent: "Sân khấu Lô Tô, gia đình và thử thách chia ly" },
          { order: 3, label: "Vọng Cổ", performers: ["PHUONG_AN_CHI"], visual_intent: "Gánh nặng người quản lý và ánh đèn sân khấu" },
          { order: 4, label: "Lý Đêm Trăng", performers: ["PHUONG_AN_CHI", "SONG_CA"], visual_intent: "Thấu hiểu, nâng đỡ và cùng giữ nghề" },
          { order: 5, label: "Tiếp Vọng Cổ", performers: ["PHUONG_AN_CHI", "TUONG_VY_EM"], visual_intent: "Lời người đi trước và lời đáp của người theo sau" },
          { order: 6, label: "Long Thanh", performers: ["TUONG_VY_EM", "PHUONG_AN_CHI", "SONG_CA"], visual_intent: "Đoàn tụ, Nghề Tổ và kết thúc một nhà" },
        ],
        continuity_rules: [
          "Tường Vy dùng nguồn tạm; cấm FACE_CLOSE_UP và chỉ dùng MEDIUM/FULL_BODY.",
          "Giữ microphone khi xuất hiện trong nguồn Tường Vy; không xóa hoặc tái tạo sai đạo cụ.",
          "Không thay mặt thật bằng LivePortrait hoặc khuôn mặt tổng hợp.",
          "Timecode từng câu phải căn thủ công theo beat master trước khi duyệt shot plan.",
        ],
        approval_gate: {
          approval_status: "PENDING",
          next_action: "APPROVE_MV_SHOT_PLAN",
        },
        prepared_at: preparedAt,
      };
      const manifestFile = await this.createOrReuseJsonFile(
        drive,
        productionFolder.id,
        `${MV_SHOT_PLAN_FILE_PREFIX}_${projectId}.json`,
        manifest,
      );

      const projectSheetRow = projectRowIndex + 1;
      const jobSheetRow = jobRows.length + 1;
      const approvalSheetRow = approvalRows.length + 1;
      const auditSheetRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            { range: `'PROJECTS'!S${projectSheetRow}:T${projectSheetRow}`, values: [["PRE_PRODUCTION", "APPROVE_MV_SHOT_PLAN"]] },
            { range: `'PROJECTS'!X${projectSheetRow}`, values: [[preparedAt]] },
            { range: `'PRODUCTION_JOBS'!A${jobSheetRow}:N${jobSheetRow}`, values: [[jobId, projectId, "PRE_PRODUCTION", MV_SHOT_PLAN_JOB_TYPE, "AWAITING_APPROVAL", "", JSON.stringify([assetManifestId, lyricsMaster.file_id]), JSON.stringify([manifestFile.id]), "", 0, preparedAt, "", preparedAt, preparedAt]] },
            { range: `'APPROVALS'!A${approvalSheetRow}:J${approvalSheetRow}`, values: [[approvalId, projectId, MV_SHOT_PLAN_JOB_TYPE, jobId, "PENDING", "", "", "Chờ duyệt shot plan; timecode còn phải căn theo beat. Chưa render và chưa gọi provider.", preparedAt, preparedAt]] },
            { range: `'AUDIT_LOG'!A${auditSheetRow}:H${auditSheetRow}`, values: [[randomUUID(), projectId, String(projectRow[0] ?? "").trim(), "MV_SHOT_PLAN_PREPARED", "SUCCEEDED", "AI_EXECUTOR_WEB", "Đã lập shot plan theo lyrics master; giữ khóa cận mặt Tường Vy; chưa render và chưa gọi provider.", preparedAt]] },
          ],
        },
      });
      return {
        project_id: projectId,
        current_stage: "PRE_PRODUCTION",
        next_action: "APPROVE_MV_SHOT_PLAN",
        job_id: jobId,
        job_status: "AWAITING_APPROVAL",
        approval_id: approvalId,
        approval_status: "PENDING",
        manifest_file_id: manifestFile.id,
        manifest_file_url: manifestFile.webViewLink,
        prepared_at: preparedAt,
        idempotent_replay: false,
      };
    } catch (error) {
      if (
        error instanceof ProjectRegistryNotConfiguredError ||
        error instanceof ProjectRegistryProjectNotFoundError ||
        error instanceof ProjectRegistryInvalidStateError
      ) throw error;
      throw new ProjectRegistryUnavailableError(
        error instanceof Error ? error.message : "Không lập được shot plan MV Gia Đình Tư Hậu",
      );
    }
  }

  async prepareMvTimecodeAlignment(projectId: string): Promise<PreparedMvTimecodeAlignment> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const projectsRootFolderId = requiredSetting("GIA_DINH_TU_HAU_PROJECTS_FOLDER_ID");
    const sheets = this.createSheetsClient();
    const drive = this.createDriveClient();
    try {
      const [projectsResponse, jobsResponse, approvalsResponse, auditResponse] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'APPROVALS'!A:J" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'AUDIT_LOG'!A:H" }),
      ]);
      const projectRows = projectsResponse.data.values ?? [];
      const projectRowIndex = projectRows.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId);
      if (projectRowIndex < 0) throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      const projectRow = projectRows[projectRowIndex].map(String);
      const nextAction = String(projectRow[19] ?? "").trim();
      const projectFolderId = String(projectRow[20] ?? "").trim();
      if (String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" || String(projectRow[16] ?? "").trim() !== "CONFIRMED" || String(projectRow[17] ?? "").trim() !== "APPROVED" || String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION") {
        throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} chưa đủ điều kiện căn timecode MV`);
      }
      const jobRows = jobsResponse.data.values ?? [];
      const approvalRows = approvalsResponse.data.values ?? [];
      const shotJob = jobRows.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_SHOT_PLAN_JOB_TYPE)?.map(String);
      const shotJobId = String(shotJob?.[0] ?? "").trim();
      const shotApproval = approvalRows.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[2] ?? "").trim() === MV_SHOT_PLAN_JOB_TYPE && String(row[3] ?? "").trim() === shotJobId)?.map(String);
      if (!shotJob || String(shotJob[4] ?? "").trim() !== "APPROVED" || !shotApproval || String(shotApproval[4] ?? "").trim() !== "APPROVED") {
        throw new ProjectRegistryInvalidStateError(`Shot plan của ${projectId} chưa được duyệt`);
      }
      const existingJob = jobRows.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_TIMECODE_ALIGNMENT_JOB_TYPE)?.map(String);
      if (existingJob) {
        const existingJobId = String(existingJob[0] ?? "").trim();
        const existingApproval = approvalRows.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[2] ?? "").trim() === MV_TIMECODE_ALIGNMENT_JOB_TYPE && String(row[3] ?? "").trim() === existingJobId)?.map(String);
        const manifestFileId = parseStringArray(existingJob[7])[0];
        if (nextAction !== "APPROVE_MV_TIMECODE_ALIGNMENT" || String(existingJob[4] ?? "").trim() !== "AWAITING_APPROVAL" || String(existingApproval?.[4] ?? "").trim() !== "PENDING" || !manifestFileId) {
          throw new ProjectRegistryInvalidStateError(`Timecode của ${projectId} đã tồn tại nhưng không ở trạng thái chờ duyệt`);
        }
        const metadata = await drive.files.get({ fileId: manifestFileId, fields: "id,webViewLink,trashed", supportsAllDrives: true });
        if (metadata.data.trashed === true) throw new ProjectRegistryInvalidStateError(`Timecode ${manifestFileId} đã bị xóa`);
        return { project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "APPROVE_MV_TIMECODE_ALIGNMENT", job_id: existingJobId, job_status: "AWAITING_APPROVAL", approval_id: String(existingApproval?.[0] ?? "").trim(), approval_status: "PENDING", manifest_file_id: manifestFileId, manifest_file_url: metadata.data.webViewLink ?? `https://drive.google.com/file/d/${manifestFileId}/view`, prepared_at: String(existingJob[12] ?? "").trim(), idempotent_replay: true };
      }
      if (nextAction !== "PREPARE_MV_TIMECODE_ALIGNMENT") throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} không thể căn timecode từ ${nextAction || "EMPTY"}`);
      const projectFolder = await drive.files.get({ fileId: projectFolderId, fields: "id,mimeType,parents,trashed", supportsAllDrives: true });
      assertProjectFolderWithinRoot(projectFolder.data, projectsRootFolderId, projectId);
      const approvedShotPlan = await this.readApprovedMvShotPlanManifest(drive, projectFolderId, shotJob, projectId);
      const productionFolder = await this.findChildFolder(drive, projectFolderId, "02_SAN_XUAT_MV");
      const shotPlanFileId = parseStringArray(shotJob[7])[0];
      const sourceReferences = approvedShotPlan.source_references as Record<string, unknown>;
      const assetManifestFileId = String(sourceReferences.approved_asset_manifest_file_id ?? "").trim();
      const assetJob = jobRows.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_ASSET_PREPARATION_JOB_TYPE)?.map(String);
      if (!assetJob || parseStringArray(assetJob[7])[0] !== assetManifestFileId) throw new ProjectRegistryInvalidStateError(`Không xác định được asset manifest đã duyệt của ${projectId}`);
      const approvedAssets = await this.readApprovedMvAssetManifest(drive, projectFolderId, assetJob, projectId);
      const instrumentalMaster = ((approvedAssets.source_assets as Record<string, unknown>).instrumental_master ?? {}) as Record<string, unknown>;
      const beatMasterFileId = String(instrumentalMaster.file_id ?? "").trim();
      if (!beatMasterFileId) throw new ProjectRegistryInvalidStateError(`Asset manifest ${projectId} chưa có beat master`);
      const preparedAt = new Date().toISOString();
      const manifest = buildMvTimecodeAlignmentManifest(projectId, String(projectRow[2] ?? "").trim(), beatMasterFileId, shotPlanFileId, Array.isArray(approvedShotPlan.identity_constraints) ? approvedShotPlan.identity_constraints as Array<Record<string, unknown>> : [], preparedAt);
      const manifestFile = await this.createOrReuseJsonFile(drive, productionFolder.id, `${MV_TIMECODE_ALIGNMENT_FILE_PREFIX}_${projectId}.json`, manifest);
      const jobId = randomUUID();
      const approvalId = randomUUID();
      const projectSheetRow = projectRowIndex + 1;
      const jobSheetRow = jobRows.length + 1;
      const approvalSheetRow = approvalRows.length + 1;
      const auditSheetRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [
        { range: `'PROJECTS'!S${projectSheetRow}:T${projectSheetRow}`, values: [["PRE_PRODUCTION", "APPROVE_MV_TIMECODE_ALIGNMENT"]] },
        { range: `'PROJECTS'!X${projectSheetRow}`, values: [[preparedAt]] },
        { range: `'PRODUCTION_JOBS'!A${jobSheetRow}:N${jobSheetRow}`, values: [[jobId, projectId, "PRE_PRODUCTION", MV_TIMECODE_ALIGNMENT_JOB_TYPE, "AWAITING_APPROVAL", "", JSON.stringify([beatMasterFileId, shotPlanFileId]), JSON.stringify([manifestFile.id]), "", 0, preparedAt, "", preparedAt, preparedAt]] },
        { range: `'APPROVALS'!A${approvalSheetRow}:J${approvalSheetRow}`, values: [[approvalId, projectId, MV_TIMECODE_ALIGNMENT_JOB_TYPE, jobId, "PENDING", "", "", "Chờ duyệt căn timecode 6 phân đoạn/15 cue. Chưa render và chưa gọi provider.", preparedAt, preparedAt]] },
        { range: `'AUDIT_LOG'!A${auditSheetRow}:H${auditSheetRow}`, values: [[randomUUID(), projectId, String(projectRow[0] ?? "").trim(), "MV_TIMECODE_ALIGNMENT_PREPARED", "SUCCEEDED", "AI_EXECUTOR_WEB", "Đã căn timecode sơ bộ theo waveform và phrase valley; chờ chủ dự án duyệt; chưa render và chưa gọi provider.", preparedAt]] },
      ] } });
      return { project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "APPROVE_MV_TIMECODE_ALIGNMENT", job_id: jobId, job_status: "AWAITING_APPROVAL", approval_id: approvalId, approval_status: "PENDING", manifest_file_id: manifestFile.id, manifest_file_url: manifestFile.webViewLink, prepared_at: preparedAt, idempotent_replay: false };
    } catch (error) {
      if (error instanceof ProjectRegistryNotConfiguredError || error instanceof ProjectRegistryProjectNotFoundError || error instanceof ProjectRegistryInvalidStateError) throw error;
      throw new ProjectRegistryUnavailableError(error instanceof Error ? error.message : "Không căn được timecode MV Gia Đình Tư Hậu");
    }
  }

  async approveMvTimecodeAlignment(projectId: string): Promise<ApprovedMvTimecodeAlignment> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const sheets = this.createSheetsClient();
    const drive = this.createDriveClient();
    try {
      const [projectsResponse, jobsResponse, approvalsResponse, auditResponse] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'APPROVALS'!A:J" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'AUDIT_LOG'!A:H" }),
      ]);
      const projectRows = projectsResponse.data.values ?? [];
      const projectRowIndex = projectRows.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId);
      if (projectRowIndex < 0) throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      const jobRows = jobsResponse.data.values ?? [];
      const jobRowIndex = jobRows.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_TIMECODE_ALIGNMENT_JOB_TYPE);
      const jobId = jobRowIndex > 0 ? String(jobRows[jobRowIndex][0] ?? "").trim() : "";
      const approvalRows = approvalsResponse.data.values ?? [];
      const approvalRowIndex = approvalRows.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[2] ?? "").trim() === MV_TIMECODE_ALIGNMENT_JOB_TYPE && String(row[3] ?? "").trim() === jobId);
      const transition = planMvTimecodeAlignmentApproval(projectRows[projectRowIndex].map(String), jobRowIndex > 0 ? jobRows[jobRowIndex].map(String) : undefined, approvalRowIndex > 0 ? approvalRows[approvalRowIndex].map(String) : undefined);
      const result: ApprovedMvTimecodeAlignment = { project_id: transition.project_id, current_stage: transition.current_stage, next_action: transition.next_action, job_id: transition.job_id, job_status: transition.job_status, approval_id: transition.approval_id, approval_status: transition.approval_status, approved_at: transition.approved_at, idempotent_replay: transition.idempotent_replay };
      if (transition.idempotent_replay) return result;
      await this.markMvTimecodeAlignmentManifestApproved(drive, String(projectRows[projectRowIndex][20] ?? "").trim(), jobRows[jobRowIndex].map(String), transition);
      const projectSheetRow = projectRowIndex + 1;
      const jobSheetRow = jobRowIndex + 1;
      const approvalSheetRow = approvalRowIndex + 1;
      const auditSheetRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [
        { range: `'PROJECTS'!S${projectSheetRow}:T${projectSheetRow}`, values: [[transition.current_stage, transition.next_action]] },
        { range: `'PROJECTS'!X${projectSheetRow}`, values: [[transition.approved_at]] },
        { range: `'PRODUCTION_JOBS'!E${jobSheetRow}`, values: [[transition.job_status]] },
        { range: `'PRODUCTION_JOBS'!L${jobSheetRow}`, values: [[transition.approved_at]] },
        { range: `'PRODUCTION_JOBS'!N${jobSheetRow}`, values: [[transition.approved_at]] },
        { range: `'APPROVALS'!E${approvalSheetRow}:G${approvalSheetRow}`, values: [[transition.approval_status, "PROJECT_OWNER", transition.approved_at]] },
        { range: `'APPROVALS'!H${approvalSheetRow}`, values: [["Đã duyệt căn timecode 6 phân đoạn/15 cue; tiếp theo chuẩn bị render plan. Chưa render và chưa gọi provider."]] },
        { range: `'APPROVALS'!J${approvalSheetRow}`, values: [[transition.approved_at]] },
        { range: `'AUDIT_LOG'!A${auditSheetRow}:H${auditSheetRow}`, values: [[randomUUID(), transition.project_id, transition.submission_id, "MV_TIMECODE_ALIGNMENT_APPROVED", "SUCCEEDED", "AI_EXECUTOR_WEB", "Timecode MV đã được chủ dự án duyệt; tiếp theo chuẩn bị render plan; chưa render và chưa gọi provider.", transition.approved_at]] },
      ] } });
      return result;
    } catch (error) {
      if (error instanceof ProjectRegistryNotConfiguredError || error instanceof ProjectRegistryProjectNotFoundError || error instanceof ProjectRegistryInvalidStateError) throw error;
      throw new ProjectRegistryUnavailableError(error instanceof Error ? error.message : "Không duyệt được timecode MV Gia Đình Tư Hậu");
    }
  }

  async prepareMvRenderPlan(projectId: string): Promise<PreparedMvRenderPlan> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const projectsRootFolderId = requiredSetting("GIA_DINH_TU_HAU_PROJECTS_FOLDER_ID");
    const sheets = this.createSheetsClient();
    const drive = this.createDriveClient();
    try {
      const [projectsResponse, jobsResponse, approvalsResponse, auditResponse] =
        await Promise.all([
          sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" }),
          sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" }),
          sheets.spreadsheets.values.get({ spreadsheetId, range: "'APPROVALS'!A:J" }),
          sheets.spreadsheets.values.get({ spreadsheetId, range: "'AUDIT_LOG'!A:H" }),
        ]);
      const projectRows = projectsResponse.data.values ?? [];
      const projectRowIndex = projectRows.findIndex(
        (row, index) => index > 0 && String(row[1] ?? "").trim() === projectId,
      );
      if (projectRowIndex < 0) {
        throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      }
      const projectRow = projectRows[projectRowIndex].map(String);
      const nextAction = String(projectRow[19] ?? "").trim();
      const projectFolderId = String(projectRow[20] ?? "").trim();
      if (
        String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" ||
        String(projectRow[16] ?? "").trim() !== "CONFIRMED" ||
        String(projectRow[17] ?? "").trim() !== "APPROVED" ||
        String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION"
      ) {
        throw new ProjectRegistryInvalidStateError(
          `Dự án ${projectId} chưa đủ điều kiện lập render plan MV`,
        );
      }

      const jobRows = jobsResponse.data.values ?? [];
      const approvalRows = approvalsResponse.data.values ?? [];
      const timecodeJob = jobRows.find(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[3] ?? "").trim() === MV_TIMECODE_ALIGNMENT_JOB_TYPE,
      )?.map(String);
      const timecodeJobId = String(timecodeJob?.[0] ?? "").trim();
      const timecodeApproval = approvalRows.find(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[2] ?? "").trim() === MV_TIMECODE_ALIGNMENT_JOB_TYPE &&
          String(row[3] ?? "").trim() === timecodeJobId,
      )?.map(String);
      if (
        !timecodeJob ||
        String(timecodeJob[4] ?? "").trim() !== "APPROVED" ||
        !timecodeApproval ||
        String(timecodeApproval[4] ?? "").trim() !== "APPROVED"
      ) {
        throw new ProjectRegistryInvalidStateError(
          `Timecode của ${projectId} chưa được duyệt`,
        );
      }

      const existingJob = jobRows.find(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[3] ?? "").trim() === MV_RENDER_PLAN_JOB_TYPE,
      )?.map(String);
      if (existingJob) {
        const existingJobId = String(existingJob[0] ?? "").trim();
        const existingApproval = approvalRows.find(
          (row, index) =>
            index > 0 &&
            String(row[1] ?? "").trim() === projectId &&
            String(row[2] ?? "").trim() === MV_RENDER_PLAN_JOB_TYPE &&
            String(row[3] ?? "").trim() === existingJobId,
        )?.map(String);
        const manifestFileId = parseStringArray(existingJob[7])[0];
        if (
          nextAction !== "APPROVE_MV_RENDER_PLAN" ||
          String(existingJob[4] ?? "").trim() !== "AWAITING_APPROVAL" ||
          String(existingApproval?.[4] ?? "").trim() !== "PENDING" ||
          !manifestFileId
        ) {
          throw new ProjectRegistryInvalidStateError(
            `Render plan của ${projectId} đã tồn tại nhưng không ở trạng thái chờ duyệt`,
          );
        }
        const metadata = await drive.files.get({
          fileId: manifestFileId,
          fields: "id,webViewLink,trashed",
          supportsAllDrives: true,
        });
        if (metadata.data.trashed === true) {
          throw new ProjectRegistryInvalidStateError(
            `Render plan ${manifestFileId} đã bị xóa`,
          );
        }
        return {
          project_id: projectId,
          current_stage: "PRE_PRODUCTION",
          next_action: "APPROVE_MV_RENDER_PLAN",
          job_id: existingJobId,
          job_status: "AWAITING_APPROVAL",
          approval_id: String(existingApproval?.[0] ?? "").trim(),
          approval_status: "PENDING",
          manifest_file_id: manifestFileId,
          manifest_file_url:
            metadata.data.webViewLink ??
            `https://drive.google.com/file/d/${manifestFileId}/view`,
          prepared_at: String(existingJob[12] ?? "").trim(),
          idempotent_replay: true,
        };
      }
      if (nextAction !== "PREPARE_MV_RENDER_PLAN") {
        throw new ProjectRegistryInvalidStateError(
          `Dự án ${projectId} không thể lập render plan từ ${nextAction || "EMPTY"}`,
        );
      }

      const projectFolder = await drive.files.get({
        fileId: projectFolderId,
        fields: "id,mimeType,parents,trashed",
        supportsAllDrives: true,
      });
      assertProjectFolderWithinRoot(projectFolder.data, projectsRootFolderId, projectId);
      const approvedTimecode = await this.readApprovedMvTimecodeManifest(
        drive,
        projectFolderId,
        timecodeJob,
        projectId,
      );
      const productionFolder = await this.findChildFolder(
        drive,
        projectFolderId,
        "02_SAN_XUAT_MV",
      );
      const timecodeManifestFileId = parseStringArray(timecodeJob[7])[0];
      const preparedAt = new Date().toISOString();
      const manifest = buildMvRenderPlanManifest(
        projectId,
        String(projectRow[2] ?? "").trim(),
        timecodeManifestFileId,
        approvedTimecode,
        preparedAt,
      );
      const manifestFile = await this.createOrReuseJsonFile(
        drive,
        productionFolder.id,
        `${MV_RENDER_PLAN_FILE_PREFIX}_${projectId}.json`,
        manifest,
      );
      const jobId = randomUUID();
      const approvalId = randomUUID();
      const projectSheetRow = projectRowIndex + 1;
      const jobSheetRow = jobRows.length + 1;
      const approvalSheetRow = approvalRows.length + 1;
      const auditSheetRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            {
              range: `'PROJECTS'!S${projectSheetRow}:T${projectSheetRow}`,
              values: [["PRE_PRODUCTION", "APPROVE_MV_RENDER_PLAN"]],
            },
            { range: `'PROJECTS'!X${projectSheetRow}`, values: [[preparedAt]] },
            {
              range: `'PRODUCTION_JOBS'!A${jobSheetRow}:N${jobSheetRow}`,
              values: [[
                jobId,
                projectId,
                "PRE_PRODUCTION",
                MV_RENDER_PLAN_JOB_TYPE,
                "AWAITING_APPROVAL",
                "",
                JSON.stringify([timecodeManifestFileId]),
                JSON.stringify([manifestFile.id]),
                "",
                0,
                preparedAt,
                "",
                preparedAt,
                preparedAt,
              ]],
            },
            {
              range: `'APPROVALS'!A${approvalSheetRow}:J${approvalSheetRow}`,
              values: [[
                approvalId,
                projectId,
                MV_RENDER_PLAN_JOB_TYPE,
                jobId,
                "PENDING",
                "",
                "",
                "Chờ duyệt render plan 15 cue. Provider và render vẫn bị khóa.",
                preparedAt,
                preparedAt,
              ]],
            },
            {
              range: `'AUDIT_LOG'!A${auditSheetRow}:H${auditSheetRow}`,
              values: [[
                randomUUID(),
                projectId,
                String(projectRow[0] ?? "").trim(),
                "MV_RENDER_PLAN_PREPARED",
                "SUCCEEDED",
                "AI_EXECUTOR_WEB",
                "Đã lập render plan 15 cue; giữ khóa Tường Vy; chưa render và chưa gọi provider.",
                preparedAt,
              ]],
            },
          ],
        },
      });
      return {
        project_id: projectId,
        current_stage: "PRE_PRODUCTION",
        next_action: "APPROVE_MV_RENDER_PLAN",
        job_id: jobId,
        job_status: "AWAITING_APPROVAL",
        approval_id: approvalId,
        approval_status: "PENDING",
        manifest_file_id: manifestFile.id,
        manifest_file_url: manifestFile.webViewLink,
        prepared_at: preparedAt,
        idempotent_replay: false,
      };
    } catch (error) {
      if (
        error instanceof ProjectRegistryNotConfiguredError ||
        error instanceof ProjectRegistryProjectNotFoundError ||
        error instanceof ProjectRegistryInvalidStateError
      ) throw error;
      throw new ProjectRegistryUnavailableError(
        error instanceof Error
          ? error.message
          : "Không lập được render plan MV Gia Đình Tư Hậu",
      );
    }
  }

  async prepareMvRenderExecution(projectId: string): Promise<PreparedMvRenderExecution> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const projectsRootFolderId = requiredSetting("GIA_DINH_TU_HAU_PROJECTS_FOLDER_ID");
    const sheets = this.createSheetsClient();
    const drive = this.createDriveClient();
    try {
      const [projectsResponse, jobsResponse, approvalsResponse, auditResponse] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'APPROVALS'!A:J" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'AUDIT_LOG'!A:H" }),
      ]);
      const projectRows = projectsResponse.data.values ?? [];
      const projectRowIndex = projectRows.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId);
      if (projectRowIndex < 0) throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      const projectRow = projectRows[projectRowIndex].map(String);
      if (String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" || String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION") {
        throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} chưa đủ điều kiện chuẩn bị thực thi render`);
      }
      const jobs = jobsResponse.data.values ?? [];
      const approvals = approvalsResponse.data.values ?? [];
      const renderPlanJob = jobs.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_RENDER_PLAN_JOB_TYPE)?.map(String);
      const planJobId = String(renderPlanJob?.[0] ?? "").trim();
      const planApproval = approvals.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[2] ?? "").trim() === MV_RENDER_PLAN_JOB_TYPE && String(row[3] ?? "").trim() === planJobId)?.map(String);
      if (!renderPlanJob || String(renderPlanJob[4] ?? "").trim() !== "APPROVED" || !planApproval || String(planApproval[4] ?? "").trim() !== "APPROVED") {
        throw new ProjectRegistryInvalidStateError(`Render plan của ${projectId} chưa được duyệt`);
      }
      const existing = jobs.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_RENDER_EXECUTION_JOB_TYPE)?.map(String);
      if (existing) {
        const existingApproval = approvals.find((row, index) => index > 0 && String(row[3] ?? "").trim() === String(existing[0] ?? "").trim())?.map(String);
        const fileId = parseStringArray(existing[7])[0];
        if (String(projectRow[19] ?? "").trim() !== "APPROVE_MV_RENDER_EXECUTION" || String(existing[4] ?? "").trim() !== "AWAITING_APPROVAL" || String(existingApproval?.[4] ?? "").trim() !== "PENDING" || !fileId) {
          throw new ProjectRegistryInvalidStateError(`Hồ sơ thực thi render của ${projectId} đã tồn tại nhưng không chờ duyệt`);
        }
        const metadata = await drive.files.get({ fileId, fields: "id,webViewLink,trashed", supportsAllDrives: true });
        if (metadata.data.trashed) throw new ProjectRegistryInvalidStateError(`Manifest thực thi ${fileId} đã bị xóa`);
        return { project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "APPROVE_MV_RENDER_EXECUTION", job_id: String(existing[0]), job_status: "AWAITING_APPROVAL", approval_id: String(existingApproval?.[0] ?? ""), approval_status: "PENDING", manifest_file_id: fileId, manifest_file_url: metadata.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`, prepared_at: String(existing[12] ?? ""), idempotent_replay: true };
      }
      if (String(projectRow[19] ?? "").trim() !== "PREPARE_MV_RENDER_EXECUTION") throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} không thể chuẩn bị thực thi từ ${String(projectRow[19] ?? "EMPTY")}`);
      const projectFolderId = String(projectRow[20] ?? "").trim();
      const projectFolder = await drive.files.get({ fileId: projectFolderId, fields: "id,mimeType,parents,trashed", supportsAllDrives: true });
      assertProjectFolderWithinRoot(projectFolder.data, projectsRootFolderId, projectId);
      const planFileId = parseStringArray(renderPlanJob[7])[0];
      const planResponse = await drive.files.get({ fileId: planFileId, alt: "media", supportsAllDrives: true }, { responseType: "text" });
      const renderPlan = typeof planResponse.data === "string" ? parseObject(planResponse.data, "MV_RENDER_PLAN manifest") : planResponse.data as Record<string, unknown>;
      const preparedAt = new Date().toISOString();
      const manifest = buildMvRenderExecutionManifest(projectId, String(projectRow[2] ?? ""), planFileId, renderPlan, preparedAt);
      const productionFolder = await this.findChildFolder(drive, projectFolderId, "02_SAN_XUAT_MV");
      const manifestFile = await this.createOrReuseJsonFile(drive, productionFolder.id, `${MV_RENDER_EXECUTION_FILE_PREFIX}_${projectId}.json`, manifest);
      const jobId = randomUUID(); const approvalId = randomUUID();
      const projectSheetRow = projectRowIndex + 1; const jobSheetRow = jobs.length + 1; const approvalSheetRow = approvals.length + 1; const auditSheetRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [
        { range: `'PROJECTS'!S${projectSheetRow}:T${projectSheetRow}`, values: [["PRE_PRODUCTION", "APPROVE_MV_RENDER_EXECUTION"]] },
        { range: `'PROJECTS'!X${projectSheetRow}`, values: [[preparedAt]] },
        { range: `'PRODUCTION_JOBS'!A${jobSheetRow}:N${jobSheetRow}`, values: [[jobId, projectId, "PRE_PRODUCTION", MV_RENDER_EXECUTION_JOB_TYPE, "AWAITING_APPROVAL", "", JSON.stringify([planFileId]), JSON.stringify([manifestFile.id]), "", 0, preparedAt, "", preparedAt, preparedAt]] },
        { range: `'APPROVALS'!A${approvalSheetRow}:J${approvalSheetRow}`, values: [[approvalId, projectId, MV_RENDER_EXECUTION_JOB_TYPE, jobId, "PENDING", "", "", "Chờ duyệt thực thi 15 render units. Provider và render vẫn bị khóa.", preparedAt, preparedAt]] },
        { range: `'AUDIT_LOG'!A${auditSheetRow}:H${auditSheetRow}`, values: [[randomUUID(), projectId, String(projectRow[0] ?? ""), "MV_RENDER_EXECUTION_PREPARED", "SUCCEEDED", "AI_EXECUTOR_WEB", "Đã chuẩn bị hồ sơ thực thi render; chưa gọi provider và chưa render.", preparedAt]] },
      ] } });
      return { project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "APPROVE_MV_RENDER_EXECUTION", job_id: jobId, job_status: "AWAITING_APPROVAL", approval_id: approvalId, approval_status: "PENDING", manifest_file_id: manifestFile.id, manifest_file_url: manifestFile.webViewLink, prepared_at: preparedAt, idempotent_replay: false };
    } catch (error) {
      if (error instanceof ProjectRegistryNotConfiguredError || error instanceof ProjectRegistryProjectNotFoundError || error instanceof ProjectRegistryInvalidStateError) throw error;
      throw new ProjectRegistryUnavailableError(error instanceof Error ? error.message : "Không chuẩn bị được thực thi render MV");
    }
  }

  async approveMvRenderPlan(projectId: string): Promise<ApprovedMvRenderPlan> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const sheets = this.createSheetsClient();
    const drive = this.createDriveClient();
    try {
      const [projectsResponse, jobsResponse, approvalsResponse, auditResponse] =
        await Promise.all([
          sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" }),
          sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" }),
          sheets.spreadsheets.values.get({ spreadsheetId, range: "'APPROVALS'!A:J" }),
          sheets.spreadsheets.values.get({ spreadsheetId, range: "'AUDIT_LOG'!A:H" }),
        ]);
      const projectRows = projectsResponse.data.values ?? [];
      const projectRowIndex = projectRows.findIndex(
        (row, index) => index > 0 && String(row[1] ?? "").trim() === projectId,
      );
      if (projectRowIndex < 0) {
        throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      }
      const jobRows = jobsResponse.data.values ?? [];
      const jobRowIndex = jobRows.findIndex(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[3] ?? "").trim() === MV_RENDER_PLAN_JOB_TYPE,
      );
      const jobId =
        jobRowIndex > 0 ? String(jobRows[jobRowIndex][0] ?? "").trim() : "";
      const approvalRows = approvalsResponse.data.values ?? [];
      const approvalRowIndex = approvalRows.findIndex(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[2] ?? "").trim() === MV_RENDER_PLAN_JOB_TYPE &&
          String(row[3] ?? "").trim() === jobId,
      );
      const transition = planMvRenderPlanApproval(
        projectRows[projectRowIndex].map(String),
        jobRowIndex > 0 ? jobRows[jobRowIndex].map(String) : undefined,
        approvalRowIndex > 0 ? approvalRows[approvalRowIndex].map(String) : undefined,
      );
      const result: ApprovedMvRenderPlan = {
        project_id: transition.project_id,
        current_stage: transition.current_stage,
        next_action: transition.next_action,
        job_id: transition.job_id,
        job_status: transition.job_status,
        approval_id: transition.approval_id,
        approval_status: transition.approval_status,
        approved_at: transition.approved_at,
        idempotent_replay: transition.idempotent_replay,
      };
      if (transition.idempotent_replay) return result;
      await this.markMvRenderPlanManifestApproved(
        drive,
        String(projectRows[projectRowIndex][20] ?? "").trim(),
        jobRows[jobRowIndex].map(String),
        transition,
      );
      const projectSheetRow = projectRowIndex + 1;
      const jobSheetRow = jobRowIndex + 1;
      const approvalSheetRow = approvalRowIndex + 1;
      const auditSheetRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            {
              range: `'PROJECTS'!S${projectSheetRow}:T${projectSheetRow}`,
              values: [[transition.current_stage, transition.next_action]],
            },
            { range: `'PROJECTS'!X${projectSheetRow}`, values: [[transition.approved_at]] },
            { range: `'PRODUCTION_JOBS'!E${jobSheetRow}`, values: [[transition.job_status]] },
            { range: `'PRODUCTION_JOBS'!L${jobSheetRow}`, values: [[transition.approved_at]] },
            { range: `'PRODUCTION_JOBS'!N${jobSheetRow}`, values: [[transition.approved_at]] },
            {
              range: `'APPROVALS'!E${approvalSheetRow}:G${approvalSheetRow}`,
              values: [[transition.approval_status, "PROJECT_OWNER", transition.approved_at]],
            },
            {
              range: `'APPROVALS'!H${approvalSheetRow}`,
              values: [[
                "Đã duyệt render plan 15 cue; tiếp theo chuẩn bị thực thi render. Provider và render vẫn bị khóa.",
              ]],
            },
            { range: `'APPROVALS'!J${approvalSheetRow}`, values: [[transition.approved_at]] },
            {
              range: `'AUDIT_LOG'!A${auditSheetRow}:H${auditSheetRow}`,
              values: [[
                randomUUID(),
                transition.project_id,
                transition.submission_id,
                "MV_RENDER_PLAN_APPROVED",
                "SUCCEEDED",
                "AI_EXECUTOR_WEB",
                "Render plan MV đã được chủ dự án duyệt; tiếp theo chuẩn bị thực thi; chưa render và chưa gọi provider.",
                transition.approved_at,
              ]],
            },
          ],
        },
      });
      return result;
    } catch (error) {
      if (
        error instanceof ProjectRegistryNotConfiguredError ||
        error instanceof ProjectRegistryProjectNotFoundError ||
        error instanceof ProjectRegistryInvalidStateError
      ) throw error;
      throw new ProjectRegistryUnavailableError(
        error instanceof Error
          ? error.message
          : "Không duyệt được render plan MV Gia Đình Tư Hậu",
      );
    }
  }

  async approveMvShotPlan(projectId: string): Promise<ApprovedMvShotPlan> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const sheets = this.createSheetsClient();
    const drive = this.createDriveClient();

    try {
      const [projectsResponse, jobsResponse, approvalsResponse, auditResponse] =
        await Promise.all([
          sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" }),
          sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" }),
          sheets.spreadsheets.values.get({ spreadsheetId, range: "'APPROVALS'!A:J" }),
          sheets.spreadsheets.values.get({ spreadsheetId, range: "'AUDIT_LOG'!A:H" }),
        ]);

      const projectRows = projectsResponse.data.values ?? [];
      const projectRowIndex = projectRows.findIndex(
        (row, index) => index > 0 && String(row[1] ?? "").trim() === projectId,
      );
      if (projectRowIndex < 0) {
        throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      }

      const jobRows = jobsResponse.data.values ?? [];
      const jobRowIndex = jobRows.findIndex(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[3] ?? "").trim() === MV_SHOT_PLAN_JOB_TYPE,
      );
      const jobId = jobRowIndex > 0 ? String(jobRows[jobRowIndex][0] ?? "").trim() : "";
      const approvalRows = approvalsResponse.data.values ?? [];
      const approvalRowIndex = approvalRows.findIndex(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[2] ?? "").trim() === MV_SHOT_PLAN_JOB_TYPE &&
          String(row[3] ?? "").trim() === jobId,
      );

      const transition = planMvShotPlanApproval(
        projectRows[projectRowIndex].map(String),
        jobRowIndex > 0 ? jobRows[jobRowIndex].map(String) : undefined,
        approvalRowIndex > 0 ? approvalRows[approvalRowIndex].map(String) : undefined,
      );
      const result: ApprovedMvShotPlan = {
        project_id: transition.project_id,
        current_stage: transition.current_stage,
        next_action: transition.next_action,
        job_id: transition.job_id,
        job_status: transition.job_status,
        approval_id: transition.approval_id,
        approval_status: transition.approval_status,
        approved_at: transition.approved_at,
        idempotent_replay: transition.idempotent_replay,
      };
      if (transition.idempotent_replay) return result;

      await this.markMvShotPlanManifestApproved(
        drive,
        String(projectRows[projectRowIndex][20] ?? "").trim(),
        jobRows[jobRowIndex].map(String),
        transition,
      );

      const projectSheetRow = projectRowIndex + 1;
      const jobSheetRow = jobRowIndex + 1;
      const approvalSheetRow = approvalRowIndex + 1;
      const auditSheetRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            { range: `'PROJECTS'!S${projectSheetRow}:T${projectSheetRow}`, values: [[transition.current_stage, transition.next_action]] },
            { range: `'PROJECTS'!X${projectSheetRow}`, values: [[transition.approved_at]] },
            { range: `'PRODUCTION_JOBS'!E${jobSheetRow}`, values: [[transition.job_status]] },
            { range: `'PRODUCTION_JOBS'!L${jobSheetRow}`, values: [[transition.approved_at]] },
            { range: `'PRODUCTION_JOBS'!N${jobSheetRow}`, values: [[transition.approved_at]] },
            { range: `'APPROVALS'!E${approvalSheetRow}:G${approvalSheetRow}`, values: [[transition.approval_status, "PROJECT_OWNER", transition.approved_at]] },
            { range: `'APPROVALS'!H${approvalSheetRow}`, values: [["Đã duyệt shot plan MV; tiếp theo căn timecode theo beat master. Chưa render và chưa gọi provider."]] },
            { range: `'APPROVALS'!J${approvalSheetRow}`, values: [[transition.approved_at]] },
            { range: `'AUDIT_LOG'!A${auditSheetRow}:H${auditSheetRow}`, values: [[randomUUID(), transition.project_id, transition.submission_id, "MV_SHOT_PLAN_APPROVED", "SUCCEEDED", "AI_EXECUTOR_WEB", "Shot plan MV đã được chủ dự án duyệt; tiếp theo căn timecode. Chưa render và chưa gọi provider.", transition.approved_at]] },
          ],
        },
      });

      return result;
    } catch (error) {
      if (
        error instanceof ProjectRegistryNotConfiguredError ||
        error instanceof ProjectRegistryProjectNotFoundError ||
        error instanceof ProjectRegistryInvalidStateError
      ) throw error;
      throw new ProjectRegistryUnavailableError(
        error instanceof Error ? error.message : "Không duyệt được shot plan MV Gia Đình Tư Hậu",
      );
    }
  }

  async approveMvAssets(projectId: string): Promise<ApprovedMvAssets> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
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
      const jobRowIndex = jobRows.findIndex(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[3] ?? "").trim() === MV_ASSET_PREPARATION_JOB_TYPE,
      );
      const jobId = jobRowIndex > 0 ? String(jobRows[jobRowIndex][0] ?? "").trim() : "";
      const approvalRows = approvalsResponse.data.values ?? [];
      const approvalRowIndex = approvalRows.findIndex(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[2] ?? "").trim() === MV_ASSET_PREPARATION_JOB_TYPE &&
          String(row[3] ?? "").trim() === jobId,
      );

      const transition = planMvAssetApproval(
        projectRows[projectRowIndex].map(String),
        jobRowIndex > 0 ? jobRows[jobRowIndex].map(String) : undefined,
        approvalRowIndex > 0 ? approvalRows[approvalRowIndex].map(String) : undefined,
      );
      const result: ApprovedMvAssets = {
        project_id: transition.project_id,
        current_stage: transition.current_stage,
        next_action: transition.next_action,
        job_id: transition.job_id,
        job_status: transition.job_status,
        approval_id: transition.approval_id,
        approval_status: transition.approval_status,
        approved_at: transition.approved_at,
        idempotent_replay: transition.idempotent_replay,
      };
      if (transition.idempotent_replay) return result;

      await this.markMvAssetManifestApproved(
        drive,
        String(projectRows[projectRowIndex][20] ?? "").trim(),
        jobRows[jobRowIndex].map(String),
        transition,
      );

      const projectSheetRow = projectRowIndex + 1;
      const jobSheetRow = jobRowIndex + 1;
      const approvalSheetRow = approvalRowIndex + 1;
      const auditSheetRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            {
              range: `'PROJECTS'!S${projectSheetRow}:T${projectSheetRow}`,
              values: [[transition.current_stage, transition.next_action]],
            },
            {
              range: `'PROJECTS'!X${projectSheetRow}`,
              values: [[transition.approved_at]],
            },
            {
              range: `'PRODUCTION_JOBS'!E${jobSheetRow}`,
              values: [[transition.job_status]],
            },
            {
              range: `'PRODUCTION_JOBS'!L${jobSheetRow}`,
              values: [[transition.approved_at]],
            },
            {
              range: `'PRODUCTION_JOBS'!N${jobSheetRow}`,
              values: [[transition.approved_at]],
            },
            {
              range: `'APPROVALS'!E${approvalSheetRow}:G${approvalSheetRow}`,
              values: [[transition.approval_status, "PROJECT_OWNER", transition.approved_at]],
            },
            {
              range: `'APPROVALS'!H${approvalSheetRow}`,
              values: [[
                "Đã duyệt tài sản MV và khóa cận mặt nguồn tạm Tường Vy; tiếp theo lập shot plan. Chưa render và chưa gọi provider.",
              ]],
            },
            {
              range: `'APPROVALS'!J${approvalSheetRow}`,
              values: [[transition.approved_at]],
            },
            {
              range: `'AUDIT_LOG'!A${auditSheetRow}:H${auditSheetRow}`,
              values: [[
                randomUUID(),
                transition.project_id,
                transition.submission_id,
                "MV_ASSETS_APPROVED",
                "SUCCEEDED",
                "AI_EXECUTOR_WEB",
                "Tài sản MV đã được chủ dự án duyệt; khóa cận mặt nguồn tạm Tường Vy; chưa render và chưa gọi provider.",
                transition.approved_at,
              ]],
            },
          ],
        },
      });

      return result;
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
          : "Không duyệt được tài sản MV Gia Đình Tư Hậu",
      );
    }
  }

  private async markMvRenderPlanManifestApproved(
    drive: drive_v3.Drive,
    projectFolderId: string,
    jobRow: string[],
    transition: ApprovedMvRenderPlan,
  ) {
    if (!projectFolderId) {
      throw new ProjectRegistryInvalidStateError(
        `Dự án ${transition.project_id} chưa có thư mục Drive`,
      );
    }
    const productionFolder = await this.findChildFolder(
      drive,
      projectFolderId,
      "02_SAN_XUAT_MV",
    );
    const manifestFileId = parseStringArray(jobRow[7])[0];
    if (!manifestFileId) {
      throw new ProjectRegistryInvalidStateError(
        `Render plan MV ${transition.job_id} chưa có manifest`,
      );
    }
    const metadata = await drive.files.get({
      fileId: manifestFileId,
      fields: "id,mimeType,parents,trashed",
      supportsAllDrives: true,
    });
    if (
      metadata.data.mimeType !== "application/json" ||
      metadata.data.trashed === true ||
      !metadata.data.parents?.includes(productionFolder.id)
    ) {
      throw new ProjectRegistryInvalidStateError(
        `Manifest render plan ${manifestFileId} không nằm đúng thư mục 02_SAN_XUAT_MV`,
      );
    }
    const response = await drive.files.get(
      { fileId: manifestFileId, alt: "media", supportsAllDrives: true },
      { responseType: "text" },
    );
    const manifest =
      typeof response.data === "string"
        ? parseObject(response.data, "MV_RENDER_PLAN manifest")
        : (response.data as Record<string, unknown>);
    const approvalGate =
      manifest.approval_gate &&
      typeof manifest.approval_gate === "object" &&
      !Array.isArray(manifest.approval_gate)
        ? (manifest.approval_gate as Record<string, unknown>)
        : {};
    const units = Array.isArray(manifest.render_units)
      ? (manifest.render_units as Array<Record<string, unknown>>)
      : [];
    const continuous =
      units.length === 15 &&
      units.every((unit, index) => {
        const start = Number(unit.start_seconds);
        const expected = index === 0 ? 0 : Number(units[index - 1].end_seconds);
        return Number.isFinite(start) && Math.abs(start - expected) <= 0.001;
      }) &&
      Math.abs(Number(units.at(-1)?.end_seconds) - 371.62) <= 0.001;
    const allBlocked = units.every(
      (unit) =>
        String(unit.execution_status ?? "") === "BLOCKED_PENDING_APPROVAL" &&
        unit.provider_execution_allowed === false &&
        unit.render_allowed === false,
    );
    const tuongVyUnits = units.filter((unit) => {
      const performer = String(unit.performer ?? "");
      return performer === "TUONG_VY_EM" || performer === "SONG_CA";
    });
    const tuongVySafe =
      tuongVyUnits.length > 0 &&
      tuongVyUnits.every((unit) => {
        const framing =
          unit.framing_constraints &&
          typeof unit.framing_constraints === "object" &&
          !Array.isArray(unit.framing_constraints)
            ? (unit.framing_constraints as Record<string, unknown>)
            : {};
        const allowed = Array.isArray(framing.allowed_framings)
          ? framing.allowed_framings.map(String)
          : [];
        return (
          framing.close_up_allowed === false &&
          framing.preserve_microphone === true &&
          allowed.length === 2 &&
          allowed.every((value) => value === "MEDIUM" || value === "FULL_BODY")
        );
      });
    if (
      String(manifest.project_id ?? "").trim() !== transition.project_id ||
      String(manifest.stage ?? "").trim() !== "PRE_PRODUCTION" ||
      String(manifest.production_priority ?? "").trim() !== "MUSIC_VIDEO_FIRST" ||
      String(manifest.face_identity_pipeline ?? "").trim() !== "ORIGINAL_FACE_COMPOSITE" ||
      manifest.provider_execution_allowed !== false ||
      manifest.render_allowed !== false ||
      String(manifest.render_plan_status ?? "").trim() !== "AWAITING_APPROVAL" ||
      String(approvalGate.approval_status ?? "").trim() !== "PENDING" ||
      Number(manifest.target_duration_seconds) !== 371.62 ||
      !continuous ||
      !allBlocked ||
      !tuongVySafe
    ) {
      throw new ProjectRegistryInvalidStateError(
        `Manifest render plan của ${transition.project_id} chưa ở trạng thái an toàn để duyệt`,
      );
    }
    const approvedManifest = {
      ...manifest,
      provider_execution_allowed: false,
      render_allowed: false,
      render_plan_status: "APPROVED",
      render_units: units.map((unit) => ({
        ...unit,
        execution_status: "BLOCKED_PENDING_EXECUTION_PREPARATION",
        provider_execution_allowed: false,
        render_allowed: false,
      })),
      approval_gate: {
        approval_status: transition.approval_status,
        reviewer: "PROJECT_OWNER",
        approved_at: transition.approved_at,
        next_action: transition.next_action,
      },
    };
    await drive.files.update({
      fileId: manifestFileId,
      media: {
        mimeType: "application/json",
        body: Readable.from([`${JSON.stringify(approvedManifest, null, 2)}\n`]),
      },
      fields: "id,modifiedTime",
      supportsAllDrives: true,
    });
  }

  private async readApprovedMvTimecodeManifest(
    drive: drive_v3.Drive,
    projectFolderId: string,
    timecodeJobRow: string[],
    projectId: string,
  ) {
    const productionFolder = await this.findChildFolder(
      drive,
      projectFolderId,
      "02_SAN_XUAT_MV",
    );
    const manifestFileId = parseStringArray(timecodeJobRow[7])[0];
    if (!manifestFileId) {
      throw new ProjectRegistryInvalidStateError(
        `Timecode MV ${projectId} chưa có manifest`,
      );
    }
    const metadata = await drive.files.get({
      fileId: manifestFileId,
      fields: "id,mimeType,parents,trashed",
      supportsAllDrives: true,
    });
    if (
      metadata.data.mimeType !== "application/json" ||
      metadata.data.trashed === true ||
      !metadata.data.parents?.includes(productionFolder.id)
    ) {
      throw new ProjectRegistryInvalidStateError(
        `Manifest timecode ${manifestFileId} không hợp lệ`,
      );
    }
    const response = await drive.files.get(
      { fileId: manifestFileId, alt: "media", supportsAllDrives: true },
      { responseType: "text" },
    );
    const manifest =
      typeof response.data === "string"
        ? parseObject(response.data, "MV_TIMECODE_ALIGNMENT manifest")
        : (response.data as Record<string, unknown>);
    const approvalGate =
      manifest.approval_gate &&
      typeof manifest.approval_gate === "object" &&
      !Array.isArray(manifest.approval_gate)
        ? (manifest.approval_gate as Record<string, unknown>)
        : {};
    const cues = Array.isArray(manifest.cues)
      ? (manifest.cues as Array<Record<string, unknown>>)
      : [];
    const continuous =
      cues.length === 15 &&
      cues.every((cue, index) => {
        const start = Number(cue.start_seconds);
        const expected = index === 0 ? 0 : Number(cues[index - 1].end_seconds);
        return Number.isFinite(start) && Math.abs(start - expected) <= 0.001;
      }) &&
      Math.abs(Number(cues.at(-1)?.end_seconds) - 371.62) <= 0.001;
    const identityConstraints = Array.isArray(manifest.identity_constraints)
      ? (manifest.identity_constraints as Array<Record<string, unknown>>)
      : [];
    const tuongVy = identityConstraints.find(
      (item) => String(item.character_id ?? "").trim() === "GDTH-CHAR-001",
    );
    if (
      String(manifest.project_id ?? "").trim() !== projectId ||
      String(manifest.stage ?? "").trim() !== "PRE_PRODUCTION" ||
      String(manifest.production_priority ?? "").trim() !== "MUSIC_VIDEO_FIRST" ||
      String(manifest.face_identity_pipeline ?? "").trim() !== "ORIGINAL_FACE_COMPOSITE" ||
      manifest.provider_execution_allowed !== false ||
      manifest.render_allowed !== false ||
      String(manifest.alignment_status ?? "").trim() !== "APPROVED" ||
      String(approvalGate.approval_status ?? "").trim() !== "APPROVED" ||
      Number(manifest.target_duration_seconds) !== 371.62 ||
      !continuous ||
      !tuongVy ||
      tuongVy.close_up_allowed !== false
    ) {
      throw new ProjectRegistryInvalidStateError(
        `Timecode ${projectId} chưa được duyệt an toàn để lập render plan`,
      );
    }
    return manifest;
  }

  private async readApprovedMvShotPlanManifest(
    drive: drive_v3.Drive,
    projectFolderId: string,
    shotJobRow: string[],
    projectId: string,
  ) {
    const productionFolder = await this.findChildFolder(drive, projectFolderId, "02_SAN_XUAT_MV");
    const manifestFileId = parseStringArray(shotJobRow[7])[0];
    if (!manifestFileId) throw new ProjectRegistryInvalidStateError(`Shot plan ${projectId} chưa có manifest`);
    const metadata = await drive.files.get({ fileId: manifestFileId, fields: "id,mimeType,parents,trashed", supportsAllDrives: true });
    if (metadata.data.mimeType !== "application/json" || metadata.data.trashed === true || !metadata.data.parents?.includes(productionFolder.id)) {
      throw new ProjectRegistryInvalidStateError(`Manifest shot plan ${manifestFileId} không hợp lệ`);
    }
    const response = await drive.files.get({ fileId: manifestFileId, alt: "media", supportsAllDrives: true }, { responseType: "text" });
    const manifest = typeof response.data === "string" ? parseObject(response.data, "MV_SHOT_PLAN manifest") : response.data as Record<string, unknown>;
    const gate = manifest.approval_gate && typeof manifest.approval_gate === "object" && !Array.isArray(manifest.approval_gate) ? manifest.approval_gate as Record<string, unknown> : {};
    const constraints = Array.isArray(manifest.identity_constraints) ? manifest.identity_constraints as Array<Record<string, unknown>> : [];
    const tuongVy = constraints.find((item) => String(item.character_id ?? "").trim() === "GDTH-CHAR-001");
    if (String(manifest.project_id ?? "").trim() !== projectId || String(manifest.production_priority ?? "").trim() !== "MUSIC_VIDEO_FIRST" || String(manifest.face_identity_pipeline ?? "").trim() !== "ORIGINAL_FACE_COMPOSITE" || manifest.render_allowed !== false || manifest.provider_execution_allowed !== false || String(manifest.timeline_status ?? "").trim() !== "TIMECODE_ALIGNMENT_REQUIRED" || String(gate.approval_status ?? "").trim() !== "APPROVED" || !tuongVy || tuongVy.close_up_allowed !== false) {
      throw new ProjectRegistryInvalidStateError(`Shot plan ${projectId} chưa được duyệt an toàn để căn timecode`);
    }
    return manifest;
  }

  private async readApprovedMvAssetManifest(
    drive: drive_v3.Drive,
    projectFolderId: string,
    assetJobRow: string[],
    projectId: string,
  ) {
    const productionFolder = await this.findChildFolder(
      drive,
      projectFolderId,
      "02_SAN_XUAT_MV",
    );
    const manifestFileId = parseStringArray(assetJobRow[7])[0];
    if (!manifestFileId) {
      throw new ProjectRegistryInvalidStateError(`Tài sản MV ${projectId} chưa có manifest`);
    }
    const metadata = await drive.files.get({
      fileId: manifestFileId,
      fields: "id,mimeType,parents,trashed",
      supportsAllDrives: true,
    });
    if (
      metadata.data.mimeType !== "application/json" ||
      metadata.data.trashed === true ||
      !metadata.data.parents?.includes(productionFolder.id)
    ) {
      throw new ProjectRegistryInvalidStateError(
        `Manifest tài sản ${manifestFileId} không nằm đúng thư mục 02_SAN_XUAT_MV`,
      );
    }
    const response = await drive.files.get(
      { fileId: manifestFileId, alt: "media", supportsAllDrives: true },
      { responseType: "text" },
    );
    const manifest =
      typeof response.data === "string"
        ? parseObject(response.data, "MV_ASSET_MANIFEST manifest")
        : (response.data as Record<string, unknown>);
    const approvalGate =
      manifest.approval_gate &&
      typeof manifest.approval_gate === "object" &&
      !Array.isArray(manifest.approval_gate)
        ? (manifest.approval_gate as Record<string, unknown>)
        : {};
    const sourceAssets =
      manifest.source_assets &&
      typeof manifest.source_assets === "object" &&
      !Array.isArray(manifest.source_assets)
        ? (manifest.source_assets as Record<string, unknown>)
        : {};
    const characterSources = Array.isArray(sourceAssets.character_sources)
      ? (sourceAssets.character_sources as Array<Record<string, unknown>>)
      : [];
    const tuongVy = characterSources.find(
      (source) => String(source.character_id ?? "").trim() === "GDTH-CHAR-001",
    );
    if (
      String(manifest.project_id ?? "").trim() !== projectId ||
      String(manifest.production_priority ?? "").trim() !== "MUSIC_VIDEO_FIRST" ||
      String(manifest.face_identity_pipeline ?? "").trim() !== "ORIGINAL_FACE_COMPOSITE" ||
      manifest.render_allowed !== false ||
      manifest.provider_execution_allowed !== false ||
      String(approvalGate.approval_status ?? "").trim() !== "APPROVED" ||
      !tuongVy ||
      tuongVy.temporary_source !== true ||
      tuongVy.close_up_allowed !== false
    ) {
      throw new ProjectRegistryInvalidStateError(
        `Manifest tài sản MV của ${projectId} chưa được duyệt an toàn để lập shot plan`,
      );
    }
    return { ...manifest, source_assets: sourceAssets };
  }

  private async assertApprovedMvProductionManifest(
    drive: drive_v3.Drive,
    projectFolderId: string,
    approvedPlanJobRow: string[],
    projectId: string,
  ) {
    const productionFolder = await this.findChildFolder(
      drive,
      projectFolderId,
      "02_SAN_XUAT_MV",
    );
    const manifestFileId = parseStringArray(approvedPlanJobRow[7])[0];
    if (!manifestFileId) {
      throw new ProjectRegistryInvalidStateError(
        `Kế hoạch MV của ${projectId} chưa có manifest`,
      );
    }
    const metadata = await drive.files.get({
      fileId: manifestFileId,
      fields: "id,mimeType,parents,trashed",
      supportsAllDrives: true,
    });
    if (
      metadata.data.mimeType !== "application/json" ||
      metadata.data.trashed === true ||
      !metadata.data.parents?.includes(productionFolder.id)
    ) {
      throw new ProjectRegistryInvalidStateError(
        `Manifest kế hoạch MV ${manifestFileId} không hợp lệ`,
      );
    }
    const response = await drive.files.get(
      {
        fileId: manifestFileId,
        alt: "media",
        supportsAllDrives: true,
      },
      { responseType: "text" },
    );
    const manifest =
      typeof response.data === "string"
        ? parseObject(response.data, "MV_PRODUCTION_PLAN manifest")
        : (response.data as Record<string, unknown>);
    const approvalGate =
      manifest.approval_gate &&
      typeof manifest.approval_gate === "object" &&
      !Array.isArray(manifest.approval_gate)
        ? (manifest.approval_gate as Record<string, unknown>)
        : {};
    if (
      String(manifest.project_id ?? "").trim() !== projectId ||
      String(approvalGate.approval_status ?? "").trim() !== "APPROVED" ||
      manifest.render_allowed !== false ||
      manifest.provider_execution_allowed !== false
    ) {
      throw new ProjectRegistryInvalidStateError(
        `Manifest kế hoạch MV của ${projectId} chưa được duyệt an toàn`,
      );
    }
  }

  private async markMvAssetManifestApproved(
    drive: drive_v3.Drive,
    projectFolderId: string,
    jobRow: string[],
    transition: ApprovedMvAssets,
  ) {
    if (!projectFolderId) {
      throw new ProjectRegistryInvalidStateError(
        `Dự án ${transition.project_id} chưa có thư mục Drive`,
      );
    }
    const productionFolder = await this.findChildFolder(
      drive,
      projectFolderId,
      "02_SAN_XUAT_MV",
    );
    const manifestFileId = parseStringArray(jobRow[7])[0];
    if (!manifestFileId) {
      throw new ProjectRegistryInvalidStateError(
        `Tài sản MV ${transition.job_id} chưa có manifest`,
      );
    }

    const metadata = await drive.files.get({
      fileId: manifestFileId,
      fields: "id,mimeType,parents,trashed",
      supportsAllDrives: true,
    });
    if (
      metadata.data.mimeType !== "application/json" ||
      metadata.data.trashed === true ||
      !metadata.data.parents?.includes(productionFolder.id)
    ) {
      throw new ProjectRegistryInvalidStateError(
        `Manifest tài sản ${manifestFileId} không nằm đúng thư mục 02_SAN_XUAT_MV`,
      );
    }

    const response = await drive.files.get(
      {
        fileId: manifestFileId,
        alt: "media",
        supportsAllDrives: true,
      },
      { responseType: "text" },
    );
    const manifest =
      typeof response.data === "string"
        ? parseObject(response.data, "MV_ASSET_MANIFEST manifest")
        : (response.data as Record<string, unknown>);
    const sourceAssets =
      manifest.source_assets &&
      typeof manifest.source_assets === "object" &&
      !Array.isArray(manifest.source_assets)
        ? (manifest.source_assets as Record<string, unknown>)
        : {};
    const assetChecks =
      manifest.asset_checks &&
      typeof manifest.asset_checks === "object" &&
      !Array.isArray(manifest.asset_checks)
        ? (manifest.asset_checks as Record<string, unknown>)
        : {};
    const approvalGate =
      manifest.approval_gate &&
      typeof manifest.approval_gate === "object" &&
      !Array.isArray(manifest.approval_gate)
        ? (manifest.approval_gate as Record<string, unknown>)
        : {};
    if (
      String(manifest.project_id ?? "").trim() !== transition.project_id ||
      String(manifest.stage ?? "").trim() !== "PRE_PRODUCTION" ||
      String(manifest.production_priority ?? "").trim() !== "MUSIC_VIDEO_FIRST" ||
      String(manifest.face_identity_pipeline ?? "").trim() !==
        "ORIGINAL_FACE_COMPOSITE" ||
      manifest.render_allowed !== false ||
      manifest.provider_execution_allowed !== false ||
      assetChecks.source_files_copied !== false ||
      String(approvalGate.approval_status ?? "").trim() !== "PENDING"
    ) {
      throw new ProjectRegistryInvalidStateError(
        `Manifest tài sản MV của ${transition.project_id} chưa ở trạng thái an toàn để duyệt`,
      );
    }

    const characterSources = applyMvAssetCharacterSafetyLocks(
      sourceAssets.character_sources,
    );
    const lockedTemporarySource = characterSources.find(
      (source) => String(source.character_id ?? "") === "GDTH-CHAR-001",
    );
    if (
      !lockedTemporarySource ||
      lockedTemporarySource.temporary_source !== true ||
      lockedTemporarySource.close_up_allowed !== false
    ) {
      throw new ProjectRegistryInvalidStateError(
        "Không thể khóa an toàn nguồn tạm Tường Vy trong MV_ASSET_MANIFEST",
      );
    }

    const approvedManifest = {
      ...manifest,
      provider_execution_allowed: false,
      render_allowed: false,
      source_assets: {
        ...sourceAssets,
        character_sources: characterSources,
      },
      approval_gate: {
        approval_status: transition.approval_status,
        reviewer: "PROJECT_OWNER",
        approved_at: transition.approved_at,
        next_action: transition.next_action,
      },
    };
    await drive.files.update({
      fileId: manifestFileId,
      media: {
        mimeType: "application/json",
        body: Readable.from([`${JSON.stringify(approvedManifest, null, 2)}\n`]),
      },
      fields: "id,modifiedTime",
      supportsAllDrives: true,
    });
  }

  private async markMvTimecodeAlignmentManifestApproved(
    drive: drive_v3.Drive,
    projectFolderId: string,
    jobRow: string[],
    transition: ApprovedMvTimecodeAlignment,
  ) {
    if (!projectFolderId) throw new ProjectRegistryInvalidStateError(`Dự án ${transition.project_id} chưa có thư mục Drive`);
    const productionFolder = await this.findChildFolder(drive, projectFolderId, "02_SAN_XUAT_MV");
    const manifestFileId = parseStringArray(jobRow[7])[0];
    if (!manifestFileId) throw new ProjectRegistryInvalidStateError(`Timecode MV ${transition.job_id} chưa có manifest`);
    const metadata = await drive.files.get({ fileId: manifestFileId, fields: "id,mimeType,parents,trashed", supportsAllDrives: true });
    if (metadata.data.mimeType !== "application/json" || metadata.data.trashed === true || !metadata.data.parents?.includes(productionFolder.id)) {
      throw new ProjectRegistryInvalidStateError(`Manifest timecode ${manifestFileId} không nằm đúng thư mục 02_SAN_XUAT_MV`);
    }
    const response = await drive.files.get({ fileId: manifestFileId, alt: "media", supportsAllDrives: true }, { responseType: "text" });
    const manifest = typeof response.data === "string" ? parseObject(response.data, "MV_TIMECODE_ALIGNMENT manifest") : response.data as Record<string, unknown>;
    const approvalGate = manifest.approval_gate && typeof manifest.approval_gate === "object" && !Array.isArray(manifest.approval_gate) ? manifest.approval_gate as Record<string, unknown> : {};
    const sections = Array.isArray(manifest.sections) ? manifest.sections : [];
    const cues = Array.isArray(manifest.cues) ? manifest.cues as Array<Record<string, unknown>> : [];
    const continuous = cues.length === 15 && cues.every((cue, index) => index === 0 ? Number(cue.start_seconds) === 0 : Number(cue.start_seconds) === Number(cues[index - 1].end_seconds)) && Number(cues.at(-1)?.end_seconds) === 371.62;
    const identityConstraints = Array.isArray(manifest.identity_constraints) ? manifest.identity_constraints as Array<Record<string, unknown>> : [];
    const tuongVyIdentity = identityConstraints.find((item) => String(item.character_id ?? "") === "GDTH-CHAR-001");
    const tuongVyCues = cues.filter((cue) => String(cue.performer ?? "") === "TUONG_VY_EM");
    const tuongVySafe = tuongVyIdentity?.close_up_allowed === false && tuongVyCues.length > 0 && tuongVyCues.every((cue) => {
      const framing = cue.framing_constraints && typeof cue.framing_constraints === "object" ? cue.framing_constraints as Record<string, unknown> : {};
      const allowed = Array.isArray(framing.allowed_framings) ? framing.allowed_framings.map(String) : [];
      return framing.close_up_allowed === false && framing.preserve_microphone === true && allowed.every((value) => value === "MEDIUM" || value === "FULL_BODY");
    });
    if (String(manifest.project_id ?? "").trim() !== transition.project_id || String(manifest.stage ?? "").trim() !== "PRE_PRODUCTION" || String(manifest.production_priority ?? "").trim() !== "MUSIC_VIDEO_FIRST" || String(manifest.face_identity_pipeline ?? "").trim() !== "ORIGINAL_FACE_COMPOSITE" || manifest.provider_execution_allowed !== false || manifest.render_allowed !== false || String(manifest.alignment_status ?? "").trim() !== "AWAITING_APPROVAL" || String(approvalGate.approval_status ?? "").trim() !== "PENDING" || Number(manifest.target_duration_seconds) !== 371.62 || sections.length !== 6 || !continuous || !tuongVySafe) {
      throw new ProjectRegistryInvalidStateError(`Manifest timecode của ${transition.project_id} chưa ở trạng thái an toàn để duyệt`);
    }
    const approvedManifest = {
      ...manifest,
      provider_execution_allowed: false,
      render_allowed: false,
      alignment_status: "APPROVED",
      approval_gate: { approval_status: transition.approval_status, reviewer: "PROJECT_OWNER", approved_at: transition.approved_at, next_action: transition.next_action },
    };
    await drive.files.update({ fileId: manifestFileId, media: { mimeType: "application/json", body: Readable.from([`${JSON.stringify(approvedManifest, null, 2)}\n`]) }, fields: "id,modifiedTime", supportsAllDrives: true });
  }

  private async markMvShotPlanManifestApproved(
    drive: drive_v3.Drive,
    projectFolderId: string,
    jobRow: string[],
    transition: ApprovedMvShotPlan,
  ) {
    if (!projectFolderId) {
      throw new ProjectRegistryInvalidStateError(
        `Dự án ${transition.project_id} chưa có thư mục Drive`,
      );
    }
    const productionFolder = await this.findChildFolder(
      drive,
      projectFolderId,
      "02_SAN_XUAT_MV",
    );
    const manifestFileId = parseStringArray(jobRow[7])[0];
    if (!manifestFileId) {
      throw new ProjectRegistryInvalidStateError(
        `Shot plan MV ${transition.job_id} chưa có manifest`,
      );
    }
    const metadata = await drive.files.get({
      fileId: manifestFileId,
      fields: "id,mimeType,parents,trashed",
      supportsAllDrives: true,
    });
    if (
      metadata.data.mimeType !== "application/json" ||
      metadata.data.trashed === true ||
      !metadata.data.parents?.includes(productionFolder.id)
    ) {
      throw new ProjectRegistryInvalidStateError(
        `Manifest shot plan ${manifestFileId} không nằm đúng thư mục 02_SAN_XUAT_MV`,
      );
    }
    const response = await drive.files.get(
      { fileId: manifestFileId, alt: "media", supportsAllDrives: true },
      { responseType: "text" },
    );
    const manifest =
      typeof response.data === "string"
        ? parseObject(response.data, "MV_SHOT_PLAN manifest")
        : (response.data as Record<string, unknown>);
    const approvalGate =
      manifest.approval_gate &&
      typeof manifest.approval_gate === "object" &&
      !Array.isArray(manifest.approval_gate)
        ? (manifest.approval_gate as Record<string, unknown>)
        : {};
    if (
      String(manifest.project_id ?? "").trim() !== transition.project_id ||
      String(manifest.stage ?? "").trim() !== "PRE_PRODUCTION" ||
      String(manifest.production_priority ?? "").trim() !== "MUSIC_VIDEO_FIRST" ||
      String(manifest.face_identity_pipeline ?? "").trim() !== "ORIGINAL_FACE_COMPOSITE" ||
      manifest.render_allowed !== false ||
      manifest.provider_execution_allowed !== false ||
      String(manifest.timeline_status ?? "").trim() !== "TIMECODE_ALIGNMENT_REQUIRED" ||
      String(approvalGate.approval_status ?? "").trim() !== "PENDING"
    ) {
      throw new ProjectRegistryInvalidStateError(
        `Manifest shot plan của ${transition.project_id} chưa ở trạng thái an toàn để duyệt`,
      );
    }
    const identityConstraints = Array.isArray(manifest.identity_constraints)
      ? (manifest.identity_constraints as Array<Record<string, unknown>>)
      : [];
    const tuongVy = identityConstraints.find(
      (item) => String(item.character_id ?? "").trim() === "GDTH-CHAR-001",
    );
    if (
      !tuongVy ||
      tuongVy.temporary_source !== true ||
      tuongVy.close_up_allowed !== false
    ) {
      throw new ProjectRegistryInvalidStateError(
        "Shot plan chưa khóa an toàn cận mặt nguồn tạm Tường Vy",
      );
    }

    const approvedManifest = {
      ...manifest,
      provider_execution_allowed: false,
      render_allowed: false,
      timeline_status: "TIMECODE_ALIGNMENT_REQUIRED",
      approval_gate: {
        approval_status: transition.approval_status,
        reviewer: "PROJECT_OWNER",
        approved_at: transition.approved_at,
        next_action: transition.next_action,
      },
    };
    await drive.files.update({
      fileId: manifestFileId,
      media: {
        mimeType: "application/json",
        body: Readable.from([`${JSON.stringify(approvedManifest, null, 2)}\n`]),
      },
      fields: "id,modifiedTime",
      supportsAllDrives: true,
    });
  }

  private async markMvProductionManifestApproved(
    drive: drive_v3.Drive,
    projectFolderId: string,
    jobRow: string[],
    transition: ApprovedMvProductionPlan,
  ) {
    if (!projectFolderId) {
      throw new ProjectRegistryInvalidStateError(
        `Dự án ${transition.project_id} chưa có thư mục Drive`,
      );
    }
    const productionFolder = await this.findChildFolder(
      drive,
      projectFolderId,
      "02_SAN_XUAT_MV",
    );
    const manifestFileId = parseStringArray(jobRow[7])[0];
    if (!manifestFileId) {
      throw new ProjectRegistryInvalidStateError(
        `Kế hoạch MV ${transition.job_id} chưa có manifest`,
      );
    }

    const metadata = await drive.files.get({
      fileId: manifestFileId,
      fields: "id,mimeType,parents,trashed",
      supportsAllDrives: true,
    });
    if (
      metadata.data.mimeType !== "application/json" ||
      metadata.data.trashed === true ||
      !metadata.data.parents?.includes(productionFolder.id)
    ) {
      throw new ProjectRegistryInvalidStateError(
        `Manifest ${manifestFileId} không nằm đúng thư mục 02_SAN_XUAT_MV`,
      );
    }

    const response = await drive.files.get(
      {
        fileId: manifestFileId,
        alt: "media",
        supportsAllDrives: true,
      },
      { responseType: "text" },
    );
    const manifest =
      typeof response.data === "string"
        ? parseObject(response.data, "MV_PRODUCTION_PLAN manifest")
        : (response.data as Record<string, unknown>);
    if (String(manifest.project_id ?? "").trim() !== transition.project_id) {
      throw new ProjectRegistryInvalidStateError(
        `Manifest ${manifestFileId} không khớp project_id ${transition.project_id}`,
      );
    }

    const approvedManifest = {
      ...manifest,
      provider_execution_allowed: false,
      render_allowed: false,
      approval_gate: {
        approval_status: transition.approval_status,
        reviewer: "PROJECT_OWNER",
        approved_at: transition.approved_at,
        next_action: transition.next_action,
      },
    };
    await drive.files.update({
      fileId: manifestFileId,
      media: {
        mimeType: "application/json",
        body: Readable.from([`${JSON.stringify(approvedManifest, null, 2)}\n`]),
      },
      fields: "id,modifiedTime",
      supportsAllDrives: true,
    });
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

  private async readExistingMvAssetPreparation(
    drive: drive_v3.Drive,
    transition: MvAssetPreparationTransition,
    existingJobRow: string[],
    approvalRows: unknown[][],
  ): Promise<PreparedMvAssets> {
    const manifestFileId = parseStringArray(existingJobRow[7])[0];
    if (!manifestFileId) {
      throw new ProjectRegistryInvalidStateError(
        `Tài sản MV ${transition.job_id} chưa có manifest`,
      );
    }
    const approvalRow = approvalRows.find(
      (row, index) =>
        index > 0 &&
        String(row[1] ?? "").trim() === transition.project_id &&
        String(row[2] ?? "").trim() === MV_ASSET_PREPARATION_JOB_TYPE &&
        String(row[3] ?? "").trim() === transition.job_id,
    );
    if (!approvalRow || String(approvalRow[4] ?? "").trim() !== "PENDING") {
      throw new ProjectRegistryInvalidStateError(
        `Tài sản MV ${transition.job_id} chưa có approval PENDING`,
      );
    }
    const manifest = await drive.files.get({
      fileId: manifestFileId,
      fields: "id,webViewLink,trashed",
      supportsAllDrives: true,
    });
    if (manifest.data.trashed === true) {
      throw new ProjectRegistryInvalidStateError(
        `Manifest tài sản MV ${manifestFileId} đã bị xóa`,
      );
    }
    return {
      project_id: transition.project_id,
      current_stage: "PRE_PRODUCTION",
      next_action: "APPROVE_MV_ASSETS",
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
