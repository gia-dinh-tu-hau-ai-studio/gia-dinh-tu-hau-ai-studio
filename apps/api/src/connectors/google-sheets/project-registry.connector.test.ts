import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProjectIntake } from "@tu-hau/contracts";
import {
  applyMvAssetCharacterSafetyLocks,
  buildMvRenderPlanManifest,
  buildMvRenderExecutionManifest,
  buildMvProviderSubmissionManifest,
  buildMvProviderPilotManifest,
  buildMvDuetBaseCompositeManifest,
  buildMvDuetBaseCompositeRolloutManifest,
  buildMvTimecodeAlignmentManifest,
  assertProjectFolderWithinRoot,
  buildProjectId,
  normalizeDriveFileIdInput,
  planContractApproval,
  planMvAssetApproval,
  planMvAssetPreparation,
  planMvProductionPlanApproval,
  planMvProductionPreparation,
  planMvRenderPlanApproval,
  planMvRenderExecutionApproval,
  planMvProviderSubmissionApproval,
  planMvDuetBaseCompositeApproval,
  planMvDuetBaseCompositeExecution,
  planMvDuetBaseCompositeReviewApproval,
  planMvDuetBaseCompositeRolloutApproval,
  selectNextMvDuetBaseCompositeRolloutUnit,
  planMvShotPlanApproval,
  planMvTimecodeAlignmentApproval,
  ProjectRegistryInvalidStateError,
} from "./project-registry.connector";
import {
  buildMvDuetBaseCompositeFfmpegArgs,
  buildRp015FinalProofFfmpegArgs,
  RP015_DURATION_SECONDS,
  RP015_FFMPEG_TIMEOUT_MS,
  RP015_PHUONG_AN_SOURCE_START_SECONDS,
  RP015_START_SECONDS,
  RP015_TUONG_VY_SOURCE_START_SECONDS,
  RP015_MASTER_AUDIO_START_SECONDS,
  selectRolloutSourceOffset,
} from "../../media/mv-duet-base-composite.executor";

function pendingMvRenderPlanRows() {
  const project = approvedMvProjectRow();
  project[19] = "APPROVE_MV_RENDER_PLAN";
  const job = Array.from({ length: 14 }, () => "");
  job[0] = "job-render-plan-001";
  job[1] = project[1];
  job[2] = "PRE_PRODUCTION";
  job[3] = "MV_RENDER_PLAN";
  job[4] = "AWAITING_APPROVAL";
  job[7] = '["render-plan-manifest-file-id"]';
  const approval = Array.from({ length: 10 }, () => "");
  approval[0] = "approval-render-plan-001";
  approval[1] = project[1];
  approval[2] = "MV_RENDER_PLAN";
  approval[3] = job[0];
  approval[4] = "PENDING";
  return { project, job, approval };
}

test("duyệt render plan chuyển sang chuẩn bị thực thi nhưng chưa render", () => {
  const { project, job, approval } = pendingMvRenderPlanRows();
  const result = planMvRenderPlanApproval(
    project,
    job,
    approval,
    new Date("2026-08-06T12:45:00.000Z"),
  );
  assert.equal(result.next_action, "PREPARE_MV_RENDER_EXECUTION");
  assert.equal(result.job_status, "APPROVED");
  assert.equal(result.approval_status, "APPROVED");
  assert.equal(result.idempotent_replay, false);
});

test("duyệt lại render plan đã APPROVED là idempotent", () => {
  const { project, job, approval } = pendingMvRenderPlanRows();
  project[19] = "PREPARE_MV_RENDER_EXECUTION";
  job[4] = "APPROVED";
  approval[4] = "APPROVED";
  approval[6] = "2026-08-06T12:45:00.000Z";
  const result = planMvRenderPlanApproval(project, job, approval);
  assert.equal(result.idempotent_replay, true);
  assert.equal(result.approved_at, "2026-08-06T12:45:00.000Z");
});

test("từ chối duyệt render plan khi job và approval không đồng bộ", () => {
  const { project, job, approval } = pendingMvRenderPlanRows();
  job[4] = "APPROVED";
  assert.throws(
    () => planMvRenderPlanApproval(project, job, approval),
    ProjectRegistryInvalidStateError,
  );
});

test("duyệt thực thi render chuyển sang chuẩn bị provider nhưng chưa gọi provider", () => {
  const project = approvedMvProjectRow(); project[19] = "APPROVE_MV_RENDER_EXECUTION";
  const job = Array.from({ length: 14 }, () => ""); Object.assign(job, { 0: "job-exec", 1: project[1], 2: "PRE_PRODUCTION", 3: "MV_RENDER_EXECUTION", 4: "AWAITING_APPROVAL" });
  const approval = Array.from({ length: 10 }, () => ""); Object.assign(approval, { 0: "approval-exec", 1: project[1], 2: "MV_RENDER_EXECUTION", 3: "job-exec", 4: "PENDING" });
  const result = planMvRenderExecutionApproval(project, job, approval, new Date("2026-08-06T14:30:00.000Z"));
  assert.equal(result.next_action, "PREPARE_MV_PROVIDER_SUBMISSION");
  assert.equal(result.job_status, "APPROVED"); assert.equal(result.approval_status, "APPROVED");
});

function pendingMvProviderSubmissionRows() {
  const project = approvedMvProjectRow(); project[19] = "APPROVE_MV_PROVIDER_SUBMISSION";
  const job = Array.from({ length: 14 }, () => "");
  Object.assign(job, { 0: "job-provider", 1: project[1], 2: "PRE_PRODUCTION", 3: "MV_PROVIDER_SUBMISSION", 4: "AWAITING_APPROVAL" });
  const approval = Array.from({ length: 10 }, () => "");
  Object.assign(approval, { 0: "approval-provider", 1: project[1], 2: "MV_PROVIDER_SUBMISSION", 3: job[0], 4: "PENDING" });
  return { project, job, approval };
}

test("duyệt provider submission chỉ mở bước submit riêng", () => {
  const { project, job, approval } = pendingMvProviderSubmissionRows();
  const result = planMvProviderSubmissionApproval(project, job, approval, new Date("2026-08-06T15:10:00.000Z"));
  assert.equal(result.next_action, "SUBMIT_MV_PROVIDER_JOBS");
  assert.equal(result.job_status, "APPROVED");
  assert.equal(result.approval_status, "APPROVED");
  assert.equal(result.idempotent_replay, false);
});

test("duyệt lại provider submission đã APPROVED là idempotent", () => {
  const { project, job, approval } = pendingMvProviderSubmissionRows();
  project[19] = "SUBMIT_MV_PROVIDER_JOBS"; job[4] = "APPROVED"; approval[4] = "APPROVED";
  approval[6] = "2026-08-06T15:10:00.000Z";
  const result = planMvProviderSubmissionApproval(project, job, approval);
  assert.equal(result.idempotent_replay, true);
  assert.equal(result.approved_at, "2026-08-06T15:10:00.000Z");
});

test("từ chối duyệt provider submission khi job và approval lệch trạng thái", () => {
  const { project, job, approval } = pendingMvProviderSubmissionRows();
  job[4] = "APPROVED";
  assert.throws(() => planMvProviderSubmissionApproval(project, job, approval), ProjectRegistryInvalidStateError);
});

function approvedTimecodeManifest() {
  const manifest = buildMvTimecodeAlignmentManifest(
    "GDTH-MV-20260804092100-63D8",
    "Gia Đình Tư Hậu",
    "beat-master-file-id",
    "shot-plan-file-id",
    [{ character_id: "GDTH-CHAR-001", close_up_allowed: false }],
    "2026-08-06T10:30:00.000Z",
  );
  return {
    ...manifest,
    alignment_status: "APPROVED",
    approval_gate: {
      approval_status: "APPROVED",
      reviewer: "PROJECT_OWNER",
      approved_at: "2026-08-06T11:50:00.000Z",
      next_action: "PREPARE_MV_RENDER_PLAN",
    },
  };
}

