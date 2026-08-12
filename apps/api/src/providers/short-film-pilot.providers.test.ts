import assert from "node:assert/strict";
import test from "node:test";
import { ElevenLabsPilotProvider, PilotProviderError, RunwayPilotProvider, SyncPilotProvider } from "./short-film-pilot.providers";
import { extractGoogleDriveFileId } from "../connectors/google-drive/drive.connector";
import { LOCKED_FACE_CROP_FILTER } from "./runway-private-keyframe";
import { approvePilotPerformanceVariant, buildEvaluationReelFacePrompt, buildPilotPerformancePrompt, EVALUATION_PERFORMANCE_CONTRACT, rejectEvaluationReelForRestart, rejectPilotForRestart, resumeEvaluationReelManifest, reviewDialogueAudioGate, reviewEvaluationReelGate, selectEvaluationReelSourceTasks, selectLockedCharacterPerformanceImage, validateEvaluationReelRequest, validateEvaluationReelTechnicalEvidence, validateLockedCharacterPerformanceSource, validatePilotPerformanceVariant, validateProviderReadyFaceReference, verifyVietnameseTranscript } from "./short-film-pilot-execution.service";
import { referenceActorIdsForShot, reviewBackgroundGate } from "./golden-scene-keyframe.service";
import { OpenAiImageEditProvider, reviewCharacterKeyframeGate, validateCharacterKeyframeBudget } from "./openai-character-keyframe.service";
import { validateGoldenSceneMotionBinding } from "./golden-scene-motion-plan.service";

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
  assert.equal(body.apply_text_normalization, "on");
  assert.equal(body.voice_settings.stability, 0.62);
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

test("provider face gate rejects a full-body fallback before Runway is called", () => {
  assert.throws(() => validateProviderReadyFaceReference({ face_reference_url: "body", body_reference_url: "body" }), /SEPARATE_APPROVED_CLOSEUP/);
  assert.equal(validateProviderReadyFaceReference({ face_reference_url: "face", body_reference_url: "body" }), "face");
});

test("evaluation reel prompt keeps the approved face visible and binds acting to Vietnamese dialogue", () => {
  const prompt = buildEvaluationReelFacePrompt({ scenePrompt: "Minh urges Vy to decide", dialogueText: "Em quyết định liền nha" });
  assert.match(prompt, /exact approved and locked character identity/);
  assert.match(prompt, /full head, both eyes, nose, mouth and shoulders visible/);
  assert.match(prompt, /Vietnamese television drama performance/);
  assert.match(prompt, /never use a plain gray studio/);
  assert.match(prompt, /four readable drama beats/);
  assert.match(prompt, /never perform as a presenter or static talking head/);
  assert.match(prompt, /Em quyết định liền nha/);
  assert.ok(prompt.length <= 1_000);
  assert.deepEqual(EVALUATION_PERFORMANCE_CONTRACT.required_beats, ["LISTEN_OR_CONSIDER", "EMOTIONAL_REACTION", "PURPOSEFUL_ACTION", "SETTLE_IN_CHARACTER"]);
});

test("dialogue-audio rejection can restart, but unrelated failures cannot", () => {
  const dialogueRejected = {
    schema_version: "SHORT_FILM_PILOT_PROVIDER_EXECUTION_V1", execution_id: "exec-audio", project_id: "project-1",
    status: "FAILED", samples: [], tasks: [], caps: { runway_credits: 1, elevenlabs_characters: 1, sync_usd: 1 },
    provider_calls_made: true, heartbeat_at: "before", started_at: "before",
    error: { stage: "DIALOGUE_AUDIO_APPROVAL", message: "DIALOGUE_AUDIO_REJECTED_BY_PROJECT_OWNER" },
  } as Parameters<typeof rejectPilotForRestart>[0];
  assert.equal(rejectPilotForRestart(dialogueRejected, "now").failed.error?.stage, "DIALOGUE_AUDIO_APPROVAL");
  assert.equal(rejectPilotForRestart({ ...dialogueRejected, error: { stage: "PROVIDER_PROCESSING", message: "VIETNAMESE_AUDIO_VERIFICATION_FAILED:LINE-003" } }, "now").failed.error?.stage, "PROVIDER_PROCESSING");
  assert.throws(() => rejectPilotForRestart({ ...dialogueRejected, error: { stage: "PROVIDER_PROCESSING", message: "failed" } }, "now"), /NOT_AWAITING/);
});

