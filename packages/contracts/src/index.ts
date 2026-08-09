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
    selected_costume_ids: z.array(z.string().trim().min(1)).default([]),
    costume_approval_status: z.literal("APPROVED").optional(),
    voice_required: z.boolean(),
    voice_approval_status: z.literal("APPROVED").optional(),
    lip_sync_required: z.boolean(),
    identity_mode: IdentityModeSchema,
    original_video_file_id: z.string().trim().min(1).optional(),
  })
  .superRefine((character, context) => {
    if (
      character.selected_costume_ids.length > 0 &&
      character.costume_approval_status !== "APPROVED"
    ) {
      context.addIssue({
        code: "custom",
        message: "Costume được sử dụng phải có trạng thái APPROVED",
        path: ["costume_approval_status"],
      });
    }

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

export const ReviewDecisionSchema = z.enum([
  "PENDING",
  "REQUEST_CHANGES",
  "APPROVE",
  "REJECT",
]);

export const ShortFilmRoleSchema = z.enum([
  "PROTAGONIST",
  "ANTAGONIST",
  "SUPPORTING",
  "CAMEO",
  "EXTRA",
]);

export const ShortFilmSourceActorSchema = z.object({
  source_actor_id: z.string().trim().min(1),
  source_actor_name: z.string().trim().min(1),
  source_kind: z.enum(["TEMPORARY_APPROVED_SOURCE", "CHARACTER_LIBRARY_MASTER"]),
  master_identity_status: z.enum(["TEMPORARY", "APPROVED_LOCKED"]),
});

export const ShortFilmCharacterSchema = z.object({
  source_actor_id: z.string().trim().min(1),
  film_character_name: z.string().trim().min(1),
  film_role: ShortFilmRoleSchema,
  relationships: z.string().trim().min(1),
  personality: z.string().trim().min(1),
  appearance: z.string().trim().min(1),
});

export const ShortFilmReviewSchema = z.object({
  decision: ReviewDecisionSchema,
  notes: z.string().trim().default(""),
  reviewer: z.literal("PROJECT_OWNER").default("PROJECT_OWNER"),
  reviewed_at: z.string().datetime().optional(),
});

export const ShortFilmQcSchema = z.object({
  identity: z.boolean(),
  motion: z.boolean(),
  lip_sync: z.boolean(),
  voice: z.boolean(),
  background: z.boolean(),
  lighting: z.boolean(),
  continuity: z.boolean(),
});

export const ShortFilmLockedIdentitySchema = z.object({
  source_actor_id: z.string().trim().min(1),
  master_identity_id: z.string().trim().min(1),
  reference_set_version: z.string().trim().min(1),
  status: z.literal("APPROVED_LOCKED"),
});

export const ShortFilmLockedVoiceSchema = z.object({
  source_actor_id: z.string().trim().min(1),
  voice_master_id: z.string().trim().min(1),
  casting_profile: z.string().trim().min(1),
  status: z.literal("APPROVED_LOCKED"),
});

export const ShortFilmKeyframeApprovalSchema = z.object({
  shot_id: z.string().trim().min(1),
  approved_image_url: z.url(),
  identity_decision: z.literal("APPROVE"),
  continuity_decision: z.literal("APPROVE"),
  reviewer: z.literal("PROJECT_OWNER").default("PROJECT_OWNER"),
  reviewed_at: z.string().datetime(),
});

export const ShortFilmSpeakerLockSchema = z
  .object({
    shot_id: z.string().trim().min(1),
    speaker_source_actor_id: z.string().trim().min(1),
    voice_master_id: z.string().trim().min(1),
    visible_face_count: z.number().int().min(1),
    selection_mode: z.enum(["SINGLE_VISIBLE_FACE", "MANUAL_FACE_TRACK"]),
    face_track_id: z.string().trim().min(1).optional(),
  })
  .superRefine((lock, context) => {
    if (lock.visible_face_count > 1 && lock.selection_mode !== "MANUAL_FACE_TRACK") {
      context.addIssue({
        code: "custom",
        message: "Shots with multiple visible faces require MANUAL_FACE_TRACK",
        path: ["selection_mode"],
      });
    }
    if (lock.selection_mode === "MANUAL_FACE_TRACK" && !lock.face_track_id) {
      context.addIssue({
        code: "custom",
        message: "MANUAL_FACE_TRACK requires face_track_id",
        path: ["face_track_id"],
      });
    }
  });

export const ShortFilmProductionReadinessSchema = z.object({
  identity_masters: z.array(ShortFilmLockedIdentitySchema).min(1),
  voice_masters: z.array(ShortFilmLockedVoiceSchema).default([]),
  keyframes: z.array(ShortFilmKeyframeApprovalSchema).min(1),
  dialogue_shot_ids: z.array(z.string().trim().min(1)).default([]),
  speaker_locks: z.array(ShortFilmSpeakerLockSchema).default([]),
  review: ShortFilmReviewSchema,
});

export const ShortFilmProviderConfigSchema = z.object({
  script: z.literal("OPENAI_RESPONSES"),
  image_to_video: z.literal("RUNWAY_IMAGE_TO_VIDEO"),
  lip_sync: z.literal("SYNC_LIP_SYNC"),
  voice: z.literal("APPROVED_VOICE_MASTER"),
  execution_mode: z.literal("APPROVAL_GATED"),
});

export const ShortFilmScriptDraftSchema = z.object({
  title: z.string().trim().min(1),
  synopsis: z.string().trim().min(1),
  full_script: z.string().trim().min(1),
});

export const ShortFilmScriptGenerationRecordSchema = z.object({
  provider: z.literal("OPENAI_RESPONSES"),
  model: z.string().trim().min(1),
  provider_request_id: z.string().trim().min(1).nullable(),
  generated_at: z.string().datetime(),
  usage: z.object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
  }).nullable(),
});