test("render plan MV tạo đủ 15 đơn vị và vẫn khóa provider/render", () => {
  const manifest = buildMvRenderPlanManifest(
    "GDTH-MV-20260804092100-63D8",
    "Gia Đình Tư Hậu",
    "timecode-manifest-file-id",
    approvedTimecodeManifest(),
    "2026-08-06T12:00:00.000Z",
  );
  assert.equal(manifest.render_units.length, 15);
  assert.equal(manifest.render_units[0].start_seconds, 0);
  assert.equal(manifest.render_units.at(-1)?.end_seconds, 371.62);
  assert.ok(
    manifest.render_units.every(
      (unit) =>
        unit.execution_status === "BLOCKED_PENDING_APPROVAL" &&
        unit.provider_execution_allowed === false &&
        unit.render_allowed === false,
    ),
  );
  assert.equal(manifest.provider_execution_allowed, false);
  assert.equal(manifest.render_allowed, false);
  assert.equal(manifest.approval_gate.approval_status, "PENDING");
  assert.equal(manifest.approval_gate.next_action, "APPROVE_MV_RENDER_PLAN");
});

test("hồ sơ thực thi render tạo đủ 15 units và tiếp tục khóa provider/render", () => {
  const pending = buildMvRenderPlanManifest(
    "GDTH-MV-20260804092100-63D8", "Gia Đình Tư Hậu", "timecode-file",
    approvedTimecodeManifest(), "2026-08-06T12:00:00.000Z",
  );
  const approved = {
    ...pending,
    render_plan_status: "APPROVED",
    render_units: pending.render_units.map((unit) => ({ ...unit, execution_status: "BLOCKED_PENDING_EXECUTION_PREPARATION" })),
  };
  const result = buildMvRenderExecutionManifest(
    "GDTH-MV-20260804092100-63D8", "Gia Đình Tư Hậu", "render-plan-file", approved,
    "2026-08-06T14:00:00.000Z",
  );
  assert.equal(result.render_units.length, 15);
  assert.ok(result.render_units.every((unit) => unit.execution_status === "BLOCKED_PENDING_EXECUTION_APPROVAL" && unit.provider_execution_allowed === false && unit.render_allowed === false));
  assert.equal(result.approval_gate.next_action, "APPROVE_MV_RENDER_EXECUTION");
});

test("gói provider submission tạo 15 payload nhưng chưa gọi Runway", () => {
  const pendingPlan = buildMvRenderPlanManifest(
    "GDTH-MV-20260804092100-63D8", "Gia Đình Tư Hậu", "timecode-file",
    approvedTimecodeManifest(), "2026-08-06T12:00:00.000Z",
  );
  const approvedPlan = {
    ...pendingPlan,
    render_plan_status: "APPROVED",
    render_units: pendingPlan.render_units.map((unit) => ({ ...unit, execution_status: "BLOCKED_PENDING_EXECUTION_PREPARATION" })),
  };
  const pendingExecution = buildMvRenderExecutionManifest(
    "GDTH-MV-20260804092100-63D8", "Gia Đình Tư Hậu", "render-plan-file",
    approvedPlan, "2026-08-06T14:00:00.000Z",
  );
  const approvedExecution = {
    ...pendingExecution,
    execution_status: "APPROVED",
    execution_authorized: true,
    render_units: pendingExecution.render_units.map((unit) => ({ ...unit, execution_status: "BLOCKED_PENDING_PROVIDER_SUBMISSION" })),
  };
  const result = buildMvProviderSubmissionManifest(
    "GDTH-MV-20260804092100-63D8", "Gia Đình Tư Hậu", "execution-file",
    approvedExecution, "2026-08-06T15:00:00.000Z",
  );
  assert.equal(result.provider.name, "RUNWAY");
  assert.equal(result.provider.submission_mode, "API_AFTER_EXPLICIT_APPROVAL");
  assert.equal(result.provider_payloads.length, 15);
  assert.ok(result.provider_payloads.every((unit) => unit.submission_status === "BLOCKED_PENDING_PROVIDER_APPROVAL" && unit.provider_execution_allowed === false && unit.render_allowed === false));
  assert.equal(result.approval_gate.next_action, "APPROVE_MV_PROVIDER_SUBMISSION");
});

test("provider submission từ chối mở cận mặt Tường Vy", () => {
  const pendingPlan = buildMvRenderPlanManifest(
    "GDTH-MV-20260804092100-63D8", "Gia Đình Tư Hậu", "timecode-file",
    approvedTimecodeManifest(), "2026-08-06T12:00:00.000Z",
  );
  const approvedPlan = { ...pendingPlan, render_plan_status: "APPROVED", render_units: pendingPlan.render_units.map((unit) => ({ ...unit, execution_status: "BLOCKED_PENDING_EXECUTION_PREPARATION" })) };
  const pending = buildMvRenderExecutionManifest("GDTH-MV-20260804092100-63D8", "Gia Đình Tư Hậu", "plan-file", approvedPlan, "2026-08-06T14:00:00.000Z");
  const units: Array<Record<string, unknown>> = pending.render_units.map((unit) => ({ ...unit, execution_status: "BLOCKED_PENDING_PROVIDER_SUBMISSION" }));
  const tuongVy = units.find((unit) => unit.performer === "TUONG_VY_EM");
  if (!tuongVy) assert.fail("Thiếu unit Tường Vy");
  tuongVy.framing_constraints = { ...(tuongVy.framing_constraints as Record<string, unknown>), close_up_allowed: true };
  assert.throws(() => buildMvProviderSubmissionManifest(
    "GDTH-MV-20260804092100-63D8", "Gia Đình Tư Hậu", "execution-file",
    { ...pending, execution_status: "APPROVED", execution_authorized: true, render_units: units },
    "2026-08-06T15:00:00.000Z",
  ), ProjectRegistryInvalidStateError);
});

test("provider pilot chỉ chọn một clip song ca RP015", () => {
  const pendingPlan = buildMvRenderPlanManifest(
    "GDTH-MV-20260804092100-63D8", "Gia Đình Tư Hậu", "timecode-file",
    approvedTimecodeManifest(), "2026-08-06T12:00:00.000Z",
  );
  const approvedPlan = { ...pendingPlan, render_plan_status: "APPROVED", render_units: pendingPlan.render_units.map((unit) => ({ ...unit, execution_status: "BLOCKED_PENDING_EXECUTION_PREPARATION" })) };
  const pendingExecution = buildMvRenderExecutionManifest("GDTH-MV-20260804092100-63D8", "Gia Đình Tư Hậu", "plan-file", approvedPlan, "2026-08-06T14:00:00.000Z");
  const approvedExecution = { ...pendingExecution, execution_status: "APPROVED", execution_authorized: true, render_units: pendingExecution.render_units.map((unit) => ({ ...unit, execution_status: "BLOCKED_PENDING_PROVIDER_SUBMISSION" })) };
  const pendingSubmission = buildMvProviderSubmissionManifest("GDTH-MV-20260804092100-63D8", "Gia Đình Tư Hậu", "execution-file", approvedExecution, "2026-08-06T15:00:00.000Z");
  const approvedSubmission = { ...pendingSubmission, submission_status: "APPROVED", provider_submission_authorized: true, provider_payloads: pendingSubmission.provider_payloads.map((payload) => ({ ...payload, submission_status: "READY_PENDING_EXPLICIT_SUBMIT" })) };
  const result = buildMvProviderPilotManifest("GDTH-MV-20260804092100-63D8", "Gia Đình Tư Hậu", "submission-file", approvedSubmission, "2026-08-06T15:30:00.000Z");
  assert.equal(result.provider.model, "aleph2");
  assert.equal(result.provider_tasks.length, 1);
  assert.equal(result.provider_tasks[0].source_render_unit_id, "RP015");
  assert.equal(result.provider_tasks[0].performer, "SONG_CA");
  assert.equal(result.provider_tasks[0].duration_seconds, 9.62);
  assert.equal(result.estimated_credits, 270);
  assert.equal(result.estimated_cost_usd, 2.7);
  assert.equal(result.provider_tasks[0].provider_execution_allowed, false);
  assert.equal(result.provider_tasks[0].render_allowed, false);
  assert.equal(result.input_readiness, "BLOCKED_MISSING_MEDIA_AND_PROMPT");
  assert.equal(result.approval_gate.next_action, "APPROVE_MV_PROVIDER_PILOT");
});