test("Vietnamese transcript gate rejects a high-similarity wrong word", () => {
  const expected = "Bên anh chỉ còn đúng một suất ưu tiên thôi nghen.";
  const wrong = verifyVietnameseTranscript(expected, {
    text: "Bên anh chỉ còn đúng một sót ưu tiên thôi nhen.",
    languageCode: "vi",
    languageProbability: 0.99,
  });
  assert.ok(wrong.similarity > 0.9);
  assert.ok(wrong.wordAccuracy < 1);
  assert.equal(wrong.passed, false);
  assert.equal(verifyVietnameseTranscript(expected, { text: expected, languageCode: "vi", languageProbability: 0.99 }).passed, true);
  assert.equal(verifyVietnameseTranscript(expected, { text: "Bên anh chỉ còn đúng một suất ưu tiên thôi nghe.", languageCode: "vi", languageProbability: 0.99 }).passed, true);
});

test("evaluation reel technical gate rejects a short reel before owner QC", () => {
  const valid = { duration_seconds: 30.04, width: 1920, height: 1080, has_audio: true };
  assert.equal(validateEvaluationReelTechnicalEvidence(valid), valid);
  assert.throws(() => validateEvaluationReelTechnicalEvidence({ ...valid, duration_seconds: 13.588 }), /ACTUAL_DURATION_MISMATCH/);
  assert.throws(() => validateEvaluationReelTechnicalEvidence({ ...valid, width: 1280 }), /RESOLUTION_MISMATCH/);
  assert.throws(() => validateEvaluationReelTechnicalEvidence({ ...valid, has_audio: false }), /AUDIO_MISSING/);
});

test("owner cannot approve a technically valid reel when any acting QC item is missing", () => {
  const completeQc = { identity_locked: true, cinematic_setting: true, purposeful_action: true, emotional_arc: true, dialogue_lip_sync: true, voice_match: true, continuity: true, exact_duration_30s: true };
  const manifest = { status: "AWAITING_REEL_QC", final_drive_file_id: "reel", technical_evidence: { duration_seconds: 30, width: 1920, height: 1080, has_audio: true }, heartbeat_at: "before" } as Parameters<typeof reviewEvaluationReelGate>[0];
  assert.throws(() => reviewEvaluationReelGate({ ...manifest }, { decision: "APPROVE", qc: { ...completeQc, purposeful_action: false } }, "now"), /QC_INCOMPLETE/);
  assert.equal(reviewEvaluationReelGate({ ...manifest }, { decision: "APPROVE", qc: completeQc }, "now").status, "APPROVED");
  const rejected = reviewEvaluationReelGate({ ...manifest }, { decision: "REJECT", qc: { ...completeQc, cinematic_setting: false } }, "now");
  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.error?.message, "EVALUATION_REEL_REJECTED_BY_PROJECT_OWNER");
});

test("rejected evaluation reel is archived before a new paid execution can replace it", () => {
  const manifest = { execution_id: "old-execution", status: "AWAITING_REEL_QC", heartbeat_at: "before" } as Parameters<typeof rejectEvaluationReelForRestart>[0];
  const rejected = rejectEvaluationReelForRestart(manifest, "2026-08-11T17:00:00.000Z");
  assert.match(rejected.archiveName, /old-execution\.json$/);
  assert.equal(rejected.archived.status, "REJECTED");
  assert.equal(rejected.archived.error.message, "EVALUATION_REEL_REJECTED_BY_PROJECT_OWNER_FOR_RESTART");
  assert.throws(() => rejectEvaluationReelForRestart({ ...manifest, status: "PROCESSING_RUNWAY" }, "now"), /NOT_AWAITING_QC_RESTART/);
});

