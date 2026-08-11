import assert from "node:assert/strict";
import test from "node:test";
import { ElevenLabsPilotProvider, PilotProviderError, RunwayPilotProvider, SyncPilotProvider } from "./short-film-pilot.providers";
import { extractGoogleDriveFileId } from "../connectors/google-drive/drive.connector";
import { rejectPilotForRestart, reviewDialogueAudioGate, verifyVietnameseTranscript } from "./short-film-pilot-execution.service";

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
