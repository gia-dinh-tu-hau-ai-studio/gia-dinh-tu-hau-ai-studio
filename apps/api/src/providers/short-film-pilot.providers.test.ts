import assert from "node:assert/strict";
import test from "node:test";
import { ElevenLabsPilotProvider, PilotProviderError, RunwayPilotProvider, SyncPilotProvider } from "./short-film-pilot.providers";
import { extractGoogleDriveFileId } from "../connectors/google-drive/drive.connector";
import { LOCKED_FACE_CROP_FILTER } from "./runway-private-keyframe";
import { approvePilotPerformanceVariant, buildPilotPerformancePrompt, rejectPilotForRestart, reviewDialogueAudioGate, selectEvaluationReelSourceTasks, selectLockedCharacterPerformanceImage, validateEvaluationReelRequest, validateLockedCharacterPerformanceSource, validatePilotPerformanceVariant, verifyVietnameseTranscript } from "./short-film-pilot-execution.service";

test("Runway submit uses current version and never accepts a shot over ten seconds", async () => {
  let request: RequestInit | undefined;
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    request = init;
    return new Response(JSON.stringify({ id: "task-1" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const provider = new RunwayPilotProvider("secret", fetcher as typeof fetch);
  assert.deepEqual(await provider.submit({ imageUrl: "https://example.com/ref.jpg", prompt: "natural motion", durationSeconds: 10, ratio: "1280:720" }), { taskId: "task-1" });
  assert.equal((request?.headers as Record<string, string>)["X-Runway-Version"], "2024-11-06");
  await assert.rejects(() => provider.submit({ imageUrl: "https://example.com/ref.jpg", prompt: "motion", durationSeconds: 11, ratio: "1280:720" }), /2-10/);
});

test("ElevenLabs uses a Vietnamese-capable model and returns billing metadata", async () => {
  let requestedUrl = "";
  let request: RequestInit | undefined;
  const provider = new ElevenLabsPilotProvider("secret", (async (url, init) => {
    requestedUrl = String(url); request = init;
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "request-id": "req-1", "character-cost": "12" } });
  }) as typeof fetch);
  const output = await provider.synthesize({ voiceId: "voice-1", text: "Xin chào", languageCode: "vi" });
  assert.equal(output.audio.length, 3);
  assert.equal(output.requestId, "req-1");
  assert.equal(output.characterCost, 12);
  assert.match(requestedUrl, /output_format=mp3_44100_128$/);
  const body = JSON.parse(String(request?.body));
  assert.equal(body.model_id, "eleven_v3");
  assert.equal(body.language_code, "vi");
});

test("Vietnamese transcript gate rejects foreign or mismatched speech", () => {
  const expected = "Chỗ tuyển dụng đàng hoàng không ai bắt đóng tiền giữ việc.";
  assert.equal(verifyVietnameseTranscript(expected, { text: expected, languageCode: "vie", languageProbability: 0.99 }).passed, true);
  assert.equal(verifyVietnameseTranscript(expected, { text: "This job requires payment.", languageCode: "en", languageProbability: 0.99 }).passed, false);
  assert.equal(verifyVietnameseTranscript(expected, { text: "Xin chào", languageCode: "vi", languageProbability: 0.99 }).passed, false);
  assert.equal(verifyVietnameseTranscript(expected, { text: expected, languageCode: "vi", languageProbability: 0.4 }).passed, false);
});

test("dialogue audio approval gate blocks Runway until every verified audio is owner-approved", () => {
  const manifest: Parameters<typeof reviewDialogueAudioGate>[0] = { status: "AWAITING_DIALOGUE_AUDIO_APPROVAL", tasks: [
    { sample_id: "S1", shot_id: "SHOT-001", runway_status: "PENDING_SUBMIT", dialogue_line_id: "LINE-001", audio_drive_file_id: "audio-1", transcript_verified: true },
  ] };
  assert.deepEqual(reviewDialogueAudioGate(manifest, "APPROVE", "2026-08-11T00:00:00Z"), { status: "PROCESSING_RUNWAY" });
  assert.equal(manifest.tasks[0].audio_review_decision, "APPROVE");
  assert.throws(() => reviewDialogueAudioGate({ status: "AWAITING_DIALOGUE_AUDIO_APPROVAL", tasks: [{ sample_id: "S1", shot_id: "SHOT-001", runway_status: "PENDING_SUBMIT", dialogue_line_id: "LINE-001", transcript_verified: false }] }, "APPROVE", "2026-08-11T00:00:00Z"), /EVIDENCE_INCOMPLETE/);
});