export const ShortFilmScriptGenerationRequestSchema = z.object({
  idea: z.string().trim().min(20).max(12_000),
  target_duration_minutes: z.number().int().min(1).max(60),
  language: z.string().trim().min(2).max(20).default("vi"),
  characters: z.array(ShortFilmCharacterSchema).min(1).max(20),
});

export type ShortFilmScriptGenerationRequest = z.infer<typeof ShortFilmScriptGenerationRequestSchema>;
export type ShortFilmScriptDraft = z.infer<typeof ShortFilmScriptDraftSchema>;

export const ShortFilmWorkflowSchema = z
  .object({
    schema_version: z.literal("SHORT_FILM_FORM_V1"),
    character_count: z.number().int().min(1).max(20),
    source_actors: z.array(ShortFilmSourceActorSchema).min(1),
    film_characters: z.array(ShortFilmCharacterSchema).min(1),
    script_source: z.enum([
      "AI_GENERATED",
      "PROJECT_OWNER_PROVIDED",
      "AI_DEVELOPED_FROM_IDEA",
    ]),
    idea_brief: z.string().trim().min(20).max(12_000),
    target_duration_minutes: z.number().int().min(1).max(60),
    providers: ShortFilmProviderConfigSchema,
    script_generation: ShortFilmScriptGenerationRecordSchema.optional(),
    script_title: z.string().trim().min(1),
    script_synopsis: z.string().trim().min(1),
    full_script: z.string().trim().min(1),
    script_review: ShortFilmReviewSchema,
    dialogue: z.object({
      language: z.string().trim().min(1),
      dialogue_mode: z.enum(["DIALOGUE", "VOICE_OVER", "MIXED"]),
      voice_master_mode: z.enum([
        "APPROVED_VOICE_MASTER_ONLY",
        "OWNER_RECORDED_DIALOGUE",
        "NO_DIALOGUE",
      ]),
      singing_scene: z.boolean(),
      singing_scene_notes: z.string().trim().default(""),
    }),
    shot_plan: z
      .object({
        summary: z.string().trim().min(1),
        shots: z.array(z.string().trim().min(1)).min(1),
      })
      .optional(),
    production_readiness: ShortFilmProductionReadinessSchema.optional(),
    pilot: z
      .object({
        duration_seconds: z.number().min(10).max(20),
        video_url: z.url(),
        qc: ShortFilmQcSchema,
        review: ShortFilmReviewSchema,
      })
      .optional(),
    full_film: z
      .object({
        video_url: z.url(),
        qc: ShortFilmQcSchema,
        review: ShortFilmReviewSchema,
      })
      .optional(),
  })
  .superRefine((workflow, context) => {
    if (workflow.film_characters.length !== workflow.character_count) {
      context.addIssue({
        code: "custom",
        message: "Số nhân vật phải khớp danh sách vai diễn",
        path: ["film_characters"],
      });
    }
    const actorIds = new Set(workflow.source_actors.map((actor) => actor.source_actor_id));
    workflow.film_characters.forEach((character, index) => {
      if (!actorIds.has(character.source_actor_id)) {
        context.addIssue({
          code: "custom",
          message: "Diễn viên nguồn không nằm trong danh sách đã chọn",
          path: ["film_characters", index, "source_actor_id"],
        });
      }
    });
    if (workflow.dialogue.singing_scene && !workflow.dialogue.singing_scene_notes) {
      context.addIssue({
        code: "custom",
        message: "Cảnh hát phải có mô tả và nguồn giọng",
        path: ["dialogue", "singing_scene_notes"],
      });
    }
    if (workflow.script_review.decision !== "APPROVE" && workflow.shot_plan) {
      context.addIssue({
        code: "custom",
        message: "SCRIPT_APPROVED là bắt buộc trước Shot Plan",
        path: ["shot_plan"],
      });
    }
    if (workflow.pilot && (!workflow.shot_plan || workflow.script_review.decision !== "APPROVE")) {
      context.addIssue({
        code: "custom",
        message: "Pilot chỉ được khai báo sau SCRIPT_APPROVED và Shot Plan",
        path: ["pilot"],
      });
    }
    if (workflow.pilot?.review.decision === "APPROVE" && !shortFilmQcPassed(workflow.pilot.qc)) {
      context.addIssue({
        code: "custom",
        message: "Không thể đặt PILOT_APPROVED khi checklist QC chưa đạt toàn bộ",
        path: ["pilot", "review"],
      });
    }
    if (workflow.full_film && workflow.pilot?.review.decision !== "APPROVE") {
      context.addIssue({
        code: "custom",
        message: "PILOT_APPROVED là bắt buộc trước sản xuất toàn phim",
        path: ["full_film"],
      });
    }
    if (workflow.full_film?.review.decision === "APPROVE" && !shortFilmQcPassed(workflow.full_film.qc)) {
      context.addIssue({
        code: "custom",
        message: "Không thể duyệt phim hoàn chỉnh khi checklist QC chưa đạt toàn bộ",
        path: ["full_film", "review"],
      });
    }
  });

