import { z } from "zod";

export const FormProjectTypeSchema = z.enum([
  "SHORT_FILM",
  "MUSIC_VIDEO",
  "SHORT_MUSIC_CLIP",
]);

export const BackendProjectTypeSchema = z.enum(["SHORT_FILM", "MUSIC_VIDEO"]);

export const ProjectRoleSchema = z.enum([
  "MAIN",
  "SUPPORTING",
  "GUEST",
  "CAMEO",
  "BACKGROUND",
]);

export const PerformanceRoleSchema = z.enum([
  "ACTOR",
  "SINGER",
  "DANCER",
  "MC",
  "COMEDIAN",
  "BAND_MEMBER",
  "AUDIENCE",
  "EXTRA",
]);

export const IdentityModeSchema = z.enum([
  "LIBRARY_MASTER",
  "ORIGINAL_FACE_COMPOSITE",
]);

export const CharacterAssignmentSchema = z
  .object({
    character_id: z.string().trim().min(1),
    project_role: ProjectRoleSchema,
    performance_role: PerformanceRoleSchema,
    selected_costume_ids: z.array(z.string().trim().min(1)).min(1),
    costume_approval_status: z.literal("APPROVED"),
    voice_required: z.boolean(),
    voice_approval_status: z.literal("APPROVED").optional(),
    lip_sync_required: z.boolean(),
    identity_mode: IdentityModeSchema,
    original_video_file_id: z.string().trim().min(1).optional(),
  })
  .superRefine((character, context) => {
    if (
      character.identity_mode === "ORIGINAL_FACE_COMPOSITE" &&
      !character.original_video_file_id
    ) {
      context.addIssue({
        code: "custom",
        message: "ORIGINAL_FACE_COMPOSITE bắt buộc có file_id video gốc",
        path: ["original_video_file_id"],
      });
    }

    if (character.voice_required && character.voice_approval_status !== "APPROVED") {
      context.addIssue({
        code: "custom",
        message: "Voice được sử dụng phải có trạng thái APPROVED",
        path: ["voice_approval_status"],
      });
    }
  });

export type CharacterAssignment = z.infer<typeof CharacterAssignmentSchema>;

const OptionalText = z.string().trim().min(1).optional();

export const CommonProjectInputSchema = z.object({
  project_name: z.string().trim().min(1, "Tên dự án là bắt buộc"),
  project_type: FormProjectTypeSchema,
  client_name: z.string().trim().min(1, "Khách hàng/đơn vị là bắt buộc"),
  project_subtype: OptionalText,
  priority: OptionalText,
  execution_mode: OptionalText,
  language: z.string().trim().min(1),
  content_rating: z.string().trim().min(1),
  target_audience: z.string().trim().min(1),
  duration_target: z.string().trim().min(1),
  aspect_ratio: z.string().trim().min(1),
  characters: z.array(CharacterAssignmentSchema).min(1, "Phải chọn ít nhất một nhân vật"),
});

const ShortFilmBranchSchema = z.object({
  story_idea: z.string().trim().min(1),
  social_theme: z.string().trim().min(1),
  story_genre: z.string().trim().min(1),
  primary_setting: z.string().trim().min(1),
  ending_direction: z.string().trim().min(1),
  dialogue_source: z.string().trim().min(1),
});

const MusicVideoBranchSchema = z.object({
  song_title: z.string().trim().min(1),
  song_topic: z.string().trim().min(1),
  music_genre: z.string().trim().min(1),
  lyrics_source_mode: z.enum(["USER_PROVIDED_LOCKED", "AI_GENERATED"]),
  lyrics: OptionalText,
  music_source_mode: z.enum([
    "AI_COMPOSITION",
    "EXISTING_INSTRUMENTAL",
    "EXISTING_SONG",
    "NEW_STUDIO_PRODUCTION",
  ]),
  vocal_source_mode: z.enum([
    "REAL_RECORDED_VOCAL",
    "AUTHORIZED_VOICE_MODEL",
    "EXISTING_MASTER_AUDIO",
  ]),
  visual_direction: z.string().trim().min(1),
});

const ShortMusicClipBranchSchema = z.object({
  music_source_mode: z.enum([
    "AI_COMPOSITION",
    "EXISTING_INSTRUMENTAL",
    "EXISTING_SONG",
    "NEW_STUDIO_PRODUCTION",
  ]),
  clip_start_time: z.string().trim().min(1),
  clip_end_time: z.string().trim().min(1),
  vocal_source_mode: z
    .enum([
      "REAL_RECORDED_VOCAL",
      "AUTHORIZED_VOICE_MODEL",
      "EXISTING_MASTER_AUDIO",
    ])
    .optional(),
  visual_direction: z.string().trim().min(1),
});

export const ProjectIntakeFormSchema = z.discriminatedUnion("project_type", [
  CommonProjectInputSchema.extend({
    project_type: z.literal("SHORT_FILM"),
  }).merge(ShortFilmBranchSchema),
  CommonProjectInputSchema.extend({
    project_type: z.literal("MUSIC_VIDEO"),
  }).merge(MusicVideoBranchSchema),
  CommonProjectInputSchema.extend({
    project_type: z.literal("SHORT_MUSIC_CLIP"),
  }).merge(ShortMusicClipBranchSchema),
]);

export type ProjectIntakeForm = z.infer<typeof ProjectIntakeFormSchema>;

export type NormalizedProjectIntake = Omit<ProjectIntakeForm, "project_type"> & {
  project_type: z.infer<typeof BackendProjectTypeSchema>;
  project_subtype?: string;
};

export function normalizeProjectIntake(input: unknown): NormalizedProjectIntake {
  const parsed = ProjectIntakeFormSchema.parse(input);

  if (parsed.project_type === "SHORT_MUSIC_CLIP") {
    return {
      ...parsed,
      project_type: "MUSIC_VIDEO",
      project_subtype: "SHORT_MUSIC_CLIP",
    };
  }

  return parsed;
}