test("rejected pilot is archived before a new dialogue-audio execution can start", () => {
  const manifest = { schema_version: "SHORT_FILM_PILOT_PROVIDER_EXECUTION_V1", execution_id: "exec-old", project_id: "project-1", status: "AWAITING_PILOT_QC", samples: [], tasks: [], caps: { runway_credits: 1, elevenlabs_characters: 1, sync_usd: 1 }, provider_calls_made: true, heartbeat_at: "before", started_at: "before" } as Parameters<typeof rejectPilotForRestart>[0];
  const result = rejectPilotForRestart(manifest, "2026-08-11T02:00:00.000Z");
  assert.match(result.archiveName, /SHORT_FILM_PILOT_REJECTED_.*exec-old\.json/);
  assert.equal(result.archived.status, "AWAITING_PILOT_QC");
  assert.equal(result.archived.qc_rejection.decision, "REJECT");
  assert.equal(result.failed.status, "FAILED");
  assert.throws(() => rejectPilotForRestart({ ...manifest, status: "PROCESSING_RUNWAY" } as Parameters<typeof rejectPilotForRestart>[0], "2026-08-11T02:00:00.000Z"), /NOT_AWAITING_QC_REJECTION/);
});

test("performance variant is limited to one approved ten-second shot and exact provider caps", () => {
  const task = { sample_id: "S3", shot_id: "SHOT-005", runway_status: "SUCCEEDED", dialogue_line_id: "LINE-005", audio_drive_file_id: "audio-5", transcript_verified: true, audio_review_decision: "APPROVE" as const, final_drive_file_id: "old-final" };
  const pilot = { status: "AWAITING_PILOT_QC" as const, execution_id: "pilot-1", tasks: [task] };
  assert.equal(validatePilotPerformanceVariant({ pilot, shotId: "SHOT-005", durationSeconds: 10, caps: { runway_credits: 50, sync_usd: 0.5 } }), task);
  assert.throws(() => validatePilotPerformanceVariant({ pilot, shotId: "SHOT-005", durationSeconds: 5, caps: { runway_credits: 50, sync_usd: 0.5 } }), /DURATION_MUST_BE_10/);
  assert.throws(() => validatePilotPerformanceVariant({ pilot, shotId: "SHOT-006", durationSeconds: 10, caps: { runway_credits: 50, sync_usd: 0.5 } }), /ONLY_APPROVED_FOR_SHOT_005/);
  assert.throws(() => validatePilotPerformanceVariant({ pilot, shotId: "SHOT-005", durationSeconds: 10, caps: { runway_credits: 121, sync_usd: 0.5 } }), /CAP_MISMATCH/);
  assert.throws(() => validatePilotPerformanceVariant({ pilot: { ...pilot, tasks: [{ ...task, audio_review_decision: "PENDING" }] }, shotId: "SHOT-005", durationSeconds: 10, caps: { runway_credits: 50, sync_usd: 0.5 } }), /SOURCE_EVIDENCE_INCOMPLETE/);
});

test("30-second evaluation reel requires the exact one-time approved provider caps", () => {
  const caps = { runway_credits: 432, elevenlabs_characters: 2000, sync_usd: 1.8 };
  assert.doesNotThrow(() => validateEvaluationReelRequest({ durationSeconds: 30, caps }));
  assert.throws(() => validateEvaluationReelRequest({ durationSeconds: 20, caps }), /DURATION_MUST_BE_30/);
  assert.throws(() => validateEvaluationReelRequest({ durationSeconds: 30, caps: { ...caps, runway_credits: 433 } }), /CAP_MISMATCH/);
  assert.throws(() => validateEvaluationReelRequest({ durationSeconds: 30, caps: { ...caps, sync_usd: 1.81 } }), /CAP_MISMATCH/);
});