test("base composite dùng đúng hai nguồn riêng và giữ khóa Tường Vy", () => {
  const pendingPlan = buildMvRenderPlanManifest(
    "GDTH-MV-20260804092100-63D8", "Gia Đình Tư Hậu", "timecode-file",
    approvedTimecodeManifest(), "2026-08-06T12:00:00.000Z",
  );
  const approvedPlan = { ...pendingPlan, render_plan_status: "APPROVED", render_units: pendingPlan.render_units.map((unit) => ({ ...unit, execution_status: "BLOCKED_PENDING_EXECUTION_PREPARATION" })) };
  const pendingExecution = buildMvRenderExecutionManifest("GDTH-MV-20260804092100-63D8", "Gia Đình Tư Hậu", "plan-file", approvedPlan, "2026-08-06T14:00:00.000Z");
  const approvedExecution = { ...pendingExecution, execution_status: "APPROVED", execution_authorized: true, render_units: pendingExecution.render_units.map((unit) => ({ ...unit, execution_status: "BLOCKED_PENDING_PROVIDER_SUBMISSION" })) };
  const pendingSubmission = buildMvProviderSubmissionManifest("GDTH-MV-20260804092100-63D8", "Gia Đình Tư Hậu", "execution-file", approvedExecution, "2026-08-06T15:00:00.000Z");
  const approvedSubmission = { ...pendingSubmission, submission_status: "APPROVED", provider_submission_authorized: true, provider_payloads: pendingSubmission.provider_payloads.map((payload) => ({ ...payload, submission_status: "READY_PENDING_EXPLICIT_SUBMIT" })) };
  const pilot = buildMvProviderPilotManifest("GDTH-MV-20260804092100-63D8", "Gia Đình Tư Hậu", "submission-file", approvedSubmission, "2026-08-06T15:30:00.000Z");
  const assets = {
    project_id: "GDTH-MV-20260804092100-63D8",
    source_assets: { character_sources: [
      { character_id: "GDTH-CHAR-001", character_name: "Tường Vy", file_id: "tuong-vy-video", mime_type: "video/mp4" },
      { character_id: "GDTH-CHAR-002", character_name: "Phương An", file_id: "phuong-an-video", mime_type: "video/mp4" },
    ] },
  };
  const result = buildMvDuetBaseCompositeManifest("GDTH-MV-20260804092100-63D8", "Gia Đình Tư Hậu", "pilot-file", pilot, "asset-file", assets, "2026-08-06T16:00:00.000Z");
  assert.equal(result.source_videos.length, 2);
  assert.equal(result.target.source_render_unit_id, "RP015");
  assert.equal(result.target.duration_seconds, 9.62);
  assert.equal(result.source_videos[0].character_id, "GDTH-CHAR-001");
  assert.equal(result.source_videos[0].close_up_allowed, false);
  assert.equal(result.source_videos[0].preserve_microphone, true);
  assert.equal(result.composite_execution_allowed, false);
  assert.equal(result.provider_execution_allowed, false);
  assert.equal(result.render_allowed, false);
  assert.equal(result.approval_gate.next_action, "APPROVE_MV_DUET_BASE_COMPOSITE");
});

test("từ chối base composite khi hai nhân vật dùng cùng một file nguồn", () => {
  const pilot = {
    project_id: "GDTH-MV-20260804092100-63D8", pilot_status: "AWAITING_APPROVAL",
    provider_execution_allowed: false, render_allowed: false,
    provider_tasks: [{ source_render_unit_id: "RP015", performer: "SONG_CA", duration_seconds: 9.62, input_video_status: "REQUIRED_NOT_UPLOADED", framing_constraints: { close_up_allowed: false, preserve_microphone: true } }],
  };
  const assets = { project_id: "GDTH-MV-20260804092100-63D8", source_assets: { character_sources: [
    { character_id: "GDTH-CHAR-001", file_id: "same-video", mime_type: "video/mp4" },
    { character_id: "GDTH-CHAR-002", file_id: "same-video", mime_type: "video/mp4" },
  ] } };
  assert.throws(() => buildMvDuetBaseCompositeManifest("GDTH-MV-20260804092100-63D8", "Gia Đình Tư Hậu", "pilot-file", pilot, "asset-file", assets, "2026-08-06T16:00:00.000Z"), ProjectRegistryInvalidStateError);
});

test("render plan khóa cận mặt Tường Vy trong cảnh riêng và song ca", () => {
  const manifest = buildMvRenderPlanManifest(
    "GDTH-MV-20260804092100-63D8",
    "Gia Đình Tư Hậu",
    "timecode-manifest-file-id",
    approvedTimecodeManifest(),
    "2026-08-06T12:00:00.000Z",
  );
  const tuongVyUnits = manifest.render_units.filter(
    (unit) => unit.performer === "TUONG_VY_EM" || unit.performer === "SONG_CA",
  );
  assert.ok(tuongVyUnits.length > 0);
  assert.ok(
    tuongVyUnits.every(
      (unit) =>
        unit.framing_constraints.close_up_allowed === false &&
        unit.framing_constraints.preserve_microphone === true &&
        unit.framing_constraints.allowed_framings.every(
          (framing) => framing === "MEDIUM" || framing === "FULL_BODY",
        ),
    ),
  );
});

test("render plan từ chối timecode bị hở", () => {
  const timecode = approvedTimecodeManifest();
  timecode.cues[1].start_seconds = 50;
  assert.throws(
    () =>
      buildMvRenderPlanManifest(
        "GDTH-MV-20260804092100-63D8",
        "Gia Đình Tư Hậu",
        "timecode-manifest-file-id",
        timecode,
        "2026-08-06T12:00:00.000Z",
      ),
    ProjectRegistryInvalidStateError,
  );
});

function pendingMvTimecodeRows() {
  const project = approvedMvProjectRow();
  project[19] = "APPROVE_MV_TIMECODE_ALIGNMENT";
  const job = Array.from({ length: 14 }, () => "");
  job[0] = "job-timecode-001";
  job[1] = project[1];
  job[2] = "PRE_PRODUCTION";
  job[3] = "MV_TIMECODE_ALIGNMENT";
  job[4] = "AWAITING_APPROVAL";
  job[7] = '["timecode-manifest-file-id"]';
  const approval = Array.from({ length: 10 }, () => "");
  approval[0] = "approval-timecode-001";
  approval[1] = project[1];
  approval[2] = "MV_TIMECODE_ALIGNMENT";
  approval[3] = job[0];
  approval[4] = "PENDING";
  return { project, job, approval };
}

test("duyệt timecode MV chuyển sang chuẩn bị render plan nhưng chưa render", () => {
  const { project, job, approval } = pendingMvTimecodeRows();
  const result = planMvTimecodeAlignmentApproval(project, job, approval, new Date("2026-08-06T11:30:00.000Z"));
  assert.equal(result.next_action, "PREPARE_MV_RENDER_PLAN");
  assert.equal(result.approval_status, "APPROVED");
  assert.equal(result.idempotent_replay, false);
});

test("duyệt lại timecode MV đã APPROVED là idempotent", () => {
  const { project, job, approval } = pendingMvTimecodeRows();
  project[19] = "PREPARE_MV_RENDER_PLAN";
  job[4] = "APPROVED";
  approval[4] = "APPROVED";
  approval[6] = "2026-08-06T11:30:00.000Z";
  assert.equal(planMvTimecodeAlignmentApproval(project, job, approval).idempotent_replay, true);
});

test("từ chối duyệt timecode MV khi job và approval không đồng bộ", () => {
  const { project, job, approval } = pendingMvTimecodeRows();
  job[4] = "APPROVED";
  assert.throws(() => planMvTimecodeAlignmentApproval(project, job, approval), ProjectRegistryInvalidStateError);
});

