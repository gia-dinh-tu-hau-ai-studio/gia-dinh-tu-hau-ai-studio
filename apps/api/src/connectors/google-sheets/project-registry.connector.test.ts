import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProjectIntake } from "@tu-hau/contracts";
import { buildProjectId } from "./project-registry.connector";

test("tạo mã dự án MV Gia Đình Tư Hậu", () => {
  const contract = normalizeProjectIntake({
    project_name: "MV Gia Đình Tư Hậu", project_type: "MUSIC_VIDEO",
    client_name: "Gia Đình Tư Hậu", phone: "0900000000", email: "studio@example.com",
    platforms: ["YOUTUBE"], language: "vi", content_rating: "T13",
    target_audience: "Đại chúng", duration_target: "4 phút", aspect_ratio: "16:9",
    characters: [{
      character_id: "GDTH-CHAR-001", project_role: "MAIN", performance_role: "SINGER",
      selected_costume_ids: [], voice_required: false, lip_sync_required: true,
      identity_mode: "ORIGINAL_FACE_COMPOSITE", original_video_file_id: "drive-video-id",
    }],
    song_title: "Gia Đình Tư Hậu", song_topic: "Tình thân", music_genre: "Dân ca Nam Bộ",
    lyrics_source_mode: "USER_PROVIDED_LOCKED", lyrics: "Lời đã duyệt",
    music_source_mode: "NEW_STUDIO_PRODUCTION", vocal_source_mode: "REAL_RECORDED_VOCAL",
    visual_direction: "Người thật, miền Tây cinematic",
  });
  assert.equal(buildProjectId(contract, new Date("2026-08-04T01:02:03.000Z"), "ABCD"),
    "GDTH-MV-20260804010203-ABCD");
});
