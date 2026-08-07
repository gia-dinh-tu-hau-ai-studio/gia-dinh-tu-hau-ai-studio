import { Injectable } from "@nestjs/common";
import type { NormalizedProjectIntake } from "@tu-hau/contracts";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { drive_v3, google, sheets_v4 } from "googleapis";
import {
  createDriveOAuthClient,
  createServiceAuth,
  GoogleDriveOAuthConfigurationError,
} from "../../google/google-auth";
import {
  cleanAndEvaluateVoiceReference,
  extractAndEvaluateVoiceReference,
  executeMvDuetBaseComposite,
  executeMvDuetBaseCompositeUnit,
  executeRp015FinalProof,
  inspectAudioAsset,
  isDriveAudioCandidate,
  RP015_AUDIO_END_DRIFT_TOLERANCE_SECONDS,
  RP015_AUDIO_PROOF_LOOKBACK_STEP_SECONDS,
  RP015_AUDIO_PROOF_MAX_LOOKBACK_SECONDS,
  RP015_DURATION_SECONDS,
  RP015_MASTER_AUDIO_START_SECONDS,
} from "../../media/mv-duet-base-composite.executor";

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

export type ApprovedMvRenderExecution = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "PREPARE_MV_PROVIDER_SUBMISSION";
  job_id: string;
  job_status: "APPROVED";
  approval_id: string;
  approval_status: "APPROVED";
  approved_at: string;
  idempotent_replay: boolean;
};

export type PreparedMvProviderSubmission = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "APPROVE_MV_PROVIDER_SUBMISSION";
  job_id: string;
  job_status: "AWAITING_APPROVAL";
  approval_id: string;
  approval_status: "PENDING";
  manifest_file_id: string;
  manifest_file_url: string;
  prepared_at: string;
  idempotent_replay: boolean;
};

export type ApprovedMvProviderSubmission = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "SUBMIT_MV_PROVIDER_JOBS";
  job_id: string;
  job_status: "APPROVED";
  approval_id: string;
  approval_status: "APPROVED";
  approved_at: string;
  idempotent_replay: boolean;
};

export type PreparedMvProviderPilot = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "APPROVE_MV_PROVIDER_PILOT";
  job_id: string;
  job_status: "AWAITING_APPROVAL";
  approval_id: string;
  approval_status: "PENDING";
  manifest_file_id: string;
  manifest_file_url: string;
  estimated_credits: number;
  estimated_cost_usd: number;
  prepared_at: string;
  idempotent_replay: boolean;
};

export type PreparedMvDuetBaseComposite = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "APPROVE_MV_DUET_BASE_COMPOSITE";
  job_id: string;
  job_status: "AWAITING_APPROVAL";
  approval_id: string;
  approval_status: "PENDING";
  manifest_file_id: string;
  manifest_file_url: string;
  prepared_at: string;
  idempotent_replay: boolean;
};

export type ApprovedMvDuetBaseComposite = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "EXECUTE_MV_DUET_BASE_COMPOSITE";
  job_id: string;
  job_status: "APPROVED";
  approval_id: string;
  approval_status: "APPROVED";
  composite_execution_allowed: true;
  provider_execution_allowed: false;
  render_allowed: false;
  approved_at: string;
  idempotent_replay: boolean;
};

export type ExecutedMvDuetBaseComposite = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "REVIEW_MV_DUET_BASE_COMPOSITE";
  job_id: string;
  job_status: "SUCCEEDED";
  output_file_id: string;
  output_file_url: string;
  duration_seconds: number;
  width: number;
  height: number;
  source_offsets?: {
    tuong_vy_start_seconds: number;
    phuong_an_start_seconds: number;
  };
  source_durations?: {
    tuong_vy_seconds: number;
    phuong_an_seconds: number;
  };
  provider_execution_allowed: false;
  render_allowed: false;
  executed_at: string;
  idempotent_replay: boolean;
};

export type ApprovedMvDuetBaseCompositeReview = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "PLAN_MV_DUET_BASE_COMPOSITE_ROLLOUT";
  job_id: string;
  job_status: "SUCCEEDED";
  review_approval_id: string;
  review_status: "APPROVED";
  output_file_id: string;
  output_file_url: string;
  provider_execution_allowed: false;
  render_allowed: false;
  approved_at: string;
  idempotent_replay: boolean;
};

export type PreparedMvDuetBaseCompositeRollout = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "APPROVE_MV_DUET_BASE_COMPOSITE_ROLLOUT";
  job_id: string;
  job_status: "AWAITING_APPROVAL";
  approval_id: string;
  approval_status: "PENDING";
  manifest_file_id: string;
  manifest_file_url: string;
  total_render_units: 15;
  pilot_reference_unit_id: "RP015";
  provider_execution_allowed: false;
  render_allowed: false;
  prepared_at: string;
  idempotent_replay: boolean;
};

export type ApprovedMvDuetBaseCompositeRollout = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "EXECUTE_MV_DUET_BASE_COMPOSITE_ROLLOUT";
  job_id: string;
  job_status: "APPROVED";
  approval_id: string;
  approval_status: "APPROVED";
  total_render_units: 15;
  pilot_reference_unit_id: "RP015";
  composite_execution_allowed: true;
  provider_execution_allowed: false;
  render_allowed: false;
  approved_at: string;
  idempotent_replay: boolean;
};

export type ExecutedMvDuetBaseCompositeRolloutUnit = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "EXECUTE_MV_DUET_BASE_COMPOSITE_ROLLOUT" | "REVIEW_MV_DUET_BASE_COMPOSITE_ROLLOUT";
  job_id: string;
  job_status: "IN_PROGRESS" | "SUCCEEDED";
  render_unit_id: string;
  completed_render_units: number;
  remaining_render_units: number;
  output_file_id: string;
  output_file_url: string;
  provider_execution_allowed: false;
  render_allowed: false;
  executed_at: string;
  idempotent_replay: boolean;
};

export type CreatedRp015FinalProof = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "REVIEW_RP015_FINAL_PROOF";
  render_unit_id: "RP015";
  proof_status: "SUCCEEDED";
  output_file_id: string;
  output_file_url: string;
  duration_seconds: number;
  width: 1920;
  height: 1080;
  has_audio: true;
  edit_mode: "DUET_STAGE_BACKGROUND_REMOVAL";
  layout_version: "NATURAL_DUET_STAGE_V4";
  voice_pilot_approval_id: string;
  audio_source: "VOCAL_MASTER";
  audio_mean_db: number;
  audio_max_db: number;
  audio_start_seconds: number;
  audio_end_drift_seconds: number;
  audio_lookback_seconds: number;
  audio_window_adjusted: boolean;
  provider_execution_allowed: false;
  render_allowed: false;
  created_at: string;
  idempotent_replay: boolean;
};

export type Rp015FinalProofJobStatus = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "WAIT_RP015_FINAL_PROOF" | "REVIEW_RP015_FINAL_PROOF" | "RETRY_RP015_FINAL_PROOF";
  job_id: string;
  job_status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  result?: CreatedRp015FinalProof;
  error_message?: string;
  provider_execution_allowed: false;
  render_allowed: false;
  created_at: string;
  updated_at: string;
  idempotent_replay: boolean;
};

export type PreparedRp015VocalPilot = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "REVIEW_RP015_VOICE_REFERENCES" | "APPROVE_RP015_AI_VOCAL_FALLBACK";
  job_id: string;
  job_status: "AWAITING_APPROVAL";
  manifest_file_id: string;
  manifest_file_url: string;
  voice_reference_status: "REFERENCE_CANDIDATE" | "AI_VOICE_REQUIRED";
  provider_execution_allowed: false;
  render_allowed: false;
  prepared_at: string;
  idempotent_replay: boolean;
};

export type PreparedRp015CleanVoiceReferences = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "REVIEW_RP015_CLEAN_VOICE_REFERENCES";
  job_id: string;
  job_status: "AWAITING_APPROVAL";
  manifest_file_id: string;
  manifest_file_url: string;
  cleaned_reference_status: "CLEAN_REFERENCE_CANDIDATE";
  provider_execution_allowed: false;
  render_allowed: false;
  prepared_at: string;
  idempotent_replay: boolean;
};

export type ApprovedRp015VocalPilot = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "CREATE_RP015_FINAL_PROOF";
  job_id: string;
  job_status: "APPROVED";
  approval_id: string;
  approval_status: "APPROVED";
  approved_at: string;
  provider_execution_allowed: false;
  render_allowed: false;
  idempotent_replay: boolean;
};

export type ApprovedRp015CleanVoiceReferences = {
  project_id: string;
  current_stage: "PRE_PRODUCTION";
  next_action: "PREPARE_RP015_VOICE_CONVERSION_PILOT";
  job_id: string;
  job_status: "APPROVED";
  approval_id: string;
  approval_status: "APPROVED";
  approved_at: string;
  provider_execution_allowed: false;
  render_allowed: false;
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
const MV_PROVIDER_SUBMISSION_JOB_TYPE = "MV_PROVIDER_SUBMISSION";
const MV_PROVIDER_SUBMISSION_FILE_PREFIX = "MV_PROVIDER_SUBMISSION_V1";
const MV_PROVIDER_PILOT_JOB_TYPE = "MV_PROVIDER_PILOT";
const MV_PROVIDER_PILOT_FILE_PREFIX = "MV_PROVIDER_PILOT_V1";
const MV_DUET_BASE_COMPOSITE_JOB_TYPE = "MV_DUET_BASE_COMPOSITE";
const MV_DUET_BASE_COMPOSITE_REVIEW_APPROVAL_TYPE = "MV_DUET_BASE_COMPOSITE_REVIEW";
const MV_DUET_BASE_COMPOSITE_FILE_PREFIX = "MV_DUET_BASE_COMPOSITE_V1";
const MV_DUET_BASE_COMPOSITE_ROLLOUT_JOB_TYPE = "MV_DUET_BASE_COMPOSITE_ROLLOUT";
const MV_DUET_BASE_COMPOSITE_ROLLOUT_FILE_PREFIX = "MV_DUET_BASE_COMPOSITE_ROLLOUT_V1";
const MV_RP015_FINAL_PROOF_JOB_TYPE = "MV_RP015_NATURAL_DUET_STAGE_PROOF_V4";
const MV_RP015_FINAL_PROOF_CONTROL_JOB_TYPE = "MV_RP015_NATURAL_DUET_STAGE_PROOF_V4_ASYNC";
const MV_RP015_FINAL_PROOF_STALE_MS = 30 * 60 * 1000;
const MV_RP015_VOCAL_PILOT_JOB_TYPE = "MV_RP015_VOCAL_PILOT_PREPARATION";
const MV_RP015_LEGACY_CLEAN_VOICE_REFERENCES_JOB_TYPE = "MV_RP015_CLEAN_VOICE_REFERENCES";
const MV_RP015_CLEAN_VOICE_REFERENCES_JOB_TYPE = "MV_RP015_DEMUCS_VOCAL_STEMS_V2";
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

export function buildMvProviderSubmissionManifest(
  projectId: string,
  projectName: string,
  executionFileId: string,
  execution: Record<string, unknown>,
  preparedAt: string,
) {
  const units = Array.isArray(execution.render_units)
    ? execution.render_units as Array<Record<string, unknown>>
    : [];
  const safe = units.length === 15 && units.every((unit, index) => {
    const framing = (unit.framing_constraints ?? {}) as Record<string, unknown>;
    const performer = String(unit.performer ?? "");
    const hasTuongVy = performer === "TUONG_VY_EM" || performer === "SONG_CA";
    const allowed = Array.isArray(framing.allowed_framings)
      ? framing.allowed_framings.map(String)
      : [];
    return Number(unit.cue_order) === index + 1 &&
      String(unit.execution_status) === "BLOCKED_PENDING_PROVIDER_SUBMISSION" &&
      unit.provider_execution_allowed === false && unit.render_allowed === false &&
      (!hasTuongVy || (framing.close_up_allowed === false &&
        framing.preserve_microphone === true && allowed.length > 0 &&
        allowed.every((value) => value === "MEDIUM" || value === "FULL_BODY")));
  });
  if (String(execution.project_id) !== projectId ||
    String(execution.execution_status) !== "APPROVED" ||
    execution.execution_authorized !== true ||
    execution.provider_execution_allowed !== false ||
    execution.render_allowed !== false || !safe) {
    throw new ProjectRegistryInvalidStateError("Hồ sơ thực thi chưa an toàn để chuẩn bị gửi provider");
  }
  return {
    schema_version: "1.0",
    project_id: projectId,
    project_name: projectName,
    stage: "PRE_PRODUCTION",
    source_references: { approved_render_execution_file_id: executionFileId },
    provider: { name: "RUNWAY", submission_mode: "API_AFTER_EXPLICIT_APPROVAL", configuration_status: "DECLARED" },
    submission_status: "AWAITING_APPROVAL",
    provider_execution_allowed: false,
    render_allowed: false,
    provider_payloads: units.map((unit) => ({
      ...unit,
      submission_status: "BLOCKED_PENDING_PROVIDER_APPROVAL",
      provider_execution_allowed: false,
      render_allowed: false,
    })),
    approval_gate: { approval_status: "PENDING", next_action: "APPROVE_MV_PROVIDER_SUBMISSION" },
    prepared_at: preparedAt,
  };
}

export function buildMvProviderPilotManifest(
  projectId: string,
  projectName: string,
  submissionFileId: string,
  submission: Record<string, unknown>,
  preparedAt: string,
) {
  const payloads = Array.isArray(submission.provider_payloads)
    ? submission.provider_payloads as Array<Record<string, unknown>>
    : [];
  const safe = payloads.length === 15 && payloads.every((payload, index) => {
    const framing = (payload.framing_constraints ?? {}) as Record<string, unknown>;
    const performer = String(payload.performer ?? "");
    const hasTuongVy = performer === "TUONG_VY_EM" || performer === "SONG_CA";
    return Number(payload.cue_order) === index + 1 &&
      String(payload.submission_status) === "READY_PENDING_EXPLICIT_SUBMIT" &&
      Number(payload.duration_seconds) > 0 &&
      payload.provider_execution_allowed === false && payload.render_allowed === false &&
      (!hasTuongVy || (framing.close_up_allowed === false && framing.preserve_microphone === true));
  });
  if (String(submission.project_id) !== projectId || String(submission.submission_status) !== "APPROVED" || submission.provider_submission_authorized !== true || submission.provider_execution_allowed !== false || submission.render_allowed !== false || !safe) {
    throw new ProjectRegistryInvalidStateError("Provider submission chưa an toàn để lập pilot Runway");
  }
  const payload = payloads.find((item) => String(item.render_unit_id) === "RP015" && String(item.performer) === "SONG_CA");
  if (!payload || Number(payload.duration_seconds) !== 9.62) {
    throw new ProjectRegistryInvalidStateError("Không tìm thấy cue pilot RP015/song ca dài 9.62 giây");
  }
  const duration = Number(payload.duration_seconds);
  const estimatedCredits = Math.ceil(Math.max(56, duration * 28));
  const task = {
    provider_task_key: "RP015-PILOT-01",
    source_render_unit_id: payload.render_unit_id,
    cue_order: payload.cue_order,
    performer: payload.performer,
    start_seconds: payload.start_seconds,
    end_seconds: payload.end_seconds,
    duration_seconds: duration,
    model: "aleph2",
    operation: "VIDEO_TO_VIDEO",
    ratio: "16:9",
    evaluation_goal: "VERIFY_DUET_FACE_IDENTITY_TUONG_VY_NO_CLOSE_UP_PRESERVE_MICROPHONE",
    framing_constraints: payload.framing_constraints,
    input_video_status: "REQUIRED_NOT_UPLOADED",
    prompt_status: "REQUIRED_NOT_AUTHORED",
    estimated_credits: estimatedCredits,
    task_status: "BLOCKED_PENDING_PILOT_APPROVAL",
    provider_execution_allowed: false,
    render_allowed: false,
  };
  return {
    schema_version: "1.0",
    project_id: projectId,
    project_name: projectName,
    stage: "PRE_PRODUCTION",
    source_references: { approved_provider_submission_file_id: submissionFileId },
    provider: { name: "RUNWAY", model: "aleph2", operation: "VIDEO_TO_VIDEO", max_input_duration_seconds: 30, credits_per_second: 28, minimum_credits_per_task: 56 },
    pilot_status: "AWAITING_APPROVAL",
    task_count: 1,
    target_duration_seconds: duration,
    estimated_credits: estimatedCredits,
    estimated_cost_usd: Number((estimatedCredits * 0.01).toFixed(2)),
    input_readiness: "BLOCKED_MISSING_MEDIA_AND_PROMPT",
    provider_execution_allowed: false,
    render_allowed: false,
    provider_tasks: [task],
    approval_gate: { approval_status: "PENDING", next_action: "APPROVE_MV_PROVIDER_PILOT" },
    prepared_at: preparedAt,
  };
}

export function buildMvDuetBaseCompositeManifest(
  projectId: string,
  projectName: string,
  pilotFileId: string,
  pilot: Record<string, unknown>,
  assetFileId: string,
  assets: Record<string, unknown>,
  preparedAt: string,
) {
  const tasks = Array.isArray(pilot.provider_tasks)
    ? pilot.provider_tasks as Array<Record<string, unknown>>
    : [];
  const task = tasks[0];
  const framing = (task?.framing_constraints ?? {}) as Record<string, unknown>;
  const sourceAssets = (assets.source_assets ?? {}) as Record<string, unknown>;
  const characterSources = Array.isArray(sourceAssets.character_sources)
    ? sourceAssets.character_sources as Array<Record<string, unknown>>
    : [];
  const tuongVy = characterSources.find((source) => String(source.character_id) === "GDTH-CHAR-001");
  const phuongAn = characterSources.find((source) => String(source.character_id) === "GDTH-CHAR-002");
  const validSource = (source: Record<string, unknown> | undefined) =>
    Boolean(source && String(source.file_id ?? "").trim() && String(source.mime_type ?? "").startsWith("video/"));
  if (
    String(pilot.project_id) !== projectId ||
    String(pilot.pilot_status) !== "AWAITING_APPROVAL" ||
    tasks.length !== 1 || !task ||
    String(task.source_render_unit_id) !== "RP015" ||
    String(task.performer) !== "SONG_CA" ||
    Number(task.duration_seconds) !== 9.62 ||
    String(task.input_video_status) !== "REQUIRED_NOT_UPLOADED" ||
    pilot.provider_execution_allowed !== false || pilot.render_allowed !== false ||
    framing.close_up_allowed !== false || framing.preserve_microphone !== true ||
    String(assets.project_id) !== projectId ||
    !validSource(tuongVy) || !validSource(phuongAn) ||
    String(tuongVy?.file_id) === String(phuongAn?.file_id)
  ) {
    throw new ProjectRegistryInvalidStateError("Nguồn song ca chưa an toàn để lập base composite RP015");
  }
  return {
    schema_version: "1.0",
    project_id: projectId,
    project_name: projectName,
    stage: "PRE_PRODUCTION",
    source_references: {
      provider_pilot_file_id: pilotFileId,
      approved_asset_manifest_file_id: assetFileId,
    },
    target: {
      source_render_unit_id: "RP015",
      performer: "SONG_CA",
      duration_seconds: 9.62,
      aspect_ratio: "16:9",
    },
    composite_status: "AWAITING_APPROVAL",
    pipeline: "ORIGINAL_FACE_COMPOSITE",
    layout: {
      mode: "DUET_SPLIT_STAGE_COMPOSITE",
      canvas_width: 1920,
      canvas_height: 1080,
      output_duration_seconds: 9.62,
    },
    source_videos: [
      {
        character_id: "GDTH-CHAR-001", character_name: tuongVy?.character_name,
        file_id: tuongVy?.file_id, mime_type: tuongVy?.mime_type,
        layout_role: "LEFT", allowed_framing: ["MEDIUM", "FULL_BODY"],
        close_up_allowed: false, preserve_microphone: true,
      },
      {
        character_id: "GDTH-CHAR-002", character_name: phuongAn?.character_name,
        file_id: phuongAn?.file_id, mime_type: phuongAn?.mime_type,
        layout_role: "RIGHT", allowed_framing: ["MEDIUM", "FULL_BODY"],
        close_up_allowed: true, preserve_microphone: false,
      },
    ],
    audio_policy: "MASTER_AUDIO_ATTACHED_AFTER_PROVIDER_RESULT",
    output_readiness: "BLOCKED_PENDING_COMPOSITE_APPROVAL",
    composite_execution_allowed: false,
    provider_execution_allowed: false,
    render_allowed: false,
    approval_gate: {
      approval_status: "PENDING",
      next_action: "APPROVE_MV_DUET_BASE_COMPOSITE",
    },
    prepared_at: preparedAt,
  };
}


export function buildMvDuetBaseCompositeRolloutManifest(
  projectId: string,
  projectName: string,
  renderPlanFileId: string,
  renderPlan: Record<string, unknown>,
  pilotManifestFileId: string,
  pilotManifest: Record<string, unknown>,
  pilotOutputFileId: string,
  preparedAt: string,
) {
  const units = Array.isArray(renderPlan.render_units)
    ? renderPlan.render_units as Array<Record<string, unknown>>
    : [];
  const safeUnits = units.length === 15 && units.every((unit, index) => {
    const framing = (unit.framing_constraints ?? {}) as Record<string, unknown>;
    const performer = String(unit.performer ?? "");
    const hasTuongVy = performer === "TUONG_VY_EM" || performer === "SONG_CA";
    return (
      Number(unit.cue_order) === index + 1 &&
      String(unit.render_unit_id ?? "").trim().length > 0 &&
      Number(unit.duration_seconds) > 0 &&
      unit.provider_execution_allowed === false &&
      unit.render_allowed === false &&
      (!hasTuongVy ||
        (framing.close_up_allowed === false &&
          framing.preserve_microphone === true))
    );
  });
  const pilotOutput = (pilotManifest.output ?? {}) as Record<string, unknown>;
  const pilotReview = (pilotManifest.review_gate ?? {}) as Record<string, unknown>;
  const pilotUnit = units.find(
    (unit) => String(unit.render_unit_id ?? "") === "RP015",
  );
  if (
    String(renderPlan.project_id ?? "") !== projectId ||
    String(renderPlan.render_plan_status ?? "") !== "APPROVED" ||
    renderPlan.provider_execution_allowed !== false ||
    renderPlan.render_allowed !== false ||
    !safeUnits ||
    !pilotUnit ||
    String(pilotUnit.performer ?? "") !== "SONG_CA" ||
    Math.abs(Number(pilotUnit.duration_seconds) - 9.62) > 0.2 ||
    String(pilotManifest.project_id ?? "") !== projectId ||
    String(pilotManifest.composite_status ?? "") !== "PILOT_APPROVED" ||
    String(pilotManifest.output_readiness ?? "") !== "APPROVED_PILOT_REFERENCE" ||
    String(pilotReview.review_status ?? "") !== "APPROVED" ||
    String(pilotOutput.file_id ?? "") !== pilotOutputFileId ||
    Number(pilotOutput.width) !== 1920 ||
    Number(pilotOutput.height) !== 1080 ||
    Math.abs(Number(pilotOutput.duration_seconds) - 9.62) > 0.2 ||
    pilotManifest.provider_execution_allowed !== false ||
    pilotManifest.render_allowed !== false
  ) {
    throw new ProjectRegistryInvalidStateError(
      "Pilot RP015 hoặc render plan chưa an toàn để lập kế hoạch rollout",
    );
  }
  const totalDurationSeconds = units.reduce(
    (sum, unit) => sum + Number(unit.duration_seconds ?? 0),
    0,
  );
  return {
    schema_version: "1.0",
    project_id: projectId,
    project_name: projectName,
    stage: "PRE_PRODUCTION",
    pipeline: "ORIGINAL_FACE_COMPOSITE",
    rollout_status: "AWAITING_APPROVAL",
    source_references: {
      approved_render_plan_file_id: renderPlanFileId,
      approved_pilot_manifest_file_id: pilotManifestFileId,
      approved_pilot_output_file_id: pilotOutputFileId,
    },
    pilot_reference: {
      render_unit_id: "RP015",
      output_file_id: pilotOutputFileId,
      width: 1920,
      height: 1080,
      duration_seconds: Number(pilotOutput.duration_seconds),
      review_status: "APPROVED",
    },
    total_render_units: 15,
    total_duration_seconds: Number(totalDurationSeconds.toFixed(3)),
    execution_scope: "PLAN_ONLY",
    composite_execution_allowed: false,
    provider_execution_allowed: false,
    render_allowed: false,
    rollout_units: units.map((unit) => ({
      render_unit_id: unit.render_unit_id,
      cue_order: unit.cue_order,
      performer: unit.performer,
      start_seconds: unit.start_seconds,
      end_seconds: unit.end_seconds,
      duration_seconds: unit.duration_seconds,
      framing_constraints: unit.framing_constraints,
      rollout_status:
        String(unit.render_unit_id ?? "") === "RP015"
          ? "PILOT_APPROVED_REFERENCE"
          : "BLOCKED_PENDING_ROLLOUT_APPROVAL",
      composite_execution_allowed: false,
      provider_execution_allowed: false,
      render_allowed: false,
    })),
    safety_policy: {
      tuong_vy_close_up_allowed: false,
      tuong_vy_preserve_microphone: true,
      provider_execution_allowed: false,
      render_allowed: false,
    },
    approval_gate: {
      approval_status: "PENDING",
      next_action: "APPROVE_MV_DUET_BASE_COMPOSITE_ROLLOUT",
    },
    prepared_at: preparedAt,
  };
}

export function planMvDuetBaseCompositeExecution(
  projectRow: string[],
  jobRow: string[] | undefined,
  approvalRow: string[] | undefined,
): {
  submission_id: string;
  project_id: string;
  project_name: string;
  project_folder_id: string;
  job_id: string;
  manifest_file_id: string;
  idempotent_replay: boolean;
  existing_result?: Omit<ExecutedMvDuetBaseComposite, "idempotent_replay">;
} {
  const submissionId = String(projectRow[0] ?? "").trim();
  const projectId = String(projectRow[1] ?? "").trim();
  const nextAction = String(projectRow[19] ?? "").trim();
  const projectFolderId = String(projectRow[20] ?? "").trim();
  if (
    !projectId ||
    !projectFolderId ||
    String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" ||
    String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION"
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId || "EMPTY"} chưa đủ điều kiện dựng base composite RP015`,
    );
  }
  if (
    !jobRow ||
    String(jobRow[1] ?? "").trim() !== projectId ||
    String(jobRow[2] ?? "").trim() !== "PRE_PRODUCTION" ||
    String(jobRow[3] ?? "").trim() !== MV_DUET_BASE_COMPOSITE_JOB_TYPE
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId} chưa có job base composite RP015 hợp lệ`,
    );
  }
  const jobId = String(jobRow[0] ?? "").trim();
  const outputFileIds = parseStringArray(jobRow[7]);
  const manifestFileId = outputFileIds[0];
  if (!manifestFileId) {
    throw new ProjectRegistryInvalidStateError(
      `Job ${jobId || "EMPTY"} chưa có base composite manifest`,
    );
  }
  if (
    !approvalRow ||
    String(approvalRow[1] ?? "").trim() !== projectId ||
    String(approvalRow[2] ?? "").trim() !== MV_DUET_BASE_COMPOSITE_JOB_TYPE ||
    String(approvalRow[3] ?? "").trim() !== jobId ||
    String(approvalRow[4] ?? "").trim() !== "APPROVED"
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Base composite RP015 của ${projectId} chưa được chủ dự án duyệt`,
    );
  }
  if (
    nextAction === "REVIEW_MV_DUET_BASE_COMPOSITE" &&
    String(jobRow[4] ?? "").trim() === "SUCCEEDED"
  ) {
    const result = parseObject(jobRow[8], "MV_DUET_BASE_COMPOSITE result");
    return {
      submission_id: submissionId,
      project_id: projectId,
      project_name: String(projectRow[2] ?? "").trim(),
      project_folder_id: projectFolderId,
      job_id: jobId,
      manifest_file_id: manifestFileId,
      idempotent_replay: true,
      existing_result: {
        project_id: projectId,
        current_stage: "PRE_PRODUCTION",
        next_action: "REVIEW_MV_DUET_BASE_COMPOSITE",
        job_id: jobId,
        job_status: "SUCCEEDED",
        output_file_id: String(result.output_file_id ?? ""),
        output_file_url: String(result.output_file_url ?? ""),
        duration_seconds: Number(result.duration_seconds),
        width: Number(result.width),
        height: Number(result.height),
        provider_execution_allowed: false,
        render_allowed: false,
        executed_at: String(result.executed_at ?? ""),
      },
    };
  }
  if (
    nextAction !== "EXECUTE_MV_DUET_BASE_COMPOSITE" ||
    String(jobRow[4] ?? "").trim() !== "APPROVED"
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Không thể dựng base composite RP015 từ ${nextAction || "EMPTY"}/${String(jobRow[4] ?? "EMPTY")}`,
    );
  }
  return {
    submission_id: submissionId,
    project_id: projectId,
    project_name: String(projectRow[2] ?? "").trim(),
    project_folder_id: projectFolderId,
    job_id: jobId,
    manifest_file_id: manifestFileId,
    idempotent_replay: false,
  };
}

