import assert from "node:assert/strict";
import test from "node:test";
import { isMasterIdentityApprovedLocked } from "./character-library.connector";

test("chỉ chấp nhận Character Master APPROVED và LOCKED", () => {
  assert.equal(isMasterIdentityApprovedLocked(JSON.stringify({
    master_identity_status: "APPROVED",
    lock_status: "LOCKED",
  })), true);
  assert.equal(isMasterIdentityApprovedLocked(JSON.stringify({
    master_identity_status: "PENDING",
    lock_status: "LOCKED",
  })), false);
  assert.equal(isMasterIdentityApprovedLocked(JSON.stringify({
    master_identity_status: "APPROVED",
    lock_status: "UNLOCKED",
  })), false);
  assert.equal(isMasterIdentityApprovedLocked("not-json"), false);
});
