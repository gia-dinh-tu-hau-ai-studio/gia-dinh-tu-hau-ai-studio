export class PilotProviderError extends Error {
  constructor(
    readonly provider: "RUNWAY" | "ELEVENLABS" | "SYNC",
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PilotProviderError";
  }
}

async function providerResponse(response: Response, provider: PilotProviderError["provider"]) {
  if (response.ok) return response;
  const body = await response.text();
  const retryable = response.status === 429 || response.status >= 500;
  throw new PilotProviderError(provider, `HTTP_${response.status}`, body.slice(0, 500), retryable);
}

export class RunwayPilotProvider {
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {}

  async submit(input: { imageUrl: string; prompt: string; durationSeconds: number; ratio: "1280:720" | "720:1280" }) {
    if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 2 || input.durationSeconds > 10) {
      throw new PilotProviderError("RUNWAY", "INVALID_DURATION", "Runway shot duration must be 2-10 seconds", false);
    }
    const response = await providerResponse(await this.fetcher("https://api.dev.runwayml.com/v1/image_to_video", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "X-Runway-Version": "2024-11-06", "content-type": "application/json" },
      body: JSON.stringify({ model: "gen4.5", promptImage: input.imageUrl, promptText: input.prompt, ratio: input.ratio, duration: input.durationSeconds }),
      signal: AbortSignal.timeout(20_000),
    }), "RUNWAY");
    const body = await response.json() as { id?: string };
    if (!body.id) throw new PilotProviderError("RUNWAY", "MALFORMED_RESPONSE", "Runway did not return task id", false);
    return { taskId: body.id };
  }

  async status(taskId: string) {
    const response = await providerResponse(await this.fetcher(`https://api.dev.runwayml.com/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${this.apiKey}`, "X-Runway-Version": "2024-11-06" },
      signal: AbortSignal.timeout(10_000),
    }), "RUNWAY");
    const body = await response.json() as { status?: string; output?: string[]; failure?: string; failureCode?: string };
    return { status: body.status ?? "UNKNOWN", outputUrl: body.output?.[0], error: body.failure, errorCode: body.failureCode };
  }
}

export class ElevenLabsPilotProvider {
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {}

  async synthesize(input: { voiceId: string; text: string }) {
    const response = await providerResponse(await this.fetcher(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=mp3_44100_192`,
      {
        method: "POST",
        headers: { "xi-api-key": this.apiKey, "content-type": "application/json" },
        body: JSON.stringify({ text: input.text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true } }),
        signal: AbortSignal.timeout(60_000),
      },
    ), "ELEVENLABS");
    return {
      audio: Buffer.from(await response.arrayBuffer()),
      requestId: response.headers.get("request-id") ?? undefined,
      characterCost: Number(response.headers.get("character-cost") ?? input.text.length),
    };
  }
}

export class SyncPilotProvider {
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {}

  async submit(input: { videoUrl: string; audio: Buffer; fileName: string }) {
    const form = new FormData();
    form.set("input", JSON.stringify([{ type: "video", url: input.videoUrl }]));
    form.set("audio", new Blob([Uint8Array.from(input.audio)], { type: "audio/mpeg" }), input.fileName);
    form.set("model", "sync-3");
    form.set("options", JSON.stringify({ sync_mode: "cut_off" }));
    const response = await providerResponse(await this.fetcher("https://api.sync.so/v2/generate", {
      method: "POST", headers: { "x-api-key": this.apiKey }, body: form, signal: AbortSignal.timeout(30_000),
    }), "SYNC");
    const body = await response.json() as { id?: string };
    if (!body.id) throw new PilotProviderError("SYNC", "MALFORMED_RESPONSE", "Sync did not return generation id", false);
    return { generationId: body.id };
  }

  async status(generationId: string) {
    const response = await providerResponse(await this.fetcher(`https://api.sync.so/v2/generate/${encodeURIComponent(generationId)}?include=progress`, {
      headers: { "x-api-key": this.apiKey }, signal: AbortSignal.timeout(10_000),
    }), "SYNC");
    const body = await response.json() as { status?: string; outputUrl?: string; outputDuration?: number; error?: string; errorCode?: string; progress_percent?: number };
    return body;
  }
}