export function planMvDuetBaseCompositeApproval(
  projectRow: string[],
  jobRow: string[] | undefined,
  approvalRow: string[] | undefined,
  now = new Date(),
): ApprovedMvDuetBaseComposite & { submission_id: string } {
  const submissionId = String(projectRow[0] ?? "").trim();
  const projectId = String(projectRow[1] ?? "").trim();
  const nextAction = String(projectRow[19] ?? "").trim();
  if (
    !projectId ||
    String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" ||
    String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION"
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId || "EMPTY"} chưa đủ điều kiện duyệt base composite song ca`,
    );
  }
  if (
    !jobRow ||
    String(jobRow[1] ?? "").trim() !== projectId ||
    String(jobRow[2] ?? "").trim() !== "PRE_PRODUCTION" ||
    String(jobRow[3] ?? "").trim() !== MV_DUET_BASE_COMPOSITE_JOB_TYPE
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId} chưa có base composite song ca hợp lệ`,
    );
  }
  const jobId = String(jobRow[0] ?? "").trim();
  if (
    !approvalRow ||
    String(approvalRow[1] ?? "").trim() !== projectId ||
    String(approvalRow[2] ?? "").trim() !== MV_DUET_BASE_COMPOSITE_JOB_TYPE ||
    String(approvalRow[3] ?? "").trim() !== jobId
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Approval base composite song ca của ${projectId} không hợp lệ`,
    );
  }
  const jobStatus = String(jobRow[4] ?? "").trim();
  const approvalStatus = String(approvalRow[4] ?? "").trim();
  const approvedAt = String(approvalRow[6] ?? "").trim() || now.toISOString();
  const result = {
    submission_id: submissionId,
    project_id: projectId,
    current_stage: "PRE_PRODUCTION" as const,
    next_action: "EXECUTE_MV_DUET_BASE_COMPOSITE" as const,
    job_id: jobId,
    job_status: "APPROVED" as const,
    approval_id: String(approvalRow[0] ?? "").trim(),
    approval_status: "APPROVED" as const,
    composite_execution_allowed: true as const,
    provider_execution_allowed: false as const,
    render_allowed: false as const,
    approved_at: approvedAt,
  };
  if (
    nextAction === "EXECUTE_MV_DUET_BASE_COMPOSITE" &&
    jobStatus === "APPROVED" &&
    approvalStatus === "APPROVED"
  ) {
    return { ...result, idempotent_replay: true };
  }
  if (
    nextAction !== "APPROVE_MV_DUET_BASE_COMPOSITE" ||
    jobStatus !== "AWAITING_APPROVAL" ||
    approvalStatus !== "PENDING"
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Không thể duyệt base composite song ca từ ${nextAction || "EMPTY"}/${jobStatus || "EMPTY"}/${approvalStatus || "EMPTY"}`,
    );
  }
  return {
    ...result,
    approved_at: now.toISOString(),
    idempotent_replay: false,
  };
}

export function planMvProviderSubmissionApproval(
  projectRow: string[],
  jobRow: string[] | undefined,
  approvalRow: string[] | undefined,
  now = new Date(),
): ApprovedMvProviderSubmission & { submission_id: string } {
  const submissionId = String(projectRow[0] ?? "").trim();
  const projectId = String(projectRow[1] ?? "").trim();
  const nextAction = String(projectRow[19] ?? "").trim();
  if (!projectId || String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" || String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION") {
    throw new ProjectRegistryInvalidStateError(`Dự án ${projectId || "EMPTY"} chưa đủ điều kiện duyệt provider submission`);
  }
  if (!jobRow || String(jobRow[1] ?? "").trim() !== projectId || String(jobRow[3] ?? "").trim() !== MV_PROVIDER_SUBMISSION_JOB_TYPE) {
    throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} chưa có provider submission hợp lệ`);
  }
  const jobId = String(jobRow[0] ?? "").trim();
  if (!approvalRow || String(approvalRow[1] ?? "").trim() !== projectId || String(approvalRow[2] ?? "").trim() !== MV_PROVIDER_SUBMISSION_JOB_TYPE || String(approvalRow[3] ?? "").trim() !== jobId) {
    throw new ProjectRegistryInvalidStateError(`Approval provider submission của ${projectId} không hợp lệ`);
  }
  const jobStatus = String(jobRow[4] ?? "").trim();
  const approvalStatus = String(approvalRow[4] ?? "").trim();
  const approvedAt = String(approvalRow[6] ?? "").trim() || now.toISOString();
  if (nextAction === "SUBMIT_MV_PROVIDER_JOBS" && jobStatus === "APPROVED" && approvalStatus === "APPROVED") {
    return { submission_id: submissionId, project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "SUBMIT_MV_PROVIDER_JOBS", job_id: jobId, job_status: "APPROVED", approval_id: String(approvalRow[0]), approval_status: "APPROVED", approved_at: approvedAt, idempotent_replay: true };
  }
  if (nextAction !== "APPROVE_MV_PROVIDER_SUBMISSION" || jobStatus !== "AWAITING_APPROVAL" || approvalStatus !== "PENDING") {
    throw new ProjectRegistryInvalidStateError(`Không thể duyệt provider submission từ ${nextAction || "EMPTY"}/${jobStatus || "EMPTY"}/${approvalStatus || "EMPTY"}`);
  }
  return { submission_id: submissionId, project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "SUBMIT_MV_PROVIDER_JOBS", job_id: jobId, job_status: "APPROVED", approval_id: String(approvalRow[0]), approval_status: "APPROVED", approved_at: now.toISOString(), idempotent_replay: false };
}

export function planMvRenderExecutionApproval(
  projectRow: string[], jobRow: string[] | undefined,
  approvalRow: string[] | undefined, now = new Date(),
): ApprovedMvRenderExecution & { submission_id: string } {
  const submissionId = String(projectRow[0] ?? "").trim();
  const projectId = String(projectRow[1] ?? "").trim();
  const nextAction = String(projectRow[19] ?? "").trim();
  if (!projectId || String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" || String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION") {
    throw new ProjectRegistryInvalidStateError(`Dự án ${projectId || "EMPTY"} chưa đủ điều kiện duyệt thực thi render`);
  }
  if (!jobRow || String(jobRow[1] ?? "").trim() !== projectId || String(jobRow[3] ?? "").trim() !== MV_RENDER_EXECUTION_JOB_TYPE) {
    throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} chưa có job thực thi render hợp lệ`);
  }
  const jobId = String(jobRow[0] ?? "").trim();
  if (!approvalRow || String(approvalRow[1] ?? "").trim() !== projectId || String(approvalRow[2] ?? "").trim() !== MV_RENDER_EXECUTION_JOB_TYPE || String(approvalRow[3] ?? "").trim() !== jobId) {
    throw new ProjectRegistryInvalidStateError(`Approval thực thi render của ${projectId} không hợp lệ`);
  }
  const jobStatus = String(jobRow[4] ?? "").trim();
  const approvalStatus = String(approvalRow[4] ?? "").trim();
  const approvedAt = String(approvalRow[6] ?? "").trim() || now.toISOString();
  if (nextAction === "PREPARE_MV_PROVIDER_SUBMISSION" && jobStatus === "APPROVED" && approvalStatus === "APPROVED") {
    return { submission_id: submissionId, project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "PREPARE_MV_PROVIDER_SUBMISSION", job_id: jobId, job_status: "APPROVED", approval_id: String(approvalRow[0]), approval_status: "APPROVED", approved_at: approvedAt, idempotent_replay: true };
  }
  if (nextAction !== "APPROVE_MV_RENDER_EXECUTION" || jobStatus !== "AWAITING_APPROVAL" || approvalStatus !== "PENDING") {
    throw new ProjectRegistryInvalidStateError(`Không thể duyệt thực thi render từ ${nextAction || "EMPTY"}/${jobStatus || "EMPTY"}/${approvalStatus || "EMPTY"}`);
  }
  return { submission_id: submissionId, project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "PREPARE_MV_PROVIDER_SUBMISSION", job_id: jobId, job_status: "APPROVED", approval_id: String(approvalRow[0]), approval_status: "APPROVED", approved_at: now.toISOString(), idempotent_replay: false };
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

