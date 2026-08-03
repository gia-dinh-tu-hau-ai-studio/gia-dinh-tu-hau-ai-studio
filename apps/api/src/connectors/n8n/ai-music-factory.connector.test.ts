import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProjectIntake } from "@tu-hau/contracts";
import {
  AiMusicFactoryConnector,
  AiMusicFactoryInvalidResponseError,
} from "./ai-music-factory.connector";

const contract = normalizeProjectIntake({
  project_name: "Pilot Gia Đình Tư Hậu",
  project_type: "SHORT_FILM",
  client_name: "Đoàn Lô Tô Tư Hậu",
  phone: "0900000000",
  email: "studio@example.com",
  platforms: ["YOUTUBE"],
  language: "vi",
  content_rating: "T13",
  target_audience: "Đại chúng",
  duration_target: "10 phút",
  aspect_ratio: "16:9",
  story_idea: "Một câu chuyện hậu trường",
  social_theme: "Tình thân",
  story_genre: "Hài tình cảm",
  primary_setting: "Đoàn Lô Tô",
  ending_direction: "Kết thúc trọn vẹn",
  dialogue_source: "AI_GENERATED",
  characters: [
    {
      character_id: "CHAR_TUONG_VY",
      project_role: "MAIN",
      performance_role: "ACTOR",
      selected_costume_ids: [],
      voice_required: false,
      lip_sync_required: false,
      identity_mode: "LIBRARY_MASTER",
    },
  ],
});

test("gửi contract 331 kèm khóa chống trùng", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.AI_MUSIC_FACTORY_WEBHOOK_URL;
  const originalToken = process.env.AI_MUSIC_FACTORY_WEBHOOK_TOKEN;
  context.after(() => {
    globalThis.fetch = originalFetch;
    process.env.AI_MUSIC_FACTORY_WEBHOOK_URL = originalUrl;
    process.env.AI_MUSIC_FACTORY_WEBHOOK_TOKEN = originalToken;
  });

  process.env.AI_MUSIC_FACTORY_WEBHOOK_URL = "https://n8n.example.com/webhook/ai-music-factory";
  process.env.AI_MUSIC_FACTORY_WEBHOOK_TOKEN = "managed-secret";
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-idempotency-key"), "36b8f84d-df4e-4d49-b662-bcde71a8764f");
    assert.equal(headers.get("authorization"), "Bearer managed-secret");
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.contract_name, "AI_MUSIC_FACTORY_INPUT_CONTRACT");
    assert.equal(payload.contract_version, "3.1");
    assert.equal(payload.source_system, "AI_EXECUTOR-01");
    assert.equal(payload.project_id, undefined);
    assert.equal(payload.project_name, "Pilot Gia Đình Tư Hậu");
    return new Response(JSON.stringify({ project_id: "TH-AIM-20260803-TEST" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await new AiMusicFactoryConnector().createProject(
    contract,
    "36b8f84d-df4e-4d49-b662-bcde71a8764f",
  );
  assert.equal(result.project_id, "TH-AIM-20260803-TEST");
});

test("từ chối phản hồi không có project_id", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.AI_MUSIC_FACTORY_WEBHOOK_URL;
  context.after(() => {
    globalThis.fetch = originalFetch;
    process.env.AI_MUSIC_FACTORY_WEBHOOK_URL = originalUrl;
  });

  process.env.AI_MUSIC_FACTORY_WEBHOOK_URL = "https://n8n.example.com/webhook/ai-music-factory";
  globalThis.fetch = async () => new Response(JSON.stringify({ status: "ok" }));

  await assert.rejects(
    () =>
      new AiMusicFactoryConnector().createProject(
        contract,
        "36b8f84d-df4e-4d49-b662-bcde71a8764f",
      ),
    AiMusicFactoryInvalidResponseError,
  );
});