test("failed reel resumes from first unfinished shot and preserves completed paid work", () => {
  const manifest = { status: "FAILED", current_task_index: 1, tasks: [
    { character_id: "A", completed_video: "done", runway_task_id: "paid", face_reference_url: "a-face", body_reference_url: "a-body", master_identity_id: "A" },
    { character_id: "B", runway_task_id: "failed", runway_status: "FAILED", face_reference_url: "b-body", body_reference_url: "b-body", master_identity_id: "B" },
    { character_id: "A", face_reference_url: "a-face", body_reference_url: "a-body", master_identity_id: "A" },
  ], error: { stage: "RUNWAY", message: "NO_FACE_FOUND" }, heartbeat_at: "before" } as Parameters<typeof resumeEvaluationReelManifest>[0];
  const refreshed = new Map([["A", { face_reference_url: "a-face", body_reference_url: "a-body", master_identity_id: "A" }], ["B", { face_reference_url: "b-face", body_reference_url: "b-body", master_identity_id: "B" }]]);
  const resumed = resumeEvaluationReelManifest(manifest, refreshed);
  assert.equal(resumed.current_task_index, 1); assert.equal(resumed.tasks[0].runway_task_id, "paid"); assert.equal(resumed.tasks[1].runway_task_id, undefined); assert.equal(resumed.tasks[1].face_reference_url, "b-face"); assert.equal(resumed.status, "PROCESSING_RUNWAY");
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

test("Runway Golden Scene keyframe uses gen4_image at 1920x1080 and private identity references only", async () => {
  let url = "", body: Record<string, unknown> = {};
  const provider = new RunwayPilotProvider("secret", (async (input, init) => { url = String(input); body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ id: "keyframe-1" }), { status: 200 }); }) as typeof fetch);
  assert.deepEqual(await provider.submitKeyframe({ prompt: "Cinematic corridor with @Character1", referenceImages: [{ uri: "runway://locked-face", tag: "Character1" }], ratio: "1920:1080" }), { taskId: "keyframe-1" });
  assert.match(url, /\/v1\/text_to_image$/);
  assert.deepEqual(body, { model: "gen4_image", promptText: "Cinematic corridor with @Character1", ratio: "1920:1080", referenceImages: [{ uri: "runway://locked-face", tag: "Character1" }] });
  await assert.rejects(() => provider.submitKeyframe({ prompt: "bad", referenceImages: [{ uri: "https://drive.google.com/file.jpg", tag: "Character1" }], ratio: "1920:1080" }), /private tagged references/);
});

test("Golden Scene close-ups cannot blend the other scene character identity", () => {
  assert.deepEqual(referenceActorIdsForShot("SHOT-006", "PA", ["PA", "TV"]), ["PA", "TV"]);
  assert.deepEqual(referenceActorIdsForShot("SHOT-007", "PA", ["PA", "TV"]), ["PA"]);
  assert.deepEqual(referenceActorIdsForShot("SHOT-008", "TV", ["PA", "TV"]), ["TV"]);
});

test("Golden Scene background approval requires exactly three persisted successful plates", () => {
  const task = (shot_id: string) => ({ shot_id, actor_id: "PA", prompt: "empty corridor", runway_status: "SUCCEEDED", drive_file_id: `${shot_id}-file`, drive_url: `https://drive.google.com/${shot_id}` });
  const manifest = { schema_version: "SHORT_FILM_GOLDEN_SCENE_KEYFRAMES_V1" as const, execution_id: "exec", project_id: "project", status: "AWAITING_KEYFRAME_QC" as const, caps: { runway_credits: 24 as const }, provider_calls_made: true, tasks: [task("SHOT-006"), task("SHOT-007"), task("SHOT-008")], runway_assets: {}, started_at: "2026-01-01", heartbeat_at: "2026-01-01" };
  assert.equal(reviewBackgroundGate(manifest, "APPROVE", "2026-01-02").status, "APPROVED");
  assert.throws(() => reviewBackgroundGate({ ...manifest, status: "AWAITING_KEYFRAME_QC", tasks: manifest.tasks.slice(0, 2) }, "APPROVE", "2026-01-02"), /EVIDENCE_INCOMPLETE/);
});

test("OpenAI Character keyframes require exact three-image one-dollar approval", () => {
  assert.deepEqual(validateCharacterKeyframeBudget({ execution_approved: true, openai_usd_cap: 1, image_count: 3 }), { execution_approved: true, openai_usd_cap: 1, image_count: 3 });
  assert.throws(() => validateCharacterKeyframeBudget({ execution_approved: true, openai_usd_cap: 2, image_count: 3 }), /EXACT_CAP_REQUIRED/);
});