export type ShortFilmWorkflow = z.infer<typeof ShortFilmWorkflowSchema>;

export const ShortFilmWorkflowUpdateRequestSchema = z.object({
  workflow: ShortFilmWorkflowSchema,
});

export type ShortFilmWorkflowUpdateRequest = z.infer<typeof ShortFilmWorkflowUpdateRequestSchema>;

export function shortFilmQcPassed(qc: z.infer<typeof ShortFilmQcSchema>) {
  return Object.values(qc).every(Boolean);
}

export function shortFilmProductionReadinessBlockers(
  workflow: Pick<
    z.infer<typeof ShortFilmWorkflowSchema>,
    "source_actors" | "film_characters" | "dialogue" | "shot_plan" | "production_readiness"
  >,
) {
  const readiness = workflow.production_readiness;
  if (!readiness) return ["PRODUCTION_READINESS_MISSING"];
  const blockers: string[] = [];
  const usedActorIds = new Set(workflow.film_characters.map((character) => character.source_actor_id));
  const sourceActors = new Map(workflow.source_actors.map((actor) => [actor.source_actor_id, actor]));
  const identityActorIds = new Set(readiness.identity_masters.map((master) => master.source_actor_id));
  const voiceByActor = new Map(readiness.voice_masters.map((master) => [master.source_actor_id, master]));

  for (const actorId of usedActorIds) {
    if (sourceActors.get(actorId)?.master_identity_status !== "APPROVED_LOCKED" || !identityActorIds.has(actorId)) {
      blockers.push(`IDENTITY_MASTER_NOT_LOCKED:${actorId}`);
    }
    if (workflow.dialogue.voice_master_mode === "APPROVED_VOICE_MASTER_ONLY" && !voiceByActor.has(actorId)) {
      blockers.push(`VOICE_MASTER_NOT_LOCKED:${actorId}`);
    }
  }

  const expectedKeyframes = workflow.shot_plan?.shots.length ?? 0;
  const expectedShotIds = new Set(Array.from({ length: expectedKeyframes }, (_, index) => `SHOT-${String(index + 1).padStart(3, "0")}`));
  const approvedShotIds = new Set(readiness.keyframes.map((keyframe) => keyframe.shot_id));
  if (expectedKeyframes === 0 || approvedShotIds.size !== expectedKeyframes || [...approvedShotIds].some((shotId) => !expectedShotIds.has(shotId))) {
    blockers.push("KEYFRAME_IDENTITY_APPROVAL_INCOMPLETE");
  }

  const expectedDialogueShotIds = workflow.dialogue.dialogue_mode === "DIALOGUE"
    ? expectedShotIds
    : workflow.dialogue.dialogue_mode === "VOICE_OVER"
      ? new Set<string>()
      : new Set(readiness.dialogue_shot_ids);
  const speakerShotIds = new Set(readiness.speaker_locks.map((lock) => lock.shot_id));
  for (const lock of readiness.speaker_locks) {
    if (!usedActorIds.has(lock.speaker_source_actor_id)) {
      blockers.push(`SPEAKER_NOT_IN_CAST:${lock.shot_id}`);
    }
    const voice = voiceByActor.get(lock.speaker_source_actor_id);
    if (!voice || voice.voice_master_id !== lock.voice_master_id) {
      blockers.push(`SPEAKER_VOICE_MISMATCH:${lock.shot_id}`);
    }
  }

  if (
    expectedDialogueShotIds.size !== speakerShotIds.size ||
    [...expectedDialogueShotIds].some((shotId) => !speakerShotIds.has(shotId)) ||
    [...speakerShotIds].some((shotId) => !expectedDialogueShotIds.has(shotId))
  ) {
    blockers.push("SPEAKER_FACE_LOCKS_INCOMPLETE");
  }
  if (readiness.review.decision !== "APPROVE") blockers.push("PRODUCTION_READINESS_NOT_APPROVED");
  return blockers;
}

