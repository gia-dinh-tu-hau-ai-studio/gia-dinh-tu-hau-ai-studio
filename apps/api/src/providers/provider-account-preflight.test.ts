import assert from "node:assert/strict";
import test from "node:test";
import { checkProviderAccounts } from "./provider-account-preflight";

const request = { project_type: "SHORT_FILM", duration_seconds: 60, providers: { script: "PROJECT_OWNER", video: "RUNWAY", voice: "ELEVENLABS", lip_sync: "NONE" } };

test("khóa chạy khi Runway không đủ credit", async () => {
  const fetcher = async (url: string | URL | Request) => new Response(JSON.stringify(String(url).includes("runway") ? { creditBalance: 100 } : { character_count: 100, character_limit: 10000, status: "active" }), { status: 200 });
  const result = await checkProviderAccounts(request, { RUNWAYML_API_SECRET: "rw", ELEVENLABS_API_KEY: "el" }, fetcher as typeof fetch);
  assert.equal(result.execution_gate, "BLOCKED");
  assert.equal(result.project_creation_gate, "READY");
  assert.equal(result.providers.find((item) => item.provider === "RUNWAY")?.status, "INSUFFICIENT");
  assert.doesNotMatch(JSON.stringify(result), /\brw\b|\bel\b/);
});

test("khởi tạo hồ sơ dự án không bị khóa bởi hạn mức sản xuất toàn phim", async () => {
  const fetcher = async (url: string | URL | Request) => new Response(JSON.stringify(String(url).includes("runway") ? { creditBalance: 700 } : { character_count: 100, character_limit: 10000, status: "active" }), { status: 200 });
  const result = await checkProviderAccounts({ ...request, duration_seconds: 180 }, { RUNWAYML_API_SECRET: "rw", ELEVENLABS_API_KEY: "el" }, fetcher as typeof fetch);
  assert.equal(result.execution_gate, "BLOCKED");
  assert.equal(result.project_creation_gate, "READY");
  assert.equal(result.providers.find((item) => item.provider === "RUNWAY")?.required_units, 3240);
});

test("mở chạy khi các provider có API số dư đều đủ", async () => {
  const fetcher = async (url: string | URL | Request) => new Response(JSON.stringify(String(url).includes("runway") ? { creditBalance: 5000 } : { character_count: 100, character_limit: 10000, status: "active" }), { status: 200 });
  const result = await checkProviderAccounts(request, { RUNWAYML_API_SECRET: "runway-secret", ELEVENLABS_API_KEY: "eleven-secret" }, fetcher as typeof fetch);
  assert.equal(result.execution_gate, "READY");
  assert.ok(result.providers.every((item) => item.status === "SUFFICIENT"));
});

test("yêu cầu xác nhận thủ công khi provider không có API số dư", async () => {
  const result = await checkProviderAccounts({ ...request, providers: { script: "OPENAI_RESPONSES", video: "NONE", voice: "NONE", lip_sync: "SYNC" } }, { OPENAI_API_KEY: "oa", SYNC_API_KEY: "sync" });
  assert.equal(result.execution_gate, "MANUAL_CONFIRMATION_REQUIRED");
  assert.equal(result.script_generation_gate, "READY");
});

test("mở tạo kịch bản khi OpenAI đã cấu hình dù media còn bị khóa", async () => {
  const fetcher = async (url: string | URL | Request) => new Response(JSON.stringify(String(url).includes("runway") ? { creditBalance: 0 } : { character_count: 100, character_limit: 10000, status: "active" }), { status: 200 });
  const result = await checkProviderAccounts({ ...request, providers: { ...request.providers, script: "OPENAI_RESPONSES" } }, { OPENAI_API_KEY: "oa", RUNWAYML_API_SECRET: "rw", ELEVENLABS_API_KEY: "el" }, fetcher as typeof fetch);
  assert.equal(result.execution_gate, "BLOCKED");
  assert.equal(result.script_generation_gate, "READY");
});

test("khóa tạo kịch bản khi OpenAI chưa được cấu hình", async () => {
  const result = await checkProviderAccounts({ ...request, providers: { script: "OPENAI_RESPONSES", video: "NONE", voice: "NONE", lip_sync: "NONE" } }, {});
  assert.equal(result.script_generation_gate, "BLOCKED");
});

test("pilot variant reuses an approved Voice Master without ElevenLabs", async () => {
  const fetcher = async () => new Response(JSON.stringify({ creditBalance: 5000 }), { status: 200 });
  const result = await checkProviderAccounts({
    project_type: "SHORT_FILM", duration_seconds: 10,
    providers: { script: "PROJECT_OWNER", video: "RUNWAY", voice: "APPROVED_VOICE_MASTER", lip_sync: "SYNC" },
  }, { RUNWAYML_API_SECRET: "rw", SYNC_API_KEY: "sync" }, fetcher as typeof fetch);
  assert.equal(result.execution_gate, "MANUAL_CONFIRMATION_REQUIRED");
  assert.deepEqual(result.providers.map((item) => item.provider), ["RUNWAY", "SYNC"]);
});
