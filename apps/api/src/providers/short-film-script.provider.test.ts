import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShortFilmScriptPrompt,
  parseShortFilmScriptResponse,
  ShortFilmScriptProvider,
  ShortFilmScriptProviderNotConfiguredError,
} from "./short-film-script.provider";

const request = {
  idea: "Hai chị em hiểu lầm nhau và phải cùng giải quyết một biến cố gia đình.",
  target_duration_minutes: 8,
  language: "vi",
  characters: [{
    source_actor_id: "CHAR-1",
    film_character_name: "An",
    film_role: "PROTAGONIST" as const,
    relationships: "chị em",
    personality: "điềm tĩnh",
    appearance: "theo Character Master",
  }],
  reference_sources: [{
    platform: "YOUTUBE" as const,
    url: "https://www.youtube.com/watch?v=public-reference",
    usage_mode: "INSPIRATION_ONLY" as const,
    rights_confirmed: true as const,
    notes: "Học nhịp kể, không sao chép",
  }],
  provider_budget: {
    internal_services: { post_production: "TUHAUAI_FFMPEG_CLOUD_RUN" as const, music_source: "PROJECT_OWNER_LICENSED" as const },
    providers: { script: "OPENAI_RESPONSES" as const, video: "RUNWAY" as const, voice: "ELEVENLABS" as const, lip_sync: "SYNC" as const },
    estimate: { currency: "USD" as const, script: 1, video: 0, voice: 0, lip_sync: 0, contingency: 0, total: 1 },
    approval: { decision: "APPROVE" as const, approved_limit: 1, reviewer: "PROJECT_OWNER" as const, reviewed_at: "2026-08-09T00:00:00.000Z" },
  },
};

test("prompt kịch bản giữ nhân vật và loại microphone/background khỏi identity", () => {
  const prompt = buildShortFilmScriptPrompt(request);
  assert.match(prompt, /An/);
  assert.match(prompt, /8 phút/);
  assert.match(prompt, /microphone/);
  assert.match(prompt, /không.*thuộc tính cố định/i);
  assert.match(prompt, /youtube\.com\/watch/);
  assert.match(prompt, /Nguồn tham khảo đã xác nhận quyền/);
});

test("đọc structured output kịch bản đúng schema", () => {
  const draft = parseShortFilmScriptResponse({ output_text: JSON.stringify({
    title: "Khoảng cách",
    synopsis: "Hai chị em hóa giải hiểu lầm.",
    full_script: "CẢNH 1 – NỘI – NHÀ – NGÀY\nAn bước vào phòng.",
  }) });
  assert.equal(draft.title, "Khoảng cách");
});

test("từ chối provider output thiếu kịch bản", () => {
  assert.throws(() => parseShortFilmScriptResponse({ output_text: "{}" }), /sai schema/);
});

test("gọi đúng OpenAI Responses contract nhưng không đưa secret vào kết quả", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousModel = process.env.SHORT_FILM_SCRIPT_MODEL;
  const previousFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedAuthorization = "";
  let capturedBody: Record<string, unknown> = {};
  try {
    process.env.OPENAI_API_KEY = "test-only-openai-secret";
    process.env.SHORT_FILM_SCRIPT_MODEL = "test-model";
    globalThis.fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: "resp_mock",
        output_text: JSON.stringify({
          title: "Khoảng cách",
          synopsis: "Hai chị em hóa giải hiểu lầm.",
          full_script: "CẢNH 1 – NỘI – NHÀ – NGÀY\nAn bước vào phòng.",
        }),
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const result = await new ShortFilmScriptProvider().generate(request);
    assert.equal(capturedUrl, "https://api.openai.com/v1/responses");
    assert.equal(capturedAuthorization, "Bearer test-only-openai-secret");
    assert.equal(capturedBody.model, "test-model");
    assert.equal(capturedBody.store, false);
    assert.deepEqual(capturedBody.tools, [{ type: "web_search" }]);
    assert.equal((capturedBody.text as { format: { type: string } }).format.type, "json_schema");
    assert.equal(result.provider_request_id, "resp_mock");
    assert.doesNotMatch(JSON.stringify(result), /test-only-openai-secret/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.SHORT_FILM_SCRIPT_MODEL; else process.env.SHORT_FILM_SCRIPT_MODEL = previousModel;
  }
});

test("không gọi mạng khi thiếu OPENAI_API_KEY", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  let called = false;
  try {
    delete process.env.OPENAI_API_KEY;
    globalThis.fetch = async () => { called = true; throw new Error("unexpected fetch"); };
    await assert.rejects(
      () => new ShortFilmScriptProvider().generate(request),
      ShortFilmScriptProviderNotConfiguredError,
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
  }
});
