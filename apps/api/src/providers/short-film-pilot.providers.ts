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

  async uploadImage(input: { content: Buffer; fileName: string; mimeType: "image/jpeg" | "image/png" | "image/webp" }) {
    if (input.content.length < 512 || input.content.length > 200 * 1024 * 1024) {
      throw new PilotProviderError("RUNWAY", "INVALID_IMAGE_SIZE", `Runway image must be 512 bytes to 200 MB; received ${input.content.length}`, false);
    }
    const created = await providerResponse(await this.fetcher("https://api.dev.runwayml.com/v1/uploads", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "X-Runway-Version": "2024-11-06", "content-type": "application/json" },
      body: JSON.stringify({ filename: input.fileName, type: "ephemeral" }),
      signal: AbortSignal.timeout(20_000),
    }), "RUNWAY");
    const upload = await created.json() as { uploadUrl?: string; fields?: Record<string, string>; runwayUri?: string };
    if (!upload.uploadUrl || !upload.fields || !upload.runwayUri?.startsWith("runway://")) {
      throw new PilotProviderError("RUNWAY", "MALFORMED_UPLOAD_RESPONSE", "Runway did not return a valid ephemeral upload", false);
    }
    const form = new FormData();
    for (const [key, value] of Object.entries(upload.fields)) form.set(key, value);
    form.set("file", new Blob([Uint8Array.from(input.content)], { type: input.mimeType }), input.fileName);
    const uploaded = await this.fetcher(upload.uploadUrl, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
    if (!uploaded.ok) {
      throw new PilotProviderError("RUNWAY", `UPLOAD_HTTP_${uploaded.status}`, (await uploaded.text()).slice(0, 500), false);
    }
    return { uri: upload.runwayUri };
  }

  async uploadVideo(input: { content: Buffer; fileName: string; mimeType: "video/mp4" }) {
    if (input.content.length < 512 || input.content.length > 200 * 1024 * 1024) {
      throw new PilotProviderError("RUNWAY", "INVALID_VIDEO_SIZE", `Runway video must be 512 bytes to 200 MB; received ${input.content.length}`, false);
    }
    const created = await providerResponse(await this.fetcher("https://api.dev.runwayml.com/v1/uploads", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "X-Runway-Version": "2024-11-06", "content-type": "application/json" },
      body: JSON.stringify({ filename: input.fileName, type: "ephemeral" }),
      signal: AbortSignal.timeout(20_000),
    }), "RUNWAY");
    const upload = await created.json() as { uploadUrl?: string; fields?: Record<string, string>; runwayUri?: string };
    if (!upload.uploadUrl || !upload.fields || !upload.runwayUri?.startsWith("runway://")) {
      throw new PilotProviderError("RUNWAY", "MALFORMED_UPLOAD_RESPONSE", "Runway did not return a valid ephemeral upload", false);
    }
    const form = new FormData();
    for (const [key, value] of Object.entries(upload.fields)) form.set(key, value);
    form.set("file", new Blob([Uint8Array.from(input.content)], { type: input.mimeType }), input.fileName);
    const uploaded = await this.fetcher(upload.uploadUrl, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
    if (!uploaded.ok) throw new PilotProviderError("RUNWAY", `UPLOAD_HTTP_${uploaded.status}`, (await uploaded.text()).slice(0, 500), false);
    return { uri: upload.runwayUri };
  }

  async submitCharacterPerformance(input: {
    characterImageUrl: string;
    referenceVideoUrl: string;
    ratio: "1280:720" | "720:1280";
  }) {
    if (!input.characterImageUrl.startsWith("runway://") || !input.referenceVideoUrl.startsWith("runway://")) {
      throw new PilotProviderError("RUNWAY", "PRIVATE_ASSET_REQUIRED", "Character Performance requires private Runway assets", false);
    }
    const response = await providerResponse(await this.fetcher("https://api.dev.runwayml.com/v1/character_performance", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "X-Runway-Version": "2024-11-06", "content-type": "application/json" },
      body: JSON.stringify({
        model: "act_two",
        character: { type: "image", uri: input.characterImageUrl },
        reference: { type: "video", uri: input.referenceVideoUrl },
        ratio: input.ratio,
        bodyControl: true,
        expressionIntensity: 3,
      }),
      signal: AbortSignal.timeout(20_000),
    }), "RUNWAY");
    const body = await response.json() as { id?: string };
    if (!body.id) throw new PilotProviderError("RUNWAY", "MALFORMED_RESPONSE", "Runway did not return Character Performance task id", false);
    return { taskId: body.id };
  }

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

  async synthesize(input: { voiceId: string; text: string; languageCode: "vi" }) {
    const response = await providerResponse(await this.fetcher(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": this.apiKey, "content-type": "application/json" },
        body: JSON.stringify({ text: input.text, model_id: "eleven_v3", language_code: input.languageCode, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true } }),
        signal: AbortSignal.timeout(60_000),
      },
    ), "ELEVENLABS");
    return {
      audio: Buffer.from(await response.arrayBuffer()),
      requestId: response.headers.get("request-id") ?? undefined,
      characterCost: Number(response.headers.get("character-cost") ?? input.text.length),
      modelId: "eleven_v3" as const,
      languageCode: input.languageCode,
    };
  }

  async transcribeVietnamese(audio: Buffer) {
    const form = new FormData();
    form.set("file", new Blob([Uint8Array.from(audio)], { type: "audio/mpeg" }), "approved-dialogue.mp3");
    form.set("model_id", "scribe_v2");
    form.set("language_code", "vi");
    form.set("tag_audio_events", "false");
    form.set("diarize", "false");
    const response = await providerResponse(await this.fetcher("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST", headers: { "xi-api-key": this.apiKey }, body: form, signal: AbortSignal.timeout(60_000),
    }), "ELEVENLABS");
    const body = await response.json() as { text?: string; language_code?: string; language_probability?: number };
    if (!body.text || !body.language_code) throw new PilotProviderError("ELEVENLABS", "MALFORMED_TRANSCRIPT", "ElevenLabs did not return transcript evidence", false);
    return { text: body.text, languageCode: body.language_code.toLowerCase(), languageProbability: body.language_probability ?? 0, requestId: response.headers.get("request-id") ?? undefined, modelId: "scribe_v2" as const };
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