export function normalizeDriveFileIdInput(value: unknown, fieldName = "instrumental_master_file_id") {
  const input = String(value ?? "").trim();
  const match = input.match(/\/d\/([^/?#]+)/);
  const fileId = (match?.[1] ?? input).trim();
  if (!/^[A-Za-z0-9_-]{10,}$/.test(fileId)) {
    throw new ProjectRegistryInvalidStateError(
      `${fieldName} phải là Drive file ID hoặc link Drive hợp lệ`,
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


export function planMvDuetBaseCompositeReviewApproval(
  projectRow: string[],
  jobRow: string[] | undefined,
  executionApprovalRow: string[] | undefined,
  reviewApprovalRow: string[] | undefined,
  now = new Date(),
): ApprovedMvDuetBaseCompositeReview & { submission_id: string; manifest_file_id: string } {
  const submissionId = String(projectRow[0] ?? "").trim();
  const projectId = String(projectRow[1] ?? "").trim();
  const nextAction = String(projectRow[19] ?? "").trim();
  if (
    !projectId ||
    String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" ||
    String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION"
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId || "EMPTY"} chưa đủ điều kiện duyệt review RP015`,
    );
  }
  if (
    !jobRow ||
    String(jobRow[1] ?? "").trim() !== projectId ||
    String(jobRow[3] ?? "").trim() !== MV_DUET_BASE_COMPOSITE_JOB_TYPE ||
    String(jobRow[4] ?? "").trim() !== "SUCCEEDED"
  ) {
    throw new ProjectRegistryInvalidStateError(
      `RP015 của ${projectId} chưa thực thi thành công`,
    );
  }
  const jobId = String(jobRow[0] ?? "").trim();
  if (
    !executionApprovalRow ||
    String(executionApprovalRow[1] ?? "").trim() !== projectId ||
    String(executionApprovalRow[2] ?? "").trim() !== MV_DUET_BASE_COMPOSITE_JOB_TYPE ||
    String(executionApprovalRow[3] ?? "").trim() !== jobId ||
    String(executionApprovalRow[4] ?? "").trim() !== "APPROVED"
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Approval thực thi RP015 của ${projectId} không hợp lệ`,
    );
  }
  const result = parseObject(jobRow[8], "MV_DUET_BASE_COMPOSITE execution result");
  const outputFileId = String(result.output_file_id ?? "").trim();
  const outputFileUrl = String(result.output_file_url ?? "").trim();
  const outputIds = parseStringArray(jobRow[7]);
  const manifestFileId = outputIds[0] ?? "";
  if (
    !manifestFileId ||
    !outputFileId ||
    outputIds[1] !== outputFileId ||
    !outputFileUrl ||
    Number(result.width) !== 1920 ||
    Number(result.height) !== 1080 ||
    Math.abs(Number(result.duration_seconds) - 9.62) > 0.2 ||
    result.provider_execution_allowed !== false ||
    result.render_allowed !== false
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Output RP015 của ${projectId} không đạt điều kiện review`,
    );
  }
  const existingApproved =
    nextAction === "PLAN_MV_DUET_BASE_COMPOSITE_ROLLOUT" &&
    String(reviewApprovalRow?.[1] ?? "").trim() === projectId &&
    String(reviewApprovalRow?.[2] ?? "").trim() === MV_DUET_BASE_COMPOSITE_REVIEW_APPROVAL_TYPE &&
    String(reviewApprovalRow?.[3] ?? "").trim() === jobId &&
    String(reviewApprovalRow?.[4] ?? "").trim() === "APPROVED";
  if (existingApproved) {
    return {
      submission_id: submissionId,
      project_id: projectId,
      current_stage: "PRE_PRODUCTION",
      next_action: "PLAN_MV_DUET_BASE_COMPOSITE_ROLLOUT",
      job_id: jobId,
      job_status: "SUCCEEDED",
      review_approval_id: String(reviewApprovalRow?.[0] ?? ""),
      review_status: "APPROVED",
      output_file_id: outputFileId,
      output_file_url: outputFileUrl,
      provider_execution_allowed: false,
      render_allowed: false,
      approved_at: String(reviewApprovalRow?.[6] ?? ""),
      manifest_file_id: manifestFileId,
      idempotent_replay: true,
    };
  }
  if (nextAction !== "REVIEW_MV_DUET_BASE_COMPOSITE" || reviewApprovalRow) {
    throw new ProjectRegistryInvalidStateError(
      `Dự án ${projectId} không ở cổng review RP015`,
    );
  }
  return {
    submission_id: submissionId,
    project_id: projectId,
    current_stage: "PRE_PRODUCTION",
    next_action: "PLAN_MV_DUET_BASE_COMPOSITE_ROLLOUT",
    job_id: jobId,
    job_status: "SUCCEEDED",
    review_approval_id: randomUUID(),
    review_status: "APPROVED",
    output_file_id: outputFileId,
    output_file_url: outputFileUrl,
    provider_execution_allowed: false,
    render_allowed: false,
    approved_at: now.toISOString(),
    manifest_file_id: manifestFileId,
    idempotent_replay: false,
  };
}

export function planMvDuetBaseCompositeRolloutApproval(
  projectRow: string[],
  jobRow: string[] | undefined,
  approvalRow: string[] | undefined,
  now = new Date(),
): ApprovedMvDuetBaseCompositeRollout & { submission_id: string; manifest_file_id: string } {
  const submissionId = String(projectRow[0] ?? "").trim();
  const projectId = String(projectRow[1] ?? "").trim();
  const nextAction = String(projectRow[19] ?? "").trim();
  const jobId = String(jobRow?.[0] ?? "").trim();
  const jobStatus = String(jobRow?.[4] ?? "").trim();
  const approvalId = String(approvalRow?.[0] ?? "").trim();
  const approvalStatus = String(approvalRow?.[4] ?? "").trim();
  const manifestFileId = parseStringArray(jobRow?.[7])[0] ?? "";
  if (
    !projectId ||
    String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" ||
    String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION" ||
    !jobRow ||
    String(jobRow[1] ?? "").trim() !== projectId ||
    String(jobRow[3] ?? "").trim() !== MV_DUET_BASE_COMPOSITE_ROLLOUT_JOB_TYPE ||
    !approvalRow ||
    String(approvalRow[1] ?? "").trim() !== projectId ||
    String(approvalRow[2] ?? "").trim() !== MV_DUET_BASE_COMPOSITE_ROLLOUT_JOB_TYPE ||
    String(approvalRow[3] ?? "").trim() !== jobId ||
    !manifestFileId
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Rollout plan của ${projectId || "EMPTY"} không hợp lệ để duyệt`,
    );
  }
  if (
    nextAction === "EXECUTE_MV_DUET_BASE_COMPOSITE_ROLLOUT" &&
    jobStatus === "APPROVED" &&
    approvalStatus === "APPROVED"
  ) {
    return {
      submission_id: submissionId,
      project_id: projectId,
      current_stage: "PRE_PRODUCTION",
      next_action: "EXECUTE_MV_DUET_BASE_COMPOSITE_ROLLOUT",
      job_id: jobId,
      job_status: "APPROVED",
      approval_id: approvalId,
      approval_status: "APPROVED",
      total_render_units: 15,
      pilot_reference_unit_id: "RP015",
      composite_execution_allowed: true,
      provider_execution_allowed: false,
      render_allowed: false,
      approved_at: String(approvalRow[6] ?? ""),
      manifest_file_id: manifestFileId,
      idempotent_replay: true,
    };
  }
  if (
    nextAction !== "APPROVE_MV_DUET_BASE_COMPOSITE_ROLLOUT" ||
    jobStatus !== "AWAITING_APPROVAL" ||
    approvalStatus !== "PENDING"
  ) {
    throw new ProjectRegistryInvalidStateError(
      `Rollout plan ${jobId || "EMPTY"} không thể duyệt từ ${nextAction || "EMPTY"}/${jobStatus || "EMPTY"}/${approvalStatus || "EMPTY"}`,
    );
  }
  return {
    submission_id: submissionId,
    project_id: projectId,
    current_stage: "PRE_PRODUCTION",
    next_action: "EXECUTE_MV_DUET_BASE_COMPOSITE_ROLLOUT",
    job_id: jobId,
    job_status: "APPROVED",
    approval_id: approvalId,
    approval_status: "APPROVED",
    total_render_units: 15,
    pilot_reference_unit_id: "RP015",
    composite_execution_allowed: true,
    provider_execution_allowed: false,
    render_allowed: false,
    approved_at: now.toISOString(),
    manifest_file_id: manifestFileId,
    idempotent_replay: false,
  };
}

export function selectNextMvDuetBaseCompositeRolloutUnit(
  manifest: Record<string, unknown>,
) {
  const units = Array.isArray(manifest.rollout_units)
    ? manifest.rollout_units as Array<Record<string, unknown>>
    : [];
  if (
    String(manifest.rollout_status ?? "") !== "APPROVED" &&
    String(manifest.rollout_status ?? "") !== "IN_PROGRESS" &&
    String(manifest.rollout_status ?? "") !== "SUCCEEDED_AWAITING_REVIEW"
  ) {
    throw new ProjectRegistryInvalidStateError("Rollout chưa được duyệt để thực thi");
  }
  if (
    manifest.composite_execution_allowed !== true ||
    manifest.provider_execution_allowed !== false ||
    manifest.render_allowed !== false ||
    units.length !== 15
  ) {
    throw new ProjectRegistryInvalidStateError("Rollout manifest không giữ đúng khóa an toàn");
  }
  const completed = units.filter((unit) =>
    String(unit.render_unit_id ?? "") === "RP015" ||
    String(unit.rollout_status ?? "") === "SUCCEEDED"
  );
  const next = units.find((unit) =>
    String(unit.render_unit_id ?? "") !== "RP015" &&
    String(unit.rollout_status ?? "") !== "SUCCEEDED"
  );
  return { next, completed_count: completed.length, remaining_count: units.length - completed.length };
}

export function selectApprovedRp015VocalPilot(
  projectIdInput: string,
  jobs: unknown[][],
  approvals: unknown[][],
) {
  const projectId = projectIdInput.trim();
  const matchingJobs = jobs
    .filter((row, index) =>
      index > 0 &&
      String(row[1] ?? "").trim() === projectId &&
      String(row[3] ?? "").trim() === MV_RP015_VOCAL_PILOT_JOB_TYPE,
    )
    .map((row) => row.map(String));
  const job = matchingJobs[matchingJobs.length - 1];
  if (!job || String(job[4] ?? "").trim() !== "APPROVED") {
    throw new ProjectRegistryInvalidStateError(`Voice Reference Pilot RP015 mới nhất của ${projectId} chưa APPROVED`);
  }

  const jobId = String(job[0] ?? "").trim();
  const matchingApprovals = approvals
    .filter((row, index) =>
      index > 0 &&
      String(row[1] ?? "").trim() === projectId &&
      String(row[2] ?? "").trim() === MV_RP015_VOCAL_PILOT_JOB_TYPE &&
      String(row[3] ?? "").trim() === jobId,
    )
    .map((row) => row.map(String));
  const approval = matchingApprovals[matchingApprovals.length - 1];
  if (!approval || String(approval[4] ?? "").trim() !== "APPROVED") {
    throw new ProjectRegistryInvalidStateError(`Approval Voice Reference Pilot RP015 mới nhất của ${projectId} chưa APPROVED`);
  }

  return { job, approval, approval_id: String(approval[0] ?? "").trim() };
}

export function planRp015VocalPilotApproval(
  projectRow: string[],
  jobRow: string[] | undefined,
  approvalRow: string[] | undefined,
  now = new Date(),
): ApprovedRp015VocalPilot {
  const projectId = String(projectRow[1] ?? "").trim();
  if (!projectId || String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" || String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION") {
    throw new ProjectRegistryInvalidStateError(`Dự án ${projectId || "EMPTY"} chưa đủ điều kiện duyệt Voice Reference Pilot RP015`);
  }
  if (!jobRow || String(jobRow[1] ?? "").trim() !== projectId || String(jobRow[3] ?? "").trim() !== MV_RP015_VOCAL_PILOT_JOB_TYPE) {
    throw new ProjectRegistryInvalidStateError(`Không tìm thấy job Voice Reference Pilot RP015 của ${projectId}`);
  }
  const jobId = String(jobRow[0] ?? "").trim();
  const result = parseObject(jobRow[8], "MV_RP015_VOCAL_PILOT result") as Record<string, unknown>;
  const outputFileIds = parseStringArray(jobRow[7]);
  if (
    String(result.voice_reference_status ?? "") !== "REFERENCE_CANDIDATE" ||
    result.provider_execution_allowed !== false ||
    result.render_allowed !== false ||
    outputFileIds.length < 3
  ) {
    throw new ProjectRegistryInvalidStateError("Hai Voice Reference Pilot RP015 chưa đủ điều kiện phê duyệt");
  }
  if (!approvalRow || String(approvalRow[1] ?? "").trim() !== projectId || String(approvalRow[2] ?? "").trim() !== MV_RP015_VOCAL_PILOT_JOB_TYPE || String(approvalRow[3] ?? "").trim() !== jobId) {
    throw new ProjectRegistryInvalidStateError(`Cổng duyệt Voice Reference Pilot RP015 của ${projectId} không khớp`);
  }
  const jobStatus = String(jobRow[4] ?? "").trim();
  const approvalId = String(approvalRow[0] ?? "").trim();
  const approvalStatus = String(approvalRow[4] ?? "").trim();
  const approvedAt = String(approvalRow[6] ?? "").trim() || now.toISOString();
  if (jobStatus === "APPROVED" && approvalStatus === "APPROVED") {
    return { project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "CREATE_RP015_FINAL_PROOF", job_id: jobId, job_status: "APPROVED", approval_id: approvalId, approval_status: "APPROVED", approved_at: approvedAt, provider_execution_allowed: false, render_allowed: false, idempotent_replay: true };
  }
  const pendingApproval = jobStatus === "AWAITING_APPROVAL" && approvalStatus === "PENDING";
  const approvedGateNeedsJobReconciliation = jobStatus === "AWAITING_APPROVAL" && approvalStatus === "APPROVED";
  if (!pendingApproval && !approvedGateNeedsJobReconciliation) {
    throw new ProjectRegistryInvalidStateError(`Không thể duyệt Voice Reference Pilot RP015 từ ${jobStatus || "EMPTY"}/${approvalStatus || "EMPTY"}`);
  }
  return { project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "CREATE_RP015_FINAL_PROOF", job_id: jobId, job_status: "APPROVED", approval_id: approvalId, approval_status: "APPROVED", approved_at: approvedGateNeedsJobReconciliation ? approvedAt : now.toISOString(), provider_execution_allowed: false, render_allowed: false, idempotent_replay: false };
}

export function planRp015CleanVoiceReferencesApproval(
  projectRow: string[],
  jobRow: string[] | undefined,
  approvalRow: string[] | undefined,
  now = new Date(),
): ApprovedRp015CleanVoiceReferences {
  const projectId = String(projectRow[1] ?? "").trim();
  if (!projectId || String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" || String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION") {
    throw new ProjectRegistryInvalidStateError(`Dự án ${projectId || "EMPTY"} chưa đủ điều kiện duyệt vocal stem RP015`);
  }
  if (!jobRow || String(jobRow[1] ?? "").trim() !== projectId || String(jobRow[3] ?? "").trim() !== MV_RP015_CLEAN_VOICE_REFERENCES_JOB_TYPE) {
    throw new ProjectRegistryInvalidStateError(`Không tìm thấy job Demucs V2 của ${projectId}`);
  }
  const jobId = String(jobRow[0] ?? "").trim();
  const result = parseObject(jobRow[8], "MV_RP015_DEMUCS_VOCAL_STEMS_V2 result") as Record<string, unknown>;
  if (String(result.cleaned_reference_status ?? "") !== "CLEAN_REFERENCE_CANDIDATE" || result.provider_execution_allowed !== false || result.render_allowed !== false) {
    throw new ProjectRegistryInvalidStateError("Kết quả Demucs RP015 không đủ điều kiện phê duyệt");
  }
  if (!approvalRow || String(approvalRow[1] ?? "").trim() !== projectId || String(approvalRow[2] ?? "").trim() !== MV_RP015_CLEAN_VOICE_REFERENCES_JOB_TYPE || String(approvalRow[3] ?? "").trim() !== jobId) {
    throw new ProjectRegistryInvalidStateError(`Cổng duyệt Demucs V2 của ${projectId} không khớp`);
  }
  const jobStatus = String(jobRow[4] ?? "").trim();
  const approvalId = String(approvalRow[0] ?? "").trim();
  const approvalStatus = String(approvalRow[4] ?? "").trim();
  const approvedAt = String(approvalRow[6] ?? "").trim() || now.toISOString();
  if (jobStatus === "APPROVED" && approvalStatus === "APPROVED") {
    return { project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "PREPARE_RP015_VOICE_CONVERSION_PILOT", job_id: jobId, job_status: "APPROVED", approval_id: approvalId, approval_status: "APPROVED", approved_at: approvedAt, provider_execution_allowed: false, render_allowed: false, idempotent_replay: true };
  }
  if (jobStatus !== "AWAITING_APPROVAL" || approvalStatus !== "PENDING") {
    throw new ProjectRegistryInvalidStateError(`Không thể duyệt Demucs V2 từ ${jobStatus || "EMPTY"}/${approvalStatus || "EMPTY"}`);
  }
  return { project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "PREPARE_RP015_VOICE_CONVERSION_PILOT", job_id: jobId, job_status: "APPROVED", approval_id: approvalId, approval_status: "APPROVED", approved_at: now.toISOString(), provider_execution_allowed: false, render_allowed: false, idempotent_replay: false };
}

@Injectable()
export class ProjectRegistryConnector {
  private readonly rp015FinalProofTasks = new Map<string, Promise<void>>();
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

  async approveMvRenderExecution(projectId: string): Promise<ApprovedMvRenderExecution> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const sheets = this.createSheetsClient(); const drive = this.createDriveClient();
    try {
      const [projectsResponse, jobsResponse, approvalsResponse, auditResponse] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'APPROVALS'!A:J" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'AUDIT_LOG'!A:H" }),
      ]);
      const projects = projectsResponse.data.values ?? []; const jobs = jobsResponse.data.values ?? []; const approvals = approvalsResponse.data.values ?? [];
      const projectIndex = projects.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId);
      if (projectIndex < 0) throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      const jobIndex = jobs.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_RENDER_EXECUTION_JOB_TYPE);
      const jobId = jobIndex > 0 ? String(jobs[jobIndex][0] ?? "").trim() : "";
      const approvalIndex = approvals.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[2] ?? "").trim() === MV_RENDER_EXECUTION_JOB_TYPE && String(row[3] ?? "").trim() === jobId);
      const transition = planMvRenderExecutionApproval(projects[projectIndex].map(String), jobIndex > 0 ? jobs[jobIndex].map(String) : undefined, approvalIndex > 0 ? approvals[approvalIndex].map(String) : undefined);
      const result: ApprovedMvRenderExecution = { project_id: transition.project_id, current_stage: transition.current_stage, next_action: transition.next_action, job_id: transition.job_id, job_status: transition.job_status, approval_id: transition.approval_id, approval_status: transition.approval_status, approved_at: transition.approved_at, idempotent_replay: transition.idempotent_replay };
      if (transition.idempotent_replay) return result;
      await this.markMvRenderExecutionManifestApproved(drive, jobs[jobIndex].map(String), transition);
      const projectRow = projectIndex + 1; const jobRow = jobIndex + 1; const approvalRow = approvalIndex + 1; const auditRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [
        { range: `'PROJECTS'!S${projectRow}:T${projectRow}`, values: [["PRE_PRODUCTION", transition.next_action]] },
        { range: `'PROJECTS'!X${projectRow}`, values: [[transition.approved_at]] },
        { range: `'PRODUCTION_JOBS'!E${jobRow}`, values: [[transition.job_status]] },
        { range: `'PRODUCTION_JOBS'!L${jobRow}:N${jobRow}`, values: [[transition.approved_at, String(jobs[jobIndex][12] ?? ""), transition.approved_at]] },
        { range: `'APPROVALS'!E${approvalRow}:H${approvalRow}`, values: [[transition.approval_status, "PROJECT_OWNER", transition.approved_at, "Đã duyệt quyền thực thi; tiếp theo chuẩn bị gửi provider. Chưa gọi provider và chưa render."]] },
        { range: `'APPROVALS'!J${approvalRow}`, values: [[transition.approved_at]] },
        { range: `'AUDIT_LOG'!A${auditRow}:H${auditRow}`, values: [[randomUUID(), projectId, transition.submission_id, "MV_RENDER_EXECUTION_APPROVED", "SUCCEEDED", "AI_EXECUTOR_WEB", "Đã duyệt thực thi render; provider và render vẫn khóa chờ chuẩn bị submission.", transition.approved_at]] },
      ] } });
      return result;
    } catch (error) {
      if (error instanceof ProjectRegistryNotConfiguredError || error instanceof ProjectRegistryProjectNotFoundError || error instanceof ProjectRegistryInvalidStateError) throw error;
      throw new ProjectRegistryUnavailableError(error instanceof Error ? error.message : "Không duyệt được thực thi render MV");
    }
  }

  async prepareMvProviderSubmission(projectId: string): Promise<PreparedMvProviderSubmission> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const projectsRootFolderId = requiredSetting("GIA_DINH_TU_HAU_PROJECTS_FOLDER_ID");
    const sheets = this.createSheetsClient(); const drive = this.createDriveClient();
    try {
      const [projectsResponse, jobsResponse, approvalsResponse, auditResponse] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'APPROVALS'!A:J" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'AUDIT_LOG'!A:H" }),
      ]);
      const projects = projectsResponse.data.values ?? []; const jobs = jobsResponse.data.values ?? []; const approvals = approvalsResponse.data.values ?? [];
      const projectIndex = projects.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId);
      if (projectIndex < 0) throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      const projectRow = projects[projectIndex].map(String);
      if (String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" || String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION") throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} chưa đủ điều kiện chuẩn bị provider submission`);
      const existing = jobs.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_PROVIDER_SUBMISSION_JOB_TYPE)?.map(String);
      if (existing) {
        const existingApproval = approvals.find((row, index) => index > 0 && String(row[3] ?? "").trim() === String(existing[0] ?? "").trim())?.map(String);
        const fileId = parseStringArray(existing[7])[0];
        if (String(projectRow[19] ?? "").trim() !== "APPROVE_MV_PROVIDER_SUBMISSION" || String(existing[4] ?? "").trim() !== "AWAITING_APPROVAL" || String(existingApproval?.[4] ?? "").trim() !== "PENDING" || !fileId) throw new ProjectRegistryInvalidStateError(`Provider submission của ${projectId} đã tồn tại nhưng không chờ duyệt`);
        const metadata = await drive.files.get({ fileId, fields: "id,webViewLink,trashed", supportsAllDrives: true });
        if (metadata.data.trashed) throw new ProjectRegistryInvalidStateError(`Provider submission ${fileId} đã bị xóa`);
        return { project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "APPROVE_MV_PROVIDER_SUBMISSION", job_id: String(existing[0]), job_status: "AWAITING_APPROVAL", approval_id: String(existingApproval?.[0] ?? ""), approval_status: "PENDING", manifest_file_id: fileId, manifest_file_url: metadata.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`, prepared_at: String(existing[12] ?? ""), idempotent_replay: true };
      }
      if (String(projectRow[19] ?? "").trim() !== "PREPARE_MV_PROVIDER_SUBMISSION") throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} không thể chuẩn bị provider submission từ ${String(projectRow[19] ?? "EMPTY")}`);
      const executionJob = jobs.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_RENDER_EXECUTION_JOB_TYPE)?.map(String);
      const executionJobId = String(executionJob?.[0] ?? "").trim();
      const executionApproval = approvals.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[2] ?? "").trim() === MV_RENDER_EXECUTION_JOB_TYPE && String(row[3] ?? "").trim() === executionJobId)?.map(String);
      if (!executionJob || String(executionJob[4] ?? "").trim() !== "APPROVED" || !executionApproval || String(executionApproval[4] ?? "").trim() !== "APPROVED") throw new ProjectRegistryInvalidStateError(`Thực thi render của ${projectId} chưa được duyệt`);
      const projectFolderId = String(projectRow[20] ?? "").trim();
      const projectFolder = await drive.files.get({ fileId: projectFolderId, fields: "id,mimeType,parents,trashed", supportsAllDrives: true });
      assertProjectFolderWithinRoot(projectFolder.data, projectsRootFolderId, projectId);
      const executionFileId = parseStringArray(executionJob[7])[0];
      if (!executionFileId) throw new ProjectRegistryInvalidStateError(`Job thực thi ${executionJobId} chưa có manifest`);
      const executionResponse = await drive.files.get({ fileId: executionFileId, alt: "media", supportsAllDrives: true }, { responseType: "text" });
      const execution = typeof executionResponse.data === "string" ? parseObject(executionResponse.data, "MV_RENDER_EXECUTION manifest") : executionResponse.data as Record<string, unknown>;
      const preparedAt = new Date().toISOString();
      const manifest = buildMvProviderSubmissionManifest(projectId, String(projectRow[2] ?? ""), executionFileId, execution, preparedAt);
      const productionFolder = await this.findChildFolder(drive, projectFolderId, "02_SAN_XUAT_MV");
      const manifestFile = await this.createOrReuseJsonFile(drive, productionFolder.id, `${MV_PROVIDER_SUBMISSION_FILE_PREFIX}_${projectId}.json`, manifest);
      const jobId = randomUUID(); const approvalId = randomUUID();
      const projectSheetRow = projectIndex + 1; const jobSheetRow = jobs.length + 1; const approvalSheetRow = approvals.length + 1; const auditSheetRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [
        { range: `'PROJECTS'!S${projectSheetRow}:T${projectSheetRow}`, values: [["PRE_PRODUCTION", "APPROVE_MV_PROVIDER_SUBMISSION"]] },
        { range: `'PROJECTS'!X${projectSheetRow}`, values: [[preparedAt]] },
        { range: `'PRODUCTION_JOBS'!A${jobSheetRow}:N${jobSheetRow}`, values: [[jobId, projectId, "PRE_PRODUCTION", MV_PROVIDER_SUBMISSION_JOB_TYPE, "AWAITING_APPROVAL", "RUNWAY", JSON.stringify([executionFileId]), JSON.stringify([manifestFile.id]), "", 0, preparedAt, "", preparedAt, preparedAt]] },
        { range: `'APPROVALS'!A${approvalSheetRow}:J${approvalSheetRow}`, values: [[approvalId, projectId, MV_PROVIDER_SUBMISSION_JOB_TYPE, jobId, "PENDING", "", "", "Chờ duyệt gói 15 payload trước khi gửi Runway. Chưa gọi provider và chưa render.", preparedAt, preparedAt]] },
        { range: `'AUDIT_LOG'!A${auditSheetRow}:H${auditSheetRow}`, values: [[randomUUID(), projectId, String(projectRow[0] ?? ""), "MV_PROVIDER_SUBMISSION_PREPARED", "SUCCEEDED", "AI_EXECUTOR_WEB", "Đã chuẩn bị gói provider submission; chưa truyền dữ liệu tới Runway và chưa render.", preparedAt]] },
      ] } });
      return { project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "APPROVE_MV_PROVIDER_SUBMISSION", job_id: jobId, job_status: "AWAITING_APPROVAL", approval_id: approvalId, approval_status: "PENDING", manifest_file_id: manifestFile.id, manifest_file_url: manifestFile.webViewLink, prepared_at: preparedAt, idempotent_replay: false };
    } catch (error) {
      if (error instanceof ProjectRegistryNotConfiguredError || error instanceof ProjectRegistryProjectNotFoundError || error instanceof ProjectRegistryInvalidStateError) throw error;
      throw new ProjectRegistryUnavailableError(error instanceof Error ? error.message : "Không chuẩn bị được provider submission MV");
    }
  }

  async approveMvProviderSubmission(projectId: string): Promise<ApprovedMvProviderSubmission> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const sheets = this.createSheetsClient(); const drive = this.createDriveClient();
    try {
      const [projectsResponse, jobsResponse, approvalsResponse, auditResponse] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'APPROVALS'!A:J" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'AUDIT_LOG'!A:H" }),
      ]);
      const projects = projectsResponse.data.values ?? []; const jobs = jobsResponse.data.values ?? []; const approvals = approvalsResponse.data.values ?? [];
      const projectIndex = projects.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId);
      if (projectIndex < 0) throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      const jobIndex = jobs.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_PROVIDER_SUBMISSION_JOB_TYPE);
      const jobId = jobIndex > 0 ? String(jobs[jobIndex][0] ?? "").trim() : "";
      const approvalIndex = approvals.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[2] ?? "").trim() === MV_PROVIDER_SUBMISSION_JOB_TYPE && String(row[3] ?? "").trim() === jobId);
      const transition = planMvProviderSubmissionApproval(projects[projectIndex].map(String), jobIndex > 0 ? jobs[jobIndex].map(String) : undefined, approvalIndex > 0 ? approvals[approvalIndex].map(String) : undefined);
      const result: ApprovedMvProviderSubmission = { project_id: transition.project_id, current_stage: transition.current_stage, next_action: transition.next_action, job_id: transition.job_id, job_status: transition.job_status, approval_id: transition.approval_id, approval_status: transition.approval_status, approved_at: transition.approved_at, idempotent_replay: transition.idempotent_replay };
      if (transition.idempotent_replay) return result;
      await this.markMvProviderSubmissionManifestApproved(drive, jobs[jobIndex].map(String), transition);
      const projectRow = projectIndex + 1; const jobRow = jobIndex + 1; const approvalRow = approvalIndex + 1; const auditRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [
        { range: `'PROJECTS'!S${projectRow}:T${projectRow}`, values: [["PRE_PRODUCTION", transition.next_action]] },
        { range: `'PROJECTS'!X${projectRow}`, values: [[transition.approved_at]] },
        { range: `'PRODUCTION_JOBS'!E${jobRow}`, values: [[transition.job_status]] },
        { range: `'PRODUCTION_JOBS'!L${jobRow}:N${jobRow}`, values: [[transition.approved_at, String(jobs[jobIndex][12] ?? ""), transition.approved_at]] },
        { range: `'APPROVALS'!E${approvalRow}:H${approvalRow}`, values: [[transition.approval_status, "PROJECT_OWNER", transition.approved_at, "Đã duyệt gói 15 payload. Chưa gửi Runway; chờ lệnh submit riêng."]] },
        { range: `'APPROVALS'!J${approvalRow}`, values: [[transition.approved_at]] },
        { range: `'AUDIT_LOG'!A${auditRow}:H${auditRow}`, values: [[randomUUID(), projectId, transition.submission_id, "MV_PROVIDER_SUBMISSION_APPROVED", "SUCCEEDED", "AI_EXECUTOR_WEB", "Đã duyệt provider submission; chưa gọi Runway và chưa render.", transition.approved_at]] },
      ] } });
      return result;
    } catch (error) {
      if (error instanceof ProjectRegistryNotConfiguredError || error instanceof ProjectRegistryProjectNotFoundError || error instanceof ProjectRegistryInvalidStateError) throw error;
      throw new ProjectRegistryUnavailableError(error instanceof Error ? error.message : "Không duyệt được provider submission MV");
    }
  }

  async prepareMvProviderPilot(projectId: string): Promise<PreparedMvProviderPilot> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const projectsRootFolderId = requiredSetting("GIA_DINH_TU_HAU_PROJECTS_FOLDER_ID");
    const sheets = this.createSheetsClient(); const drive = this.createDriveClient();
    try {
      const [projectsResponse, jobsResponse, approvalsResponse, auditResponse] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'APPROVALS'!A:J" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'AUDIT_LOG'!A:H" }),
      ]);
      const projects = projectsResponse.data.values ?? []; const jobs = jobsResponse.data.values ?? []; const approvals = approvalsResponse.data.values ?? [];
      const projectIndex = projects.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId);
      if (projectIndex < 0) throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      const projectRow = projects[projectIndex].map(String);
      const existing = jobs.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_PROVIDER_PILOT_JOB_TYPE)?.map(String);
      if (existing) {
        const existingApproval = approvals.find((row, index) => index > 0 && String(row[3] ?? "").trim() === String(existing[0] ?? "").trim())?.map(String);
        const fileId = parseStringArray(existing[7])[0];
        if (String(projectRow[19] ?? "").trim() !== "APPROVE_MV_PROVIDER_PILOT" || String(existing[4] ?? "").trim() !== "AWAITING_APPROVAL" || String(existingApproval?.[4] ?? "").trim() !== "PENDING" || !fileId) throw new ProjectRegistryInvalidStateError(`Provider pilot của ${projectId} đã tồn tại nhưng không chờ duyệt`);
        const metadata = await drive.files.get({ fileId, fields: "id,webViewLink,trashed", supportsAllDrives: true });
        const response = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "text" });
        const manifest = typeof response.data === "string" ? parseObject(response.data, "MV_PROVIDER_PILOT manifest") : response.data as Record<string, unknown>;
        if (metadata.data.trashed) throw new ProjectRegistryInvalidStateError(`Provider pilot ${fileId} đã bị xóa`);
        return { project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "APPROVE_MV_PROVIDER_PILOT", job_id: String(existing[0]), job_status: "AWAITING_APPROVAL", approval_id: String(existingApproval?.[0] ?? ""), approval_status: "PENDING", manifest_file_id: fileId, manifest_file_url: metadata.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`, estimated_credits: Number(manifest.estimated_credits), estimated_cost_usd: Number(manifest.estimated_cost_usd), prepared_at: String(existing[12] ?? ""), idempotent_replay: true };
      }
      if (String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" || String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION" || String(projectRow[19] ?? "").trim() !== "SUBMIT_MV_PROVIDER_JOBS") throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} không thể lập provider pilot từ ${String(projectRow[19] ?? "EMPTY")}`);
      const submissionJob = jobs.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_PROVIDER_SUBMISSION_JOB_TYPE)?.map(String);
      const submissionJobId = String(submissionJob?.[0] ?? "").trim();
      const submissionApproval = approvals.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[2] ?? "").trim() === MV_PROVIDER_SUBMISSION_JOB_TYPE && String(row[3] ?? "").trim() === submissionJobId)?.map(String);
      if (!submissionJob || String(submissionJob[4] ?? "").trim() !== "APPROVED" || !submissionApproval || String(submissionApproval[4] ?? "").trim() !== "APPROVED") throw new ProjectRegistryInvalidStateError(`Provider submission của ${projectId} chưa được duyệt`);
      const projectFolderId = String(projectRow[20] ?? "").trim();
      const projectFolder = await drive.files.get({ fileId: projectFolderId, fields: "id,mimeType,parents,trashed", supportsAllDrives: true });
      assertProjectFolderWithinRoot(projectFolder.data, projectsRootFolderId, projectId);
      const submissionFileId = parseStringArray(submissionJob[7])[0];
      const response = await drive.files.get({ fileId: submissionFileId, alt: "media", supportsAllDrives: true }, { responseType: "text" });
      const submission = typeof response.data === "string" ? parseObject(response.data, "MV_PROVIDER_SUBMISSION manifest") : response.data as Record<string, unknown>;
      const preparedAt = new Date().toISOString();
      const manifest = buildMvProviderPilotManifest(projectId, String(projectRow[2] ?? ""), submissionFileId, submission, preparedAt);
      const productionFolder = await this.findChildFolder(drive, projectFolderId, "02_SAN_XUAT_MV");
      const manifestFile = await this.createOrReuseJsonFile(drive, productionFolder.id, `${MV_PROVIDER_PILOT_FILE_PREFIX}_${projectId}.json`, manifest);
      const jobId = randomUUID(); const approvalId = randomUUID();
      const projectSheetRow = projectIndex + 1; const jobSheetRow = jobs.length + 1; const approvalSheetRow = approvals.length + 1; const auditSheetRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [
        { range: `'PROJECTS'!S${projectSheetRow}:T${projectSheetRow}`, values: [["PRE_PRODUCTION", "APPROVE_MV_PROVIDER_PILOT"]] },
        { range: `'PROJECTS'!X${projectSheetRow}`, values: [[preparedAt]] },
        { range: `'PRODUCTION_JOBS'!A${jobSheetRow}:N${jobSheetRow}`, values: [[jobId, projectId, "PRE_PRODUCTION", MV_PROVIDER_PILOT_JOB_TYPE, "AWAITING_APPROVAL", "RUNWAY_ALEPH2", JSON.stringify([submissionFileId]), JSON.stringify([manifestFile.id]), "", 0, preparedAt, "", preparedAt, preparedAt]] },
        { range: `'APPROVALS'!A${approvalSheetRow}:J${approvalSheetRow}`, values: [[approvalId, projectId, MV_PROVIDER_PILOT_JOB_TYPE, jobId, "PENDING", "", "", `Chờ duyệt pilot song ca RP015/9.62 giây, ngân sách tối đa ${manifest.estimated_credits} credits (~$${manifest.estimated_cost_usd}). Chưa gọi Runway.`, preparedAt, preparedAt]] },
        { range: `'AUDIT_LOG'!A${auditSheetRow}:H${auditSheetRow}`, values: [[randomUUID(), projectId, String(projectRow[0] ?? ""), "MV_PROVIDER_PILOT_PREPARED", "SUCCEEDED", "AI_EXECUTOR_WEB", "Đã chọn một pilot song ca RP015 để đánh giá hai gương mặt; còn thiếu media/prompt; chưa gọi Runway và chưa tiêu credit.", preparedAt]] },
      ] } });
      return { project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "APPROVE_MV_PROVIDER_PILOT", job_id: jobId, job_status: "AWAITING_APPROVAL", approval_id: approvalId, approval_status: "PENDING", manifest_file_id: manifestFile.id, manifest_file_url: manifestFile.webViewLink, estimated_credits: manifest.estimated_credits, estimated_cost_usd: manifest.estimated_cost_usd, prepared_at: preparedAt, idempotent_replay: false };
    } catch (error) {
      if (error instanceof ProjectRegistryNotConfiguredError || error instanceof ProjectRegistryProjectNotFoundError || error instanceof ProjectRegistryInvalidStateError) throw error;
      throw new ProjectRegistryUnavailableError(error instanceof Error ? error.message : "Không lập được provider pilot MV");
    }
  }


  async prepareMvDuetBaseCompositeRollout(
    projectId: string,
  ): Promise<PreparedMvDuetBaseCompositeRollout> {
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
      const projects = projectsResponse.data.values ?? [];
      const jobs = jobsResponse.data.values ?? [];
      const approvals = approvalsResponse.data.values ?? [];
      const projectIndex = projects.findIndex(
        (row, index) => index > 0 && String(row[1] ?? "").trim() === projectId,
      );
      if (projectIndex < 0) {
        throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      }
      const projectRow = projects[projectIndex].map(String);
      const existing = jobs.find(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[3] ?? "").trim() === MV_DUET_BASE_COMPOSITE_ROLLOUT_JOB_TYPE,
      )?.map(String);
      if (existing) {
        const existingApproval = approvals.find(
          (row, index) =>
            index > 0 &&
            String(row[1] ?? "").trim() === projectId &&
            String(row[2] ?? "").trim() === MV_DUET_BASE_COMPOSITE_ROLLOUT_JOB_TYPE &&
            String(row[3] ?? "").trim() === String(existing[0] ?? "").trim(),
        )?.map(String);
        const manifestFileId = parseStringArray(existing[7])[0];
        if (
          String(projectRow[19] ?? "").trim() !== "APPROVE_MV_DUET_BASE_COMPOSITE_ROLLOUT" ||
          String(existing[4] ?? "").trim() !== "AWAITING_APPROVAL" ||
          String(existingApproval?.[4] ?? "").trim() !== "PENDING" ||
          !manifestFileId
        ) {
          throw new ProjectRegistryInvalidStateError(
            `Rollout plan của ${projectId} đã tồn tại nhưng không chờ duyệt`,
          );
        }
        const metadata = await drive.files.get({
          fileId: manifestFileId,
          fields: "id,webViewLink,trashed",
          supportsAllDrives: true,
        });
        if (metadata.data.trashed) {
          throw new ProjectRegistryInvalidStateError(
            `Rollout manifest ${manifestFileId} đã bị xóa`,
          );
        }
        return {
          project_id: projectId,
          current_stage: "PRE_PRODUCTION",
          next_action: "APPROVE_MV_DUET_BASE_COMPOSITE_ROLLOUT",
          job_id: String(existing[0] ?? ""),
          job_status: "AWAITING_APPROVAL",
          approval_id: String(existingApproval?.[0] ?? ""),
          approval_status: "PENDING",
          manifest_file_id: manifestFileId,
          manifest_file_url:
            metadata.data.webViewLink ??
            `https://drive.google.com/file/d/${manifestFileId}/view`,
          total_render_units: 15,
          pilot_reference_unit_id: "RP015",
          provider_execution_allowed: false,
          render_allowed: false,
          prepared_at: String(existing[12] ?? ""),
          idempotent_replay: true,
        };
      }
      if (
        String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" ||
        String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION" ||
        String(projectRow[19] ?? "").trim() !== "PLAN_MV_DUET_BASE_COMPOSITE_ROLLOUT"
      ) {
        throw new ProjectRegistryInvalidStateError(
          `Dự án ${projectId} không thể lập rollout plan từ ${String(projectRow[19] ?? "EMPTY")}`,
        );
      }
      const projectFolderId = String(projectRow[20] ?? "").trim();
      const projectFolder = await drive.files.get({
        fileId: projectFolderId,
        fields: "id,mimeType,parents,trashed",
        supportsAllDrives: true,
      });
      assertProjectFolderWithinRoot(
        projectFolder.data,
        projectsRootFolderId,
        projectId,
      );
      const baseJob = jobs.find(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[3] ?? "").trim() === MV_DUET_BASE_COMPOSITE_JOB_TYPE,
      )?.map(String);
      const baseJobId = String(baseJob?.[0] ?? "").trim();
      const reviewApproval = approvals.find(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[2] ?? "").trim() === MV_DUET_BASE_COMPOSITE_REVIEW_APPROVAL_TYPE &&
          String(row[3] ?? "").trim() === baseJobId,
      )?.map(String);
      const baseOutputIds = parseStringArray(baseJob?.[7]);
      const baseManifestFileId = baseOutputIds[0] ?? "";
      const pilotOutputFileId = baseOutputIds[1] ?? "";
      if (
        !baseJob ||
        String(baseJob[4] ?? "").trim() !== "SUCCEEDED" ||
        !reviewApproval ||
        String(reviewApproval[4] ?? "").trim() !== "APPROVED" ||
        !baseManifestFileId ||
        !pilotOutputFileId
      ) {
        throw new ProjectRegistryInvalidStateError(
          `Pilot RP015 của ${projectId} chưa được duyệt đầy đủ`,
        );
      }
      const renderPlanJob = jobs.find(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[3] ?? "").trim() === MV_RENDER_PLAN_JOB_TYPE,
      )?.map(String);
      const renderPlanApproval = approvals.find(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[2] ?? "").trim() === MV_RENDER_PLAN_JOB_TYPE &&
          String(row[3] ?? "").trim() === String(renderPlanJob?.[0] ?? "").trim(),
      )?.map(String);
      const renderPlanFileId = parseStringArray(renderPlanJob?.[7])[0];
      if (
        !renderPlanJob ||
        String(renderPlanJob[4] ?? "").trim() !== "APPROVED" ||
        !renderPlanApproval ||
        String(renderPlanApproval[4] ?? "").trim() !== "APPROVED" ||
        !renderPlanFileId
      ) {
        throw new ProjectRegistryInvalidStateError(
          `Render plan của ${projectId} chưa được duyệt`,
        );
      }
      const [pilotResponse, renderPlanResponse] = await Promise.all([
        drive.files.get(
          { fileId: baseManifestFileId, alt: "media", supportsAllDrives: true },
          { responseType: "text" },
        ),
        drive.files.get(
          { fileId: renderPlanFileId, alt: "media", supportsAllDrives: true },
          { responseType: "text" },
        ),
      ]);
      const pilotManifest =
        typeof pilotResponse.data === "string"
          ? parseObject(pilotResponse.data, "MV_DUET_BASE_COMPOSITE manifest")
          : pilotResponse.data as Record<string, unknown>;
      const renderPlan =
        typeof renderPlanResponse.data === "string"
          ? parseObject(renderPlanResponse.data, "MV_RENDER_PLAN manifest")
          : renderPlanResponse.data as Record<string, unknown>;
      const preparedAt = new Date().toISOString();
      const manifest = buildMvDuetBaseCompositeRolloutManifest(
        projectId,
        String(projectRow[2] ?? ""),
        renderPlanFileId,
        renderPlan,
        baseManifestFileId,
        pilotManifest,
        pilotOutputFileId,
        preparedAt,
      );
      const productionFolder = await this.findChildFolder(
        drive,
        projectFolderId,
        "02_SAN_XUAT_MV",
      );
      const manifestFile = await this.createOrReuseJsonFile(
        drive,
        productionFolder.id,
        `${MV_DUET_BASE_COMPOSITE_ROLLOUT_FILE_PREFIX}_${projectId}.json`,
        manifest,
      );
      const jobId = randomUUID();
      const approvalId = randomUUID();
      const projectSheetRow = projectIndex + 1;
      const jobSheetRow = jobs.length + 1;
      const approvalSheetRow = approvals.length + 1;
      const auditSheetRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            {
              range: `'PROJECTS'!S${projectSheetRow}:T${projectSheetRow}`,
              values: [["PRE_PRODUCTION", "APPROVE_MV_DUET_BASE_COMPOSITE_ROLLOUT"]],
            },
            {
              range: `'PROJECTS'!X${projectSheetRow}`,
              values: [[preparedAt]],
            },
            {
              range: `'PRODUCTION_JOBS'!A${jobSheetRow}:N${jobSheetRow}`,
              values: [[
                jobId,
                projectId,
                "PRE_PRODUCTION",
                MV_DUET_BASE_COMPOSITE_ROLLOUT_JOB_TYPE,
                "AWAITING_APPROVAL",
                "ORIGINAL_FACE_COMPOSITE",
                JSON.stringify([renderPlanFileId, baseManifestFileId, pilotOutputFileId]),
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
                MV_DUET_BASE_COMPOSITE_ROLLOUT_JOB_TYPE,
                jobId,
                "PENDING",
                "",
                "",
                "Chờ duyệt kế hoạch rollout 15 render unit dựa trên pilot RP015. Chưa chạy media và chưa gọi provider.",
                preparedAt,
                preparedAt,
              ]],
            },
            {
              range: `'AUDIT_LOG'!A${auditSheetRow}:H${auditSheetRow}`,
              values: [[
                randomUUID(),
                projectId,
                String(projectRow[0] ?? ""),
                "MV_DUET_BASE_COMPOSITE_ROLLOUT_PREPARED",
                "SUCCEEDED",
                "AI_EXECUTOR_WEB",
                "Đã lập kế hoạch rollout 15 render unit từ pilot RP015; toàn bộ thực thi và provider vẫn bị khóa.",
                preparedAt,
              ]],
            },
          ],
        },
      });
      return {
        project_id: projectId,
        current_stage: "PRE_PRODUCTION",
        next_action: "APPROVE_MV_DUET_BASE_COMPOSITE_ROLLOUT",
        job_id: jobId,
        job_status: "AWAITING_APPROVAL",
        approval_id: approvalId,
        approval_status: "PENDING",
        manifest_file_id: manifestFile.id,
        manifest_file_url: manifestFile.webViewLink,
        total_render_units: 15,
        pilot_reference_unit_id: "RP015",
        provider_execution_allowed: false,
        render_allowed: false,
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
          : "Không lập được kế hoạch Base Composite rollout",
      );
    }
  }

  async approveMvDuetBaseCompositeRollout(
    projectId: string,
  ): Promise<ApprovedMvDuetBaseCompositeRollout> {
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
      const projects = projectsResponse.data.values ?? [];
      const jobs = jobsResponse.data.values ?? [];
      const approvals = approvalsResponse.data.values ?? [];
      const projectIndex = projects.findIndex(
        (row, index) => index > 0 && String(row[1] ?? "").trim() === projectId,
      );
      if (projectIndex < 0) {
        throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      }
      const jobIndex = jobs.findIndex(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[3] ?? "").trim() === MV_DUET_BASE_COMPOSITE_ROLLOUT_JOB_TYPE,
      );
      const jobId = jobIndex > 0 ? String(jobs[jobIndex][0] ?? "").trim() : "";
      const approvalIndex = approvals.findIndex(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[2] ?? "").trim() === MV_DUET_BASE_COMPOSITE_ROLLOUT_JOB_TYPE &&
          String(row[3] ?? "").trim() === jobId,
      );
      const transition = planMvDuetBaseCompositeRolloutApproval(
        projects[projectIndex].map(String),
        jobIndex > 0 ? jobs[jobIndex].map(String) : undefined,
        approvalIndex > 0 ? approvals[approvalIndex].map(String) : undefined,
      );
      const { submission_id: _submissionId, manifest_file_id: _manifestFileId, ...result } = transition;
      if (transition.idempotent_replay) return result;
      const response = await drive.files.get(
        { fileId: transition.manifest_file_id, alt: "media", supportsAllDrives: true },
        { responseType: "text" },
      );
      const manifest = typeof response.data === "string"
        ? parseObject(response.data, "MV_DUET_BASE_COMPOSITE_ROLLOUT manifest")
        : response.data as Record<string, unknown>;
      const units = Array.isArray(manifest.rollout_units)
        ? manifest.rollout_units as Array<Record<string, unknown>>
        : [];
      if (
        String(manifest.project_id ?? "") !== projectId ||
        String(manifest.rollout_status ?? "") !== "AWAITING_APPROVAL" ||
        Number(manifest.total_render_units) !== 15 ||
        units.length !== 15 ||
        String((manifest.pilot_reference as Record<string, unknown> | undefined)?.render_unit_id ?? "") !== "RP015" ||
        manifest.composite_execution_allowed !== false ||
        manifest.provider_execution_allowed !== false ||
        manifest.render_allowed !== false ||
        units.some((unit) => unit.provider_execution_allowed !== false || unit.render_allowed !== false)
      ) {
        throw new ProjectRegistryInvalidStateError(
          `Rollout manifest của ${projectId} chưa an toàn để duyệt`,
        );
      }
      const approvedManifest = {
        ...manifest,
        rollout_status: "APPROVED",
        execution_scope: "LOCAL_COMPOSITE_ONLY",
        composite_execution_allowed: true,
        provider_execution_allowed: false,
        render_allowed: false,
        rollout_units: units.map((unit) => ({
          ...unit,
          rollout_status: String(unit.render_unit_id ?? "") === "RP015"
            ? "PILOT_APPROVED_REFERENCE"
            : "APPROVED_PENDING_LOCAL_COMPOSITE_EXECUTION",
          composite_execution_allowed: String(unit.render_unit_id ?? "") !== "RP015",
          provider_execution_allowed: false,
          render_allowed: false,
        })),
        approval_gate: {
          approval_status: "APPROVED",
          reviewer: "PROJECT_OWNER",
          approved_at: transition.approved_at,
          next_action: transition.next_action,
        },
      };
      await drive.files.update({
        fileId: transition.manifest_file_id,
        media: { mimeType: "application/json", body: JSON.stringify(approvedManifest, null, 2) },
        supportsAllDrives: true,
      });
      const projectRow = projectIndex + 1;
      const jobRow = jobIndex + 1;
      const approvalRow = approvalIndex + 1;
      const auditRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: "RAW", data: [
          { range: `'PROJECTS'!S${projectRow}:T${projectRow}`, values: [["PRE_PRODUCTION", transition.next_action]] },
          { range: `'PROJECTS'!X${projectRow}`, values: [[transition.approved_at]] },
          { range: `'PRODUCTION_JOBS'!E${jobRow}`, values: [[transition.job_status]] },
          { range: `'PRODUCTION_JOBS'!L${jobRow}:N${jobRow}`, values: [[transition.approved_at, String(jobs[jobIndex][12] ?? ""), transition.approved_at]] },
          { range: `'APPROVALS'!E${approvalRow}:H${approvalRow}`, values: [[transition.approval_status, "PROJECT_OWNER", transition.approved_at, "Đã duyệt rollout 15 cảnh theo mẫu RP015; chỉ mở dựng composite cục bộ cho 14 cảnh còn lại. Provider và render vẫn khóa."]] },
          { range: `'APPROVALS'!J${approvalRow}`, values: [[transition.approved_at]] },
          { range: `'AUDIT_LOG'!A${auditRow}:H${auditRow}`, values: [[randomUUID(), projectId, transition.submission_id, "MV_DUET_BASE_COMPOSITE_ROLLOUT_APPROVED", "SUCCEEDED", "AI_EXECUTOR_WEB", "Đã duyệt rollout Base Composite; chưa gọi Runway, provider_execution_allowed=false và render_allowed=false.", transition.approved_at]] },
        ] },
      });
      return result;
    } catch (error) {
      if (
        error instanceof ProjectRegistryNotConfiguredError ||
        error instanceof ProjectRegistryProjectNotFoundError ||
        error instanceof ProjectRegistryInvalidStateError
      ) throw error;
      throw new ProjectRegistryUnavailableError(
        error instanceof Error ? error.message : "Không duyệt được Base Composite rollout",
      );
    }
  }

  async executeMvDuetBaseCompositeRolloutUnit(
    projectId: string,
  ): Promise<ExecutedMvDuetBaseCompositeRolloutUnit> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const projectsRootFolderId = requiredSetting("GIA_DINH_TU_HAU_PROJECTS_FOLDER_ID");
    const sheets = this.createSheetsClient();
    const drive = this.createDriveClient();
    let temporaryDirectory = "";
    try {
      const [projectsResponse, jobsResponse, approvalsResponse, auditResponse] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'APPROVALS'!A:J" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'AUDIT_LOG'!A:H" }),
      ]);
      const projects = projectsResponse.data.values ?? [];
      const jobs = jobsResponse.data.values ?? [];
      const approvals = approvalsResponse.data.values ?? [];
      const projectIndex = projects.findIndex((row, index) =>
        index > 0 && String(row[1] ?? "").trim() === projectId
      );
      if (projectIndex < 0) throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      const projectRow = projects[projectIndex].map(String);
      const nextAction = String(projectRow[19] ?? "").trim();
      if (
        String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" ||
        String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION" ||
        !["EXECUTE_MV_DUET_BASE_COMPOSITE_ROLLOUT", "REVIEW_MV_DUET_BASE_COMPOSITE_ROLLOUT"].includes(nextAction)
      ) throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} không ở cổng thực thi rollout`);
      const jobIndex = jobs.findIndex((row, index) => index > 0 &&
        String(row[1] ?? "").trim() === projectId &&
        String(row[3] ?? "").trim() === MV_DUET_BASE_COMPOSITE_ROLLOUT_JOB_TYPE
      );
      const jobId = jobIndex > 0 ? String(jobs[jobIndex][0] ?? "").trim() : "";
      const approval = approvals.find((row, index) => index > 0 &&
        String(row[1] ?? "").trim() === projectId &&
        String(row[2] ?? "").trim() === MV_DUET_BASE_COMPOSITE_ROLLOUT_JOB_TYPE &&
        String(row[3] ?? "").trim() === jobId
      );
      const manifestFileId = parseStringArray(jobs[jobIndex]?.[7])[0] ?? "";
      if (!jobId || !manifestFileId || String(approval?.[4] ?? "") !== "APPROVED") {
        throw new ProjectRegistryInvalidStateError(`Rollout ${projectId} chưa được duyệt đầy đủ`);
      }
      const manifestResponse = await drive.files.get(
        { fileId: manifestFileId, alt: "media", supportsAllDrives: true },
        { responseType: "text" },
      );
      const manifest = typeof manifestResponse.data === "string"
        ? parseObject(manifestResponse.data, "MV_DUET_BASE_COMPOSITE_ROLLOUT manifest")
        : manifestResponse.data as Record<string, unknown>;
      if (String(manifest.project_id ?? "") !== projectId) {
        throw new ProjectRegistryInvalidStateError("Rollout manifest sai project_id");
      }
      const selection = selectNextMvDuetBaseCompositeRolloutUnit(manifest);
      const units = manifest.rollout_units as Array<Record<string, unknown>>;
      if (!selection.next) {
        const last = [...units].reverse().find((unit) => String(unit.output_file_id ?? ""));
        return {
          project_id: projectId, current_stage: "PRE_PRODUCTION",
          next_action: "REVIEW_MV_DUET_BASE_COMPOSITE_ROLLOUT", job_id: jobId,
          job_status: "SUCCEEDED", render_unit_id: String(last?.render_unit_id ?? "RP015"),
          completed_render_units: 15, remaining_render_units: 0,
          output_file_id: String(last?.output_file_id ?? ""), output_file_url: String(last?.output_file_url ?? ""),
          provider_execution_allowed: false, render_allowed: false,
          executed_at: String(manifest.completed_at ?? manifest.updated_at ?? ""), idempotent_replay: true,
        };
      }
      const unit = selection.next;
      const renderUnitId = String(unit.render_unit_id ?? "").trim();
      const startSeconds = Number(unit.start_seconds);
      const durationSeconds = Number(unit.duration_seconds);
      const framing = (unit.framing_constraints ?? {}) as Record<string, unknown>;
      const performer = String(unit.performer ?? "");
      if (
        !renderUnitId || renderUnitId === "RP015" || !Number.isFinite(startSeconds) ||
        !Number.isFinite(durationSeconds) || durationSeconds <= 0 ||
        unit.provider_execution_allowed !== false || unit.render_allowed !== false ||
        ((performer === "TUONG_VY_EM" || performer === "SONG_CA") &&
          (framing.close_up_allowed !== false || framing.preserve_microphone !== true))
      ) throw new ProjectRegistryInvalidStateError(`Render unit ${renderUnitId || "EMPTY"} không an toàn`);

      const sourceRefs = (manifest.source_references ?? {}) as Record<string, unknown>;
      const pilotManifestId = String(sourceRefs.approved_pilot_manifest_file_id ?? "").trim();
      const pilotResponse = await drive.files.get(
        { fileId: pilotManifestId, alt: "media", supportsAllDrives: true },
        { responseType: "text" },
      );
      const pilot = typeof pilotResponse.data === "string"
        ? parseObject(pilotResponse.data, "MV_DUET_BASE_COMPOSITE pilot manifest")
        : pilotResponse.data as Record<string, unknown>;
      const sources = Array.isArray(pilot.source_videos) ? pilot.source_videos as Array<Record<string, unknown>> : [];
      const tuongVy = sources.find((source) => String(source.character_id ?? "") === "GDTH-CHAR-001");
      const phuongAn = sources.find((source) => String(source.character_id ?? "") === "GDTH-CHAR-002");
      if (!tuongVy || !phuongAn || tuongVy.close_up_allowed !== false || tuongVy.preserve_microphone !== true) {
        throw new ProjectRegistryInvalidStateError("Nguồn rollout không giữ đúng khóa Tường Vy");
      }
      const projectFolderId = String(projectRow[20] ?? "").trim();
      const projectFolder = await drive.files.get({ fileId: projectFolderId, fields: "id,mimeType,parents,trashed", supportsAllDrives: true });
      assertProjectFolderWithinRoot(projectFolder.data, projectsRootFolderId, projectId);
      temporaryDirectory = await mkdtemp(join(tmpdir(), `gdth-${renderUnitId.toLowerCase()}-`));
      const tuongVyPath = join(temporaryDirectory, "tuong-vy-source");
      const phuongAnPath = join(temporaryDirectory, "phuong-an-source");
      const outputPath = join(temporaryDirectory, `${renderUnitId}.mp4`);
      const download = async (fileId: string, destination: string) => {
        const response = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "stream" });
        await pipeline(response.data as Readable, createWriteStream(destination));
      };
      await Promise.all([
        download(String(tuongVy.file_id ?? ""), tuongVyPath),
        download(String(phuongAn.file_id ?? ""), phuongAnPath),
      ]);
      const probe = await executeMvDuetBaseCompositeUnit(
        { render_unit_id: renderUnitId, start_seconds: startSeconds, duration_seconds: durationSeconds },
        tuongVyPath, phuongAnPath, outputPath,
      );
      if ((await stat(outputPath)).size <= 0) throw new ProjectRegistryInvalidStateError(`FFmpeg không tạo output ${renderUnitId}`);
      const compositeFolder = await this.findChildFolder(drive, projectFolderId, "03_ORIGINAL_FACE_COMPOSITE");
      const outputName = `MV_DUET_BASE_COMPOSITE_${renderUnitId}_${projectId}.mp4`;
      const existing = await drive.files.list({
        q: `'${compositeFolder.id}' in parents and name='${outputName.replace(/'/g, "\\'")}' and trashed=false`,
        fields: "files(id,webViewLink)", spaces: "drive", supportsAllDrives: true, includeItemsFromAllDrives: true,
      });
      const outputFile = existing.data.files?.[0]?.id
        ? await drive.files.update({ fileId: existing.data.files[0].id!, media: { mimeType: "video/mp4", body: createReadStream(outputPath) }, fields: "id,webViewLink", supportsAllDrives: true })
        : await drive.files.create({ requestBody: { name: outputName, mimeType: "video/mp4", parents: [compositeFolder.id] }, media: { mimeType: "video/mp4", body: createReadStream(outputPath) }, fields: "id,webViewLink", supportsAllDrives: true });
      const outputFileId = String(outputFile.data.id ?? "");
      const outputFileUrl = outputFile.data.webViewLink ?? `https://drive.google.com/file/d/${outputFileId}/view`;
      const executedAt = new Date().toISOString();
      const updatedUnits = units.map((candidate) => String(candidate.render_unit_id ?? "") === renderUnitId ? {
        ...candidate, rollout_status: "SUCCEEDED", composite_execution_allowed: false,
        provider_execution_allowed: false, render_allowed: false,
        output_file_id: outputFileId, output_file_url: outputFileUrl,
        width: probe.width, height: probe.height, output_duration_seconds: probe.duration_seconds,
        source_offsets: probe.source_offsets, executed_at: executedAt,
      } : candidate);
      const completedCount = updatedUnits.filter((candidate) =>
        String(candidate.render_unit_id ?? "") === "RP015" || String(candidate.rollout_status ?? "") === "SUCCEEDED"
      ).length;
      const remainingCount = 15 - completedCount;
      const final = remainingCount === 0;
      const result: ExecutedMvDuetBaseCompositeRolloutUnit = {
        project_id: projectId, current_stage: "PRE_PRODUCTION",
        next_action: final ? "REVIEW_MV_DUET_BASE_COMPOSITE_ROLLOUT" : "EXECUTE_MV_DUET_BASE_COMPOSITE_ROLLOUT",
        job_id: jobId, job_status: final ? "SUCCEEDED" : "IN_PROGRESS", render_unit_id: renderUnitId,
        completed_render_units: completedCount, remaining_render_units: remainingCount,
        output_file_id: outputFileId, output_file_url: outputFileUrl,
        provider_execution_allowed: false, render_allowed: false, executed_at: executedAt, idempotent_replay: false,
      };
      await drive.files.update({ fileId: manifestFileId, media: { mimeType: "application/json", body: Readable.from([`${JSON.stringify({
        ...manifest, rollout_status: final ? "SUCCEEDED_AWAITING_REVIEW" : "IN_PROGRESS",
        composite_execution_allowed: !final, provider_execution_allowed: false, render_allowed: false,
        rollout_units: updatedUnits, completed_render_units: completedCount,
        remaining_render_units: remainingCount, updated_at: executedAt, ...(final ? { completed_at: executedAt } : {}),
      }, null, 2)}\n`]) }, supportsAllDrives: true });
      const projectSheetRow = projectIndex + 1; const jobSheetRow = jobIndex + 1;
      const auditRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [
        { range: `'PROJECTS'!S${projectSheetRow}:T${projectSheetRow}`, values: [["PRE_PRODUCTION", result.next_action]] },
        { range: `'PROJECTS'!X${projectSheetRow}`, values: [[executedAt]] },
        { range: `'PRODUCTION_JOBS'!E${jobSheetRow}:J${jobSheetRow}`, values: [[result.job_status, "", String(jobs[jobIndex][6] ?? "[]"), JSON.stringify([manifestFileId, ...updatedUnits.map((candidate) => candidate.output_file_id).filter(Boolean)]), JSON.stringify(result), Number(jobs[jobIndex][9] ?? 0) + 1]] },
        { range: `'PRODUCTION_JOBS'!L${jobSheetRow}:N${jobSheetRow}`, values: [[final ? executedAt : "", String(jobs[jobIndex][12] ?? ""), executedAt]] },
        { range: `'AUDIT_LOG'!A${auditRow}:H${auditRow}`, values: [[randomUUID(), projectId, String(projectRow[0] ?? ""), "MV_DUET_BASE_COMPOSITE_ROLLOUT_UNIT_EXECUTED", "SUCCEEDED", "AI_EXECUTOR_WEB", `Đã dựng local ${renderUnitId}; ${remainingCount} cảnh còn lại. Không gọi provider.`, executedAt]] },
      ] } });
      return result;
    } catch (error) {
      if (error instanceof ProjectRegistryNotConfiguredError || error instanceof ProjectRegistryProjectNotFoundError || error instanceof ProjectRegistryInvalidStateError) throw error;
      throw new ProjectRegistryUnavailableError(error instanceof Error ? error.message : "Không thực thi được Base Composite rollout");
    } finally {
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async prepareRp015VocalPilot(projectId: string): Promise<PreparedRp015VocalPilot> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const projectsRootFolderId = requiredSetting("GIA_DINH_TU_HAU_PROJECTS_FOLDER_ID");
    const sheets = this.createSheetsClient();
    const drive = this.createDriveClient();
    let temporaryDirectory = "";
    try {
      const [projectsResponse, jobsResponse, approvalsResponse, auditResponse] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'APPROVALS'!A:J" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'AUDIT_LOG'!A:H" }),
      ]);
      const projects = projectsResponse.data.values ?? []; const jobs = jobsResponse.data.values ?? [];
      const projectIndex = projects.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId);
      if (projectIndex < 0) throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      const projectRow = projects[projectIndex].map(String);
      if (String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" || String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION") {
        throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} không ở PRE_PRODUCTION`);
      }
      const existing = jobs.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_RP015_VOCAL_PILOT_JOB_TYPE)?.map(String);
      if (existing && String(existing[4] ?? "") === "AWAITING_APPROVAL") {
        const replay = parseObject(existing[8], "MV_RP015_VOCAL_PILOT result") as unknown as PreparedRp015VocalPilot;
        return { ...replay, idempotent_replay: true };
      }
      const assetJob = jobs.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_ASSET_PREPARATION_JOB_TYPE)?.map(String);
      const approvals = approvalsResponse.data.values ?? [];
      const assetApproval = approvals.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[2] ?? "").trim() === MV_ASSET_PREPARATION_JOB_TYPE && String(row[3] ?? "").trim() === String(assetJob?.[0] ?? "").trim())?.map(String);
      if (!assetJob || String(assetJob[4] ?? "") !== "APPROVED" || String(assetApproval?.[4] ?? "") !== "APPROVED") {
        throw new ProjectRegistryInvalidStateError(`Asset manifest của ${projectId} chưa được duyệt`);
      }
      const projectFolderId = String(projectRow[20] ?? "").trim();
      const projectFolder = await drive.files.get({ fileId: projectFolderId, fields: "id,mimeType,parents,trashed", supportsAllDrives: true });
      assertProjectFolderWithinRoot(projectFolder.data, projectsRootFolderId, projectId);
      const approvedAssets = await this.readApprovedMvAssetManifest(drive, projectFolderId, assetJob, projectId);
      const sourceAssets = (approvedAssets.source_assets ?? {}) as Record<string, unknown>;
      const characterSources = Array.isArray(sourceAssets.character_sources) ? sourceAssets.character_sources as Array<Record<string, unknown>> : [];
      const references = [
        { character_id: "GDTH-CHAR-001", character_name: "Tường Vy", source: characterSources.find((item) => String(item.character_id) === "GDTH-CHAR-001") },
        { character_id: "GDTH-CHAR-002", character_name: "Phương An", source: characterSources.find((item) => String(item.character_id) === "GDTH-CHAR-002") },
      ];
      if (references.some((item) => !String(item.source?.file_id ?? "").trim())) {
        throw new ProjectRegistryInvalidStateError("Thiếu clip nguồn Tường Vy hoặc Phương An để đánh giá giọng hát");
      }
      temporaryDirectory = await mkdtemp(join(tmpdir(), "gdth-rp015-vocal-pilot-"));
      const productionFolder = await this.findChildFolder(drive, projectFolderId, "02_SAN_XUAT_MV");
      const evaluated = [] as Array<Record<string, unknown>>;
      for (const reference of references) {
        const sourceFileId = String(reference.source?.file_id ?? "").trim();
        const videoPath = join(temporaryDirectory, `${reference.character_id}.mp4`);
        const wavPath = join(temporaryDirectory, `${reference.character_id}.wav`);
        const response = await drive.files.get({ fileId: sourceFileId, alt: "media", supportsAllDrives: true }, { responseType: "stream" });
        await pipeline(response.data as Readable, createWriteStream(videoPath));
        const evaluation = await extractAndEvaluateVoiceReference(videoPath, wavPath);
        let referenceFileId = ""; let referenceFileUrl = "";
        if (evaluation.technical_status === "REFERENCE_CANDIDATE") {
          const fileName = `VOICE_REFERENCE_${reference.character_id}_${projectId}.wav`;
          const existingFile = await drive.files.list({ q: `'${productionFolder.id}' in parents and name='${fileName}' and trashed=false`, fields: "files(id,webViewLink)", spaces: "drive", supportsAllDrives: true, includeItemsFromAllDrives: true });
          const file = existingFile.data.files?.[0]?.id
            ? await drive.files.update({ fileId: existingFile.data.files[0].id!, media: { mimeType: "audio/wav", body: createReadStream(wavPath) }, fields: "id,webViewLink", supportsAllDrives: true })
            : await drive.files.create({ requestBody: { name: fileName, mimeType: "audio/wav", parents: [productionFolder.id] }, media: { mimeType: "audio/wav", body: createReadStream(wavPath) }, fields: "id,webViewLink", supportsAllDrives: true });
          referenceFileId = String(file.data.id ?? ""); referenceFileUrl = String(file.data.webViewLink ?? "");
        }
        evaluated.push({ character_id: reference.character_id, character_name: reference.character_name, source_video_file_id: sourceFileId, reference_audio_file_id: referenceFileId || null, reference_audio_file_url: referenceFileUrl || null, ...evaluation });
      }
      const allCandidates = evaluated.every((item) => item.technical_status === "REFERENCE_CANDIDATE");
      const nextAction = allCandidates ? "REVIEW_RP015_VOICE_REFERENCES" as const : "APPROVE_RP015_AI_VOCAL_FALLBACK" as const;
      const status = allCandidates ? "REFERENCE_CANDIDATE" as const : "AI_VOICE_REQUIRED" as const;
      const preparedAt = new Date().toISOString(); const jobId = randomUUID(); const approvalId = randomUUID();
      const manifest = {
        schema_version: "1.0", project_id: projectId, stage: "PRE_PRODUCTION", render_unit_id: "RP015",
        target_duration_seconds: 9.62, target_master_start_seconds: 362,
        voice_references: evaluated, voice_reference_status: status,
        vocal_strategy: allCandidates ? "VOICE_CONVERSION_REQUIRES_HUMAN_REVIEW" : "GENERIC_AI_VOCAL_REQUIRES_PROVIDER_APPROVAL",
        provider_preferences: ["KITS_AI_OR_EQUIVALENT", "SUNO_GENERIC_AI_VOCAL"],
        provider_execution_allowed: false, render_allowed: false,
        approval_gate: { approval_status: "PENDING", next_action: nextAction }, prepared_at: preparedAt,
      };
      const manifestFile = await this.createOrReuseJsonFile(drive, productionFolder.id, `MV_RP015_VOCAL_PILOT_${projectId}.json`, manifest);
      const result: PreparedRp015VocalPilot = {
        project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: nextAction, job_id: jobId,
        job_status: "AWAITING_APPROVAL", manifest_file_id: manifestFile.id, manifest_file_url: manifestFile.webViewLink,
        voice_reference_status: status, provider_execution_allowed: false, render_allowed: false, prepared_at: preparedAt, idempotent_replay: false,
      };
      const jobRow = jobs.length + 1; const approvalRow = approvals.length + 1; const auditRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [
        { range: `'PRODUCTION_JOBS'!A${jobRow}:N${jobRow}`, values: [[jobId, projectId, "PRE_PRODUCTION", MV_RP015_VOCAL_PILOT_JOB_TYPE, "AWAITING_APPROVAL", "LOCAL_DEMUCS", JSON.stringify(references.map((item) => String(item.source?.file_id ?? ""))), JSON.stringify([manifestFile.id, ...evaluated.map((item) => item.reference_audio_file_id).filter(Boolean)]), JSON.stringify(result), 1, preparedAt, preparedAt, preparedAt, preparedAt]] },
        { range: `'APPROVALS'!A${approvalRow}:J${approvalRow}`, values: [[approvalId, projectId, MV_RP015_VOCAL_PILOT_JOB_TYPE, jobId, "PENDING", "PROJECT_OWNER", "", nextAction, preparedAt, preparedAt]] },
        { range: `'AUDIT_LOG'!A${auditRow}:H${auditRow}`, values: [[randomUUID(), projectId, String(projectRow[0] ?? ""), "MV_RP015_VOCAL_PILOT_PREPARED", "AWAITING_APPROVAL", "AI_EXECUTOR_WEB", `Đã trích và đánh giá hai voice reference; status=${status}; chưa gọi provider.`, preparedAt]] },
      ] } });
      return result;
    } catch (error) {
      if (error instanceof ProjectRegistryNotConfiguredError || error instanceof ProjectRegistryProjectNotFoundError || error instanceof ProjectRegistryInvalidStateError) throw error;
      throw new ProjectRegistryUnavailableError(error instanceof Error ? error.message : "Không chuẩn bị được RP015 vocal pilot");
    } finally {
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async prepareRp015CleanVoiceReferences(projectId: string): Promise<PreparedRp015CleanVoiceReferences> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const projectsRootFolderId = requiredSetting("GIA_DINH_TU_HAU_PROJECTS_FOLDER_ID");
    const sheets = this.createSheetsClient();
    const drive = this.createDriveClient();
    let temporaryDirectory = "";
    try {
      const [projectsResponse, jobsResponse, approvalsResponse, auditResponse] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'APPROVALS'!A:J" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'AUDIT_LOG'!A:H" }),
      ]);
      const projects = projectsResponse.data.values ?? [];
      const jobs = jobsResponse.data.values ?? [];
      const approvals = approvalsResponse.data.values ?? [];
      const projectIndex = projects.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId);
      if (projectIndex < 0) throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      const projectRow = projects[projectIndex].map(String);
      if (String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" || String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION") {
        throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} không ở PRE_PRODUCTION`);
      }
      const existing = jobs.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_RP015_CLEAN_VOICE_REFERENCES_JOB_TYPE)?.map(String);
      if (existing && String(existing[4] ?? "").trim() === "AWAITING_APPROVAL") {
        const replay = parseObject(existing[8], "MV_RP015_CLEAN_VOICE_REFERENCES result") as unknown as PreparedRp015CleanVoiceReferences;
        return { ...replay, idempotent_replay: true };
      }
      const legacyJobIndex = jobs.findIndex((row, index) =>
        index > 0 &&
        String(row[1] ?? "").trim() === projectId &&
        String(row[3] ?? "").trim() === MV_RP015_LEGACY_CLEAN_VOICE_REFERENCES_JOB_TYPE &&
        String(row[4] ?? "").trim() === "AWAITING_APPROVAL"
      );
      if (legacyJobIndex < 0) {
        throw new ProjectRegistryInvalidStateError(`Không tìm thấy kết quả FFmpeg RP015 đang chờ duyệt để tách lại bằng Demucs`);
      }
      const legacyJob = jobs[legacyJobIndex].map(String);
      const legacyApprovalIndex = approvals.findIndex((row, index) =>
        index > 0 &&
        String(row[1] ?? "").trim() === projectId &&
        String(row[2] ?? "").trim() === MV_RP015_LEGACY_CLEAN_VOICE_REFERENCES_JOB_TYPE &&
        String(row[3] ?? "").trim() === String(legacyJob[0] ?? "").trim()
      );
      if (legacyApprovalIndex < 0 || String(approvals[legacyApprovalIndex][4] ?? "").trim() !== "PENDING") {
        throw new ProjectRegistryInvalidStateError("Cổng duyệt kết quả FFmpeg RP015 không ở trạng thái PENDING");
      }
      const referenceFileIds = JSON.parse(String(legacyJob[6] ?? "[]")) as string[];
      if (referenceFileIds.length !== 2 || referenceFileIds.some((fileId) => !fileId)) {
        throw new ProjectRegistryInvalidStateError("Thiếu hai tệp Voice Reference nguồn để tách lại bằng Demucs");
      }
      console.info(JSON.stringify({ event: "RP015_DEMUCS_PREFLIGHT_PASSED", project_id: projectId, source_count: referenceFileIds.length }));

      const projectFolderId = String(projectRow[20] ?? "").trim();
      const projectFolder = await drive.files.get({ fileId: projectFolderId, fields: "id,mimeType,parents,trashed", supportsAllDrives: true });
      assertProjectFolderWithinRoot(projectFolder.data, projectsRootFolderId, projectId);
      const productionFolder = await this.findChildFolder(drive, projectFolderId, "02_SAN_XUAT_MV");
      temporaryDirectory = await mkdtemp(join(tmpdir(), "gdth-rp015-clean-voice-"));
      const characters = [
        { character_id: "GDTH-CHAR-001", character_name: "Tường Vy" },
        { character_id: "GDTH-CHAR-002", character_name: "Phương An" },
      ];
      const cleaned = [] as Array<Record<string, unknown>>;
      for (let index = 0; index < characters.length; index += 1) {
        const inputFileId = referenceFileIds[index];
        const inputPath = join(temporaryDirectory, `${characters[index].character_id}-source.wav`);
        const outputPath = join(temporaryDirectory, `${characters[index].character_id}-clean.wav`);
        const response = await drive.files.get({ fileId: inputFileId, alt: "media", supportsAllDrives: true }, { responseType: "stream" });
        await pipeline(response.data as Readable, createWriteStream(inputPath));
        console.info(JSON.stringify({ event: "RP015_DEMUCS_SEPARATION_STARTED", project_id: projectId, character_id: characters[index].character_id }));
        const evaluation = await cleanAndEvaluateVoiceReference(inputPath, outputPath);
        console.info(JSON.stringify({ event: "RP015_DEMUCS_SEPARATION_COMPLETED", project_id: projectId, character_id: characters[index].character_id, technical_status: evaluation.technical_status, mean_volume_db: evaluation.mean_volume_db, max_volume_db: evaluation.max_volume_db }));
        if (evaluation.technical_status !== "REFERENCE_CANDIDATE") {
          throw new ProjectRegistryInvalidStateError(`Voice Reference đã chuẩn hóa của ${characters[index].character_name} không đạt kiểm tra kỹ thuật`);
        }
        const fileName = `VOICE_REFERENCE_CLEAN_${characters[index].character_id}_${projectId}.wav`;
        const existingFile = await drive.files.list({ q: `'${productionFolder.id}' in parents and name='${fileName}' and trashed=false`, fields: "files(id,webViewLink)", spaces: "drive", supportsAllDrives: true, includeItemsFromAllDrives: true });
        const file = existingFile.data.files?.[0]?.id
          ? await drive.files.update({ fileId: existingFile.data.files[0].id!, media: { mimeType: "audio/wav", body: createReadStream(outputPath) }, fields: "id,webViewLink", supportsAllDrives: true })
          : await drive.files.create({ requestBody: { name: fileName, mimeType: "audio/wav", parents: [productionFolder.id] }, media: { mimeType: "audio/wav", body: createReadStream(outputPath) }, fields: "id,webViewLink", supportsAllDrives: true });
        cleaned.push({ ...characters[index], source_reference_file_id: inputFileId, clean_reference_file_id: file.data.id, clean_reference_file_url: file.data.webViewLink, ...evaluation });
      }
      const preparedAt = new Date().toISOString();
      const jobId = randomUUID();
      const approvalId = randomUUID();
      const manifest = {
        schema_version: "1.0", project_id: projectId, stage: "PRE_PRODUCTION", render_unit_id: "RP015",
        cleanup_method: "DEMUCS_HTDEMUCS_FT_TWO_STEMS_V1",
        cleanup_disclaimer: "Tách stem vocals bằng Demucs htdemucs_ft, sau đó chuẩn hóa WAV mono 48 kHz; bắt buộc nghe duyệt trước khi dùng.",
        clean_voice_references: cleaned,
        provider_execution_allowed: false, render_allowed: false,
        approval_gate: { approval_status: "PENDING", next_action: "REVIEW_RP015_CLEAN_VOICE_REFERENCES" }, prepared_at: preparedAt,
      };
      const manifestFile = await this.createOrReuseJsonFile(drive, productionFolder.id, `MV_RP015_CLEAN_VOICE_REFERENCES_${projectId}.json`, manifest);
      const result: PreparedRp015CleanVoiceReferences = {
        project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "REVIEW_RP015_CLEAN_VOICE_REFERENCES",
        job_id: jobId, job_status: "AWAITING_APPROVAL", manifest_file_id: manifestFile.id, manifest_file_url: manifestFile.webViewLink,
        cleaned_reference_status: "CLEAN_REFERENCE_CANDIDATE", provider_execution_allowed: false, render_allowed: false,
        prepared_at: preparedAt, idempotent_replay: false,
      };
      const jobRow = jobs.length + 1;
      const approvalRow = approvals.length + 1;
      const auditRow = (auditResponse.data.values ?? []).length + 1;
      console.info(JSON.stringify({ event: "RP015_DEMUCS_PERSIST_STARTED", project_id: projectId, job_id: jobId }));
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [
        { range: `'PRODUCTION_JOBS'!E${legacyJobIndex + 1}`, values: [["REJECTED_BACKGROUND_MUSIC_REMAINS"]] },
        { range: `'APPROVALS'!E${legacyApprovalIndex + 1}:J${legacyApprovalIndex + 1}`, values: [["REJECTED", "PROJECT_OWNER", preparedAt, "Hai kết quả FFmpeg vẫn còn nhạc nền; chuyển sang tách stem Demucs.", String(approvals[legacyApprovalIndex][8] ?? preparedAt), preparedAt]] },
        { range: `'PRODUCTION_JOBS'!A${jobRow}:N${jobRow}`, values: [[jobId, projectId, "PRE_PRODUCTION", MV_RP015_CLEAN_VOICE_REFERENCES_JOB_TYPE, "AWAITING_APPROVAL", "LOCAL_DEMUCS", JSON.stringify(referenceFileIds), JSON.stringify([manifestFile.id, ...cleaned.map((item) => item.clean_reference_file_id)]), JSON.stringify(result), 1, preparedAt, preparedAt, preparedAt, preparedAt]] },
        { range: `'APPROVALS'!A${approvalRow}:J${approvalRow}`, values: [[approvalId, projectId, MV_RP015_CLEAN_VOICE_REFERENCES_JOB_TYPE, jobId, "PENDING", "PROJECT_OWNER", "", "REVIEW_RP015_CLEAN_VOICE_REFERENCES", preparedAt, preparedAt]] },
        { range: `'AUDIT_LOG'!A${auditRow}:H${auditRow}`, values: [[randomUUID(), projectId, String(projectRow[0] ?? ""), "MV_RP015_CLEAN_VOICE_REFERENCES_PREPARED", "AWAITING_APPROVAL", "AI_EXECUTOR_WEB", "Đã tách hai stem vocals bằng Demucs htdemucs_ft và chuẩn hóa WAV mono 48 kHz; chưa gọi provider.", preparedAt]] },
      ] } });
      console.info(JSON.stringify({ event: "RP015_DEMUCS_PERSIST_COMPLETED", project_id: projectId, job_id: jobId }));
      return result;
    } catch (error) {
      console.error(JSON.stringify({ event: "RP015_DEMUCS_FAILED", project_id: projectId, error: error instanceof Error ? error.message : String(error) }));
      if (error instanceof ProjectRegistryNotConfiguredError || error instanceof ProjectRegistryProjectNotFoundError || error instanceof ProjectRegistryInvalidStateError) throw error;
      throw new ProjectRegistryUnavailableError(error instanceof Error ? error.message : "Không chuẩn hóa được Voice Reference RP015");
    } finally {
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async approveRp015CleanVoiceReferences(projectId: string): Promise<ApprovedRp015CleanVoiceReferences> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const sheets = this.createSheetsClient();
    try {
      const [projectsResponse, jobsResponse, approvalsResponse, auditResponse] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'APPROVALS'!A:J" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'AUDIT_LOG'!A:H" }),
      ]);
      const projects = projectsResponse.data.values ?? [];
      const jobs = jobsResponse.data.values ?? [];
      const approvals = approvalsResponse.data.values ?? [];
      const projectIndex = projects.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId);
      if (projectIndex < 0) throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      const jobIndex = jobs.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_RP015_CLEAN_VOICE_REFERENCES_JOB_TYPE);
      const job = jobIndex >= 0 ? jobs[jobIndex].map(String) : undefined;
      const approvalIndex = approvals.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[2] ?? "").trim() === MV_RP015_CLEAN_VOICE_REFERENCES_JOB_TYPE && String(row[3] ?? "").trim() === String(job?.[0] ?? "").trim());
      const approval = approvalIndex >= 0 ? approvals[approvalIndex].map(String) : undefined;
      const result = planRp015CleanVoiceReferencesApproval(projects[projectIndex].map(String), job, approval);
      if (result.idempotent_replay) return result;
      const auditRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [
        { range: `'PROJECTS'!T${projectIndex + 1}`, values: [[result.next_action]] },
        { range: `'PRODUCTION_JOBS'!E${jobIndex + 1}:N${jobIndex + 1}`, values: [["APPROVED", String(job?.[5] ?? "LOCAL_DEMUCS"), String(job?.[6] ?? "[]"), String(job?.[7] ?? "[]"), String(job?.[8] ?? ""), String(job?.[9] ?? "1"), String(job?.[10] ?? result.approved_at), result.approved_at, String(job?.[12] ?? result.approved_at), result.approved_at]] },
        { range: `'APPROVALS'!E${approvalIndex + 1}:J${approvalIndex + 1}`, values: [["APPROVED", "PROJECT_OWNER", result.approved_at, "Chủ dự án xác nhận hai vocal stem Demucs RP015 đã hết nhạc nền.", String(approval?.[8] ?? result.approved_at), result.approved_at]] },
        { range: `'AUDIT_LOG'!A${auditRow}:H${auditRow}`, values: [[randomUUID(), projectId, String(projects[projectIndex][0] ?? ""), "MV_RP015_DEMUCS_VOCAL_STEMS_APPROVED", "SUCCEEDED", "AI_EXECUTOR_WEB", "Đã duyệt hai vocal stem Demucs RP015; xác nhận hết nhạc nền. Provider và render vẫn khóa.", result.approved_at]] },
      ] } });
      return result;
    } catch (error) {
      if (error instanceof ProjectRegistryNotConfiguredError || error instanceof ProjectRegistryProjectNotFoundError || error instanceof ProjectRegistryInvalidStateError) throw error;
      throw new ProjectRegistryUnavailableError(error instanceof Error ? error.message : "Không duyệt được vocal stem Demucs RP015");
    }
  }

  async approveRp015VocalPilot(projectId: string): Promise<ApprovedRp015VocalPilot> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const sheets = this.createSheetsClient();
    try {
      const [projectsResponse, jobsResponse, approvalsResponse, auditResponse] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'APPROVALS'!A:J" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'AUDIT_LOG'!A:H" }),
      ]);
      const projects = projectsResponse.data.values ?? [];
      const jobs = jobsResponse.data.values ?? [];
      const approvals = approvalsResponse.data.values ?? [];
      const projectIndex = projects.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId);
      if (projectIndex < 0) throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      const jobIndex = jobs.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_RP015_VOCAL_PILOT_JOB_TYPE);
      const job = jobIndex >= 0 ? jobs[jobIndex].map(String) : undefined;
      const approvalIndex = approvals.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[2] ?? "").trim() === MV_RP015_VOCAL_PILOT_JOB_TYPE && String(row[3] ?? "").trim() === String(job?.[0] ?? "").trim());
      const approval = approvalIndex >= 0 ? approvals[approvalIndex].map(String) : undefined;
      const result = planRp015VocalPilotApproval(projects[projectIndex].map(String), job, approval);
      if (result.idempotent_replay) return result;
      const auditRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [
        { range: `'PROJECTS'!T${projectIndex + 1}`, values: [[result.next_action]] },
        { range: `'PRODUCTION_JOBS'!E${jobIndex + 1}:N${jobIndex + 1}`, values: [["APPROVED", String(job?.[5] ?? "LOCAL_DEMUCS"), String(job?.[6] ?? "[]"), String(job?.[7] ?? "[]"), String(job?.[8] ?? ""), String(job?.[9] ?? "1"), String(job?.[10] ?? result.approved_at), result.approved_at, String(job?.[12] ?? result.approved_at), result.approved_at]] },
        { range: `'APPROVALS'!E${approvalIndex + 1}:J${approvalIndex + 1}`, values: [["APPROVED", "PROJECT_OWNER", result.approved_at, "Chủ dự án xác nhận đã nghe và duyệt cả hai Voice Reference Pilot RP015.", String(approval?.[8] ?? result.approved_at), result.approved_at]] },
        { range: `'AUDIT_LOG'!A${auditRow}:H${auditRow}`, values: [[randomUUID(), projectId, String(projects[projectIndex][0] ?? ""), "MV_RP015_VOCAL_PILOT_APPROVED", "SUCCEEDED", "AI_EXECUTOR_WEB", "Đã duyệt cả hai Voice Reference Pilot RP015. Provider và render vẫn khóa.", result.approved_at]] },
      ] } });
      return result;
    } catch (error) {
      if (error instanceof ProjectRegistryNotConfiguredError || error instanceof ProjectRegistryProjectNotFoundError || error instanceof ProjectRegistryInvalidStateError) throw error;
      throw new ProjectRegistryUnavailableError(error instanceof Error ? error.message : "Không duyệt được Voice Reference Pilot RP015");
    }
  }

  async startRp015FinalProof(projectId: string, vocalMasterFileIdInput: string): Promise<Rp015FinalProofJobStatus> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const sheets = this.createSheetsClient();
    try {
      const [projectsResponse, jobsResponse, auditResponse] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'AUDIT_LOG'!A:H" }),
      ]);
      const projects = projectsResponse.data.values ?? [];
      const jobs = jobsResponse.data.values ?? [];
      const projectIndex = projects.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId);
      if (projectIndex < 0) throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      const projectRow = projects[projectIndex].map(String);
      if (String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" || String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION") {
        throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} không ở PRE_PRODUCTION`);
      }
      const vocalMasterFileId = normalizeDriveFileIdInput(vocalMasterFileIdInput, "vocal_master_file_id");
      const completedProof = jobs.filter((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_RP015_FINAL_PROOF_JOB_TYPE && String(row[4] ?? "").trim() === "SUCCEEDED").at(-1)?.map(String);
      if (completedProof) {
        const result = parseObject(completedProof[8], "MV_RP015_FINAL_PROOF result") as unknown as CreatedRp015FinalProof;
        return {
          project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "REVIEW_RP015_FINAL_PROOF",
          job_id: String(completedProof[0] ?? ""), job_status: "SUCCEEDED", result: { ...result, idempotent_replay: true },
          provider_execution_allowed: false, render_allowed: false,
          created_at: String(completedProof[12] ?? result.created_at), updated_at: String(completedProof[13] ?? result.created_at), idempotent_replay: true,
        };
      }
      const activeControl = jobs.filter((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_RP015_FINAL_PROOF_CONTROL_JOB_TYPE && ["QUEUED", "RUNNING"].includes(String(row[4] ?? "").trim())).at(-1)?.map(String);
      if (activeControl) {
        const updatedAt = String(activeControl[13] ?? activeControl[12] ?? "");
        const ageMs = Date.now() - Date.parse(updatedAt);
        if (this.rp015FinalProofTasks.has(projectId) || !Number.isFinite(ageMs) || ageMs < MV_RP015_FINAL_PROOF_STALE_MS) {
          return this.buildRp015FinalProofJobStatus(activeControl, true);
        }
      }
      const now = new Date().toISOString();
      const jobId = randomUUID();
      const jobRow = jobs.length + 1;
      const auditRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [
        { range: `'PRODUCTION_JOBS'!A${jobRow}:N${jobRow}`, values: [[jobId, projectId, "PRE_PRODUCTION", MV_RP015_FINAL_PROOF_CONTROL_JOB_TYPE, "QUEUED", "LOCAL_FFMPEG", JSON.stringify([vocalMasterFileId]), "[]", JSON.stringify({ message: "Final Proof V4 đã vào hàng đợi" }), 0, "", "", now, now]] },
        { range: `'AUDIT_LOG'!A${auditRow}:H${auditRow}`, values: [[randomUUID(), projectId, String(projectRow[0] ?? ""), "MV_RP015_FINAL_PROOF_V4_QUEUED", "QUEUED", "AI_EXECUTOR_WEB", "Đã tạo job bất đồng bộ Final Proof V4; provider và render tổng vẫn khóa.", now]] },
      ] } });
      this.launchRp015FinalProofTask(projectId, vocalMasterFileId, jobRow, now);
      return {
        project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "WAIT_RP015_FINAL_PROOF",
        job_id: jobId, job_status: "QUEUED", provider_execution_allowed: false, render_allowed: false,
        created_at: now, updated_at: now, idempotent_replay: false,
      };
    } catch (error) {
      if (error instanceof ProjectRegistryNotConfiguredError || error instanceof ProjectRegistryProjectNotFoundError || error instanceof ProjectRegistryInvalidStateError) throw error;
      throw new ProjectRegistryUnavailableError(error instanceof Error ? error.message : "Không tạo được job Final Proof V4");
    }
  }

  async getRp015FinalProofStatus(projectId: string): Promise<Rp015FinalProofJobStatus> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const sheets = this.createSheetsClient();
    try {
      const jobsResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" });
      const jobs = jobsResponse.data.values ?? [];
      const control = jobs.filter((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_RP015_FINAL_PROOF_CONTROL_JOB_TYPE).at(-1)?.map(String);
      if (!control) throw new ProjectRegistryInvalidStateError(`Chưa có job Final Proof V4 cho ${projectId}`);
      return this.buildRp015FinalProofJobStatus(control, true);
    } catch (error) {
      if (error instanceof ProjectRegistryNotConfiguredError || error instanceof ProjectRegistryInvalidStateError) throw error;
      throw new ProjectRegistryUnavailableError(error instanceof Error ? error.message : "Không đọc được trạng thái Final Proof V4");
    }
  }

  private buildRp015FinalProofJobStatus(job: string[], idempotentReplay: boolean): Rp015FinalProofJobStatus {
    const status = String(job[4] ?? "FAILED") as Rp015FinalProofJobStatus["job_status"];
    const payload = (() => { try { return parseObject(job[8], "RP015 Final Proof async payload"); } catch { return {}; } })();
    const result = status === "SUCCEEDED" ? payload as unknown as CreatedRp015FinalProof : undefined;
    return {
      project_id: String(job[1] ?? ""), current_stage: "PRE_PRODUCTION",
      next_action: status === "SUCCEEDED" ? "REVIEW_RP015_FINAL_PROOF" : status === "FAILED" ? "RETRY_RP015_FINAL_PROOF" : "WAIT_RP015_FINAL_PROOF",
      job_id: String(job[0] ?? ""), job_status: status, result,
      error_message: status === "FAILED" ? String(payload.message ?? "Final Proof V4 thất bại") : undefined,
      provider_execution_allowed: false, render_allowed: false,
      created_at: String(job[12] ?? ""), updated_at: String(job[13] ?? job[12] ?? ""), idempotent_replay: idempotentReplay,
    };
  }

  private launchRp015FinalProofTask(projectId: string, vocalMasterFileId: string, jobRow: number, createdAt: string) {
    if (this.rp015FinalProofTasks.has(projectId)) return;
    const task = new Promise<void>((resolve) => setImmediate(resolve)).then(async () => {
      const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
      const sheets = this.createSheetsClient();
      const startedAt = new Date().toISOString();
      try {
        await sheets.spreadsheets.values.update({ spreadsheetId, range: `'PRODUCTION_JOBS'!E${jobRow}:N${jobRow}`, valueInputOption: "RAW", requestBody: { values: [["RUNNING", "LOCAL_FFMPEG", JSON.stringify([vocalMasterFileId]), "[]", JSON.stringify({ message: "Đang tách nền và dựng Final Proof V4" }), 0, startedAt, "", createdAt, startedAt]] } });
        const result = await this.createRp015FinalProof(projectId, vocalMasterFileId);
        const completedAt = new Date().toISOString();
        await sheets.spreadsheets.values.update({ spreadsheetId, range: `'PRODUCTION_JOBS'!E${jobRow}:N${jobRow}`, valueInputOption: "RAW", requestBody: { values: [["SUCCEEDED", "LOCAL_FFMPEG", JSON.stringify([vocalMasterFileId]), JSON.stringify([result.output_file_id]), JSON.stringify(result), 0, startedAt, completedAt, createdAt, completedAt]] } });
      } catch (error) {
        const failedAt = new Date().toISOString();
        const message = error instanceof Error ? error.message : "Lỗi không xác định khi tạo Final Proof V4";
        try {
          await sheets.spreadsheets.values.update({ spreadsheetId, range: `'PRODUCTION_JOBS'!E${jobRow}:N${jobRow}`, valueInputOption: "RAW", requestBody: { values: [["FAILED", "LOCAL_FFMPEG", JSON.stringify([vocalMasterFileId]), "[]", JSON.stringify({ message }), 0, startedAt, failedAt, createdAt, failedAt]] } });
        } catch {
          // Tránh unhandled rejection làm dừng process; job QUEUED/RUNNING cũ sẽ hết hạn và cho phép retry.
        }
      }
    }).catch(() => undefined).finally(() => this.rp015FinalProofTasks.delete(projectId));
    this.rp015FinalProofTasks.set(projectId, task);
  }

  private async createRp015FinalProof(projectId: string, vocalMasterFileIdInput: string): Promise<CreatedRp015FinalProof> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const projectsRootFolderId = requiredSetting("GIA_DINH_TU_HAU_PROJECTS_FOLDER_ID");
    const sheets = this.createSheetsClient();
    const drive = this.createDriveClient();
    let temporaryDirectory = "";
    try {
      const [projectsResponse, jobsResponse, approvalsResponse, auditResponse] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'APPROVALS'!A:J" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'AUDIT_LOG'!A:H" }),
      ]);
      const projects = projectsResponse.data.values ?? [];
      const jobs = jobsResponse.data.values ?? [];
      const approvals = approvalsResponse.data.values ?? [];
      const projectIndex = projects.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId);
      if (projectIndex < 0) throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      const projectRow = projects[projectIndex].map(String);
      if (String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" || String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION") {
        throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} không ở PRE_PRODUCTION`);
      }
      const existingProofJob = jobs.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_RP015_FINAL_PROOF_JOB_TYPE)?.map(String);
      if (existingProofJob && String(existingProofJob[4] ?? "").trim() === "SUCCEEDED") {
        const existing = parseObject(existingProofJob[8], "MV_RP015_FINAL_PROOF result") as unknown as CreatedRp015FinalProof;
        return { ...existing, idempotent_replay: true };
      }
      const baseJob = jobs.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_DUET_BASE_COMPOSITE_JOB_TYPE)?.map(String);
      const baseJobId = String(baseJob?.[0] ?? "").trim();
      const reviewApproval = approvals.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[2] ?? "").trim() === MV_DUET_BASE_COMPOSITE_REVIEW_APPROVAL_TYPE && String(row[3] ?? "").trim() === baseJobId)?.map(String);
      if (!baseJob || String(baseJob[4] ?? "") !== "SUCCEEDED" || String(reviewApproval?.[4] ?? "") !== "APPROVED") {
        throw new ProjectRegistryInvalidStateError(`RP015 của ${projectId} chưa được duyệt để tạo final proof`);
      }
      const assetJob = jobs.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_ASSET_PREPARATION_JOB_TYPE)?.map(String);
      const assetApproval = approvals.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[2] ?? "").trim() === MV_ASSET_PREPARATION_JOB_TYPE && String(row[3] ?? "").trim() === String(assetJob?.[0] ?? "").trim())?.map(String);
      if (!assetJob || String(assetJob[4] ?? "") !== "APPROVED" || String(assetApproval?.[4] ?? "") !== "APPROVED") {
        throw new ProjectRegistryInvalidStateError(`Asset manifest của ${projectId} chưa được duyệt`);
      }
      const approvedVocalPilot = selectApprovedRp015VocalPilot(projectId, jobs, approvals);
      const voicePilotApprovalId = approvedVocalPilot.approval_id;

      const projectFolderId = String(projectRow[20] ?? "").trim();
      const projectFolder = await drive.files.get({ fileId: projectFolderId, fields: "id,mimeType,parents,trashed", supportsAllDrives: true });
      assertProjectFolderWithinRoot(projectFolder.data, projectsRootFolderId, projectId);
      const approvedAssets = await this.readApprovedMvAssetManifest(drive, projectFolderId, assetJob, projectId);
      const sourceAssets = (approvedAssets.source_assets ?? {}) as Record<string, unknown>;
      const characterSources = Array.isArray(sourceAssets.character_sources) ? sourceAssets.character_sources as Array<Record<string, unknown>> : [];
      const tuongVyFileId = String(characterSources.find((source) => String(source.character_id) === "GDTH-CHAR-001")?.file_id ?? "").trim();
      const phuongAnFileId = String(characterSources.find((source) => String(source.character_id) === "GDTH-CHAR-002")?.file_id ?? "").trim();
      if (!tuongVyFileId || !phuongAnFileId || tuongVyFileId === phuongAnFileId) {
        throw new ProjectRegistryInvalidStateError(`Asset manifest ${projectId} thiếu hai video nguồn riêng đã duyệt`);
      }
      const vocalMasterFileId = normalizeDriveFileIdInput(vocalMasterFileIdInput, "vocal_master_file_id");
      const vocalMetadata = await drive.files.get({ fileId: vocalMasterFileId, fields: "id,name,mimeType,size,trashed", supportsAllDrives: true });
      if (!vocalMetadata.data.id || vocalMetadata.data.trashed === true) {
        throw new ProjectRegistryInvalidStateError("vocal_master_file_id không tồn tại, đã bị xóa hoặc service account không truy cập được");
      }
      if (!isDriveAudioCandidate(
        String(vocalMetadata.data.name ?? ""),
        String(vocalMetadata.data.mimeType ?? ""),
        vocalMetadata.data.size,
      )) {
        throw new ProjectRegistryInvalidStateError(
          `Metadata vocal master không giống tài sản âm thanh: name=${String(vocalMetadata.data.name ?? "")}, mime=${String(vocalMetadata.data.mimeType ?? "")}, size=${String(vocalMetadata.data.size ?? "0")}`,
        );
      }
      temporaryDirectory = await mkdtemp(join(tmpdir(), "gdth-rp015-final-proof-"));
      const tuongVyPath = join(temporaryDirectory, "tuong-vy.mp4");
      const phuongAnPath = join(temporaryDirectory, "phuong-an.mp4");
      const audioPath = join(temporaryDirectory, "vocal-master-audio");
      const outputPath = join(temporaryDirectory, "rp015-final-proof.mp4");
      const download = async (fileId: string, destination: string) => {
        const response = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "stream" });
        await pipeline(response.data as Readable, createWriteStream(destination));
      };
      await Promise.all([download(tuongVyFileId, tuongVyPath), download(phuongAnFileId, phuongAnPath), download(vocalMasterFileId, audioPath)]);
      let audioInspection;
      try {
        audioInspection = await inspectAudioAsset(audioPath, {
          requiredStartSeconds: RP015_MASTER_AUDIO_START_SECONDS,
          requiredDurationSeconds: RP015_DURATION_SECONDS,
          minimumMeanDb: -45,
          minimumMaxDb: -40,
          maximumEndDriftSeconds: RP015_AUDIO_END_DRIFT_TOLERANCE_SECONDS,
          maximumLookbackSeconds: RP015_AUDIO_PROOF_MAX_LOOKBACK_SECONDS,
          lookbackStepSeconds: RP015_AUDIO_PROOF_LOOKBACK_STEP_SECONDS,
        });
      } catch (error) {
        throw new ProjectRegistryInvalidStateError(
          `Vocal master không đạt kiểm tra nội dung bằng ffprobe/ffmpeg: ${error instanceof Error ? error.message : "lỗi không xác định"}`,
        );
      }
      const proof = await executeRp015FinalProof(tuongVyPath, phuongAnPath, audioPath, outputPath, {
        audioStartSeconds: audioInspection.inspected_start_seconds,
      });
      if ((await stat(outputPath)).size <= 0) throw new ProjectRegistryInvalidStateError("FFmpeg không tạo được RP015 final proof");
      const compositeFolder = await this.findChildFolder(drive, projectFolderId, "03_ORIGINAL_FACE_COMPOSITE");
      const outputName = `MV_NATURAL_DUET_STAGE_PROOF_RP015_V4_${projectId}.mp4`;
      const existingOutput = await drive.files.list({ q: `'${compositeFolder.id}' in parents and name='${outputName}' and trashed=false`, fields: "files(id,webViewLink)", spaces: "drive", supportsAllDrives: true, includeItemsFromAllDrives: true });
      const outputFile = existingOutput.data.files?.[0]?.id
        ? await drive.files.update({ fileId: existingOutput.data.files[0].id!, media: { mimeType: "video/mp4", body: createReadStream(outputPath) }, fields: "id,webViewLink", supportsAllDrives: true })
        : await drive.files.create({ requestBody: { name: outputName, mimeType: "video/mp4", parents: [compositeFolder.id] }, media: { mimeType: "video/mp4", body: createReadStream(outputPath) }, fields: "id,webViewLink", supportsAllDrives: true });
      const outputFileId = String(outputFile.data.id ?? "");
      if (!outputFileId) throw new ProjectRegistryInvalidStateError("Drive không trả file ID RP015 final proof");
      const createdAt = new Date().toISOString();
      const result: CreatedRp015FinalProof = {
        project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "REVIEW_RP015_FINAL_PROOF",
        render_unit_id: "RP015", proof_status: "SUCCEEDED", output_file_id: outputFileId,
        output_file_url: outputFile.data.webViewLink ?? `https://drive.google.com/file/d/${outputFileId}/view`,
        duration_seconds: proof.duration_seconds, width: 1920, height: 1080, has_audio: true,
        edit_mode: "DUET_STAGE_BACKGROUND_REMOVAL", layout_version: "NATURAL_DUET_STAGE_V4", voice_pilot_approval_id: voicePilotApprovalId, audio_source: "VOCAL_MASTER",
        audio_mean_db: proof.audio_mean_db, audio_max_db: proof.audio_max_db,
        audio_start_seconds: proof.audio_start_seconds, audio_end_drift_seconds: audioInspection.end_drift_seconds,
        audio_lookback_seconds: audioInspection.lookback_seconds, audio_window_adjusted: audioInspection.window_adjusted,
        provider_execution_allowed: false, render_allowed: false, created_at: createdAt, idempotent_replay: false,
      };
      const jobRow = jobs.length + 1; const auditRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [
        { range: `'PRODUCTION_JOBS'!A${jobRow}:N${jobRow}`, values: [[randomUUID(), projectId, "PRE_PRODUCTION", MV_RP015_FINAL_PROOF_JOB_TYPE, "SUCCEEDED", "LOCAL_FFMPEG", JSON.stringify([tuongVyFileId, phuongAnFileId, vocalMasterFileId]), JSON.stringify([outputFileId]), JSON.stringify(result), 2, createdAt, createdAt, createdAt, createdAt]] },
        { range: `'AUDIT_LOG'!A${auditRow}:H${auditRow}`, values: [[randomUUID(), projectId, String(projectRow[0] ?? ""), "MV_RP015_NATURAL_DUET_STAGE_PROOF_V4_CREATED", "SUCCEEDED", "AI_EXECUTOR_WEB", `Đã tách nền hai nguồn và ghép Tường Vy - Phương An cùng sân khấu V4; kiểm chứng audio sau mux mean=${proof.audio_mean_db}dB/max=${proof.audio_max_db}dB; audio_start=${proof.audio_start_seconds}s; end_drift=${audioInspection.end_drift_seconds}s; lookback=${audioInspection.lookback_seconds}s; không gọi provider và không thay đổi rollout.`, createdAt]] },
      ] } });
      return result;
    } catch (error) {
      if (error instanceof ProjectRegistryNotConfiguredError || error instanceof ProjectRegistryProjectNotFoundError || error instanceof ProjectRegistryInvalidStateError) throw error;
      throw new ProjectRegistryUnavailableError(error instanceof Error ? error.message : "Không tạo được RP015 final proof");
    } finally {
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async prepareMvDuetBaseComposite(projectId: string): Promise<PreparedMvDuetBaseComposite> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const projectsRootFolderId = requiredSetting("GIA_DINH_TU_HAU_PROJECTS_FOLDER_ID");
    const sheets = this.createSheetsClient(); const drive = this.createDriveClient();
    try {
      const [projectsResponse, jobsResponse, approvalsResponse, auditResponse] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'APPROVALS'!A:J" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "'AUDIT_LOG'!A:H" }),
      ]);
      const projects = projectsResponse.data.values ?? []; const jobs = jobsResponse.data.values ?? []; const approvals = approvalsResponse.data.values ?? [];
      const projectIndex = projects.findIndex((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId);
      if (projectIndex < 0) throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      const projectRow = projects[projectIndex].map(String);
      const existing = jobs.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_DUET_BASE_COMPOSITE_JOB_TYPE)?.map(String);
      if (existing) {
        const existingApproval = approvals.find((row, index) => index > 0 && String(row[2] ?? "").trim() === MV_DUET_BASE_COMPOSITE_JOB_TYPE && String(row[3] ?? "").trim() === String(existing[0] ?? "").trim())?.map(String);
        const fileId = parseStringArray(existing[7])[0];
        if (String(projectRow[19] ?? "").trim() !== "APPROVE_MV_DUET_BASE_COMPOSITE" || String(existing[4] ?? "").trim() !== "AWAITING_APPROVAL" || String(existingApproval?.[4] ?? "").trim() !== "PENDING" || !fileId) throw new ProjectRegistryInvalidStateError(`Base composite của ${projectId} đã tồn tại nhưng không chờ duyệt`);
        const metadata = await drive.files.get({ fileId, fields: "id,webViewLink,trashed", supportsAllDrives: true });
        if (metadata.data.trashed) throw new ProjectRegistryInvalidStateError(`Base composite ${fileId} đã bị xóa`);
        return { project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "APPROVE_MV_DUET_BASE_COMPOSITE", job_id: String(existing[0]), job_status: "AWAITING_APPROVAL", approval_id: String(existingApproval?.[0] ?? ""), approval_status: "PENDING", manifest_file_id: fileId, manifest_file_url: metadata.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`, prepared_at: String(existing[12] ?? ""), idempotent_replay: true };
      }
      if (String(projectRow[3] ?? "").trim() !== "MUSIC_VIDEO" || String(projectRow[18] ?? "").trim() !== "PRE_PRODUCTION" || String(projectRow[19] ?? "").trim() !== "APPROVE_MV_PROVIDER_PILOT") throw new ProjectRegistryInvalidStateError(`Dự án ${projectId} không thể lập base composite từ ${String(projectRow[19] ?? "EMPTY")}`);
      const projectFolderId = String(projectRow[20] ?? "").trim();
      const projectFolder = await drive.files.get({ fileId: projectFolderId, fields: "id,mimeType,parents,trashed", supportsAllDrives: true });
      assertProjectFolderWithinRoot(projectFolder.data, projectsRootFolderId, projectId);
      const pilotJob = jobs.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_PROVIDER_PILOT_JOB_TYPE)?.map(String);
      const pilotApproval = approvals.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[2] ?? "").trim() === MV_PROVIDER_PILOT_JOB_TYPE && String(row[3] ?? "").trim() === String(pilotJob?.[0] ?? "").trim())?.map(String);
      if (!pilotJob || String(pilotJob[4] ?? "").trim() !== "AWAITING_APPROVAL" || !pilotApproval || String(pilotApproval[4] ?? "").trim() !== "PENDING") throw new ProjectRegistryInvalidStateError(`Provider pilot của ${projectId} không ở trạng thái chờ nguồn composite`);
      const pilotFileId = parseStringArray(pilotJob[7])[0];
      const pilotResponse = await drive.files.get({ fileId: pilotFileId, alt: "media", supportsAllDrives: true }, { responseType: "text" });
      const pilot = typeof pilotResponse.data === "string" ? parseObject(pilotResponse.data, "MV_PROVIDER_PILOT manifest") : pilotResponse.data as Record<string, unknown>;
      const assetJob = jobs.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[3] ?? "").trim() === MV_ASSET_PREPARATION_JOB_TYPE)?.map(String);
      const assetApproval = approvals.find((row, index) => index > 0 && String(row[1] ?? "").trim() === projectId && String(row[2] ?? "").trim() === MV_ASSET_PREPARATION_JOB_TYPE && String(row[3] ?? "").trim() === String(assetJob?.[0] ?? "").trim())?.map(String);
      if (!assetJob || String(assetJob[4] ?? "").trim() !== "APPROVED" || !assetApproval || String(assetApproval[4] ?? "").trim() !== "APPROVED") throw new ProjectRegistryInvalidStateError(`Tài sản nguồn của ${projectId} chưa được duyệt`);
      const assetFileId = parseStringArray(assetJob[7])[0];
      const assets = await this.readApprovedMvAssetManifest(drive, projectFolderId, assetJob, projectId);
      const preparedAt = new Date().toISOString();
      const manifest = buildMvDuetBaseCompositeManifest(projectId, String(projectRow[2] ?? ""), pilotFileId, pilot, assetFileId, assets, preparedAt);
      const productionFolder = await this.findChildFolder(drive, projectFolderId, "02_SAN_XUAT_MV");
      const manifestFile = await this.createOrReuseJsonFile(drive, productionFolder.id, `${MV_DUET_BASE_COMPOSITE_FILE_PREFIX}_${projectId}.json`, manifest);
      const jobId = randomUUID(); const approvalId = randomUUID();
      const projectSheetRow = projectIndex + 1; const jobSheetRow = jobs.length + 1; const approvalSheetRow = approvals.length + 1; const auditSheetRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [
        { range: `'PROJECTS'!S${projectSheetRow}:T${projectSheetRow}`, values: [["PRE_PRODUCTION", "APPROVE_MV_DUET_BASE_COMPOSITE"]] },
        { range: `'PROJECTS'!X${projectSheetRow}`, values: [[preparedAt]] },
        { range: `'PRODUCTION_JOBS'!A${jobSheetRow}:N${jobSheetRow}`, values: [[jobId, projectId, "PRE_PRODUCTION", MV_DUET_BASE_COMPOSITE_JOB_TYPE, "AWAITING_APPROVAL", "ORIGINAL_FACE_COMPOSITE", JSON.stringify([pilotFileId, assetFileId]), JSON.stringify([manifestFile.id]), "", 0, preparedAt, "", preparedAt, preparedAt]] },
        { range: `'APPROVALS'!A${approvalSheetRow}:J${approvalSheetRow}`, values: [[approvalId, projectId, MV_DUET_BASE_COMPOSITE_JOB_TYPE, jobId, "PENDING", "", "", "Chờ duyệt kế hoạch ghép hai nguồn riêng thành base song ca RP015/9.62 giây. Chưa chạy composite, chưa gọi Runway và chưa tiêu credit.", preparedAt, preparedAt]] },
        { range: `'AUDIT_LOG'!A${auditSheetRow}:H${auditSheetRow}`, values: [[randomUUID(), projectId, String(projectRow[0] ?? ""), "MV_DUET_BASE_COMPOSITE_PREPARED", "SUCCEEDED", "AI_EXECUTOR_WEB", "Đã lập kế hoạch base composite từ hai nguồn riêng; giữ khóa Tường Vy; chưa xử lý media và chưa gọi Runway.", preparedAt]] },
      ] } });
      return { project_id: projectId, current_stage: "PRE_PRODUCTION", next_action: "APPROVE_MV_DUET_BASE_COMPOSITE", job_id: jobId, job_status: "AWAITING_APPROVAL", approval_id: approvalId, approval_status: "PENDING", manifest_file_id: manifestFile.id, manifest_file_url: manifestFile.webViewLink, prepared_at: preparedAt, idempotent_replay: false };
    } catch (error) {
      if (error instanceof ProjectRegistryNotConfiguredError || error instanceof ProjectRegistryProjectNotFoundError || error instanceof ProjectRegistryInvalidStateError) throw error;
      throw new ProjectRegistryUnavailableError(error instanceof Error ? error.message : "Không lập được base composite song ca MV");
    }
  }

  async executeMvDuetBaseComposite(
    projectId: string,
  ): Promise<ExecutedMvDuetBaseComposite> {
    const spreadsheetId = requiredSetting("GIA_DINH_TU_HAU_DATABASE_ID");
    const projectsRootFolderId = requiredSetting("GIA_DINH_TU_HAU_PROJECTS_FOLDER_ID");
    const sheets = this.createSheetsClient();
    const drive = this.createDriveClient();
    let temporaryDirectory = "";
    const executionStartedAt = Date.now();
    let executionStage = "INITIALIZING";
    try {
      const [projectsResponse, jobsResponse, approvalsResponse, auditResponse] =
        await Promise.all([
          sheets.spreadsheets.values.get({ spreadsheetId, range: "'PROJECTS'!A:Y" }),
          sheets.spreadsheets.values.get({ spreadsheetId, range: "'PRODUCTION_JOBS'!A:N" }),
          sheets.spreadsheets.values.get({ spreadsheetId, range: "'APPROVALS'!A:J" }),
          sheets.spreadsheets.values.get({ spreadsheetId, range: "'AUDIT_LOG'!A:H" }),
        ]);
      const projects = projectsResponse.data.values ?? [];
      const jobs = jobsResponse.data.values ?? [];
      const approvals = approvalsResponse.data.values ?? [];
      const projectIndex = projects.findIndex(
        (row, index) => index > 0 && String(row[1] ?? "").trim() === projectId,
      );
      if (projectIndex < 0) {
        throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      }
      const jobIndex = jobs.findIndex(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[3] ?? "").trim() === MV_DUET_BASE_COMPOSITE_JOB_TYPE,
      );
      const jobId = jobIndex > 0 ? String(jobs[jobIndex][0] ?? "").trim() : "";
      const approvalIndex = approvals.findIndex(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[2] ?? "").trim() === MV_DUET_BASE_COMPOSITE_JOB_TYPE &&
          String(row[3] ?? "").trim() === jobId,
      );
      const transition = planMvDuetBaseCompositeExecution(
        projects[projectIndex].map(String),
        jobIndex > 0 ? jobs[jobIndex].map(String) : undefined,
        approvalIndex > 0 ? approvals[approvalIndex].map(String) : undefined,
      );
      if (transition.idempotent_replay && transition.existing_result) {
        return { ...transition.existing_result, idempotent_replay: true };
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
      const manifestResponse = await drive.files.get(
        {
          fileId: transition.manifest_file_id,
          alt: "media",
          supportsAllDrives: true,
        },
        { responseType: "text" },
      );
      const manifest =
        typeof manifestResponse.data === "string"
          ? parseObject(manifestResponse.data, "MV_DUET_BASE_COMPOSITE manifest")
          : manifestResponse.data as Record<string, unknown>;
      const sources = Array.isArray(manifest.source_videos)
        ? manifest.source_videos as Array<Record<string, unknown>>
        : [];
      const tuongVy = sources.find(
        (source) => String(source.character_id ?? "") === "GDTH-CHAR-001",
      );
      const phuongAn = sources.find(
        (source) => String(source.character_id ?? "") === "GDTH-CHAR-002",
      );
      if (
        String(manifest.project_id ?? "") !== transition.project_id ||
        String(manifest.composite_status ?? "") !== "APPROVED" ||
        String(manifest.output_readiness ?? "") !== "READY_FOR_LOCAL_COMPOSITE_EXECUTION" ||
        manifest.composite_execution_allowed !== true ||
        manifest.provider_execution_allowed !== false ||
        manifest.render_allowed !== false ||
        sources.length !== 2 ||
        !tuongVy ||
        !phuongAn ||
        !String(tuongVy.file_id ?? "").trim() ||
        !String(phuongAn.file_id ?? "").trim() ||
        String(tuongVy.file_id) === String(phuongAn.file_id) ||
        tuongVy.close_up_allowed !== false ||
        tuongVy.preserve_microphone !== true
      ) {
        throw new ProjectRegistryInvalidStateError(
          `Base composite RP015 của ${transition.project_id} chưa an toàn để thực thi`,
        );
      }

      temporaryDirectory = await mkdtemp(join(tmpdir(), "gdth-rp015-"));
      const tuongVyPath = join(temporaryDirectory, "tuong-vy-source");
      const phuongAnPath = join(temporaryDirectory, "phuong-an-source");
      const outputPath = join(temporaryDirectory, "rp015-base-composite.mp4");
      const download = async (fileId: string, destination: string) => {
        const response = await drive.files.get(
          { fileId, alt: "media", supportsAllDrives: true },
          { responseType: "stream" },
        );
        await pipeline(response.data as Readable, createWriteStream(destination));
      };
      executionStage = "DOWNLOADING_SOURCES";
      console.log(JSON.stringify({
        event: "MV_DUET_BASE_COMPOSITE_DOWNLOAD_STARTED",
        project_id: transition.project_id,
        render_unit_id: "RP015",
      }));
      await Promise.all([
        download(String(tuongVy.file_id), tuongVyPath),
        download(String(phuongAn.file_id), phuongAnPath),
      ]);
      console.log(JSON.stringify({
        event: "MV_DUET_BASE_COMPOSITE_DOWNLOAD_COMPLETED",
        project_id: transition.project_id,
        render_unit_id: "RP015",
        elapsed_ms: Date.now() - executionStartedAt,
      }));
      executionStage = "RUNNING_FFMPEG";
      const probe = await executeMvDuetBaseComposite(
        tuongVyPath,
        phuongAnPath,
        outputPath,
      );
      const outputStats = await stat(outputPath);
      if (outputStats.size <= 0) {
        throw new ProjectRegistryInvalidStateError("FFmpeg không tạo được output RP015");
      }

      const compositeFolder = await this.findChildFolder(
        drive,
        transition.project_folder_id,
        "03_ORIGINAL_FACE_COMPOSITE",
      );
      const outputName =
        `MV_DUET_BASE_COMPOSITE_RP015_${transition.project_id}.mp4`;
      const escapedName = outputName.replace(/'/g, "\\'");
      const existingOutput = await drive.files.list({
        q: `'${compositeFolder.id}' in parents and name='${escapedName}' and trashed=false`,
        fields: "files(id,webViewLink)",
        spaces: "drive",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      const existingFile = existingOutput.data.files?.[0];
      executionStage = "UPLOADING_OUTPUT";
      console.log(JSON.stringify({
        event: "MV_DUET_BASE_COMPOSITE_UPLOAD_STARTED",
        project_id: transition.project_id,
        render_unit_id: "RP015",
      }));
      const outputFile = existingFile?.id
        ? await drive.files.update({
            fileId: existingFile.id,
            media: { mimeType: "video/mp4", body: createReadStream(outputPath) },
            fields: "id,webViewLink",
            supportsAllDrives: true,
          })
        : await drive.files.create({
            requestBody: {
              name: outputName,
              mimeType: "video/mp4",
              parents: [compositeFolder.id],
            },
            media: { mimeType: "video/mp4", body: createReadStream(outputPath) },
            fields: "id,webViewLink",
            supportsAllDrives: true,
          });
      const outputFileId = String(outputFile.data.id ?? "");
      console.log(JSON.stringify({
        event: "MV_DUET_BASE_COMPOSITE_UPLOAD_COMPLETED",
        project_id: transition.project_id,
        render_unit_id: "RP015",
        elapsed_ms: Date.now() - executionStartedAt,
      }));
      if (!outputFileId) {
        throw new ProjectRegistryInvalidStateError("Drive không trả output file ID RP015");
      }
      const outputFileUrl =
        outputFile.data.webViewLink ??
        `https://drive.google.com/file/d/${outputFileId}/view`;
      const executedAt = new Date().toISOString();
      const result: ExecutedMvDuetBaseComposite = {
        project_id: transition.project_id,
        current_stage: "PRE_PRODUCTION",
        next_action: "REVIEW_MV_DUET_BASE_COMPOSITE",
        job_id: transition.job_id,
        job_status: "SUCCEEDED",
        output_file_id: outputFileId,
        output_file_url: outputFileUrl,
        duration_seconds: probe.duration_seconds,
        width: probe.width,
        height: probe.height,
        source_offsets: probe.source_offsets,
        source_durations: probe.source_durations,
        provider_execution_allowed: false,
        render_allowed: false,
        executed_at: executedAt,
        idempotent_replay: false,
      };
      const updatedManifest = {
        ...manifest,
        composite_status: "EXECUTED_AWAITING_REVIEW",
        output_readiness: "AWAITING_OWNER_REVIEW",
        composite_execution_allowed: false,
        provider_execution_allowed: false,
        render_allowed: false,
        output: {
          file_id: outputFileId,
          file_url: outputFileUrl,
          mime_type: "video/mp4",
          width: probe.width,
          height: probe.height,
          duration_seconds: probe.duration_seconds,
          source_offsets: probe.source_offsets,
          source_durations: probe.source_durations,
          master_timeline: {
            render_unit_id: "RP015",
            start_seconds: 362,
            duration_seconds: probe.duration_seconds,
          },
        },
        review_gate: {
          review_status: "PENDING",
          next_action: result.next_action,
        },
        executed_at: executedAt,
      };
      await drive.files.update({
        fileId: transition.manifest_file_id,
        media: {
          mimeType: "application/json",
          body: Readable.from([`${JSON.stringify(updatedManifest, null, 2)}\n`]),
        },
        fields: "id,modifiedTime",
        supportsAllDrives: true,
      });

      const projectRow = projectIndex + 1;
      const jobRow = jobIndex + 1;
      const auditRow = (auditResponse.data.values ?? []).length + 1;
      const outputIds = [
        transition.manifest_file_id,
        outputFileId,
      ];
      executionStage = "PERSISTING_RESULT";
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            {
              range: `'PROJECTS'!S${projectRow}:T${projectRow}`,
              values: [["PRE_PRODUCTION", result.next_action]],
            },
            {
              range: `'PROJECTS'!X${projectRow}`,
              values: [[executedAt]],
            },
            {
              range: `'PRODUCTION_JOBS'!E${jobRow}:J${jobRow}`,
              values: [[
                result.job_status,
                "",
                String(jobs[jobIndex][6] ?? "[]"),
                JSON.stringify(outputIds),
                JSON.stringify(result),
                Number(jobs[jobIndex][9] ?? 0) + 1,
              ]],
            },
            {
              range: `'PRODUCTION_JOBS'!L${jobRow}:N${jobRow}`,
              values: [[executedAt, String(jobs[jobIndex][12] ?? ""), executedAt]],
            },
            {
              range: `'AUDIT_LOG'!A${auditRow}:H${auditRow}`,
              values: [[
                randomUUID(),
                transition.project_id,
                transition.submission_id,
                "MV_DUET_BASE_COMPOSITE_EXECUTED",
                "SUCCEEDED",
                "AI_EXECUTOR_WEB",
                "Đã dựng local RP015 9.62 giây từ hai nguồn riêng; chờ chủ dự án review. Không gọi Runway.",
                executedAt,
              ]],
            },
          ],
        },
      });
      executionStage = "COMPLETED";
      console.log(JSON.stringify({
        event: "MV_DUET_BASE_COMPOSITE_COMPLETED",
        project_id: transition.project_id,
        render_unit_id: "RP015",
        elapsed_ms: Date.now() - executionStartedAt,
      }));
      return result;
    } catch (error) {
      const detail = (error instanceof Error ? error.message : String(error))
        .replace(/\/tmp\/[^\s'"]+/g, "<temporary-file>")
        .replace(/\s+/g, " ")
        .slice(0, 2_000);
      console.error(JSON.stringify({
        event: "MV_DUET_BASE_COMPOSITE_FAILED",
        project_id: projectId,
        render_unit_id: "RP015",
        stage: executionStage,
        elapsed_ms: Date.now() - executionStartedAt,
        error: detail,
      }));
      if (
        error instanceof ProjectRegistryNotConfiguredError ||
        error instanceof ProjectRegistryProjectNotFoundError ||
        error instanceof ProjectRegistryInvalidStateError
      ) throw error;
      throw new ProjectRegistryUnavailableError(
        error instanceof Error
          ? error.message
          : "Không dựng được base composite RP015",
      );
    } finally {
      if (temporaryDirectory) {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    }
  }


  async approveMvDuetBaseCompositeReview(
    projectId: string,
  ): Promise<ApprovedMvDuetBaseCompositeReview> {
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
      const projects = projectsResponse.data.values ?? [];
      const jobs = jobsResponse.data.values ?? [];
      const approvals = approvalsResponse.data.values ?? [];
      const projectIndex = projects.findIndex(
        (row, index) => index > 0 && String(row[1] ?? "").trim() === projectId,
      );
      if (projectIndex < 0) {
        throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      }
      const jobIndex = jobs.findIndex(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[3] ?? "").trim() === MV_DUET_BASE_COMPOSITE_JOB_TYPE,
      );
      const jobId = jobIndex > 0 ? String(jobs[jobIndex][0] ?? "").trim() : "";
      const executionApproval = approvals.find(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[2] ?? "").trim() === MV_DUET_BASE_COMPOSITE_JOB_TYPE &&
          String(row[3] ?? "").trim() === jobId,
      )?.map(String);
      const reviewApproval = approvals.find(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[2] ?? "").trim() === MV_DUET_BASE_COMPOSITE_REVIEW_APPROVAL_TYPE &&
          String(row[3] ?? "").trim() === jobId,
      )?.map(String);
      const transition = planMvDuetBaseCompositeReviewApproval(
        projects[projectIndex].map(String),
        jobIndex > 0 ? jobs[jobIndex].map(String) : undefined,
        executionApproval,
        reviewApproval,
      );
      if (transition.idempotent_replay) {
        const { submission_id: _submissionId, manifest_file_id: _manifestFileId, ...result } = transition;
        return result;
      }
      const manifestResponse = await drive.files.get(
        { fileId: transition.manifest_file_id, alt: "media", supportsAllDrives: true },
        { responseType: "text" },
      );
      const manifest =
        typeof manifestResponse.data === "string"
          ? parseObject(manifestResponse.data, "MV_DUET_BASE_COMPOSITE manifest")
          : manifestResponse.data as Record<string, unknown>;
      const output = (manifest.output ?? {}) as Record<string, unknown>;
      const reviewGate = (manifest.review_gate ?? {}) as Record<string, unknown>;
      if (
        String(manifest.project_id ?? "") !== projectId ||
        String(manifest.composite_status ?? "") !== "EXECUTED_AWAITING_REVIEW" ||
        String(manifest.output_readiness ?? "") !== "AWAITING_OWNER_REVIEW" ||
        String(reviewGate.review_status ?? "") !== "PENDING" ||
        String(output.file_id ?? "") !== transition.output_file_id ||
        Number(output.width) !== 1920 ||
        Number(output.height) !== 1080 ||
        Math.abs(Number(output.duration_seconds) - 9.62) > 0.2 ||
        manifest.provider_execution_allowed !== false ||
        manifest.render_allowed !== false
      ) {
        throw new ProjectRegistryInvalidStateError(
          `Manifest RP015 của ${projectId} không ở trạng thái chờ review`,
        );
      }
      const approvedManifest = {
        ...manifest,
        composite_status: "PILOT_APPROVED",
        output_readiness: "APPROVED_PILOT_REFERENCE",
        composite_execution_allowed: false,
        provider_execution_allowed: false,
        render_allowed: false,
        review_gate: {
          review_status: "APPROVED",
          review_approval_id: transition.review_approval_id,
          approved_at: transition.approved_at,
          next_action: transition.next_action,
        },
        reviewed_at: transition.approved_at,
      };
      await drive.files.update({
        fileId: transition.manifest_file_id,
        media: {
          mimeType: "application/json",
          body: Readable.from([`${JSON.stringify(approvedManifest, null, 2)}\n`]),
        },
        fields: "id,modifiedTime",
        supportsAllDrives: true,
      });
      const projectRow = projectIndex + 1;
      const approvalRow = approvals.length + 1;
      const auditRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            {
              range: `'PROJECTS'!S${projectRow}:T${projectRow}`,
              values: [["PRE_PRODUCTION", transition.next_action]],
            },
            {
              range: `'PROJECTS'!X${projectRow}`,
              values: [[transition.approved_at]],
            },
            {
              range: `'APPROVALS'!A${approvalRow}:J${approvalRow}`,
              values: [[
                transition.review_approval_id,
                projectId,
                MV_DUET_BASE_COMPOSITE_REVIEW_APPROVAL_TYPE,
                transition.job_id,
                "APPROVED",
                "OWNER",
                transition.approved_at,
                "Chủ dự án duyệt Base Composite RP015 bản dựng thử.",
                transition.approved_at,
                transition.approved_at,
              ]],
            },
            {
              range: `'AUDIT_LOG'!A${auditRow}:H${auditRow}`,
              values: [[
                randomUUID(),
                projectId,
                transition.submission_id,
                "MV_DUET_BASE_COMPOSITE_REVIEW_APPROVED",
                "SUCCEEDED",
                "AI_EXECUTOR_WEB",
                "Chủ dự án đã duyệt RP015 làm pilot reference. Provider và render toàn bộ vẫn bị khóa.",
                transition.approved_at,
              ]],
            },
          ],
        },
      });
      const { submission_id: _submissionId, manifest_file_id: _manifestFileId, ...result } = transition;
      return result;
    } catch (error) {
      if (
        error instanceof ProjectRegistryNotConfiguredError ||
        error instanceof ProjectRegistryProjectNotFoundError ||
        error instanceof ProjectRegistryInvalidStateError
      ) throw error;
      throw new ProjectRegistryUnavailableError(
        error instanceof Error ? error.message : "Không duyệt được review Base Composite RP015",
      );
    }
  }

  async approveMvDuetBaseComposite(
    projectId: string,
  ): Promise<ApprovedMvDuetBaseComposite> {
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
      const projects = projectsResponse.data.values ?? [];
      const jobs = jobsResponse.data.values ?? [];
      const approvals = approvalsResponse.data.values ?? [];
      const projectIndex = projects.findIndex(
        (row, index) => index > 0 && String(row[1] ?? "").trim() === projectId,
      );
      if (projectIndex < 0) {
        throw new ProjectRegistryProjectNotFoundError(`Không tìm thấy project_id ${projectId}`);
      }
      const jobIndex = jobs.findIndex(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[3] ?? "").trim() === MV_DUET_BASE_COMPOSITE_JOB_TYPE,
      );
      const jobId = jobIndex > 0 ? String(jobs[jobIndex][0] ?? "").trim() : "";
      const approvalIndex = approvals.findIndex(
        (row, index) =>
          index > 0 &&
          String(row[1] ?? "").trim() === projectId &&
          String(row[2] ?? "").trim() === MV_DUET_BASE_COMPOSITE_JOB_TYPE &&
          String(row[3] ?? "").trim() === jobId,
      );
      const transition = planMvDuetBaseCompositeApproval(
        projects[projectIndex].map(String),
        jobIndex > 0 ? jobs[jobIndex].map(String) : undefined,
        approvalIndex > 0 ? approvals[approvalIndex].map(String) : undefined,
      );
      const result: ApprovedMvDuetBaseComposite = {
        project_id: transition.project_id,
        current_stage: transition.current_stage,
        next_action: transition.next_action,
        job_id: transition.job_id,
        job_status: transition.job_status,
        approval_id: transition.approval_id,
        approval_status: transition.approval_status,
        composite_execution_allowed: true,
        provider_execution_allowed: false,
        render_allowed: false,
        approved_at: transition.approved_at,
        idempotent_replay: transition.idempotent_replay,
      };
      if (transition.idempotent_replay) return result;

      await this.markMvDuetBaseCompositeManifestApproved(
        drive,
        jobs[jobIndex].map(String),
        transition,
      );
      const projectRow = projectIndex + 1;
      const jobRow = jobIndex + 1;
      const approvalRow = approvalIndex + 1;
      const auditRow = (auditResponse.data.values ?? []).length + 1;
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            {
              range: `'PROJECTS'!S${projectRow}:T${projectRow}`,
              values: [["PRE_PRODUCTION", transition.next_action]],
            },
            {
              range: `'PROJECTS'!X${projectRow}`,
              values: [[transition.approved_at]],
            },
            {
              range: `'PRODUCTION_JOBS'!E${jobRow}`,
              values: [[transition.job_status]],
            },
            {
              range: `'PRODUCTION_JOBS'!L${jobRow}`,
              values: [[transition.approved_at]],
            },
            {
              range: `'PRODUCTION_JOBS'!N${jobRow}`,
              values: [[transition.approved_at]],
            },
            {
              range: `'APPROVALS'!E${approvalRow}:H${approvalRow}`,
              values: [[
                transition.approval_status,
                "PROJECT_OWNER",
                transition.approved_at,
                "Đã duyệt base composite RP015 từ hai nguồn riêng; chỉ mở dựng composite cục bộ. Provider và render vẫn khóa.",
              ]],
            },
            {
              range: `'APPROVALS'!J${approvalRow}`,
              values: [[transition.approved_at]],
            },
            {
              range: `'AUDIT_LOG'!A${auditRow}:H${auditRow}`,
              values: [[
                randomUUID(),
                transition.project_id,
                transition.submission_id,
                "MV_DUET_BASE_COMPOSITE_APPROVED",
                "SUCCEEDED",
                "AI_EXECUTOR_WEB",
                "Đã duyệt dựng base composite RP015; chưa gọi Runway, provider_execution_allowed=false và render_allowed=false.",
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
          : "Không duyệt được base composite song ca MV",
      );
    }
  }

  private async markMvDuetBaseCompositeManifestApproved(
    drive: drive_v3.Drive,
    jobRow: string[],
    transition: ApprovedMvDuetBaseComposite,
  ) {
    const fileId = parseStringArray(jobRow[7])[0];
    if (!fileId) {
      throw new ProjectRegistryInvalidStateError(
        `Job ${transition.job_id} chưa có base composite manifest`,
      );
    }
    const response = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "text" },
    );
    const manifest =
      typeof response.data === "string"
        ? parseObject(response.data, "MV_DUET_BASE_COMPOSITE manifest")
        : response.data as Record<string, unknown>;
    const sources = Array.isArray(manifest.source_videos)
      ? manifest.source_videos as Array<Record<string, unknown>>
      : [];
    const tuongVy = sources.find(
      (source) => String(source.character_id ?? "") === "GDTH-CHAR-001",
    );
    const phuongAn = sources.find(
      (source) => String(source.character_id ?? "") === "GDTH-CHAR-002",
    );
    if (
      String(manifest.project_id ?? "") !== transition.project_id ||
      String(manifest.composite_status ?? "") !== "AWAITING_APPROVAL" ||
      String(manifest.output_readiness ?? "") !== "BLOCKED_PENDING_COMPOSITE_APPROVAL" ||
      manifest.composite_execution_allowed !== false ||
      manifest.provider_execution_allowed !== false ||
      manifest.render_allowed !== false ||
      sources.length !== 2 ||
      !tuongVy ||
      !phuongAn ||
      String(tuongVy.file_id ?? "") === String(phuongAn.file_id ?? "") ||
      tuongVy.close_up_allowed !== false ||
      tuongVy.preserve_microphone !== true
    ) {
      throw new ProjectRegistryInvalidStateError(
        `Base composite của ${transition.project_id} chưa an toàn để duyệt`,
      );
    }
    const approved = {
      ...manifest,
      composite_status: "APPROVED",
      output_readiness: "READY_FOR_LOCAL_COMPOSITE_EXECUTION",
      composite_execution_allowed: true,
      provider_execution_allowed: false,
      render_allowed: false,
      approval_gate: {
        approval_status: "APPROVED",
        reviewer: "PROJECT_OWNER",
        approved_at: transition.approved_at,
        next_action: transition.next_action,
      },
    };
    await drive.files.update({
      fileId,
      media: {
        mimeType: "application/json",
        body: Readable.from([`${JSON.stringify(approved, null, 2)}\n`]),
      },
      fields: "id,modifiedTime",
      supportsAllDrives: true,
    });
  }

  private async markMvProviderSubmissionManifestApproved(drive: drive_v3.Drive, jobRow: string[], transition: ApprovedMvProviderSubmission) {
    const fileId = parseStringArray(jobRow[7])[0];
    if (!fileId) throw new ProjectRegistryInvalidStateError(`Job ${transition.job_id} chưa có provider submission manifest`);
    const response = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "text" });
    const manifest = typeof response.data === "string" ? parseObject(response.data, "MV_PROVIDER_SUBMISSION manifest") : response.data as Record<string, unknown>;
    const payloads = Array.isArray(manifest.provider_payloads) ? manifest.provider_payloads as Array<Record<string, unknown>> : [];
    const safe = payloads.length === 15 && payloads.every((payload) => String(payload.submission_status) === "BLOCKED_PENDING_PROVIDER_APPROVAL" && payload.provider_execution_allowed === false && payload.render_allowed === false);
    if (String(manifest.project_id) !== transition.project_id || String(manifest.submission_status) !== "AWAITING_APPROVAL" || manifest.provider_execution_allowed !== false || manifest.render_allowed !== false || !safe) {
      throw new ProjectRegistryInvalidStateError(`Provider submission của ${transition.project_id} chưa an toàn để duyệt`);
    }
    const approved = { ...manifest, submission_status: "APPROVED", provider_submission_authorized: true, provider_execution_allowed: false, render_allowed: false, provider_payloads: payloads.map((payload) => ({ ...payload, submission_status: "READY_PENDING_EXPLICIT_SUBMIT", provider_execution_allowed: false, render_allowed: false })), approval_gate: { approval_status: "APPROVED", reviewer: "PROJECT_OWNER", approved_at: transition.approved_at, next_action: transition.next_action } };
    await drive.files.update({ fileId, media: { mimeType: "application/json", body: Readable.from([`${JSON.stringify(approved, null, 2)}\n`]) }, fields: "id,modifiedTime", supportsAllDrives: true });
  }

  private async markMvRenderExecutionManifestApproved(drive: drive_v3.Drive, jobRow: string[], transition: ApprovedMvRenderExecution) {
    const fileId = parseStringArray(jobRow[7])[0];
    if (!fileId) throw new ProjectRegistryInvalidStateError(`Job ${transition.job_id} chưa có manifest thực thi`);
    const response = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "text" });
    const manifest = typeof response.data === "string" ? parseObject(response.data, "MV_RENDER_EXECUTION manifest") : response.data as Record<string, unknown>;
    const units = Array.isArray(manifest.render_units) ? manifest.render_units as Array<Record<string, unknown>> : [];
    const safe = units.length === 15 && units.every((unit) => String(unit.execution_status) === "BLOCKED_PENDING_EXECUTION_APPROVAL" && unit.provider_execution_allowed === false && unit.render_allowed === false);
    if (String(manifest.project_id) !== transition.project_id || String(manifest.execution_status) !== "AWAITING_APPROVAL" || manifest.provider_execution_allowed !== false || manifest.render_allowed !== false || !safe) {
      throw new ProjectRegistryInvalidStateError(`Manifest thực thi của ${transition.project_id} chưa an toàn để duyệt`);
    }
    const approved = { ...manifest, execution_status: "APPROVED", execution_authorized: true, provider_execution_allowed: false, render_allowed: false, render_units: units.map((unit) => ({ ...unit, execution_status: "BLOCKED_PENDING_PROVIDER_SUBMISSION", provider_execution_allowed: false, render_allowed: false })), approval_gate: { approval_status: "APPROVED", reviewer: "PROJECT_OWNER", approved_at: transition.approved_at, next_action: transition.next_action } };
    await drive.files.update({ fileId, media: { mimeType: "application/json", body: Readable.from([`${JSON.stringify(approved, null, 2)}\n`]) }, fields: "id,modifiedTime", supportsAllDrives: true });
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
