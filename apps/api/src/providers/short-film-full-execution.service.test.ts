import assert from "node:assert/strict";
import test from "node:test";
import { calculateFullFilmRequiredCaps, fullFilmNeedsBackgroundRunner } from "./short-film-full-execution.service";

test("full-film runner continues without browser polling until a terminal review state", () => {
  assert.equal(fullFilmNeedsBackgroundRunner("IN_PROGRESS"), true);
  assert.equal(fullFilmNeedsBackgroundRunner("ASSEMBLING"), true);
  assert.equal(fullFilmNeedsBackgroundRunner("AWAITING_FINAL_QC"), false);
  assert.equal(fullFilmNeedsBackgroundRunner("FAILED"), false);
});

test("approved pilot shots are reused and excluded from every full-film provider cap", () => {
  const required = calculateFullFilmRequiredCaps(
    [
      { shot_id: "SHOT-001", duration_seconds: 10 },
      { shot_id: "SHOT-002", duration_seconds: 8 },
      { shot_id: "SHOT-003", duration_seconds: 6 },
    ],
    new Set(["SHOT-001"]),
    new Map([["SHOT-001", 40], ["SHOT-002", 25]]),
  );

  assert.deepEqual(required, { runway: 168, eleven: 25, sync: 0.4 });
});