test("timecode MV phủ đủ 06:11.62, liên tục và giữ khóa Tường Vy", () => {
  const manifest = buildMvTimecodeAlignmentManifest(
    "GDTH-MV-20260804092100-63D8",
    "Gia Đình Tư Hậu",
    "beat-master-file-id",
    "shot-plan-file-id",
    [{ character_id: "GDTH-CHAR-001", close_up_allowed: false }],
    "2026-08-06T10:30:00.000Z",
  );
  assert.equal(manifest.sections.length, 6);
  assert.equal(manifest.cues.length, 15);
  assert.equal(manifest.cues[0].start_seconds, 0);
  assert.equal(manifest.cues.at(-1)?.end_seconds, 371.62);
  for (let index = 1; index < manifest.cues.length; index += 1) {
    assert.equal(manifest.cues[index].start_seconds, manifest.cues[index - 1].end_seconds);
  }
  const tuongVyCues = manifest.cues.filter((cue) => cue.performer === "TUONG_VY_EM");
  assert.ok(tuongVyCues.length > 0);
  assert.ok(tuongVyCues.every((cue) => cue.framing_constraints?.close_up_allowed === false));
  assert.equal(manifest.provider_execution_allowed, false);
  assert.equal(manifest.render_allowed, false);
  assert.equal(manifest.approval_gate.approval_status, "PENDING");
});

test("chỉ cho phép project folder nằm trong projects root", () => {
  assert.doesNotThrow(() =>
    assertProjectFolderWithinRoot(
      {
        id: "project-folder-id",
        mimeType: "application/vnd.google-apps.folder",
        parents: ["projects-root-id"],
        trashed: false,
      },
      "projects-root-id",
      "GDTH-MV-20260804092100-63D8",
    ),
  );
});

test("từ chối project folder nằm ngoài projects root", () => {
  assert.throws(
    () =>
      assertProjectFolderWithinRoot(
        {
          id: "other-folder-id",
          mimeType: "application/vnd.google-apps.folder",
          parents: ["other-root-id"],
          trashed: false,
        },
        "projects-root-id",
        "GDTH-MV-20260804092100-63D8",
      ),
    ProjectRegistryInvalidStateError,
  );
});

test("tạo mã dự án MV Gia Đình Tư Hậu", () => {
  const contract = normalizeProjectIntake({
    project_name: "MV Gia Đình Tư Hậu", project_type: "MUSIC_VIDEO",
    client_name: "Gia Đình Tư Hậu", phone: "0900000000", email: "studio@example.com",
    platforms: ["YOUTUBE"], language: "vi", content_rating: "T13",
    target_audience: "Đại chúng", duration_target: "4 phút", aspect_ratio: "16:9",
    characters: [{
      character_id: "GDTH-CHAR-001", project_role: "MAIN", performance_role: "SINGER",
      selected_costume_ids: [], voice_required: false, lip_sync_required: true,
      identity_mode: "ORIGINAL_FACE_COMPOSITE", original_video_file_id: "drive-video-id",
    }],
    song_title: "Gia Đình Tư Hậu", song_topic: "Tình thân", music_genre: "Dân ca Nam Bộ",
    lyrics_source_mode: "USER_PROVIDED_LOCKED", lyrics: "Lời đã duyệt",
    music_source_mode: "NEW_STUDIO_PRODUCTION", vocal_source_mode: "REAL_RECORDED_VOCAL",
    visual_direction: "Người thật, miền Tây cinematic",
  });
  assert.equal(buildProjectId(contract, new Date("2026-08-04T01:02:03.000Z"), "ABCD"),
    "GDTH-MV-20260804010203-ABCD");
});

function projectRow(overrides: Record<number, string> = {}) {
  const row = Array.from({ length: 25 }, () => "");
  row[0] = "submission-001";
  row[1] = "GDTH-MV-20260804092100-63D8";
  row[16] = "CONFIRMED";
  row[17] = "PENDING";
  row[18] = "CONTRACT";
  row[19] = "APPROVE_CONTRACT";
  Object.entries(overrides).forEach(([index, value]) => {
    row[Number(index)] = value;
  });
  return row;
}

test("duyệt hợp đồng chuyển dự án MV sang PRE_PRODUCTION", () => {
  const approvedAt = new Date("2026-08-04T09:30:00.000Z");
  assert.deepEqual(planContractApproval(projectRow(), approvedAt), {
    project_id: "GDTH-MV-20260804092100-63D8",
    approval_status: "APPROVED",
    current_stage: "PRE_PRODUCTION",
    next_action: "PREPARE_MV_PRODUCTION",
    approved_at: "2026-08-04T09:30:00.000Z",
    idempotent_replay: false,
  });
});

test("duyệt lại hợp đồng đã APPROVED là idempotent", () => {
  const result = planContractApproval(projectRow({
    17: "APPROVED",
    18: "PRE_PRODUCTION",
    19: "PREPARE_MV_PRODUCTION",
    23: "2026-08-04T09:30:00.000Z",
  }));
  assert.equal(result.idempotent_replay, true);
  assert.equal(result.approved_at, "2026-08-04T09:30:00.000Z");
});

test("từ chối duyệt hợp đồng sai trạng thái", () => {
  assert.throws(
    () => planContractApproval(projectRow({ 16: "DRAFT" })),
    ProjectRegistryInvalidStateError,
  );
});

function approvedMvProjectRow(contractOverrides: Record<string, unknown> = {}) {
  const contract = {
    project_name: "Gia Đình Tư Hậu",
    project_type: "MUSIC_VIDEO",
    song_title: "Gia Đình Tư Hậu",
    visual_direction:
      "Người thật; ORIGINAL_FACE_COMPOSITE; Tường Vy tạm thời không dùng cận cảnh.",
    characters: [
      {
        character_id: "GDTH-CHAR-001",
        character_name: "Tường Vy",
        voice_required: true,
        voice_approval_status: "APPROVED",
        identity_mode: "ORIGINAL_FACE_COMPOSITE",
        original_video_file_id: "tuong-vy-video-id",
      },
      {
        character_id: "GDTH-CHAR-002",
        character_name: "Phương An",
        voice_required: true,
        voice_approval_status: "APPROVED",
        identity_mode: "ORIGINAL_FACE_COMPOSITE",
        original_video_file_id: "phuong-an-video-id",
      },
    ],
    ...contractOverrides,
  };
  return projectRow({
    2: "Gia Đình Tư Hậu",
    3: "MUSIC_VIDEO",
    17: "APPROVED",
    18: "PRE_PRODUCTION",
    19: "PREPARE_MV_PRODUCTION",
    20: "project-folder-id",
    24: JSON.stringify(contract),
  });
}

test("lập kế hoạch MV PRE_PRODUCTION chờ duyệt", () => {
  const preparedAt = new Date("2026-08-04T11:00:00.000Z");
  assert.deepEqual(
    planMvProductionPreparation(
      approvedMvProjectRow(),
      undefined,
      preparedAt,
      "job-preprod-001",
    ),
    {
      project_id: "GDTH-MV-20260804092100-63D8",
      submission_id: "submission-001",
      project_name: "Gia Đình Tư Hậu",
      project_folder_id: "project-folder-id",
      contract: JSON.parse(approvedMvProjectRow()[24]),
      job_id: "job-preprod-001",
      prepared_at: "2026-08-04T11:00:00.000Z",
      idempotent_replay: false,
    },
  );
});

test("lập lại kế hoạch MV đang chờ duyệt là idempotent", () => {
  const existingJob = Array.from({ length: 14 }, () => "");
  existingJob[0] = "job-preprod-001";
  existingJob[1] = "GDTH-MV-20260804092100-63D8";
  existingJob[3] = "MV_PRODUCTION_PLAN";
  existingJob[4] = "AWAITING_APPROVAL";
  existingJob[12] = "2026-08-04T11:00:00.000Z";
  const row = approvedMvProjectRow();
  row[19] = "APPROVE_MV_PRODUCTION_PLAN";
  const result = planMvProductionPreparation(row, existingJob);
  assert.equal(result.idempotent_replay, true);
  assert.equal(result.job_id, "job-preprod-001");
  assert.equal(result.prepared_at, "2026-08-04T11:00:00.000Z");
});

test("từ chối kế hoạch MV nếu không dùng ORIGINAL_FACE_COMPOSITE", () => {
  assert.throws(
    () =>
      planMvProductionPreparation(
        approvedMvProjectRow({
          characters: [
            {
              character_id: "GDTH-CHAR-001",
              identity_mode: "LIBRARY_MASTER",
              original_video_file_id: "tuong-vy-video-id",
            },
          ],
        }),
        undefined,
      ),
    ProjectRegistryInvalidStateError,
  );
});

