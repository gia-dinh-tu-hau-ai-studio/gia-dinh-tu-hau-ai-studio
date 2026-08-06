import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProjectIntake } from "@tu-hau/contracts";
import {
  applyMvAssetCharacterSafetyLocks,
  buildMvRenderPlanManifest,
  buildMvRenderExecutionManifest,
  buildMvProviderSubmissionManifest,
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
  planMvShotPlanApproval,
  planMvTimecodeAlignmentApproval,
  ProjectRegistryInvalidStateError,
} from "./project-registry.connector";

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