test("OpenAI image edit uses one high-fidelity landscape output and no video provider", async () => {
  let url = "", form: FormData | undefined;
  const provider = new OpenAiImageEditProvider("secret", (async (input, init) => { url = String(input); form = init?.body as FormData; return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("image").toString("base64") }] }), { status: 200 }); }) as typeof fetch);
  const image = { content: Buffer.alloc(600), fileName: "image.png", mimeType: "image/png" };
  await provider.edit({ background: image, characterImages: [image], prompt: "locked identity" });
  assert.equal(url, "https://api.openai.com/v1/images/edits"); assert.equal(form?.get("model"), "gpt-image-1.5"); assert.equal(form?.get("size"), "1536x1024"); assert.equal(form?.get("quality"), "high"); assert.equal(form?.get("input_fidelity"), "high"); assert.equal(form?.get("n"), "1"); assert.equal(form?.getAll("image[]").length, 2);
});

test("Character keyframe approval requires exact shot and locked actor mapping", () => {
  const task = (shot_id: string, actor_id: string) => ({ shot_id, actor_id, character_name: "actor", status: "SUCCEEDED" as const, drive_file_id: `${shot_id}-file`, drive_url: `https://drive.google.com/${shot_id}` });
  const manifest = { schema_version: "SHORT_FILM_OPENAI_CHARACTER_KEYFRAMES_V1" as const, execution_id: "exec", project_id: "project", status: "AWAITING_CHARACTER_KEYFRAME_QC" as const, caps: { openai_usd: 1 as const, image_count: 3 as const }, model: "gpt-image-1.5" as const, tasks: [task("SHOT-006", "GDTH-CHAR-002"), task("SHOT-007", "GDTH-CHAR-002"), task("SHOT-008", "GDTH-CHAR-001")], provider_calls_made: true, started_at: "2026-01-01", heartbeat_at: "2026-01-01" };
  assert.equal(reviewCharacterKeyframeGate(manifest, "APPROVE", "2026-01-02").status, "APPROVED");
  assert.throws(() => reviewCharacterKeyframeGate({ ...manifest, status: "AWAITING_CHARACTER_KEYFRAME_QC", tasks: [task("SHOT-006", "GDTH-CHAR-001"), ...manifest.tasks.slice(1)] }, "APPROVE", "2026-01-02"), /EVIDENCE_INCOMPLETE/);
});

test("Golden Scene motion binds approved keyframe, speaker and Voice Master to the same actor", () => {
  const binding = {
    shotId: "SHOT-006",
    keyframe: { actor_id: "GDTH-CHAR-002" },
    dialogue: { speaker_source_actor_id: "GDTH-CHAR-002", voice_master_id: "VOICE-PA", pronunciation_decision: "APPROVE", age_casting_decision: "APPROVE", timing_decision: "APPROVE" },
    speaker: { speaker_source_actor_id: "GDTH-CHAR-002", voice_master_id: "VOICE-PA" },
    voice: { source_actor_id: "GDTH-CHAR-002", voice_master_id: "VOICE-PA", status: "APPROVED_LOCKED" },
  };
  assert.equal(validateGoldenSceneMotionBinding(binding), true);
  assert.throws(() => validateGoldenSceneMotionBinding({ ...binding, keyframe: { actor_id: "GDTH-CHAR-001" } }), /CHARACTER_SPEAKER_KEYFRAME_MISMATCH/);
  assert.throws(() => validateGoldenSceneMotionBinding({ ...binding, speaker: { ...binding.speaker, voice_master_id: "VOICE-WRONG" } }), /VOICE_SPEAKER_MISMATCH/);
  assert.throws(() => validateGoldenSceneMotionBinding({ ...binding, voice: { ...binding.voice, status: "PENDING" } }), /APPROVED_LOCKED_VOICE_REQUIRED/);
});

test("Golden Scene motion rejects dialogue before pronunciation, age and timing are all approved", () => {
  const binding = {
    shotId: "SHOT-008",
    keyframe: { actor_id: "GDTH-CHAR-001" },
    dialogue: { speaker_source_actor_id: "GDTH-CHAR-001", voice_master_id: "VOICE-TV", pronunciation_decision: "APPROVE", age_casting_decision: "APPROVE", timing_decision: "REQUEST_CHANGES" },
    speaker: { speaker_source_actor_id: "GDTH-CHAR-001", voice_master_id: "VOICE-TV" },
    voice: { source_actor_id: "GDTH-CHAR-001", voice_master_id: "VOICE-TV", status: "APPROVED_LOCKED" },
  };
  assert.throws(() => validateGoldenSceneMotionBinding(binding), /DIALOGUE_QC_INCOMPLETE/);
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
