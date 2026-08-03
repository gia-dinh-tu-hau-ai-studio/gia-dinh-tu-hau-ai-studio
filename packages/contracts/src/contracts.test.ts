import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProjectIntake } from "./index";

const common = {
  project_name: "Pilot Gia Đình Tư Hậu",
  client_name: "Đoàn Lô Tô Tư Hậu",
  phone: "0900000000",
  email: "studio@example.com",
  platforms: ["YOUTUBE"],
  language: "vi",
  content_rating: "T13",
  target_audience: "Đại chúng",
  duration_target: "10 phút",
  aspect_ratio: "16:9",
  characters: [
    {
      character_id: "CHAR_TUONG_VY",
      project_role: "MAIN",
      performance_role: "SINGER",
      selected_costume_ids: ["COSTUME_TUONG_VY_DEFAULT"],
      costume_approval_status: "APPROVED",
      voice_required: true,
      voice_approval_status: "APPROVED",
      lip_sync_required: true,
      identity_mode: "LIBRARY_MASTER",
    },
  ],
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

test("chấp nhận nhân vật thư viện với costume và voice APPROVED", () => {
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

  assert.equal(result.characters[0]?.character_id, "CHAR_TUONG_VY");
  assert.equal(result.characters[0]?.voice_approval_status, "APPROVED");
});

test("từ chối ORIGINAL_FACE_COMPOSITE khi thiếu file_id video gốc", () => {
  assert.throws(() =>
    normalizeProjectIntake({
      ...common,
      characters: [
        {
          ...common.characters[0],
          identity_mode: "ORIGINAL_FACE_COMPOSITE",
        },
      ],
      project_type: "MUSIC_VIDEO",
      song_title: "Lời Người Đi Trước",
      song_topic: "Tình chị em",
      music_genre: "Dân ca Nam Bộ",
      lyrics_source_mode: "USER_PROVIDED_LOCKED",
      lyrics: "Lời bài hát đã khóa",
      music_source_mode: "EXISTING_INSTRUMENTAL",
      vocal_source_mode: "REAL_RECORDED_VOCAL",
      visual_direction: "Miền Tây cinematic",
    }),
  );
});

test("chấp nhận nhân vật hợp lệ khi chưa chọn costume", () => {
  const result = normalizeProjectIntake({
    ...common,
    characters: [
      {
        ...common.characters[0],
        selected_costume_ids: [],
        costume_approval_status: undefined,
      },
    ],
    project_type: "SHORT_FILM",
    story_idea: "Một câu chuyện hậu trường",
    social_theme: "Tình thân",
    story_genre: "Hài tình cảm",
    primary_setting: "Đoàn Lô Tô",
    ending_direction: "Kết thúc trọn vẹn",
    dialogue_source: "AI_GENERATED",
  });

  assert.deepEqual(result.characters[0]?.selected_costume_ids, []);
});
