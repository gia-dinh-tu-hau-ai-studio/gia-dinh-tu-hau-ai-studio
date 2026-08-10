import assert from "node:assert/strict";
import test from "node:test";
import { ElevenLabsPilotProvider, PilotProviderError, RunwayPilotProvider, SyncPilotProvider } from "./short-film-pilot.providers";

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

test("ElevenLabs returns audio and billing metadata without exposing the key", async () => {
  let requestedUrl = "";
  const provider = new ElevenLabsPilotProvider("secret", (async (url) => {
    requestedUrl = String(url);
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200, headers: { "request-id": "req-1", "character-cost": "12" },
    });
  }) as typeof fetch);
  const output = await provider.synthesize({ voiceId: "voice-1", text: "Xin chào" });
  assert.equal(output.audio.length, 3);
  assert.equal(output.requestId, "req-1");
  assert.equal(output.characterCost, 12);
  assert.match(requestedUrl, /output_format=mp3_44100_128$/);
  assert.doesNotMatch(requestedUrl, /mp3_44100_192/);
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
