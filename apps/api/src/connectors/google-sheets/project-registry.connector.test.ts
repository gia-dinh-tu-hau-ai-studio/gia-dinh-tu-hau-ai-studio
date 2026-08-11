import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectId, planContractApproval, ProjectRegistryInvalidStateError } from "./project-registry.connector";

test("buildProjectId chỉ tạo mã dự án phim", () => {
  assert.equal(buildProjectId({ project_name: "Lừa đảo xin việc" } as never, new Date("2026-08-12T01:02:03Z")), "GDTH-FILM-20260812010203-L-A-O-XIN-VI-C");
});

test("duyệt hợp đồng mở đúng bước review kịch bản phim", () => {
  const row = Array<string>(25).fill("");
  Object.assign(row, { 1: "GDTH-FILM-1", 3: "SHORT_FILM", 17: "PENDING", 18: "CONTRACT", 19: "APPROVE_CONTRACT" });
  const result = planContractApproval(row, new Date("2026-08-12T01:02:03Z"));
  assert.equal(result.next_action, "REVIEW_SHORT_FILM_SCRIPT");
  assert.equal(result.idempotent_replay, false);
});

test("không duyệt dữ liệu ngoài pipeline phim", () => {
  const row = Array<string>(25).fill("");
  Object.assign(row, { 1: "LEGACY-1", 3: "LEGACY", 17: "PENDING", 18: "CONTRACT", 19: "APPROVE_CONTRACT" });
  assert.throws(() => planContractApproval(row), ProjectRegistryInvalidStateError);
});