test("từ chối kế hoạch MV khi dự án chưa ở PRE_PRODUCTION", () => {
  const row = approvedMvProjectRow();
  row[18] = "CONTRACT";
  assert.throws(
    () => planMvProductionPreparation(row, undefined),
    ProjectRegistryInvalidStateError,
  );
});

function pendingMvPlanRows() {
  const project = approvedMvProjectRow();
  project[19] = "APPROVE_MV_PRODUCTION_PLAN";

  const job = Array.from({ length: 14 }, () => "");
  job[0] = "job-preprod-001";
  job[1] = "GDTH-MV-20260804092100-63D8";
  job[2] = "PRE_PRODUCTION";
  job[3] = "MV_PRODUCTION_PLAN";
  job[4] = "AWAITING_APPROVAL";
  job[7] = '["manifest-file-id"]';

  const approval = Array.from({ length: 10 }, () => "");
  approval[0] = "approval-preprod-001";
  approval[1] = "GDTH-MV-20260804092100-63D8";
  approval[2] = "MV_PRODUCTION_PLAN";
  approval[3] = "job-preprod-001";
  approval[4] = "PENDING";

  return { project, job, approval };
}

test("duyệt kế hoạch MV chuyển sang chuẩn bị tài sản nhưng chưa render", () => {
  const { project, job, approval } = pendingMvPlanRows();
  assert.deepEqual(
    planMvProductionPlanApproval(
      project,
      job,
      approval,
      new Date("2026-08-04T14:30:00.000Z"),
    ),
    {
      submission_id: "submission-001",
      project_id: "GDTH-MV-20260804092100-63D8",
      current_stage: "PRE_PRODUCTION",
      next_action: "PREPARE_MV_ASSETS",
      job_id: "job-preprod-001",
      job_status: "APPROVED",
      approval_id: "approval-preprod-001",
      approval_status: "APPROVED",
      approved_at: "2026-08-04T14:30:00.000Z",
      idempotent_replay: false,
    },
  );
});

test("duyệt lại kế hoạch MV đã APPROVED là idempotent", () => {
  const { project, job, approval } = pendingMvPlanRows();
  project[19] = "PREPARE_MV_ASSETS";
  job[4] = "APPROVED";
  approval[4] = "APPROVED";
  approval[6] = "2026-08-04T14:30:00.000Z";

  const result = planMvProductionPlanApproval(project, job, approval);
  assert.equal(result.idempotent_replay, true);
  assert.equal(result.approved_at, "2026-08-04T14:30:00.000Z");
});

test("từ chối duyệt kế hoạch MV nếu job và approval không đồng bộ", () => {
  const { project, job, approval } = pendingMvPlanRows();
  job[4] = "APPROVED";
  assert.throws(
    () => planMvProductionPlanApproval(project, job, approval),
    ProjectRegistryInvalidStateError,
  );
});

test("chuẩn hóa Drive ID của beat từ link hoặc ID", () => {
  assert.equal(
    normalizeDriveFileIdInput(
      "https://drive.google.com/file/d/1k9sgXZfFwo42XY0Y0NoWKXUQ-CuA63M5/view?usp=sharing",
    ),
    "1k9sgXZfFwo42XY0Y0NoWKXUQ-CuA63M5",
  );
  assert.equal(
    normalizeDriveFileIdInput("1k9sgXZfFwo42XY0Y0NoWKXUQ-CuA63M5"),
    "1k9sgXZfFwo42XY0Y0NoWKXUQ-CuA63M5",
  );
  assert.throws(
    () => normalizeDriveFileIdInput("bad"),
    ProjectRegistryInvalidStateError,
  );
});

function approvedMvPlanForAssetPreparation() {
  const project = approvedMvProjectRow({
    lyrics: "https://docs.google.com/document/d/lyrics-master-file-id/edit",
  });
  project[19] = "PREPARE_MV_ASSETS";

  const planJob = Array.from({ length: 14 }, () => "");
  planJob[0] = "job-preprod-001";
  planJob[1] = "GDTH-MV-20260804092100-63D8";
  planJob[2] = "PRE_PRODUCTION";
  planJob[3] = "MV_PRODUCTION_PLAN";
  planJob[4] = "APPROVED";
  planJob[7] = '["plan-manifest-file-id"]';

  const planApproval = Array.from({ length: 10 }, () => "");
  planApproval[0] = "approval-preprod-001";
  planApproval[1] = "GDTH-MV-20260804092100-63D8";
  planApproval[2] = "MV_PRODUCTION_PLAN";
  planApproval[3] = "job-preprod-001";
  planApproval[4] = "APPROVED";

  return { project, planJob, planApproval };
}

test("chuẩn bị tài sản MV sau khi kế hoạch đã duyệt", () => {
  const { project, planJob, planApproval } = approvedMvPlanForAssetPreparation();
  assert.deepEqual(
    planMvAssetPreparation(
      project,
      planJob,
      planApproval,
      undefined,
      new Date("2026-08-04T15:00:00.000Z"),
      "job-assets-001",
    ),
    {
      project_id: "GDTH-MV-20260804092100-63D8",
      submission_id: "submission-001",
      project_name: "Gia Đình Tư Hậu",
      project_folder_id: "project-folder-id",
      contract: JSON.parse(project[24]),
      job_id: "job-assets-001",
      prepared_at: "2026-08-04T15:00:00.000Z",
      idempotent_replay: false,
    },
  );
});

test("chuẩn bị lại tài sản đang chờ duyệt là idempotent", () => {
  const { project, planJob, planApproval } = approvedMvPlanForAssetPreparation();
  project[19] = "APPROVE_MV_ASSETS";
  const assetJob = Array.from({ length: 14 }, () => "");
  assetJob[0] = "job-assets-001";
  assetJob[1] = "GDTH-MV-20260804092100-63D8";
  assetJob[3] = "MV_ASSET_PREPARATION";
  assetJob[4] = "AWAITING_APPROVAL";
  assetJob[12] = "2026-08-04T15:00:00.000Z";

  const result = planMvAssetPreparation(
    project,
    planJob,
    planApproval,
    assetJob,
  );
  assert.equal(result.idempotent_replay, true);
  assert.equal(result.job_id, "job-assets-001");
});

test("từ chối chuẩn bị tài sản nếu kế hoạch MV chưa APPROVED", () => {
  const { project, planJob, planApproval } = approvedMvPlanForAssetPreparation();
  planJob[4] = "AWAITING_APPROVAL";
  assert.throws(
    () => planMvAssetPreparation(project, planJob, planApproval, undefined),
    ProjectRegistryInvalidStateError,
  );
});

function pendingMvAssetRows() {
  const project = approvedMvProjectRow();
  project[19] = "APPROVE_MV_ASSETS";

  const job = Array.from({ length: 14 }, () => "");
  job[0] = "job-assets-001";
  job[1] = "GDTH-MV-20260804092100-63D8";
  job[2] = "PRE_PRODUCTION";
  job[3] = "MV_ASSET_PREPARATION";
  job[4] = "AWAITING_APPROVAL";
  job[7] = '["asset-manifest-file-id"]';

  const approval = Array.from({ length: 10 }, () => "");
  approval[0] = "approval-assets-001";
  approval[1] = "GDTH-MV-20260804092100-63D8";
  approval[2] = "MV_ASSET_PREPARATION";
  approval[3] = "job-assets-001";
  approval[4] = "PENDING";

  return { project, job, approval };
}

test("duyệt tài sản MV và chuyển sang lập shot plan", () => {
  const { project, job, approval } = pendingMvAssetRows();
  assert.deepEqual(
    planMvAssetApproval(
      project,
      job,
      approval,
      new Date("2026-08-04T16:00:00.000Z"),
    ),
    {
      submission_id: "submission-001",
      project_id: "GDTH-MV-20260804092100-63D8",
      current_stage: "PRE_PRODUCTION",
      next_action: "PREPARE_MV_SHOT_PLAN",
      job_id: "job-assets-001",
      job_status: "APPROVED",
      approval_id: "approval-assets-001",
      approval_status: "APPROVED",
      approved_at: "2026-08-04T16:00:00.000Z",
      idempotent_replay: false,
    },
  );
});