export function shortFilmMediaExecutionDecision(workflow: ShortFilmWorkflow) {
  const blockers = shortFilmProductionReadinessBlockers(workflow);
  return {
    provider_execution_allowed: blockers.length === 0,
    blockers,
  } as const;
}

export function shortFilmNextAction(workflow: ShortFilmWorkflow) {
  if (workflow.script_review.decision === "REJECT") return "SCRIPT_REJECTED" as const;
  if (workflow.script_review.decision !== "APPROVE") return "REVIEW_SHORT_FILM_SCRIPT" as const;
  if (!workflow.shot_plan) return "PREPARE_SHORT_FILM_SHOT_PLAN" as const;
  if (shortFilmProductionReadinessBlockers(workflow).length > 0) {
    return "LOCK_SHORT_FILM_PRODUCTION_READINESS" as const;
  }
  if (!workflow.pilot) return "PREPARE_SHORT_FILM_PILOT" as const;
  if (workflow.pilot.review.decision !== "APPROVE" || !shortFilmQcPassed(workflow.pilot.qc)) {
    return "REVIEW_SHORT_FILM_PILOT" as const;
  }
  if (!workflow.full_film) return "PRODUCE_SHORT_FILM" as const;
  if (workflow.full_film.review.decision !== "APPROVE" || !shortFilmQcPassed(workflow.full_film.qc)) {
    return "REVIEW_SHORT_FILM_FINAL" as const;
  }
  return "READY_TO_PUBLISH" as const;
}

export const CommonProjectInputSchema = z.object({
  project_name: z.string().trim().min(1, "Tên dự án là bắt buộc"),
  project_type: FormProjectTypeSchema,
  client_name: z.string().trim().min(1, "Khách hàng/đơn vị là bắt buộc"),
  phone: z.string().trim().min(1, "Số điện thoại là bắt buộc"),
  email: z.email("Email không hợp lệ"),
  platforms: z.array(z.string().trim().min(1)).min(1, "Phải chọn ít nhất một nền tảng"),
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
  short_film_workflow: ShortFilmWorkflowSchema,
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

export const ProjectSubmitRequestSchema = z.object({
  submission_id: z.uuid(),
  payload: z.unknown(),
});

export type ProjectSubmitRequest = z.infer<typeof ProjectSubmitRequestSchema>;

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