test("30-second evaluation reel selects exactly three approved ten-second shots", () => {
  const task = (shot_id: string) => ({ sample_id: "S", shot_id, runway_status: "SUCCEEDED", audio_drive_file_id: `audio-${shot_id}`, final_drive_file_id: `video-${shot_id}`, transcript_verified: true, audio_review_decision: "APPROVE" as const });
  const pilot = { samples: [{ sample_id: "S", purpose: "IDENTITY_DIALOGUE" as const, expected_duration_seconds: 35, shots: [
    { shot_id: "SHOT-001", summary: "one", runway_prompt: "one", duration_seconds: 10, risk_tags: [] },
    { shot_id: "SHOT-002", summary: "two", runway_prompt: "two", duration_seconds: 5, risk_tags: [] },
    { shot_id: "SHOT-003", summary: "three", runway_prompt: "three", duration_seconds: 10, risk_tags: [] },
    { shot_id: "SHOT-005", summary: "five", runway_prompt: "five", duration_seconds: 10, risk_tags: [] },
  ] }], tasks: [task("SHOT-001"), task("SHOT-002"), task("SHOT-003"), task("SHOT-005")] };
  assert.deepEqual(selectEvaluationReelSourceTasks(pilot).map((item) => item.shot_id), ["SHOT-001", "SHOT-003", "SHOT-005"]);
});

test("identity correction requires the shot keyframe to be the assigned approved and locked Character Master", () => {
  const character = { character_id: "GDTH-CHAR-001", body_reference_url: "https://drive.google.com/file/d/body/view", face_reference_url: "https://drive.google.com/file/d/face/view", master_identity_id: "TUONG_VY_MASTER_IDENTITY_V1", master_identity_version: "V1", readiness: { master_identity: "APPROVED_LOCKED" } };
  assert.equal(validateLockedCharacterPerformanceSource({ dialogue: { speaker_source_actor_id: "GDTH-CHAR-001" }, keyframe: { approved_image_url: character.body_reference_url }, character }), character);
  assert.throws(() => validateLockedCharacterPerformanceSource({ dialogue: { speaker_source_actor_id: "GDTH-CHAR-002" }, keyframe: { approved_image_url: character.body_reference_url }, character }), /ASSIGNMENT_MISMATCH/);
  assert.throws(() => validateLockedCharacterPerformanceSource({ dialogue: { speaker_source_actor_id: "GDTH-CHAR-001" }, keyframe: { approved_image_url: "https://drive.google.com/file/d/wrong/view" }, character }), /KEYFRAME_NOT_FROM_LOCKED/);
  assert.throws(() => validateLockedCharacterPerformanceSource({ dialogue: { speaker_source_actor_id: "GDTH-CHAR-001" }, keyframe: { approved_image_url: character.body_reference_url }, character: { ...character, readiness: { master_identity: "NOT_READY" } } }), /NOT_APPROVED_LOCKED/);
});

test("Act-Two identity input uses the clear face reference, never the distant full-body keyframe", () => {
  const character = { character_id: "GDTH-CHAR-001", body_reference_url: "https://drive.google.com/file/d/body/view", face_reference_url: "https://drive.google.com/file/d/clear-face/view", master_identity_id: "TUONG_VY_MASTER_IDENTITY_V1", master_identity_version: "V1", readiness: { master_identity: "APPROVED_LOCKED" } };
  assert.equal(selectLockedCharacterPerformanceImage(character), character.face_reference_url);
  assert.notEqual(selectLockedCharacterPerformanceImage(character), character.body_reference_url);
  assert.throws(() => selectLockedCharacterPerformanceImage({ ...character, face_reference_url: "" }), /FACE_REFERENCE_MISSING/);
});

test("full-body-only Character Masters use a deterministic upper-body face derivative", () => {
  assert.match(LOCKED_FACE_CROP_FILTER, /ih\/2/);
  assert.match(LOCKED_FACE_CROP_FILTER, /scale=1024:1024/);
  assert.match(LOCKED_FACE_CROP_FILTER, /lanczos/);
});

test("Runway Character Performance uses locked image for identity and video only for acting", async () => {
  let body: Record<string, unknown> = {};
  const provider = new RunwayPilotProvider("secret", (async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "act-two-1" }), { status: 200 });
  }) as typeof fetch);
  assert.deepEqual(await provider.submitCharacterPerformance({ characterImageUrl: "runway://locked-character", referenceVideoUrl: "runway://acting-reference", ratio: "1280:720" }), { taskId: "act-two-1" });
  assert.deepEqual(body, { model: "act_two", character: { type: "image", uri: "runway://locked-character" }, reference: { type: "video", uri: "runway://acting-reference" }, ratio: "1280:720", bodyControl: true, expressionIntensity: 3 });
  await assert.rejects(
    () => provider.submitCharacterPerformance({ characterImageUrl: "https://drive.google.com/locked.jpg", referenceVideoUrl: "runway://acting-reference", ratio: "1280:720" }),
    (error: unknown) => error instanceof PilotProviderError && error.code === "PRIVATE_ASSET_REQUIRED",
  );
});