test("duyệt lại tài sản MV đã APPROVED là idempotent", () => {
  const { project, job, approval } = pendingMvAssetRows();
  project[19] = "PREPARE_MV_SHOT_PLAN";
  job[4] = "APPROVED";
  approval[4] = "APPROVED";
  approval[6] = "2026-08-04T16:00:00.000Z";
  const result = planMvAssetApproval(project, job, approval);
  assert.equal(result.idempotent_replay, true);
  assert.equal(result.approved_at, "2026-08-04T16:00:00.000Z");
});

test("từ chối duyệt tài sản MV nếu job và approval không đồng bộ", () => {
  const { project, job, approval } = pendingMvAssetRows();
  job[4] = "APPROVED";
  assert.throws(
    () => planMvAssetApproval(project, job, approval),
    ProjectRegistryInvalidStateError,
  );
});

test("luôn khóa cận mặt nguồn tạm Tường Vy", () => {
  assert.deepEqual(
    applyMvAssetCharacterSafetyLocks([
      {
        character_id: "GDTH-CHAR-001",
        temporary_source: false,
        close_up_allowed: true,
      },
      {
        character_id: "GDTH-CHAR-002",
        temporary_source: false,
        close_up_allowed: true,
      },
    ]),
    [
      {
        character_id: "GDTH-CHAR-001",
        temporary_source: true,
        close_up_allowed: false,
      },
      {
        character_id: "GDTH-CHAR-002",
        temporary_source: false,
        close_up_allowed: true,
      },
    ],
  );
});

function pendingMvShotPlanRows() {
  const project = approvedMvProjectRow();
  project[19] = "APPROVE_MV_SHOT_PLAN";

  const job = Array.from({ length: 14 }, () => "");
  job[0] = "job-shot-plan-001";
  job[1] = "GDTH-MV-20260804092100-63D8";
  job[2] = "PRE_PRODUCTION";
  job[3] = "MV_SHOT_PLAN";
  job[4] = "AWAITING_APPROVAL";
  job[7] = '["shot-plan-manifest-file-id"]';

  const approval = Array.from({ length: 10 }, () => "");
  approval[0] = "approval-shot-plan-001";
  approval[1] = "GDTH-MV-20260804092100-63D8";
  approval[2] = "MV_SHOT_PLAN";
  approval[3] = "job-shot-plan-001";
  approval[4] = "PENDING";

  return { project, job, approval };
}

test("duyệt shot plan MV và chuyển sang căn timecode", () => {
  const { project, job, approval } = pendingMvShotPlanRows();
  assert.deepEqual(
    planMvShotPlanApproval(
      project,
      job,
      approval,
      new Date("2026-08-06T06:30:00.000Z"),
    ),
    {
      submission_id: "submission-001",
      project_id: "GDTH-MV-20260804092100-63D8",
      current_stage: "PRE_PRODUCTION",
      next_action: "PREPARE_MV_TIMECODE_ALIGNMENT",
      job_id: "job-shot-plan-001",
      job_status: "APPROVED",
      approval_id: "approval-shot-plan-001",
      approval_status: "APPROVED",
      approved_at: "2026-08-06T06:30:00.000Z",
      idempotent_replay: false,
    },
  );
});

test("duyệt lại shot plan MV đã APPROVED là idempotent", () => {
  const { project, job, approval } = pendingMvShotPlanRows();
  project[19] = "PREPARE_MV_TIMECODE_ALIGNMENT";
  job[4] = "APPROVED";
  approval[4] = "APPROVED";
  approval[6] = "2026-08-06T06:30:00.000Z";
  const result = planMvShotPlanApproval(project, job, approval);
  assert.equal(result.idempotent_replay, true);
  assert.equal(result.approved_at, "2026-08-06T06:30:00.000Z");
});

test("từ chối duyệt shot plan nếu job và approval không đồng bộ", () => {
  const { project, job, approval } = pendingMvShotPlanRows();
  job[4] = "APPROVED";
  assert.throws(
    () => planMvShotPlanApproval(project, job, approval),
    ProjectRegistryInvalidStateError,
  );
});


function pendingMvDuetBaseCompositeRows() {
  const project = approvedMvProjectRow();
  project[19] = "APPROVE_MV_DUET_BASE_COMPOSITE";
  const job = Array.from({ length: 14 }, () => "");
  Object.assign(job, {
    0: "job-duet-base-composite",
    1: project[1],
    2: "PRE_PRODUCTION",
    3: "MV_DUET_BASE_COMPOSITE",
    4: "AWAITING_APPROVAL",
  });
  const approval = Array.from({ length: 10 }, () => "");
  Object.assign(approval, {
    0: "approval-duet-base-composite",
    1: project[1],
    2: "MV_DUET_BASE_COMPOSITE",
    3: job[0],
    4: "PENDING",
  });
  return { project, job, approval };
}

test("duyệt base composite chỉ mở dựng local và tiếp tục khóa provider/render", () => {
  const { project, job, approval } = pendingMvDuetBaseCompositeRows();
  const result = planMvDuetBaseCompositeApproval(
    project,
    job,
    approval,
    new Date("2026-08-07T01:30:00.000Z"),
  );
  assert.equal(result.next_action, "EXECUTE_MV_DUET_BASE_COMPOSITE");
  assert.equal(result.job_status, "APPROVED");
  assert.equal(result.approval_status, "APPROVED");
  assert.equal(result.composite_execution_allowed, true);
  assert.equal(result.provider_execution_allowed, false);
  assert.equal(result.render_allowed, false);
  assert.equal(result.idempotent_replay, false);
});

test("duyệt lại base composite đã APPROVED là idempotent", () => {
  const { project, job, approval } = pendingMvDuetBaseCompositeRows();
  project[19] = "EXECUTE_MV_DUET_BASE_COMPOSITE";
  job[4] = "APPROVED";
  approval[4] = "APPROVED";
  approval[6] = "2026-08-07T01:30:00.000Z";
  const result = planMvDuetBaseCompositeApproval(project, job, approval);
  assert.equal(result.idempotent_replay, true);
  assert.equal(result.approved_at, "2026-08-07T01:30:00.000Z");
});

test("từ chối duyệt base composite khi job và approval lệch trạng thái", () => {
  const { project, job, approval } = pendingMvDuetBaseCompositeRows();
  job[4] = "APPROVED";
  assert.throws(
    () => planMvDuetBaseCompositeApproval(project, job, approval),
    ProjectRegistryInvalidStateError,
  );
});


function approvedMvDuetBaseCompositeExecutionRows() {
  const project = approvedMvProjectRow();
  project[19] = "EXECUTE_MV_DUET_BASE_COMPOSITE";
  const job = Array.from({ length: 14 }, () => "");
  Object.assign(job, {
    0: "job-duet-base-composite",
    1: project[1],
    2: "PRE_PRODUCTION",
    3: "MV_DUET_BASE_COMPOSITE",
    4: "APPROVED",
    7: '["duet-base-composite-manifest-id"]',
  });
  const approval = Array.from({ length: 10 }, () => "");
  Object.assign(approval, {
    0: "approval-duet-base-composite",
    1: project[1],
    2: "MV_DUET_BASE_COMPOSITE",
    3: job[0],
    4: "APPROVED",
  });
  return { project, job, approval };
}

test("chỉ thực thi RP015 sau khi base composite đã được duyệt", () => {
  const { project, job, approval } = approvedMvDuetBaseCompositeExecutionRows();
  const result = planMvDuetBaseCompositeExecution(project, job, approval);
  assert.equal(result.idempotent_replay, false);
  assert.equal(result.manifest_file_id, "duet-base-composite-manifest-id");
  assert.equal(result.project_folder_id, "project-folder-id");
});

