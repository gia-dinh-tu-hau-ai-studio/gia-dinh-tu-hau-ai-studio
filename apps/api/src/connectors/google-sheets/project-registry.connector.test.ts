import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProjectIntake } from "@tu-hau/contracts";
import {
  assertProjectFolderWithinRoot,
  buildProjectId,
  normalizeDriveFileIdInput,
  planContractApproval,
  planMvAssetPreparation,
  planMvProductionPlanApproval,
  planMvProductionPreparation,
  ProjectRegistryInvalidStateError,
} from "./project-registry.connector";

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