test("approved performance variant replaces only its pilot shot for full-film reuse", () => {
  const target = { sample_id: "S3", shot_id: "SHOT-005", runway_status: "SUCCEEDED", final_drive_file_id: "old-final" };
  const untouched = { sample_id: "S3", shot_id: "SHOT-006", runway_status: "SUCCEEDED", final_drive_file_id: "other-final" };
  const pilot = { status: "AWAITING_PILOT_QC" as const, tasks: [target, untouched] };
  approvePilotPerformanceVariant({ variant: { status: "AWAITING_VARIANT_QC", shot_id: "SHOT-005", final_drive_file_id: "variant-final" }, pilot });
  assert.equal(target.final_drive_file_id, "variant-final");
  assert.equal(untouched.final_drive_file_id, "other-final");
  assert.throws(() => approvePilotPerformanceVariant({ variant: { status: "PROCESSING_SYNC", shot_id: "SHOT-005", final_drive_file_id: "unsafe" }, pilot }), /NOT_AWAITING_QC/);
});

test("performance prompt stays within Runway's 1000-character contract", () => {
  const prompt = buildPilotPerformancePrompt("Cảnh phòng trọ. ".repeat(100), "Họ kêu mình chuyển hai triệu giữ chỗ, nói ngày đầu đi làm sẽ hoàn lại");
  assert.ok(prompt.length <= 1_000);
  assert.match(prompt, /finger pauses immediately/);
  assert.match(prompt, /two million dong/);
  assert.match(prompt, /exact approved Tường Vy Character Master/);
});

test("private Drive keyframes use a Runway ephemeral upload instead of exposing a protected URL", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const provider = new RunwayPilotProvider("secret", (async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/v1/uploads")) {
      return new Response(JSON.stringify({ uploadUrl: "https://uploads.example.com/signed", fields: { key: "asset-key", policy: "signed" }, runwayUri: "runway://private-keyframe" }), { status: 200 });
    }
    if (String(url) === "https://uploads.example.com/signed") return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ id: "task-private" }), { status: 200 });
  }) as typeof fetch);
  const uploaded = await provider.uploadImage({ content: Buffer.alloc(1_024, 7), fileName: "master.jpg", mimeType: "image/jpeg" });
  assert.deepEqual(uploaded, { uri: "runway://private-keyframe" });
  await provider.submit({ imageUrl: uploaded.uri, prompt: "natural cinematic motion", durationSeconds: 5, ratio: "1280:720" });
  assert.equal(requests.length, 3);
  assert.equal((requests[1]?.init?.body as FormData).get("key"), "asset-key");
  assert.equal((requests[1]?.init?.headers as Record<string, string> | undefined)?.Authorization, undefined);
  assert.match(String(requests[2]?.init?.body), /runway:\/\/private-keyframe/);
  assert.doesNotMatch(String(requests[2]?.init?.body), /drive\.google\.com/);
});

test("only canonical private Google Drive references can be resolved as approved keyframes", () => {
  assert.equal(extractGoogleDriveFileId("https://drive.google.com/file/d/1A173k-4ucI0zsuQKjOa-kxZtXQnqN-0j/view"), "1A173k-4ucI0zsuQKjOa-kxZtXQnqN-0j");
  assert.equal(extractGoogleDriveFileId("https://drive.usercontent.google.com/download?id=1A173k-4ucI0zsuQKjOa-kxZtXQnqN-0j&export=download"), "1A173k-4ucI0zsuQKjOa-kxZtXQnqN-0j");
  assert.throws(() => extractGoogleDriveFileId("https://example.com/master.jpg"), /MUST_BE_GOOGLE_DRIVE/);
});

test("Sync sends sync-3 multipart and exposes stable failure codes", async () => {
  let form: FormData | undefined;
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    form = init?.body as FormData;
    return new Response(JSON.stringify({ id: "sync-1" }), { status: 201, headers: { "content-type": "application/json" } });
  };
  const provider = new SyncPilotProvider("secret", fetcher as typeof fetch);
  assert.deepEqual(await provider.submit({ videoUrl: "https://example.com/video.mp4", audio: Buffer.from([1]), fileName: "line.mp3" }), { generationId: "sync-1" });
  assert.equal(form?.get("model"), "sync-3");
  assert.match(String(form?.get("input")), /video\.mp4/);

  const failing = new SyncPilotProvider("secret", (async () => new Response("busy", { status: 503 })) as typeof fetch);
  await assert.rejects(() => failing.status("sync-1"), (error: unknown) => error instanceof PilotProviderError && error.retryable);
});