test("thực thi lại RP015 đã thành công trả kết quả idempotent", () => {
  const { project, job, approval } = approvedMvDuetBaseCompositeExecutionRows();
  project[19] = "REVIEW_MV_DUET_BASE_COMPOSITE";
  job[4] = "SUCCEEDED";
  job[8] = JSON.stringify({
    output_file_id: "rp015-output-id",
    output_file_url: "https://drive.google.com/file/d/rp015-output-id/view",
    duration_seconds: 9.62,
    width: 1920,
    height: 1080,
    executed_at: "2026-08-07T02:00:00.000Z",
  });
  const result = planMvDuetBaseCompositeExecution(project, job, approval);
  assert.equal(result.idempotent_replay, true);
  assert.equal(result.existing_result?.output_file_id, "rp015-output-id");
  assert.equal(result.existing_result?.provider_execution_allowed, false);
  assert.equal(result.existing_result?.render_allowed, false);
});

test("từ chối thực thi RP015 khi approval chưa APPROVED", () => {
  const { project, job, approval } = approvedMvDuetBaseCompositeExecutionRows();
  approval[4] = "PENDING";
  assert.throws(
    () => planMvDuetBaseCompositeExecution(project, job, approval),
    ProjectRegistryInvalidStateError,
  );
});

test("FFmpeg RP015 có tối đa 720 giây dưới timeout Cloud Run 900 giây", () => {
  assert.equal(RP015_FFMPEG_TIMEOUT_MS, 720_000);
  assert.ok(RP015_FFMPEG_TIMEOUT_MS < 900_000);
});

test("FFmpeg chỉ dựng RP015 9.62 giây, không gắn audio và xuất 1920x1080", () => {
  const args = buildMvDuetBaseCompositeFfmpegArgs(
    "/tmp/tuong-vy",
    "/tmp/phuong-an",
    "/tmp/rp015.mp4",
  );
  const firstSeek = args.indexOf("-ss");
  const secondSeek = args.indexOf("-ss", firstSeek + 1);
  assert.equal(args[firstSeek + 1], String(RP015_TUONG_VY_SOURCE_START_SECONDS));
  assert.equal(args[secondSeek + 1], String(RP015_PHUONG_AN_SOURCE_START_SECONDS));
  assert.ok(!args.includes(String(RP015_START_SECONDS)));
  assert.ok(args.includes(String(RP015_DURATION_SECONDS)));
  assert.ok(args.includes("-an"));
  const filterIndex = args.indexOf("-filter_complex");
  const filterGraph = args[filterIndex + 1] ?? "";
  assert.match(filterGraph, /\[0:v\]scale=.*?,pad=.*?,setsar=1\[left\]/);
  assert.match(filterGraph, /\[1:v\]scale=.*?,pad=.*?,setsar=1\[right\]/);
  assert.doesNotMatch(filterGraph, /;pad=/);
  assert.ok(filterGraph.includes("[left][right]hstack=inputs=2[outv]"));
  assert.equal(args.at(-1), "/tmp/rp015.mp4");
});


function executedMvDuetBaseCompositeReviewRows() {
  const { project, job, approval } = approvedMvDuetBaseCompositeExecutionRows();
  project[19] = "REVIEW_MV_DUET_BASE_COMPOSITE";
  job[4] = "SUCCEEDED";
  job[7] = '["duet-base-composite-manifest-id","rp015-output-id"]';
  job[8] = JSON.stringify({
    output_file_id: "rp015-output-id",
    output_file_url: "https://drive.google.com/file/d/rp015-output-id/view",
    duration_seconds: 9.633333,
    width: 1920,
    height: 1080,
    provider_execution_allowed: false,
    render_allowed: false,
  });
  return { project, job, approval };
}

test("duyệt review RP015 chỉ chốt pilot reference và tiếp tục khóa provider/render", () => {
  const { project, job, approval } = executedMvDuetBaseCompositeReviewRows();
  const result = planMvDuetBaseCompositeReviewApproval(
    project,
    job,
    approval,
    undefined,
    new Date("2026-08-07T03:20:00.000Z"),
  );
  assert.equal(result.next_action, "PLAN_MV_DUET_BASE_COMPOSITE_ROLLOUT");
  assert.equal(result.review_status, "APPROVED");
  assert.equal(result.job_status, "SUCCEEDED");
  assert.equal(result.output_file_id, "rp015-output-id");
  assert.equal(result.provider_execution_allowed, false);
  assert.equal(result.render_allowed, false);
  assert.equal(result.idempotent_replay, false);
});

test("duyệt lại review RP015 đã APPROVED là idempotent", () => {
  const { project, job, approval } = executedMvDuetBaseCompositeReviewRows();
  project[19] = "PLAN_MV_DUET_BASE_COMPOSITE_ROLLOUT";
  const reviewApproval = [
    "review-approval-id",
    project[1],
    "MV_DUET_BASE_COMPOSITE_REVIEW",
    job[0],
    "APPROVED",
    "OWNER",
    "2026-08-07T03:20:00.000Z",
  ];
  const result = planMvDuetBaseCompositeReviewApproval(
    project,
    job,
    approval,
    reviewApproval,
  );
  assert.equal(result.idempotent_replay, true);
  assert.equal(result.review_approval_id, "review-approval-id");
});

test("từ chối duyệt review RP015 khi output chưa SUCCEEDED", () => {
  const { project, job, approval } = executedMvDuetBaseCompositeReviewRows();
  job[4] = "FAILED";
  assert.throws(
    () => planMvDuetBaseCompositeReviewApproval(project, job, approval, undefined),
    ProjectRegistryInvalidStateError,
  );
});


function approvedRenderPlanForRollout(projectId = "GDTH-MV-TEST") {
  return {
    schema_version: "1.0",
    project_id: projectId,
    render_plan_status: "APPROVED",
    provider_execution_allowed: false,
    render_allowed: false,
    render_units: Array.from({ length: 15 }, (_, index) => {
      const isPilot = index === 14;
      const performer = isPilot ? "SONG_CA" : index % 2 === 0 ? "TUONG_VY_EM" : "PHUONG_AN";
      return {
        render_unit_id: `RP${String(index + 1).padStart(3, "0")}`,
        cue_order: index + 1,
        performer,
        start_seconds: index * 20,
        end_seconds: index * 20 + (isPilot ? 9.62 : 20),
        duration_seconds: isPilot ? 9.62 : 20,
        framing_constraints: {
          close_up_allowed: performer === "PHUONG_AN",
          preserve_microphone: performer !== "PHUONG_AN",
          allowed_framings: performer === "PHUONG_AN"
            ? ["CLOSE_UP", "MEDIUM", "FULL_BODY"]
            : ["MEDIUM", "FULL_BODY"],
        },
        provider_execution_allowed: false,
        render_allowed: false,
      };
    }),
  };
}

function approvedPilotManifestForRollout(projectId = "GDTH-MV-TEST") {
  return {
    project_id: projectId,
    composite_status: "PILOT_APPROVED",
    output_readiness: "APPROVED_PILOT_REFERENCE",
    provider_execution_allowed: false,
    render_allowed: false,
    output: {
      file_id: "rp015-output-id",
      width: 1920,
      height: 1080,
      duration_seconds: 9.633333,
    },
    review_gate: {
      review_status: "APPROVED",
    },
  };
}

test("lập rollout plan đủ 15 render unit và tiếp tục khóa toàn bộ thực thi", () => {
  const manifest = buildMvDuetBaseCompositeRolloutManifest(
    "GDTH-MV-TEST",
    "Gia Đình Tư Hậu",
    "render-plan-id",
    approvedRenderPlanForRollout(),
    "pilot-manifest-id",
    approvedPilotManifestForRollout(),
    "rp015-output-id",
    "2026-08-07T03:40:00.000Z",
  );
  assert.equal(manifest.rollout_status, "AWAITING_APPROVAL");
  assert.equal(manifest.total_render_units, 15);
  assert.equal(manifest.rollout_units.length, 15);
  assert.equal(manifest.rollout_units[14].rollout_status, "PILOT_APPROVED_REFERENCE");
  assert.equal(manifest.rollout_units[0].composite_execution_allowed, false);
  assert.equal(manifest.composite_execution_allowed, false);
  assert.equal(manifest.provider_execution_allowed, false);
  assert.equal(manifest.render_allowed, false);
  assert.equal(manifest.safety_policy.provider_execution_allowed, false);
  assert.equal(manifest.safety_policy.render_allowed, false);
  assert.equal(
    manifest.approval_gate.next_action,
    "APPROVE_MV_DUET_BASE_COMPOSITE_ROLLOUT",
  );
});

