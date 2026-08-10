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

    if (character.lip_sync_required && !character.voice_required) {
      context.addIssue({
        code: "custom",
        message: "Khớp khẩu hình chỉ được bật khi nhân vật có Voice APPROVED",
        path: ["lip_sync_required"],
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

export function deriveShortFilmCharacterMediaRequirements(
  filmRole: z.infer<typeof ShortFilmRoleSchema>,
  dialogueMode: "DIALOGUE" | "VOICE_OVER" | "MIXED",
) {
  const voiceRequired = filmRole !== "EXTRA";
  return {
    voice_required: voiceRequired,
    lip_sync_required: voiceRequired && dialogueMode !== "VOICE_OVER",
  };
}

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
  relationships: z.string().trim().default(""),
  personality: z.string().trim().default(""),
  appearance: z.string().trim().default(""),
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

export const ShortFilmPilotPurposeSchema = z.enum([
  "IDENTITY_DIALOGUE",
  "MOTION_PERFORMANCE",
  "MULTI_CHARACTER_CONTINUITY",
  "LIGHTING_BACKGROUND",
  "HIGH_RISK_SHOT",
]);

export const ShortFilmPilotSamplingSchema = z.object({
  sample_count: z.number().int().min(2).max(5).default(3),
  clip_duration_seconds: z.number().int().min(10).max(20).default(15),
  selection_mode: z.literal("RISK_BASED_REPRESENTATIVE_SHOTS").default("RISK_BASED_REPRESENTATIVE_SHOTS"),
  required_purposes: z.array(ShortFilmPilotPurposeSchema).min(2).max(5),
});

export const ShortFilmPilotSampleSchema = z.object({
  sample_id: z.string().trim().min(1),
  purpose: ShortFilmPilotPurposeSchema,
  shot_ids: z.array(z.string().trim().min(1)).min(1),
  duration_seconds: z.number().min(10).max(20),
  video_url: z.url(),
  qc: ShortFilmQcSchema,
  review: ShortFilmReviewSchema,
});

export const ShortFilmPilotBatchSchema = z.object({
  samples: z.array(ShortFilmPilotSampleSchema).min(2).max(5),
  batch_review: ShortFilmReviewSchema,
}).superRefine((batch, context) => {
  if (batch.batch_review.decision === "APPROVE") {
    batch.samples.forEach((sample, index) => {
      if (sample.review.decision !== "APPROVE" || !shortFilmQcPassed(sample.qc)) {
        context.addIssue({ code: "custom", message: `PILOT_SAMPLE_NOT_APPROVED:${sample.sample_id}`, path: ["samples", index] });
      }
    });
  }
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
  perceived_age_band: z.enum(["YOUNG_ADULT", "ADULT", "MIDDLE_AGED", "OLDER_ADULT"]).optional(),
  locale: z.literal("vi-VN-southwest").optional(),
  performance_style: z.literal("SOUTHERN_TV_DRAMA_DUBBING").optional(),
  pronunciation_lexicon_id: z.string().trim().min(1).optional(),
  audition_audio_url: z.url().optional(),
  audition_review: ShortFilmReviewSchema.optional(),
  status: z.literal("APPROVED_LOCKED"),
});

export const ShortFilmDialogueLineApprovalSchema = z.object({
  line_id: z.string().trim().min(1),
  shot_id: z.string().trim().min(1),
  speaker_source_actor_id: z.string().trim().min(1),
  voice_master_id: z.string().trim().min(1),
  dialogue_text: z.string().trim().min(1),
  target_duration_ms: z.number().int().min(250).max(60_000),
  pronunciation_decision: ReviewDecisionSchema,
  age_casting_decision: ReviewDecisionSchema,
  timing_decision: ReviewDecisionSchema,
  reviewer: z.literal("PROJECT_OWNER").default("PROJECT_OWNER"),
  reviewed_at: z.string().datetime(),
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
  dialogue_line_approvals: z.array(ShortFilmDialogueLineApprovalSchema).default([]),
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

const referenceHostMatchesPlatform = (platform: "YOUTUBE" | "TIKTOK" | "FACEBOOK", url: string) => {
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  const isHost = (domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);
  if (platform === "YOUTUBE") return isHost("youtube.com") || hostname === "youtu.be";
  if (platform === "TIKTOK") return isHost("tiktok.com");
  return isHost("facebook.com") || hostname === "fb.watch";
};

export const ReferenceSourceSchema = z.object({
  platform: z.enum(["YOUTUBE", "TIKTOK", "FACEBOOK"]),
  url: z.url(),
  usage_mode: z.enum(["INSPIRATION_ONLY", "STRUCTURE_REFERENCE", "AUTHORIZED_ADAPTATION"]),
  rights_confirmed: z.literal(true, {
    error: "Phải xác nhận quyền sử dụng cho từng link tham khảo",
  }),
  notes: z.string().trim().max(2_000).default(""),
}).superRefine((source, context) => {
  if (!referenceHostMatchesPlatform(source.platform, source.url)) {
    context.addIssue({
      code: "custom",
      message: "Tên miền URL không khớp nền tảng đã chọn",
      path: ["url"],
    });
  }
});

export const ProviderBudgetPlanSchema = z.object({
  internal_services: z.object({
    post_production: z.literal("TUHAUAI_FFMPEG_CLOUD_RUN"),
    music_source: z.enum(["PROJECT_OWNER_LICENSED", "LICENSED_LIBRARY", "NOT_SELECTED"]),
  }),
  providers: z.object({
    script: z.enum(["OPENAI_RESPONSES", "PROJECT_OWNER"]),
    video: z.enum(["RUNWAY", "NONE"]),
    voice: z.enum(["ELEVENLABS", "APPROVED_VOICE_MASTER", "NONE"]),
    lip_sync: z.enum(["SYNC", "NONE"]),
  }),
  estimate: z.object({
    basis_version: z.literal("TUHAUAI_BUDGET_2026-08-09"),
    estimated_duration_seconds: z.number().int().positive(),
    currency: z.enum(["VND", "USD"]),
    script: z.number().min(0),
    video: z.number().min(0),
    voice: z.number().min(0),
    lip_sync: z.number().min(0),
    contingency: z.number().min(0),
    total: z.number().min(0),
  }),
  approval: z.object({
    decision: z.enum(["PENDING", "APPROVE", "REJECT"]),
    approved_limit: z.number().min(0),
    reviewer: z.literal("PROJECT_OWNER"),
    reviewed_at: z.iso.datetime().optional(),
  }),
}).superRefine((plan, context) => {
  const calculated = plan.estimate.script + plan.estimate.video + plan.estimate.voice + plan.estimate.lip_sync + plan.estimate.contingency;
  if (Math.abs(calculated - plan.estimate.total) > 0.01) {
    context.addIssue({ code: "custom", message: "Tổng dự toán không khớp các khoản chi phí", path: ["estimate", "total"] });
  }
  if (plan.approval.decision === "APPROVE") {
    if (!plan.approval.reviewed_at) {
      context.addIssue({ code: "custom", message: "Thiếu thời điểm duyệt kinh phí", path: ["approval", "reviewed_at"] });
    }
    if (plan.approval.approved_limit < plan.estimate.total) {
      context.addIssue({ code: "custom", message: "Hạn mức duyệt phải lớn hơn hoặc bằng tổng dự toán", path: ["approval", "approved_limit"] });
    }
  }
});

export type ProviderBudgetPlan = z.infer<typeof ProviderBudgetPlanSchema>;

export function calculateSuggestedProviderBudget(input: {
  project_type: "SHORT_FILM" | "MUSIC_VIDEO" | "SHORT_MUSIC_CLIP";
  duration_seconds: number;
  providers: ProviderBudgetPlan["providers"];
}): ProviderBudgetPlan["estimate"] {
  const durationSeconds = Math.max(1, Math.round(input.duration_seconds));
  const dialogueRatio = input.project_type === "MUSIC_VIDEO" ? 0.15 : input.project_type === "SHORT_MUSIC_CLIP" ? 0.1 : 0.35;
  const dialogueSeconds = durationSeconds * dialogueRatio;
  const script = input.providers.script === "OPENAI_RESPONSES" ? 1 : 0;
  // Runway Gen-4.5 baseline: 12 credits/second at $0.01/API credit. The 1.5 multiplier covers controlled retries/QC.
  const video = input.providers.video === "RUNWAY" ? durationSeconds * 0.12 * 1.5 : 0;
  const voice = input.providers.voice === "ELEVENLABS" ? dialogueSeconds * 0.02 : 0;
  const lipSync = input.providers.lip_sync === "SYNC" ? dialogueSeconds * 0.05 : 0;
  const subtotal = script + video + voice + lipSync;
  const contingency = subtotal * 0.2;
  const roundMoney = (value: number) => Math.round(value * 100) / 100;
  return {
    basis_version: "TUHAUAI_BUDGET_2026-08-09",
    estimated_duration_seconds: durationSeconds,
    currency: "USD",
    script: roundMoney(script),
    video: roundMoney(video),
    voice: roundMoney(voice),
    lip_sync: roundMoney(lipSync),
    contingency: roundMoney(contingency),
    total: roundMoney(subtotal + contingency),
  };
}

export function providerBudgetApproved(plan: ProviderBudgetPlan) {
  return plan.approval.decision === "APPROVE" &&
    Boolean(plan.approval.reviewed_at) &&
    plan.approval.approved_limit >= plan.estimate.total;
}

export function canResumeContractApproval(progress: { current_stage: string; next_action: string }) {
  return progress.current_stage === "CONTRACT" && progress.next_action === "APPROVE_CONTRACT";
}

export function canResumeShortFilmWorkflow(progress: { project_type: string; next_action: string }) {
  return progress.project_type === "SHORT_FILM" && progress.next_action !== "APPROVE_CONTRACT";
}

const ShortFilmProgressActions = [
  ["APPROVE_CONTRACT", "Khởi tạo và duyệt hợp đồng"],
  ["REVIEW_SHORT_FILM_SCRIPT", "Duyệt kịch bản"],
  ["PREPARE_SHORT_FILM_SHOT_PLAN", "Lập Shot Plan"],
  ["REVIEW_SHORT_FILM_SHOT_PLAN", "Duyệt Shot Plan"],
  ["LOCK_SHORT_FILM_PRODUCTION_READINESS", "Khóa nhân vật, giọng và keyframe"],
  ["PREPARE_SHORT_FILM_PILOT", "Tạo pilot"],
  ["REVIEW_SHORT_FILM_PILOT", "QC và duyệt pilot"],
  ["PRODUCE_SHORT_FILM", "Sản xuất toàn phim"],
  ["REVIEW_SHORT_FILM_FINAL", "QC và duyệt phim hoàn chỉnh"],
  ["READY_TO_PUBLISH", "Sẵn sàng xuất bản"],
] as const;

const MusicVideoProgressActions = [
  ["APPROVE_CONTRACT", "Khởi tạo và duyệt hợp đồng"],
  ["PREPARE_MV_PRODUCTION", "Lập kế hoạch sản xuất"],
  ["APPROVE_MV_PRODUCTION_PLAN", "Duyệt kế hoạch sản xuất"],
  ["PREPARE_MV_ASSETS", "Chuẩn bị tài sản"],
  ["APPROVE_MV_ASSETS", "Duyệt tài sản"],
  ["PREPARE_MV_SHOT_PLAN", "Lập Shot Plan"],
  ["APPROVE_MV_SHOT_PLAN", "Duyệt Shot Plan"],
  ["PREPARE_MV_TIMECODE_ALIGNMENT", "Căn timecode"],
  ["APPROVE_MV_TIMECODE_ALIGNMENT", "Duyệt timecode"],
  ["PREPARE_MV_RENDER_PLAN", "Lập kế hoạch render"],
  ["APPROVE_MV_RENDER_PLAN", "Duyệt kế hoạch render"],
  ["PREPARE_MV_RENDER_EXECUTION", "Chuẩn bị thực thi"],
  ["APPROVE_MV_RENDER_EXECUTION", "Duyệt thực thi"],
  ["PREPARE_MV_PROVIDER_SUBMISSION", "Chuẩn bị gửi nhà cung cấp"],
  ["APPROVE_MV_PROVIDER_SUBMISSION", "Duyệt gửi nhà cung cấp"],
  ["READY_TO_PUBLISH", "Sẵn sàng xuất bản"],
] as const;

export function calculateProjectProgress(projectType: string, nextAction: string) {
  const steps = projectType === "SHORT_FILM" ? ShortFilmProgressActions : MusicVideoProgressActions;
  const currentIndex = Math.max(0, steps.findIndex(([action]) => action === nextAction));
  const completed = nextAction === "READY_TO_PUBLISH" ? steps.length : currentIndex;
  return {
    percent_complete: Math.round((completed / steps.length) * 100),
    completed_steps: completed,
    total_steps: steps.length,
    milestones: steps.map(([action, label], index) => ({
      action,
      label,
      status: index < completed ? "COMPLETED" as const : index === currentIndex ? "CURRENT" as const : "PENDING" as const,
    })),
  };
}

export const ShortFilmScriptGenerationRequestSchema = z.object({
  idea: z.string().trim().min(20).max(12_000),
  target_duration_minutes: z.number().int().min(1).max(60),
  language: z.string().trim().min(2).max(20).default("vi"),
  characters: z.array(ShortFilmCharacterSchema).min(1).max(20),
  reference_sources: z.array(ReferenceSourceSchema).max(5, "Chỉ được thêm tối đa 5 link tham khảo").default([]),
  provider_budget: ProviderBudgetPlanSchema,
}).superRefine((request, context) => {
  if (request.provider_budget.providers.script !== "OPENAI_RESPONSES") {
    context.addIssue({ code: "custom", message: "Phải chọn OpenAI Responses cho chức năng tạo kịch bản AI", path: ["provider_budget", "providers", "script"] });
  }
  if (!providerBudgetApproved(request.provider_budget)) {
    context.addIssue({ code: "custom", message: "Kinh phí phải được duyệt trước khi gọi nhà cung cấp", path: ["provider_budget", "approval"] });
  }
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
    pilot_sampling: ShortFilmPilotSamplingSchema.default({
      sample_count: 3,
      clip_duration_seconds: 15,
      selection_mode: "RISK_BASED_REPRESENTATIVE_SHOTS",
      required_purposes: ["IDENTITY_DIALOGUE", "MOTION_PERFORMANCE", "MULTI_CHARACTER_CONTINUITY"],
    }),
    shot_plan: z
      .object({
        summary: z.string().trim().min(1),
        shots: z.array(z.string().trim().min(1)).min(1),
        execution_shots: z.array(z.object({
          shot_id: z.string().trim().min(1),
          summary: z.string().trim().min(1),
          runway_prompt: z.string().trim().min(10).max(1_000),
          duration_seconds: z.number().int().min(2).max(10),
          risk_tags: z.array(ShortFilmPilotPurposeSchema).default([]),
        })).default([]),
        review: ShortFilmReviewSchema.default({ decision: "APPROVE", notes: "Migrated from the pre-review Shot Plan contract.", reviewer: "PROJECT_OWNER" }),
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
    pilot_batch: ShortFilmPilotBatchSchema.optional(),
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
    if (workflow.pilot_batch && workflow.pilot_batch.samples.length !== workflow.pilot_sampling.sample_count) {
      context.addIssue({ code: "custom", message: "Số clip pilot phải khớp cấu hình sampling", path: ["pilot_batch", "samples"] });
    }
    const legacyPilotApproved = workflow.pilot?.review.decision === "APPROVE" && shortFilmQcPassed(workflow.pilot.qc);
    const batchPilotApproved = workflow.pilot_batch?.batch_review.decision === "APPROVE";
    if (workflow.full_film && !legacyPilotApproved && !batchPilotApproved) {
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

export function createShortFilmShotPlan(workflow: ShortFilmWorkflow) {
  if (workflow.script_review.decision !== "APPROVE") {
    throw new Error("SCRIPT_APPROVED_REQUIRED");
  }

  const normalizedScript = workflow.full_script.replace(/\r/g, "").trim();
  const sceneChunks = normalizedScript
    .split(/(?=CẢNH\s+\d+)/giu)
    .map((scene) => scene.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const sourceBeats = (sceneChunks.length > 0 ? sceneChunks : [normalizedScript])
    .flatMap((scene) => scene.split(/(?<=[.!?])\s+|(?=[A-ZÀ-Ỹ][A-ZÀ-Ỹ ]{2,}:)/u))
    .map((beat) => beat.replace(/\s+/g, " ").trim())
    .filter((beat) => beat.length >= 12);
  const beats = sourceBeats.length > 0 ? sourceBeats : [workflow.script_synopsis];
  const totalSeconds = workflow.target_duration_minutes * 60;
  const shotCount = Math.max(3, Math.ceil(totalSeconds / 10));
  if (beats.length < shotCount) {
    throw new Error(`SHOT_PLAN_SCRIPT_DETAIL_INSUFFICIENT:${beats.length}:${shotCount}`);
  }
  const shots = Array.from({ length: shotCount }, (_, index) => {
    const beat = beats[index];
    return `Shot ${String(index + 1).padStart(2, "0")}: ${beat.slice(0, 180)}`;
  });
  const executionShots = shots.map((summary, index) => ({
    shot_id: `SHOT-${String(index + 1).padStart(3, "0")}`,
    summary,
    runway_prompt: `${summary}. Phim truyền hình Việt Nam điện ảnh, diễn xuất tự nhiên có chuyển động, giữ đúng Character Master, trang phục, bối cảnh và continuity đã duyệt.`,
    duration_seconds: Math.min(10, totalSeconds - index * 10),
    risk_tags: index === 0
      ? ["IDENTITY_DIALOGUE" as const]
      : index === 1
        ? ["MOTION_PERFORMANCE" as const]
        : index === 2
          ? ["MULTI_CHARACTER_CONTINUITY" as const]
          : [],
  }));

  return {
    summary: `${shots.length} shot bao phủ ${workflow.target_duration_minutes} phút, được tạo cục bộ từ kịch bản đã duyệt.`,
    shots,
    execution_shots: executionShots,
    review: { decision: "PENDING" as const, notes: "", reviewer: "PROJECT_OWNER" as const },
  };
}

export function syncShortFilmSourceActors(
  filmCharacters: ReadonlyArray<ShortFilmWorkflow["film_characters"][number]>,
  availableActors: ReadonlyArray<ShortFilmWorkflow["source_actors"][number]>,
  existingActors: ReadonlyArray<ShortFilmWorkflow["source_actors"][number]> = [],
): ShortFilmWorkflow["source_actors"] {
  const actorsById = new Map(
    [...existingActors, ...availableActors].map((actor) => [actor.source_actor_id, actor]),
  );
  const selectedActorIds = [...new Set(filmCharacters.map((character) => character.source_actor_id))];
  return selectedActorIds.flatMap((actorId) => {
    const actor = actorsById.get(actorId);
    return actor ? [{ ...actor }] : [];
  });
}

export function approveProviderBudgetForProjectCreation(
  plan: ProviderBudgetPlan,
  reviewedAt: string,
): ProviderBudgetPlan {
  return ProviderBudgetPlanSchema.parse({
    ...plan,
    approval: {
      ...plan.approval,
      decision: "APPROVE",
      approved_limit: Math.max(plan.approval.approved_limit, plan.estimate.total),
      reviewed_at: reviewedAt,
    },
  });
}

export function resetProviderBudgetApprovalForDraft(plan: ProviderBudgetPlan): ProviderBudgetPlan {
  return ProviderBudgetPlanSchema.parse({
    ...plan,
    approval: {
      ...plan.approval,
      decision: "PENDING",
      approved_limit: plan.estimate.total,
      reviewed_at: undefined,
    },
  });
}

export function shortFilmScriptReadyForProjectCreation(workflow: {
  idea_brief: string;
  script_title: string;
  script_synopsis: string;
  full_script: string;
  script_review: { decision: z.infer<typeof ReviewDecisionSchema> };
}) {
  return workflow.idea_brief.trim().length >= 20 &&
    workflow.script_title.trim().length > 0 &&
    workflow.script_synopsis.trim().length > 0 &&
    workflow.full_script.trim().length > 0 &&
    workflow.script_review.decision === "APPROVE";
}

export function shortFilmScriptProvider(source: ShortFilmWorkflow["script_source"]): ProviderBudgetPlan["providers"]["script"] {
  return source === "PROJECT_OWNER_PROVIDED" ? "PROJECT_OWNER" : "OPENAI_RESPONSES";
}

export function synchronizeShortFilmIntakeFields(
  workflow: ShortFilmWorkflow,
  input: { idea_brief?: string; target_duration_minutes?: number; language?: string },
): ShortFilmWorkflow {
  const ideaBrief = input.idea_brief ?? workflow.idea_brief;
  const targetDurationMinutes = input.target_duration_minutes ?? workflow.target_duration_minutes;
  const language = input.language ?? workflow.dialogue.language;
  const changed = ideaBrief !== workflow.idea_brief || targetDurationMinutes !== workflow.target_duration_minutes || language !== workflow.dialogue.language;
  if (!changed) return workflow;
  return {
    ...workflow,
    idea_brief: ideaBrief,
    target_duration_minutes: targetDurationMinutes,
    dialogue: { ...workflow.dialogue, language },
    script_review: { ...workflow.script_review, decision: "PENDING", reviewed_at: undefined },
  };
}

export function shortFilmSourceActorsNeedSync(
  filmCharacters: ReadonlyArray<ShortFilmWorkflow["film_characters"][number]>,
  sourceActors: ReadonlyArray<ShortFilmWorkflow["source_actors"][number]>,
) {
  const selectedActorIds = new Set(filmCharacters.map((character) => character.source_actor_id));
  const sourceActorIds = new Set(sourceActors.map((actor) => actor.source_actor_id));
  return selectedActorIds.size !== sourceActorIds.size ||
    [...selectedActorIds].some((actorId) => !sourceActorIds.has(actorId));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Preserve user-entered draft values while filling fields added by newer form versions. */
export function migrateShortFilmWorkflowDraft(draft: unknown, defaults: ShortFilmWorkflow): ShortFilmWorkflow {
  const mergeMissing = (fallback: unknown, stored: unknown): unknown => {
    if (Array.isArray(fallback)) return Array.isArray(stored) ? stored : fallback;
    if (isPlainRecord(fallback)) {
      if (!isPlainRecord(stored)) return fallback;
      return Object.fromEntries(
        Object.entries(fallback).map(([key, value]) => [key, mergeMissing(value, stored[key])]).concat(
          Object.entries(stored).filter(([key]) => !(key in fallback)),
        ),
      );
    }
    if (stored === undefined || stored === null || typeof stored !== typeof fallback) return fallback;
    return stored;
  };
  return mergeMissing(defaults, draft) as ShortFilmWorkflow;
}

export function selectShortFilmPilotSamples(workflowInput: ShortFilmWorkflow) {
  const workflow = ShortFilmWorkflowSchema.parse(workflowInput);
  const shots = workflow.shot_plan?.execution_shots ?? [];
  if (shots.length === 0) throw new Error("STRUCTURED_EXECUTION_SHOTS_REQUIRED");
  const used = new Set<string>();
  return Array.from({ length: workflow.pilot_sampling.sample_count }, (_, sampleIndex) => {
    const purpose = workflow.pilot_sampling.required_purposes[sampleIndex] ?? "HIGH_RISK_SHOT";
    const ordered = [...shots].sort((left, right) => {
      const leftScore = left.risk_tags.includes(purpose) ? 1 : 0;
      const rightScore = right.risk_tags.includes(purpose) ? 1 : 0;
      return rightScore - leftScore;
    });
    const selected: typeof shots = [];
    let duration = 0;
    for (const shot of ordered) {
      if (used.has(shot.shot_id) && shots.length >= workflow.pilot_sampling.sample_count) continue;
      selected.push(shot);
      used.add(shot.shot_id);
      duration += shot.duration_seconds;
      if (duration >= workflow.pilot_sampling.clip_duration_seconds) break;
    }
    if (duration < 10) throw new Error(`PILOT_SAMPLE_TOO_SHORT:${sampleIndex + 1}`);
    return {
      sample_id: `PILOT-SAMPLE-${String(sampleIndex + 1).padStart(2, "0")}`,
      purpose,
      shots: selected,
      expected_duration_seconds: Math.min(duration, 20),
    };
  });
}

export const ShortFilmPilotAccountCheckSchema = z.object({
  provider: z.enum(["RUNWAY", "ELEVENLABS", "SYNC"]),
  status: z.enum(["SUFFICIENT", "INSUFFICIENT", "AUTH_ERROR", "NOT_CONFIGURED", "UNVERIFIED"]),
  checked_at: z.string().datetime(),
  manual_balance_confirmed: z.boolean().default(false),
});

export const ShortFilmPilotPreparationRequestSchema = z.object({
  project_id: z.string().trim().min(1),
  workflow: ShortFilmWorkflowSchema,
  provider_budget: ProviderBudgetPlanSchema,
  pilot_duration_seconds: z.number().int().min(10).max(20),
  account_checks: z.array(ShortFilmPilotAccountCheckSchema),
  prepared_at: z.string().datetime(),
}).superRefine((request, context) => {
  if (request.pilot_duration_seconds !== request.workflow.pilot_sampling.clip_duration_seconds) {
    context.addIssue({ code: "custom", message: "PILOT_DURATION_MUST_MATCH_APPROVED_SAMPLING", path: ["pilot_duration_seconds"] });
  }
  if (!providerBudgetApproved(request.provider_budget)) {
    context.addIssue({ code: "custom", message: "BUDGET_APPROVED là bắt buộc trước khi chuẩn bị pilot", path: ["provider_budget", "approval"] });
  }
  if (request.workflow.script_review.decision !== "APPROVE") {
    context.addIssue({ code: "custom", message: "SCRIPT_APPROVED là bắt buộc trước khi chuẩn bị pilot", path: ["workflow", "script_review"] });
  }
  if (!request.workflow.shot_plan) {
    context.addIssue({ code: "custom", message: "Shot Plan là bắt buộc trước khi chuẩn bị pilot", path: ["workflow", "shot_plan"] });
  }
  const mediaDecision = shortFilmMediaExecutionDecision(request.workflow);
  for (const blocker of mediaDecision.blockers) {
    context.addIssue({ code: "custom", message: blocker, path: ["workflow", "production_readiness"] });
  }
  const checks = new Map(request.account_checks.map((check) => [check.provider, check]));
  for (const provider of ["RUNWAY", "ELEVENLABS"] as const) {
    if (checks.get(provider)?.status !== "SUFFICIENT") {
      context.addIssue({ code: "custom", message: `${provider}_ACCOUNT_NOT_SUFFICIENT`, path: ["account_checks"] });
    }
  }
  const sync = checks.get("SYNC");
  if (sync?.status !== "SUFFICIENT" && !(sync?.status === "UNVERIFIED" && sync.manual_balance_confirmed)) {
    context.addIssue({ code: "custom", message: "SYNC_ACCOUNT_NOT_CONFIRMED", path: ["account_checks"] });
  }
  const newestAllowed = Date.parse(request.prepared_at) - 15 * 60_000;
  request.account_checks.forEach((check, index) => {
    if (Date.parse(check.checked_at) < newestAllowed) {
      context.addIssue({ code: "custom", message: `${check.provider}_ACCOUNT_CHECK_STALE`, path: ["account_checks", index, "checked_at"] });
    }
  });
});

export type ShortFilmPilotPreparationRequest = z.infer<typeof ShortFilmPilotPreparationRequestSchema>;

export function prepareShortFilmPilotPlan(input: ShortFilmPilotPreparationRequest) {
  const request = ShortFilmPilotPreparationRequestSchema.parse(input);
  const readiness = request.workflow.production_readiness!;
  const pilotShotIds = request.workflow.shot_plan!.shots
    .slice(0, Math.max(1, Math.min(request.workflow.shot_plan!.shots.length, request.workflow.pilot_sampling.sample_count)))
    .map((_, index) => `SHOT-${String(index + 1).padStart(3, "0")}`);
  while (pilotShotIds.length < request.workflow.pilot_sampling.sample_count) {
    pilotShotIds.push(pilotShotIds[pilotShotIds.length % Math.max(1, pilotShotIds.length)] ?? "SHOT-001");
  }
  const pilotSamples = Array.from({ length: request.workflow.pilot_sampling.sample_count }, (_, index) => ({
    sample_id: `PILOT-SAMPLE-${String(index + 1).padStart(2, "0")}`,
    purpose: request.workflow.pilot_sampling.required_purposes[index] ?? "HIGH_RISK_SHOT",
    shot_id: pilotShotIds[index],
    duration_seconds: request.workflow.pilot_sampling.clip_duration_seconds,
    approval_status: "PENDING" as const,
  }));
  const dialogueShots = new Set(readiness.speaker_locks.map((lock) => lock.shot_id));
  const stages = [
    { stage: "SYNTHESIZE_APPROVED_DIALOGUE", provider: "ELEVENLABS", required: pilotShotIds.some((id) => dialogueShots.has(id)) },
    { stage: "GENERATE_LOCKED_SHOT_VIDEO", provider: "RUNWAY", required: true },
    { stage: "SYNC_LOCKED_SPEAKER", provider: "SYNC", required: pilotShotIds.some((id) => dialogueShots.has(id)) },
    { stage: "ASSEMBLE_PILOT", provider: "TUHAUAI_FFMPEG", required: true },
    { stage: "AWAIT_PILOT_QC", provider: "PROJECT_OWNER", required: true },
  ] as const;
  return {
    schema_version: "SHORT_FILM_PILOT_EXECUTION_V1" as const,
    project_id: request.project_id,
    pilot_duration_seconds: request.pilot_duration_seconds,
    total_sample_duration_seconds: request.pilot_duration_seconds * pilotSamples.length,
    pilot_samples: pilotSamples,
    pilot_shot_ids: pilotShotIds,
    locked_identity_master_ids: readiness.identity_masters.map((item) => item.master_identity_id),
    locked_voice_master_ids: readiness.voice_masters.map((item) => item.voice_master_id),
    stages,
    submission_gate: "AWAITING_PROJECT_OWNER_APPROVAL" as const,
    provider_calls_made: false as const,
    retry_policy: { max_attempts_per_stage: 2, require_fresh_account_check_before_retry: true },
    heartbeat_policy: { interval_seconds: 30, stale_after_seconds: 180, hard_timeout_seconds: 900 },
    budget_cap_usd: request.provider_budget.approval.approved_limit,
    prepared_at: request.prepared_at,
  };
}

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
  const blockers: string[] = [];
  if (!workflow.shot_plan || workflow.shot_plan.review.decision !== "APPROVE") blockers.push("SHOT_PLAN_NOT_APPROVED");
  if (!readiness) return [...blockers, "PRODUCTION_READINESS_MISSING"];
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
    const voice = voiceByActor.get(actorId);
    if (workflow.dialogue.voice_master_mode === "APPROVED_VOICE_MASTER_ONLY" && voice) {
      if (!voice.perceived_age_band) blockers.push(`VOICE_AGE_NOT_LOCKED:${actorId}`);
      if (voice.locale !== "vi-VN-southwest") blockers.push(`VOICE_LOCALE_NOT_LOCKED:${actorId}`);
      if (voice.performance_style !== "SOUTHERN_TV_DRAMA_DUBBING") blockers.push(`VOICE_PERFORMANCE_STYLE_NOT_LOCKED:${actorId}`);
      if (!voice.pronunciation_lexicon_id) blockers.push(`VOICE_PRONUNCIATION_LEXICON_MISSING:${actorId}`);
      if (!voice.audition_audio_url || voice.audition_review?.decision !== "APPROVE") {
        blockers.push(`VOICE_AUDITION_NOT_APPROVED:${actorId}`);
      }
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
  const lineApprovalsByShot = new Map(readiness.dialogue_line_approvals.map((line) => [line.shot_id, line]));
  for (const lock of readiness.speaker_locks) {
    if (!usedActorIds.has(lock.speaker_source_actor_id)) {
      blockers.push(`SPEAKER_NOT_IN_CAST:${lock.shot_id}`);
    }
    const voice = voiceByActor.get(lock.speaker_source_actor_id);
    if (!voice || voice.voice_master_id !== lock.voice_master_id) {
      blockers.push(`SPEAKER_VOICE_MISMATCH:${lock.shot_id}`);
    }
    const line = lineApprovalsByShot.get(lock.shot_id);
    if (!line) {
      blockers.push(`DIALOGUE_LINE_NOT_APPROVED:${lock.shot_id}`);
    } else if (line.speaker_source_actor_id !== lock.speaker_source_actor_id || line.voice_master_id !== lock.voice_master_id) {
      blockers.push(`DIALOGUE_LINE_VOICE_MISMATCH:${lock.shot_id}`);
    } else {
      if (line.pronunciation_decision !== "APPROVE") blockers.push(`PRONUNCIATION_NOT_APPROVED:${lock.shot_id}`);
      if (line.age_casting_decision !== "APPROVE") blockers.push(`AGE_CASTING_NOT_APPROVED:${lock.shot_id}`);
      if (line.timing_decision !== "APPROVE") blockers.push(`DIALOGUE_TIMING_NOT_APPROVED:${lock.shot_id}`);
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
  if (workflow.shot_plan.review.decision !== "APPROVE") return "REVIEW_SHORT_FILM_SHOT_PLAN" as const;
  if (shortFilmProductionReadinessBlockers(workflow).length > 0) {
    return "LOCK_SHORT_FILM_PRODUCTION_READINESS" as const;
  }
  if (!workflow.pilot && !workflow.pilot_batch) return "PREPARE_SHORT_FILM_PILOT" as const;
  const legacyPilotApproved = Boolean(workflow.pilot && workflow.pilot.review.decision === "APPROVE" && shortFilmQcPassed(workflow.pilot.qc));
  const batchPilotApproved = workflow.pilot_batch?.batch_review.decision === "APPROVE";
  if (!legacyPilotApproved && !batchPilotApproved) {
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
  reference_sources: z.array(ReferenceSourceSchema).max(5, "Chỉ được thêm tối đa 5 link tham khảo").default([]),
  provider_budget: ProviderBudgetPlanSchema,
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

export type ShortFilmProjectIntake = Extract<ProjectIntakeForm, { project_type: "SHORT_FILM" }>;

export type ShortFilmResumeSnapshot = {
  form_values: Record<string, string[]>;
  reference_sources: ShortFilmProjectIntake["reference_sources"];
  short_film_workflow: ShortFilmWorkflow;
  characters: ShortFilmProjectIntake["characters"];
  provider_budget: ProviderBudgetPlan;
  duration_target: string;
};

export function createShortFilmResumeSnapshot(input: unknown): ShortFilmResumeSnapshot {
  const parsed = ProjectIntakeFormSchema.parse(input);
  if (parsed.project_type !== "SHORT_FILM") {
    throw new Error("SHORT_FILM_PROJECT_REQUIRED");
  }

  const formValues: Record<string, string[]> = {};
  const put = (name: string, value: string | undefined) => {
    if (value !== undefined) formValues[name] = [value];
  };
  put("project_name", parsed.project_name);
  put("client_name", parsed.client_name);
  put("phone", parsed.phone);
  put("email", parsed.email);
  put("project_subtype", parsed.project_subtype);
  put("priority", parsed.priority);
  put("execution_mode", parsed.execution_mode);
  put("language", parsed.language);
  put("content_rating", parsed.content_rating);
  put("target_audience", parsed.target_audience);
  const workflowDurationTarget = `${parsed.short_film_workflow.target_duration_minutes}_MINUTES`;
  const durationTarget = ["3_MINUTES", "5_MINUTES", "7_MINUTES", "10_MINUTES", "15_MINUTES"].includes(workflowDurationTarget)
    ? workflowDurationTarget
    : parsed.duration_target;
  put("duration_target", durationTarget);
  put("aspect_ratio", parsed.aspect_ratio);
  put("story_idea", parsed.story_idea);
  put("social_theme", parsed.social_theme);
  put("story_genre", parsed.story_genre);
  put("primary_setting", parsed.primary_setting);
  put("ending_direction", parsed.ending_direction);
  put("dialogue_source", parsed.dialogue_source);
  formValues.platforms = [...parsed.platforms];

  return {
    form_values: formValues,
    reference_sources: parsed.reference_sources,
    short_film_workflow: parsed.short_film_workflow,
    characters: parsed.characters,
    provider_budget: parsed.provider_budget,
    duration_target: durationTarget,
  };
}

export function shortFilmScriptApprovalIsFresh(
  existing: Pick<ShortFilmWorkflow, "full_script" | "script_review">,
  incoming: Pick<ShortFilmWorkflow, "full_script" | "script_review">,
) {
  if (existing.full_script === incoming.full_script) return true;
  if (incoming.script_review.decision !== "APPROVE") return false;

  const incomingReviewedAt = Date.parse(incoming.script_review.reviewed_at ?? "");
  if (!Number.isFinite(incomingReviewedAt)) return false;

  const existingReviewedAt = Date.parse(existing.script_review.reviewed_at ?? "");
  return !Number.isFinite(existingReviewedAt) || incomingReviewedAt > existingReviewedAt;
}

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
