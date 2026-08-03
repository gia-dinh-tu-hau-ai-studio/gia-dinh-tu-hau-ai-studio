import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProjectIntake } from "./index";

const common = {
  project_name: "Pilot Gia Đình Tư Hậu",
  client_name: "Đoàn Lô Tô Tư Hậu",
  language: "vi",
  content_rating: "T13",
  target_audience: "Đại chúng",
  duration_target: "10 phút",
  aspect_ratio: "16:9",
};

test("chuẩn hóa payload SHORT_FILM", () => {
  const result = normalizeProjectIntake({
    ...common,
    project_type: "SHORT_FILM",
    story_idea: "Một câu chuyện hậu trường",
    social_theme: "Tình thân",
    story_genre: "Hài tình cảm",
    primary_setting: "Đoàn Lô Tô",
    ending_direction: "Kết thúc trọn vẹn",
    dialogue_source: "AI_GENERATED",
  });

  assert.equal(result.project_type, "SHORT_FILM");
});

test("chuẩn hóa payload MUSIC_VIDEO", () => {
  const result = normalizeProjectIntake({
    ...common,
    project_type: "MUSIC_VIDEO",
    song_title: "Lời Người Đi Trước",
    song_topic: "Tình chị em",
    music_genre: "Dân ca Nam Bộ",
    lyrics_source_mode: "USER_PROVIDED_LOCKED",
    lyrics: "Lời bài hát đã khóa",
    music_source_mode: "EXISTING_INSTRUMENTAL",
    vocal_source_mode: "REAL_RECORDED_VOCAL",
    visual_direction: "Miền Tây cinematic",
  });

  assert.equal(result.project_type, "MUSIC_VIDEO");
});

test("SHORT_MUSIC_CLIP không tạo project_type backend mới", () => {
  const result = normalizeProjectIntake({
    ...common,
    project_type: "SHORT_MUSIC_CLIP",
    music_source_mode: "EXISTING_SONG",
    clip_start_time: "00:30",
    clip_end_time: "01:30",
    vocal_source_mode: "EXISTING_MASTER_AUDIO",
    visual_direction: "Biểu diễn sân khấu",
  });

  assert.equal(result.project_type, "MUSIC_VIDEO");
  assert.equal(result.project_subtype, "SHORT_MUSIC_CLIP");
});