test("từ chối rollout plan nếu unit có Tường Vy cho phép close-up", () => {
  const renderPlan = approvedRenderPlanForRollout();
  const first = renderPlan.render_units[0];
  first.framing_constraints.close_up_allowed = true;
  assert.throws(
    () => buildMvDuetBaseCompositeRolloutManifest(
      "GDTH-MV-TEST",
      "Gia Đình Tư Hậu",
      "render-plan-id",
      renderPlan,
      "pilot-manifest-id",
      approvedPilotManifestForRollout(),
      "rp015-output-id",
      "2026-08-07T03:40:00.000Z",
    ),
    ProjectRegistryInvalidStateError,
  );
});

test("từ chối rollout plan nếu pilot RP015 chưa được owner duyệt", () => {
  const pilot = approvedPilotManifestForRollout();
  pilot.review_gate.review_status = "PENDING";
  assert.throws(
    () => buildMvDuetBaseCompositeRolloutManifest(
      "GDTH-MV-TEST",
      "Gia Đình Tư Hậu",
      "render-plan-id",
      approvedRenderPlanForRollout(),
      "pilot-manifest-id",
      pilot,
      "rp015-output-id",
      "2026-08-07T03:40:00.000Z",
    ),
    ProjectRegistryInvalidStateError,
  );
});

function pendingMvDuetBaseCompositeRolloutRows() {
  const project = approvedMvProjectRow();
  project[19] = "APPROVE_MV_DUET_BASE_COMPOSITE_ROLLOUT";
  const job = Array.from({ length: 14 }, () => "");
  Object.assign(job, {
    0: "job-rollout-001",
    1: project[1],
    2: "PRE_PRODUCTION",
    3: "MV_DUET_BASE_COMPOSITE_ROLLOUT",
    4: "AWAITING_APPROVAL",
    7: '["rollout-manifest-file-id"]',
  });
  const approval = Array.from({ length: 10 }, () => "");
  Object.assign(approval, {
    0: "approval-rollout-001",
    1: project[1],
    2: "MV_DUET_BASE_COMPOSITE_ROLLOUT",
    3: job[0],
    4: "PENDING",
  });
  return { project, job, approval };
}

test("duyệt rollout chỉ mở composite cục bộ và tiếp tục khóa provider/render", () => {
  const { project, job, approval } = pendingMvDuetBaseCompositeRolloutRows();
  const result = planMvDuetBaseCompositeRolloutApproval(
    project,
    job,
    approval,
    new Date("2026-08-07T04:00:00.000Z"),
  );
  assert.equal(result.next_action, "EXECUTE_MV_DUET_BASE_COMPOSITE_ROLLOUT");
  assert.equal(result.job_status, "APPROVED");
  assert.equal(result.approval_status, "APPROVED");
  assert.equal(result.total_render_units, 15);
  assert.equal(result.pilot_reference_unit_id, "RP015");
  assert.equal(result.composite_execution_allowed, true);
  assert.equal(result.provider_execution_allowed, false);
  assert.equal(result.render_allowed, false);
  assert.equal(result.idempotent_replay, false);
});

test("duyệt lại rollout đã APPROVED là idempotent", () => {
  const { project, job, approval } = pendingMvDuetBaseCompositeRolloutRows();
  project[19] = "EXECUTE_MV_DUET_BASE_COMPOSITE_ROLLOUT";
  job[4] = "APPROVED";
  approval[4] = "APPROVED";
  approval[6] = "2026-08-07T04:00:00.000Z";
  const result = planMvDuetBaseCompositeRolloutApproval(project, job, approval);
  assert.equal(result.idempotent_replay, true);
  assert.equal(result.approved_at, "2026-08-07T04:00:00.000Z");
});

test("từ chối duyệt rollout khi job và approval lệch trạng thái", () => {
  const { project, job, approval } = pendingMvDuetBaseCompositeRolloutRows();
  job[4] = "APPROVED";
  assert.throws(
    () => planMvDuetBaseCompositeRolloutApproval(project, job, approval),
    ProjectRegistryInvalidStateError,
  );
});

test("rollout tuần tự bỏ qua RP015 và cảnh đã hoàn tất", () => {
  const units = approvedRenderPlanForRollout().render_units.map((unit) => ({
    ...unit,
    rollout_status: unit.render_unit_id === "RP015" ? "PILOT_APPROVED_REFERENCE" : "APPROVED_PENDING_LOCAL_COMPOSITE_EXECUTION",
    composite_execution_allowed: unit.render_unit_id !== "RP015",
    provider_execution_allowed: false,
    render_allowed: false,
  }));
  units[0].rollout_status = "SUCCEEDED";
  const result = selectNextMvDuetBaseCompositeRolloutUnit({
    rollout_status: "IN_PROGRESS",
    composite_execution_allowed: true,
    provider_execution_allowed: false,
    render_allowed: false,
    rollout_units: units,
  });
  assert.equal(result.next?.render_unit_id, "RP002");
  assert.equal(result.completed_count, 2);
  assert.equal(result.remaining_count, 13);
});

test("rollout hoàn tất là idempotent và không chọn lại unit", () => {
  const units = approvedRenderPlanForRollout().render_units.map((unit) => ({
    ...unit,
    rollout_status: unit.render_unit_id === "RP015" ? "PILOT_APPROVED_REFERENCE" : "SUCCEEDED",
    provider_execution_allowed: false,
    render_allowed: false,
  }));
  const result = selectNextMvDuetBaseCompositeRolloutUnit({
    rollout_status: "SUCCEEDED_AWAITING_REVIEW",
    composite_execution_allowed: true,
    provider_execution_allowed: false,
    render_allowed: false,
    rollout_units: units,
  });
  assert.equal(result.next, undefined);
  assert.equal(result.completed_count, 15);
  assert.equal(result.remaining_count, 0);
});

test("source offset rollout luôn nằm trong cửa sổ nguồn", () => {
  const offset = selectRolloutSourceOffset(250.5, 42.066667, 12.4, 16.22);
  assert.ok(offset >= 0);
  assert.ok(offset + 12.4 <= 42.066667 + 0.001);
});

test("cảnh rollout dài hơn nguồn bắt đầu từ 0 để FFmpeg lặp an toàn", () => {
  assert.equal(selectRolloutSourceOffset(0, 40.466667, 51.2, 15.42), 0);
});

test("FFmpeg rollout lặp riêng cả hai input nhưng RP015 không bị thay đổi", () => {
  const rolloutArgs = buildMvDuetBaseCompositeFfmpegArgs(
    "tuong-vy.mp4",
    "phuong-an.mp4",
    "rp001.mp4",
    { durationSeconds: 51.2, tuongVyOffset: 0, phuongAnOffset: 0 },
  );
  assert.equal(rolloutArgs.filter((arg) => arg === "-stream_loop").length, 2);
  assert.equal(rolloutArgs.filter((arg) => arg === "-1").length, 2);
  const pilotArgs = buildMvDuetBaseCompositeFfmpegArgs(
    "tuong-vy.mp4", "phuong-an.mp4", "rp015.mp4",
  );
  assert.equal(pilotArgs.includes("-stream_loop"), false);
});

test("RP015 final proof ghép đúng audio master 362-371.62 và giữ video", () => {
  const args = buildRp015FinalProofFfmpegArgs("rp015.mp4", "master.wav", "proof.mp4");
  const seek = args.indexOf("-ss");
  const duration = args.indexOf("-t");
  assert.equal(args[seek + 1], String(RP015_MASTER_AUDIO_START_SECONDS));
  assert.equal(args[duration + 1], String(RP015_DURATION_SECONDS));
  assert.ok(args.includes("0:v:0"));
  assert.ok(args.includes("1:a:0"));
  assert.ok(args.includes("copy"));
  assert.ok(args.includes("aac"));
  assert.ok(args.includes("192k"));
  assert.ok(args.includes("-shortest"));
});
