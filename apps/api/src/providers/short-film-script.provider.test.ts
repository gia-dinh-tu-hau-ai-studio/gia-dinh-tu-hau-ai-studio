import assert from "node:assert/strict";
import test from "node:test";
import { buildShortFilmScriptPrompt, parseShortFilmScriptResponse } from "./short-film-script.provider";

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
};

test("prompt kịch bản giữ nhân vật và loại microphone/background khỏi identity", () => {
  const prompt = buildShortFilmScriptPrompt(request);
  assert.match(prompt, /An/);
  assert.match(prompt, /8 phút/);
  assert.match(prompt, /microphone/);
  assert.match(prompt, /không.*thuộc tính cố định/i);
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
