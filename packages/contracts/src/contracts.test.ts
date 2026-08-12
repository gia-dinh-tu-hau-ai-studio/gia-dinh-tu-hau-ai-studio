import assert from "node:assert/strict";
import test from "node:test";
import {
  approveProviderBudgetForProjectCreation,
  calculateSuggestedProviderBudget,
  calculateProjectProgress,
  calculateShortFilmPilotBudget,
  canResumeContractApproval,
  canResumeShortFilmWorkflow,
  createShortFilmShotPlan,
  createShortFilmResumeSnapshot,
  deriveShortFilmCharacterMediaRequirements,
  migrateShortFilmWorkflowDraft,
  normalizeProjectIntake,
  providerBudgetApproved,
  resetProviderBudgetApprovalForDraft,
  shortFilmScriptReadyForProjectCreation,
  shortFilmScriptProvider,
  synchronizeShortFilmIntakeFields,
  prepareShortFilmPilotPlan,
  selectShortFilmPilotSamples,
  shortFilmMediaExecutionDecision,
  shortFilmPilotBudgetApprovalIsSufficient,
  matchShortFilmShotActor,
  shortFilmNextAction,
  shortFilmScriptApprovalIsFresh,
  shortFilmProductionReadinessBlockers,
  shortFilmSourceActorsNeedSync,
  syncShortFilmSourceActors,
  ShortFilmScriptGenerationRequestSchema,
  ShortFilmPerformancePlanSchema,
  ShortFilmTimingContractSchema,
  ShortFilmWorkflowSchema,
} from "./index";

test("performance timing contract rejects silent tail disguised as a ten-second dialogue shot", () => {
  assert.throws(() => ShortFilmTimingContractSchema.parse({
    shot_id: "SHOT-001", dialogue_line_id: "LINE-001",
    speech_start_ms: 250, speech_end_ms: 4_000, shot_end_ms: 10_000,
    max_post_speech_action_ms: 1_000,
    review: { decision: "APPROVE", notes: "", reviewer: "PROJECT_OWNER" },
  }), /POST_SPEECH_ACTION_TOO_LONG/);
});

test("performance-driven plan accepts measured speech, reaction and natural cut without paid animatic", () => {
  const result = ShortFilmPerformancePlanSchema.parse({
    production_mode: "PERFORMANCE_DRIVEN_HYBRID",
    shots: [{
      shot_id: "SHOT-001", duration_ms: 5_000,
      performance_source_mode: "OWNER_RECORDED",
      performance_source_url: "https://drive.google.com/file/d/performance/view",
      beats: [
        { beat_id: "B1", beat_type: "PREPARE", start_ms: 0, end_ms: 300, direction: "Nhìn người đối diện" },
        { beat_id: "B2", beat_type: "SPEAK", start_ms: 300, end_ms: 4_000, direction: "Nói đúng câu thoại", dialogue_line_id: "LINE-001" },
        { beat_id: "B3", beat_type: "SETTLE", start_ms: 4_000, end_ms: 5_000, direction: "Dừng tự nhiên và cắt cảnh" },
      ],
      review: { decision: "APPROVE", notes: "", reviewer: "PROJECT_OWNER" },
    }],
    timing_contracts: [{
      shot_id: "SHOT-001", dialogue_line_id: "LINE-001",
      speech_start_ms: 300, speech_end_ms: 4_000, measured_speech_end_ms: 4_080,
      shot_end_ms: 5_000, max_post_speech_action_ms: 1_000,
      review: { decision: "APPROVE", notes: "", reviewer: "PROJECT_OWNER" },
    }],
    animatic: { video_url: "https://drive.google.com/file/d/animatic/view", uses_paid_provider_output: false, dialogue_timing_visible: true, review: { decision: "APPROVE", notes: "", reviewer: "PROJECT_OWNER" } },
    golden_scene: { shot_ids: ["SHOT-001"], identity_locked: true, speech_motion_aligned: true, performance_continuity: true, natural_cut_after_dialogue: true, review: { decision: "APPROVE", notes: "", reviewer: "PROJECT_OWNER" } },
    review: { decision: "APPROVE", notes: "", reviewer: "PROJECT_OWNER" },
  });
  assert.equal(result.animatic?.uses_paid_provider_output, false);
});

test("performance plan draft can be saved before footage and animatic are supplied", () => {
  const draft = ShortFilmPerformancePlanSchema.parse({
    production_mode: "PERFORMANCE_DRIVEN_HYBRID",
    shots: [{
      shot_id: "SHOT-001", duration_ms: 3_000, performance_source_mode: "OWNER_RECORDED", performance_source_url: "",
      beats: [{ beat_id: "B1", beat_type: "SPEAK", start_ms: 0, end_ms: 2_000, direction: "Nói theo kịch bản", dialogue_line_id: "LINE-001" }],
      review: { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" },
    }],
    animatic: { video_url: "", uses_paid_provider_output: false, dialogue_timing_visible: true, review: { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" } },
    review: { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" },
  });
  assert.equal(draft.shots[0].performance_source_url, "");
});

test("contract approval can resume only from the pending contract gate", () => {
  assert.equal(canResumeContractApproval({ current_stage: "CONTRACT", next_action: "APPROVE_CONTRACT" }), true);
  assert.equal(canResumeContractApproval({ current_stage: "PRE_PRODUCTION", next_action: "REVIEW_SHORT_FILM_SCRIPT" }), false);
  assert.equal(canResumeContractApproval({ current_stage: "CONTRACT", next_action: "REVIEW_SHORT_FILM_SCRIPT" }), false);
});

test("short-film workflow can resume only after contract approval", () => {
  assert.equal(canResumeShortFilmWorkflow({ project_type: "SHORT_FILM", next_action: "REVIEW_SHORT_FILM_SCRIPT" }), true);
  assert.equal(canResumeShortFilmWorkflow({ project_type: "SHORT_FILM", next_action: "APPROVE_CONTRACT" }), false);
  assert.equal(canResumeShortFilmWorkflow({ project_type: "LEGACY", next_action: "REVIEW_SHORT_FILM_SCRIPT" }), false);
});

test("creates a provider-free Shot Plan from the approved script and waits for owner review", () => {
  const approved = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    target_duration_minutes: 3,
    full_script: Array.from({ length: 18 }, (_, index) => `Dien bien ${index + 1} mo ta mot hanh dong rieng biet cua nhan vat trong cau chuyen.`).join(" "),
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
  });
  const shotPlan = createShortFilmShotPlan(approved);
  const withPlan = ShortFilmWorkflowSchema.parse({ ...approved, shot_plan: shotPlan });
  assert.equal(shotPlan.execution_shots.length, 18);
  assert.equal(shotPlan.execution_shots.reduce((total, shot) => total + shot.duration_seconds, 0), 180);
  assert.equal(new Set(shotPlan.execution_shots.map((shot) => shot.summary)).size, 18);
  assert.equal(shotPlan.review.decision, "PENDING");
  assert.equal(shortFilmNextAction(withPlan), "REVIEW_SHORT_FILM_SHOT_PLAN");
  assert.match(shortFilmProductionReadinessBlockers(withPlan).join(","), /SHOT_PLAN_NOT_APPROVED/);
});

test("Shot Plan approval is required before character and voice locking", () => {
  const approved = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    full_script: Array.from({ length: 48 }, (_, index) => `Dien bien ${index + 1} mo ta mot hanh dong rieng biet cua nhan vat trong cau chuyen.`).join(" "),
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
  });
  const shotPlan = createShortFilmShotPlan(approved);
  const reviewed = ShortFilmWorkflowSchema.parse({
    ...approved,
    shot_plan: { ...shotPlan, review: { decision: "APPROVE", notes: "Shot plan approved", reviewer: "PROJECT_OWNER" } },
  });
  assert.equal(shortFilmNextAction(reviewed), "LOCK_SHORT_FILM_PRODUCTION_READINESS");
});

test("Shot Plan refuses to fabricate repeated shots when the approved script lacks detail", () => {
  const approved = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    target_duration_minutes: 3,
    full_script: "Mot tinh huong ngan chua du dien bien de bao phu ba phut phim.",
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
  });
  assert.throws(() => createShortFilmShotPlan(approved), /SHOT_PLAN_SCRIPT_DETAIL_INSUFFICIENT:1:18/);
});

test("short-film dialogue derives safe voice and lip-sync requirements", () => {
  assert.deepEqual(deriveShortFilmCharacterMediaRequirements("PROTAGONIST", "DIALOGUE"), { voice_required: true, lip_sync_required: true });
  assert.deepEqual(deriveShortFilmCharacterMediaRequirements("SUPPORTING", "VOICE_OVER"), { voice_required: true, lip_sync_required: false });
  assert.deepEqual(deriveShortFilmCharacterMediaRequirements("EXTRA", "MIXED"), { voice_required: false, lip_sync_required: false });
});

test("restored draft never keeps a stale budget approval", () => {
  const restored = resetProviderBudgetApprovalForDraft(approvedProviderBudget);
  assert.equal(restored.approval.decision, "PENDING");
  assert.equal(restored.approval.approved_limit, restored.estimate.total);
  assert.equal(restored.approval.reviewed_at, undefined);
  assert.equal(providerBudgetApproved(restored), false);
});

test("project creation waits for a complete owner-approved script", () => {
  const approvedWorkflow = { ...shortFilmWorkflow, script_review: { ...shortFilmWorkflow.script_review, decision: "APPROVE" as const } };
  assert.equal(shortFilmScriptReadyForProjectCreation(approvedWorkflow), true);
  assert.equal(shortFilmScriptReadyForProjectCreation({ ...shortFilmWorkflow, full_script: "" }), false);
  assert.equal(shortFilmScriptReadyForProjectCreation(shortFilmWorkflow), false);
});

test("thông tin người dùng đồng bộ vào workflow và hủy duyệt cũ khi nội dung đổi", () => {
  const approvedWorkflow = ShortFilmWorkflowSchema.parse({ ...shortFilmWorkflow, script_review: { ...shortFilmWorkflow.script_review, decision: "APPROVE" as const, reviewed_at: "2026-08-10T10:00:00.000Z" } });
  const synchronized = synchronizeShortFilmIntakeFields(approvedWorkflow, {
    idea_brief: "Ý tưởng duy nhất được nhập ở giao diện người dùng và đồng bộ xuống workflow.",
    target_duration_minutes: 3,
    language: "vi-VN-southwest",
  });
  assert.equal(synchronized.idea_brief, "Ý tưởng duy nhất được nhập ở giao diện người dùng và đồng bộ xuống workflow.");
  assert.equal(synchronized.target_duration_minutes, 3);
  assert.equal(synchronized.dialogue.language, "vi-VN-southwest");
  assert.equal(synchronized.script_review.decision, "PENDING");
  assert.equal(synchronized.script_review.reviewed_at, undefined);
});

test("budget approval used by project creation locks the full suggested amount", () => {
  const approved = approveProviderBudgetForProjectCreation(approvedProviderBudget, "2026-08-10T10:00:00.000Z");
  assert.equal(approved.approval.decision, "APPROVE");
  assert.equal(approved.approval.approved_limit, approved.estimate.total);
  assert.equal(approved.approval.reviewed_at, "2026-08-10T10:00:00.000Z");
  assert.equal(providerBudgetApproved(approved), true);
});

test("maps each pilot shot to the first named cast member instead of always using Tường Vy", () => {
  const filmCharacters = [
    { source_actor_id: "TV", film_character_name: "Nhân vật A" },
    { source_actor_id: "PA", film_character_name: "Nhân vật B" },
    { source_actor_id: "BL", film_character_name: "Bà Lan" },
    { source_actor_id: "MINH", film_character_name: "Minh" },
  ];
  const sourceActors = [
    { source_actor_id: "TV", source_actor_name: "Tường Vy" },
    { source_actor_id: "PA", source_actor_name: "Phương An" },
    { source_actor_id: "BL", source_actor_name: "Bà Lan" },
    { source_actor_id: "MINH", source_actor_name: "Minh" },
  ];
  assert.equal(matchShortFilmShotActor("Tường Vy lướt điện thoại tìm việc", filmCharacters, sourceActors), "TV");
  assert.equal(matchShortFilmShotActor("Minh tự xưng tuyển dụng viên", filmCharacters, sourceActors), "MINH");
  assert.equal(matchShortFilmShotActor("Phương An nhận thấy Tường Vy căng thẳng", filmCharacters, sourceActors), "PA");
  assert.equal(matchShortFilmShotActor("Bà Lan nhắc nhà tuyển dụng chân chính không thu tiền", filmCharacters, sourceActors), "BL");
});

test("syncs a newly added third character into the selected source actors", () => {
  const actors = [
    { source_actor_id: "CHAR_TUONG_VY", source_actor_name: "Tường Vy", source_kind: "CHARACTER_LIBRARY_MASTER", master_identity_status: "APPROVED_LOCKED" },
    { source_actor_id: "CHAR_PHUONG_AN", source_actor_name: "Phương An", source_kind: "CHARACTER_LIBRARY_MASTER", master_identity_status: "APPROVED_LOCKED" },
    { source_actor_id: "CHAR_BA_LAN", source_actor_name: "Bà Lan", source_kind: "CHARACTER_LIBRARY_MASTER", master_identity_status: "APPROVED_LOCKED" },
  ] as const;
  const characters = actors.map((actor, index) => ({
    source_actor_id: actor.source_actor_id,
    film_character_name: actor.source_actor_name,
    film_role: index === 0 ? "PROTAGONIST" as const : "SUPPORTING" as const,
    relationships: "",
    personality: "",
    appearance: "",
  }));

  const selected = syncShortFilmSourceActors(characters, [...actors], [actors[0], actors[1]]);

  assert.equal(shortFilmSourceActorsNeedSync(characters, [actors[0], actors[1]]), true);
  assert.deepEqual(selected.map((actor) => actor.source_actor_id), ["CHAR_TUONG_VY", "CHAR_PHUONG_AN", "CHAR_BA_LAN"]);
  assert.equal(shortFilmSourceActorsNeedSync(characters, selected), false);
  assert.doesNotThrow(() => ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    character_count: 3,
    source_actors: selected,
    film_characters: characters,
  }));
});

test("migrate legacy short-film draft without deleting user content", () => {
  const defaults = ShortFilmWorkflowSchema.parse(shortFilmWorkflow);
  const legacy = {
    ...shortFilmWorkflow,
    idea_brief: "Ý tưởng người dùng phải được giữ nguyên",
    pilot_sampling: undefined,
    dialogue: { language: "vi", dialogue_mode: "DIALOGUE" },
  };
  const migrated = migrateShortFilmWorkflowDraft(legacy, defaults);
  assert.equal(migrated.idea_brief, legacy.idea_brief);
  assert.deepEqual(migrated.pilot_sampling, defaults.pilot_sampling);
  assert.equal(migrated.dialogue.voice_master_mode, defaults.dialogue.voice_master_mode);
  assert.equal(migrated.dialogue.singing_scene, defaults.dialogue.singing_scene);
});

test("Shot Plan blocks an ambiguous multi-character scene instead of silently using the first actor", () => {
  const secondActor = {
    ...shortFilmWorkflow.source_actors[0],
    source_actor_id: "GDTH-CHAR-002",
    source_actor_name: "Phương An",
  };
  const workflow = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    character_count: 2,
    source_actors: [...shortFilmWorkflow.source_actors, secondActor],
    film_characters: [
      ...shortFilmWorkflow.film_characters,
      { ...shortFilmWorkflow.film_characters[0], source_actor_id: secondActor.source_actor_id, film_character_name: "Phương An" },
    ],
    target_duration_minutes: 1,
    full_script: Array.from({ length: 6 }, (_, index) => `CẢNH ${index + 1}. Một người bước vào phòng và nhìn quanh rất lo lắng.`).join(" "),
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
  });

  assert.throws(() => createShortFilmShotPlan(workflow), /SHOT_PLAN_CHARACTER_AMBIGUOUS/);
});

test("Shot Plan preserves Vietnamese character names and multi-sentence dialogue", () => {
  const script = [
    "CẢNH 1 – PHÒNG TRỌ – SÁNG",
    "NHỊP 1 – TƯỜNG VY ngồi trước bàn, nhìn điện thoại rồi thở dài vì chưa tìm được việc.",
    "TƯỜNG VY: Trời ơi, kiếm việc đàng hoàng sao khó dữ vậy nè. Mình phải bình tĩnh tìm cho kỹ.",
    "NHỊP 2 – TƯỜNG VY mở tin nhắn tuyển dụng và đọc kỹ từng dòng trên màn hình.",
    "TƯỜNG VY: Việc nhẹ lương cao mà còn đòi chuyển tiền giữ suất thì đáng nghi quá.",
    "NHỊP 3 – TƯỜNG VY chụp lại bằng chứng rồi gọi điện cho người thân để hỏi ý kiến.",
    "TƯỜNG VY: Mình sẽ không chuyển tiền và sẽ báo tài khoản này ngay.",
  ].join("\n");
  const workflow = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    target_duration_minutes: 1,
    full_script: script,
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
  });

  const plan = createShortFilmShotPlan(workflow);
  assert.equal(plan.execution_shots.length, 6);
  assert.ok(plan.execution_shots.every((shot) => /TƯỜNG VY/u.test(shot.summary)));
  assert.match(plan.execution_shots[2].summary, /TƯỜNG VY: Mình phải bình tĩnh tìm cho kỹ/u);
  assert.deepEqual(plan.execution_shots[1].risk_tags, ["IDENTITY_DIALOGUE"]);
});

test("Shot Plan samples the full approved script instead of truncating to the opening scene", () => {
  const fullScript = Array.from({ length: 4 }, (_, sceneIndex) => [
    `CẢNH ${sceneIndex + 1} – BỐI CẢNH ${sceneIndex + 1}`,
    ...Array.from({ length: 8 }, (_, beatIndex) => `NHỊP ${sceneIndex * 8 + beatIndex + 1} – TƯỜNG VY thực hiện hành động ${sceneIndex + 1}.${beatIndex + 1} để câu chuyện tiến triển rõ ràng.`),
  ].join("\n")).join("\n");
  const workflow = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    target_duration_minutes: 3,
    full_script: fullScript,
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
  });

  const plan = createShortFilmShotPlan(workflow);
  assert.equal(plan.execution_shots.length, 18);
  assert.match(plan.execution_shots[0].summary, /CẢNH 1/u);
  assert.match(plan.execution_shots.at(-1)?.summary ?? "", /CẢNH 4/u);
  assert.ok([1, 2, 3, 4].every((scene) => plan.execution_shots.some((shot) => shot.summary.includes(`CẢNH ${scene}`))));
});

test("draft migration never deletes valid user approvals or project content", () => {
  const defaults = ShortFilmWorkflowSchema.parse(shortFilmWorkflow);
  const migrated = migrateShortFilmWorkflowDraft({
    ...shortFilmWorkflow,
    idea_brief: "Nội dung dự án phải giữ nguyên",
    pilot_budget_approval: { sample_count: 3, clip_duration_seconds: 15, runway_credits_cap: 700, elevenlabs_credits_cap: 1_000, sync_usd_cap: 3, decision: "APPROVE", reviewer: "PROJECT_OWNER", reviewed_at: "2026-08-01T00:00:00.000Z" },
    pilot: { duration_seconds: 15, video_url: "https://drive.google.com/file/d/old-pilot/view", qc: { identity: true, motion: true, lip_sync: true, voice: true, background: true, lighting: true, continuity: true }, review: { decision: "APPROVE", notes: "old", reviewer: "PROJECT_OWNER" } },
    full_film: { video_url: "https://drive.google.com/file/d/old-film/view", qc: { identity: true, motion: true, lip_sync: true, voice: true, background: true, lighting: true, continuity: true }, review: { decision: "APPROVE", notes: "old", reviewer: "PROJECT_OWNER" } },
  }, defaults);
  assert.equal(migrated.idea_brief, "Nội dung dự án phải giữ nguyên");
  assert.deepEqual(migrated.source_actors, shortFilmWorkflow.source_actors);
  assert.equal(migrated.pilot_budget_approval?.decision, "APPROVE");
  assert.equal(migrated.pilot?.review.decision, "APPROVE");
  assert.equal(migrated.full_film?.review.decision, "APPROVE");
});

test("AI có thể tự xây dựng chi tiết nhân vật còn để trống", () => {
  const workflow = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    film_characters: shortFilmWorkflow.film_characters.map((character) => ({
      ...character,
      relationships: "",
      personality: "",
      appearance: "",
    })),
  });
  assert.equal(workflow.film_characters[0].relationships, "");
  assert.equal(workflow.film_characters[0].personality, "");
  assert.equal(workflow.film_characters[0].appearance, "");
});

const approvedProviderBudget = {
  internal_services: { post_production: "TUHAUAI_FFMPEG_CLOUD_RUN", music_source: "PROJECT_OWNER_LICENSED" },
  providers: { script: "OPENAI_RESPONSES", video: "RUNWAY", voice: "ELEVENLABS", lip_sync: "SYNC" },
  estimate: { basis_version: "TUHAUAI_BUDGET_2026-08-09", estimated_duration_seconds: 300, currency: "USD", script: 1, video: 50, voice: 5, lip_sync: 4, contingency: 10, total: 70 },
  approval: { decision: "APPROVE", approved_limit: 70, reviewer: "PROJECT_OWNER", reviewed_at: "2026-08-09T00:00:00.000Z" },
} as const;

const shortFilmWorkflow = {
  schema_version: "SHORT_FILM_FORM_V1",
  character_count: 1,
  source_actors: [{
    source_actor_id: "CHAR_TUONG_VY",
    source_actor_name: "Tường Vy",
    source_kind: "CHARACTER_LIBRARY_MASTER",
    master_identity_status: "APPROVED_LOCKED",
  }],
  film_characters: [{
    source_actor_id: "CHAR_TUONG_VY",
    film_character_name: "Vy",
    film_role: "PROTAGONIST",
    relationships: "Chị của An",
    personality: "Điềm tĩnh",
    appearance: "Trang phục đời thường",
  }],
  script_source: "AI_DEVELOPED_FROM_IDEA",
  idea_brief: "Hai chị em hiểu lầm nhau rồi cùng tìm lại sự tin tưởng trong gia đình.",
  target_duration_minutes: 8,
  providers: {
    script: "OPENAI_RESPONSES",
    image_to_video: "RUNWAY_IMAGE_TO_VIDEO",
    lip_sync: "SYNC_LIP_SYNC",
    voice: "APPROVED_VOICE_MASTER",
    execution_mode: "APPROVAL_GATED",
  },
  script_title: "Gia đình",
  script_synopsis: "Hai chị em hóa giải hiểu lầm.",
  full_script: "CẢNH 1 – NỘI – NHÀ – NGÀY\nVy và An trò chuyện.",
  script_review: { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" },
  dialogue: {
    language: "vi",
    dialogue_mode: "DIALOGUE",
    voice_master_mode: "APPROVED_VOICE_MASTER_ONLY",
    singing_scene: false,
    singing_scene_notes: "",
  },
} as const;

const productionReadiness = {
  identity_masters: [{
    source_actor_id: "CHAR_TUONG_VY",
    master_identity_id: "TUONG_VY_MASTER_IDENTITY_V1",
    reference_set_version: "V1",
    status: "APPROVED_LOCKED",
  }],
  voice_masters: [{
    source_actor_id: "CHAR_TUONG_VY",
    voice_master_id: "TUONG_VY_VOICE_MASTER_AI_V1",
    casting_profile: "Vietnamese female Mekong Delta adult",
    perceived_age_band: "ADULT",
    locale: "vi-VN-southwest",
    performance_style: "SOUTHERN_TV_DRAMA_DUBBING",
    pronunciation_lexicon_id: "GDTH-SOUTHWEST-VI-V1",
    audition_audio_url: "https://drive.google.com/file/d/audition/view",
    audition_review: { decision: "APPROVE", notes: "Age, accent and delivery approved", reviewer: "PROJECT_OWNER", reviewed_at: "2026-08-09T00:00:00.000Z" },
    status: "APPROVED_LOCKED",
  }],
  keyframes: [{
    shot_id: "SHOT-001",
    approved_image_url: "https://drive.google.com/file/d/keyframe/view",
    identity_decision: "APPROVE",
    continuity_decision: "APPROVE",
    reviewer: "PROJECT_OWNER",
    reviewed_at: "2026-08-09T00:00:00.000Z",
  }],
  speaker_locks: [{
    shot_id: "SHOT-001",
    speaker_source_actor_id: "CHAR_TUONG_VY",
    voice_master_id: "TUONG_VY_VOICE_MASTER_AI_V1",
    visible_face_count: 1,
    selection_mode: "SINGLE_VISIBLE_FACE",
  }],
  dialogue_line_approvals: [{
    line_id: "LINE-001",
    shot_id: "SHOT-001",
    speaker_source_actor_id: "CHAR_TUONG_VY",
    voice_master_id: "TUONG_VY_VOICE_MASTER_AI_V1",
    dialogue_text: "Má về rồi, con đừng lo.",
    target_duration_ms: 2400,
    pronunciation_decision: "APPROVE",
    age_casting_decision: "APPROVE",
    timing_decision: "APPROVE",
    reviewer: "PROJECT_OWNER",
    reviewed_at: "2026-08-09T00:00:00.000Z",
  }],
  performance_plan: {
    production_mode: "PERFORMANCE_DRIVEN_HYBRID",
    shots: [{
      shot_id: "SHOT-001", duration_ms: 3400,
      performance_source_mode: "OWNER_RECORDED",
      performance_source_url: "https://drive.google.com/file/d/performance/view",
      beats: [
        { beat_id: "B1", beat_type: "SPEAK", start_ms: 0, end_ms: 2400, direction: "Nói đúng câu thoại", dialogue_line_id: "LINE-001" },
        { beat_id: "B2", beat_type: "SETTLE", start_ms: 2400, end_ms: 3400, direction: "Dừng tự nhiên rồi cắt" },
      ],
      review: { decision: "APPROVE", notes: "", reviewer: "PROJECT_OWNER" },
    }],
    timing_contracts: [{
      shot_id: "SHOT-001", dialogue_line_id: "LINE-001", speech_start_ms: 0, speech_end_ms: 2400,
      measured_speech_end_ms: 2400, shot_end_ms: 3400, max_post_speech_action_ms: 1000,
      review: { decision: "APPROVE", notes: "", reviewer: "PROJECT_OWNER" },
    }],
    animatic: { video_url: "https://drive.google.com/file/d/animatic/view", uses_paid_provider_output: false, dialogue_timing_visible: true, review: { decision: "APPROVE", notes: "", reviewer: "PROJECT_OWNER" } },
    golden_scene: { shot_ids: ["SHOT-001"], identity_locked: true, speech_motion_aligned: true, performance_continuity: true, natural_cut_after_dialogue: true, review: { decision: "APPROVE", notes: "", reviewer: "PROJECT_OWNER" } },
    review: { decision: "APPROVE", notes: "", reviewer: "PROJECT_OWNER" },
  },
  review: {
    decision: "APPROVE",
    notes: "Identity, voice, keyframe and speaker mapping locked",
    reviewer: "PROJECT_OWNER",
    reviewed_at: "2026-08-09T00:00:00.000Z",
  },
} as const;

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
  provider_budget: approvedProviderBudget,
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

test("canonical short-film resume snapshot preserves the complete saved project", () => {
  const workflow = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    target_duration_minutes: 3,
    script_review: { decision: "APPROVE", notes: "Da duyet kich ban", reviewer: "PROJECT_OWNER" },
    shot_plan: {
      summary: "Shot Plan can sua",
      shots: ["Shot 01"],
      execution_shots: [],
      review: { decision: "REQUEST_CHANGES", notes: "Khong lap noi dung", reviewer: "PROJECT_OWNER" },
    },
  });
  const snapshot = createShortFilmResumeSnapshot({
    ...common,
    project_type: "SHORT_FILM",
    project_name: "Lua dao xin viec",
    language: "vi-VN-southwest",
    duration_target: "5_MINUTES",
    platforms: ["YOUTUBE", "FACEBOOK"],
    story_idea: "Tim viec qua mang va bi lua chuyen tien giu suat viec nhe luong cao.",
    social_theme: "COMMUNITY",
    story_genre: "FAMILY_DRAMA",
    primary_setting: "CITY",
    ending_direction: "LESSON",
    dialogue_source: "AI_DRAFT_OWNER_APPROVES",
    short_film_workflow: workflow,
  });
  assert.deepEqual(snapshot.form_values.duration_target, ["3_MINUTES"]);
  assert.deepEqual(snapshot.form_values.platforms, ["YOUTUBE", "FACEBOOK"]);
  assert.deepEqual(snapshot.form_values.story_idea, ["Tim viec qua mang va bi lua chuyen tien giu suat viec nhe luong cao."]);
  assert.equal(snapshot.duration_target, "3_MINUTES");
  assert.equal(snapshot.provider_budget.approval.decision, "APPROVE");
  assert.equal(snapshot.characters.length, 1);
  assert.equal(snapshot.short_film_workflow.script_review.decision, "APPROVE");
  assert.equal(snapshot.short_film_workflow.shot_plan?.review.decision, "REQUEST_CHANGES");
  assert.equal(snapshot.short_film_workflow.shot_plan?.review.notes, "Khong lap noi dung");
});

test("khóa nhà cung cấp khi kinh phí chưa duyệt hoặc hạn mức không đủ", () => {
  assert.equal(providerBudgetApproved({
    ...approvedProviderBudget,
    approval: { ...approvedProviderBudget.approval, decision: "PENDING", reviewed_at: undefined },
  }), false);
  assert.throws(() => ShortFilmScriptGenerationRequestSchema.parse({
    idea: "Hai chị em cùng giải quyết một biến cố gia đình quan trọng.",
    target_duration_minutes: 6,
    language: "vi",
    characters: shortFilmWorkflow.film_characters,
    reference_sources: [],
    provider_budget: { ...approvedProviderBudget, approval: { ...approvedProviderBudget.approval, approved_limit: 60 } },
  }), /Hạn mức duyệt/);
});

test("tự tính dự toán có dự phòng theo thời lượng và provider", () => {
  const estimate = calculateSuggestedProviderBudget({
    project_type: "SHORT_FILM",
    duration_seconds: 300,
    providers: approvedProviderBudget.providers,
  });
  assert.equal(estimate.basis_version, "TUHAUAI_BUDGET_2026-08-09");
  assert.equal(estimate.video, 54);
  assert.equal(estimate.total, 74.82);
  assert.equal(estimate.contingency, 12.47);
});

test("kịch bản chủ dự án cung cấp không tính phí OpenAI", () => {
  const providers = { ...approvedProviderBudget.providers, script: shortFilmScriptProvider("PROJECT_OWNER_PROVIDED") };
  const estimate = calculateSuggestedProviderBudget({ project_type: "SHORT_FILM", duration_seconds: 180, providers });
  assert.equal(providers.script, "PROJECT_OWNER");
  assert.equal(estimate.script, 0);
  assert.equal(estimate.total, 44.17);
});

test("pilot plan khóa provider và tài sản nhưng chưa gọi provider", () => {
  const preparedAt = "2026-08-09T10:00:00.000Z";
  const workflow = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER", reviewed_at: preparedAt },
    shot_plan: { summary: "Pilot", shots: ["Cận cảnh Vy nói thoại"] },
    production_readiness: productionReadiness,
  });
  const plan = prepareShortFilmPilotPlan({
    project_id: "GDTH-FILM-PILOT-001",
    workflow,
    provider_budget: approvedProviderBudget,
    pilot_duration_seconds: 15,
    prepared_at: preparedAt,
    account_checks: [
      { provider: "RUNWAY", status: "SUFFICIENT", checked_at: preparedAt, manual_balance_confirmed: false },
      { provider: "ELEVENLABS", status: "SUFFICIENT", checked_at: preparedAt, manual_balance_confirmed: false },
      { provider: "SYNC", status: "UNVERIFIED", checked_at: preparedAt, manual_balance_confirmed: true },
    ],
  });
  assert.equal(plan.submission_gate, "AWAITING_PROJECT_OWNER_APPROVAL");
  assert.equal(plan.provider_calls_made, false);
  assert.equal(plan.pilot_shot_ids[0], "SHOT-001");
  assert.equal(plan.pilot_samples.length, 3);
  assert.equal(plan.total_sample_duration_seconds, 45);
  assert.deepEqual(plan.locked_identity_master_ids, ["TUONG_VY_MASTER_IDENTITY_V1"]);
  assert.deepEqual(plan.locked_voice_master_ids, ["TUONG_VY_VOICE_MASTER_AI_V1"]);
  assert.equal(plan.stages.find((stage) => stage.provider === "SYNC")?.required, true);
  assert.ok(plan.heartbeat_policy.hard_timeout_seconds > plan.heartbeat_policy.stale_after_seconds);
});

test("pilot plan từ chối số dư thiếu, xác nhận Sync thiếu và account check cũ", () => {
  const preparedAt = "2026-08-09T10:20:00.000Z";
  const workflow = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER", reviewed_at: preparedAt },
    shot_plan: { summary: "Pilot", shots: ["Cận cảnh Vy nói thoại"] },
    production_readiness: productionReadiness,
  });
  assert.throws(() => prepareShortFilmPilotPlan({
    project_id: "GDTH-FILM-PILOT-001",
    workflow,
    provider_budget: approvedProviderBudget,
    pilot_duration_seconds: 15,
    prepared_at: preparedAt,
    account_checks: [
      { provider: "RUNWAY", status: "INSUFFICIENT", checked_at: "2026-08-09T10:00:00.000Z", manual_balance_confirmed: false },
      { provider: "ELEVENLABS", status: "SUFFICIENT", checked_at: preparedAt, manual_balance_confirmed: false },
      { provider: "SYNC", status: "UNVERIFIED", checked_at: preparedAt, manual_balance_confirmed: false },
    ],
  }), /RUNWAY_ACCOUNT_NOT_SUFFICIENT|SYNC_ACCOUNT_NOT_CONFIRMED|RUNWAY_ACCOUNT_CHECK_STALE/);
});

test("khóa sản xuất toàn phim cho đến khi mọi clip mẫu và pilot batch được duyệt", () => {
  const approvedQc = { identity: true, motion: true, lip_sync: true, voice: true, background: true, lighting: true, continuity: true };
  const workflow = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    script_review: { decision: "APPROVE", notes: "ok", reviewer: "PROJECT_OWNER", reviewed_at: "2026-08-10T10:00:00.000Z" },
    shot_plan: { summary: "Representative shot", shots: ["A"] },
    production_readiness: productionReadiness,
    pilot_sampling: { sample_count: 3, clip_duration_seconds: 15, selection_mode: "RISK_BASED_REPRESENTATIVE_SHOTS", required_purposes: ["IDENTITY_DIALOGUE", "MOTION_PERFORMANCE", "MULTI_CHARACTER_CONTINUITY"] },
    pilot_batch: {
      samples: ["IDENTITY_DIALOGUE", "MOTION_PERFORMANCE", "MULTI_CHARACTER_CONTINUITY"].map((purpose, index) => ({
        sample_id: `PILOT-${index + 1}`, purpose, shot_ids: [`SHOT-00${index + 1}`], duration_seconds: 15,
        video_url: `https://drive.google.com/file/d/pilot-${index + 1}/view`, qc: approvedQc,
        review: { decision: "APPROVE", notes: "ok", reviewer: "PROJECT_OWNER", reviewed_at: "2026-08-10T10:00:00.000Z" },
      })),
      batch_review: { decision: "APPROVE", notes: "all passed", reviewer: "PROJECT_OWNER", reviewed_at: "2026-08-10T10:00:00.000Z" },
    },
  });
  assert.equal(shortFilmNextAction(workflow), "PRODUCE_SHORT_FILM");
  assert.throws(() => ShortFilmWorkflowSchema.parse({ ...workflow, pilot_batch: { ...workflow.pilot_batch, samples: workflow.pilot_batch!.samples.map((sample, index) => index === 0 ? { ...sample, qc: { ...sample.qc, identity: false } } : sample) } }), /PILOT_SAMPLE_NOT_APPROVED/);
});

test("chọn clip mẫu theo rủi ro từ các execution shot hợp lệ của phim dài", () => {
  const shots = Array.from({ length: 9 }, (_, index) => ({
    shot_id: `SHOT-${String(index + 1).padStart(3, "0")}`,
    summary: `Shot ${index + 1}`,
    runway_prompt: `Cinematic natural performance for approved character in shot ${index + 1}`,
    duration_seconds: 5,
    risk_tags: index === 0 ? ["IDENTITY_DIALOGUE"] : index === 3 ? ["MOTION_PERFORMANCE"] : index === 6 ? ["MULTI_CHARACTER_CONTINUITY"] : [],
  }));
  const parsed = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    script_review: { decision: "APPROVE", notes: "ok", reviewer: "PROJECT_OWNER" },
    shot_plan: { summary: "Nine shots", shots: shots.map((shot) => shot.summary), execution_shots: shots },
  });
  const samples = selectShortFilmPilotSamples(parsed);
  assert.equal(samples.length, 3);
  assert.ok(samples.every((sample) => sample.expected_duration_seconds === 15 && sample.shots.length === 3));
  assert.equal(new Set(samples.flatMap((sample) => sample.shots.map((shot) => shot.shot_id))).size, 9);
});

test("mở yêu cầu kịch bản AI khi dự toán và kinh phí đã duyệt", () => {
  const result = ShortFilmScriptGenerationRequestSchema.parse({
    idea: "Hai chị em cùng giải quyết một biến cố gia đình quan trọng.",
    target_duration_minutes: 6,
    language: "vi",
    characters: shortFilmWorkflow.film_characters,
    reference_sources: [],
    provider_budget: approvedProviderBudget,
  });
  assert.equal(providerBudgetApproved(result.provider_budget), true);
});

test("tính tiến độ phim ngắn theo approval gate thực tế", () => {
  const progress = calculateProjectProgress("SHORT_FILM", "PREPARE_SHORT_FILM_PILOT");
  assert.equal(progress.completed_steps, 5);
  assert.equal(progress.total_steps, 10);
  assert.equal(progress.percent_complete, 50);
  assert.equal(progress.milestones[5]?.status, "CURRENT");
  assert.equal(progress.milestones[6]?.status, "PENDING");
});

test("chỉ báo 100% khi dự án READY_TO_PUBLISH", () => {
  const progress = calculateProjectProgress("SHORT_FILM", "READY_TO_PUBLISH");
  assert.equal(progress.percent_complete, 100);
  assert.ok(progress.milestones.every((milestone) => milestone.status === "COMPLETED"));
});

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
    short_film_workflow: shortFilmWorkflow,
  });

  assert.equal(result.project_type, "SHORT_FILM");
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
    short_film_workflow: shortFilmWorkflow,
  });

  assert.equal(result.characters[0]?.character_id, "CHAR_TUONG_VY");
  assert.equal(result.characters[0]?.voice_approval_status, "APPROVED");
});

test("từ chối lip-sync khi voice chưa được bật và duyệt", () => {
  assert.throws(() => normalizeProjectIntake({
    ...common,
    characters: [{
      ...common.characters[0],
      voice_required: false,
      voice_approval_status: undefined,
      lip_sync_required: true,
    }],
    project_type: "SHORT_FILM",
    story_idea: "Một câu chuyện hậu trường",
    social_theme: "Tình thân",
    story_genre: "Hài tình cảm",
    primary_setting: "Đoàn Lô Tô",
    ending_direction: "Kết thúc trọn vẹn",
    dialogue_source: "AI_GENERATED",
    short_film_workflow: shortFilmWorkflow,
  }), /Khớp khẩu hình chỉ được bật/);
});

test("chấp nhận tối đa 5 link công khai khi từng link đã xác nhận quyền", () => {
  const result = normalizeProjectIntake({
    ...common,
    reference_sources: Array.from({ length: 5 }, (_, index) => ({
      platform: "YOUTUBE",
      url: `https://www.youtube.com/watch?v=public-${index}`,
      usage_mode: "INSPIRATION_ONLY",
      rights_confirmed: true,
      notes: "Chỉ học nhịp kể",
    })),
    project_type: "SHORT_FILM",
    story_idea: "Một câu chuyện hậu trường",
    social_theme: "Tình thân",
    story_genre: "Hài tình cảm",
    primary_setting: "Đoàn Lô Tô",
    ending_direction: "Kết thúc trọn vẹn",
    dialogue_source: "AI_GENERATED",
    short_film_workflow: shortFilmWorkflow,
  });

  assert.equal(result.reference_sources.length, 5);
});

test("từ chối link tham khảo chưa xác nhận quyền hoặc vượt quá 5 link", () => {
  const project = {
    ...common,
    project_type: "SHORT_FILM",
    story_idea: "Một câu chuyện hậu trường",
    social_theme: "Tình thân",
    story_genre: "Hài tình cảm",
    primary_setting: "Đoàn Lô Tô",
    ending_direction: "Kết thúc trọn vẹn",
    dialogue_source: "AI_GENERATED",
    short_film_workflow: shortFilmWorkflow,
  };
  const reference = {
    platform: "FACEBOOK",
    url: "https://www.facebook.com/watch/public",
    usage_mode: "STRUCTURE_REFERENCE",
    rights_confirmed: true,
    notes: "Chỉ học cấu trúc",
  };

  assert.throws(() => normalizeProjectIntake({
    ...project,
    reference_sources: [{ ...reference, rights_confirmed: false }],
  }), /Phải xác nhận quyền sử dụng/);
  assert.throws(() => normalizeProjectIntake({
    ...project,
    reference_sources: Array.from({ length: 6 }, () => reference),
  }), /tối đa 5 link/);
});

test("từ chối URL không khớp nền tảng tham khảo", () => {
  assert.throws(() => ShortFilmScriptGenerationRequestSchema.parse({
    idea: "Hai chị em cùng giải quyết một biến cố gia đình quan trọng.",
    target_duration_minutes: 6,
    language: "vi",
    characters: shortFilmWorkflow.film_characters,
    reference_sources: [{
      platform: "YOUTUBE",
      url: "https://example.com/not-youtube",
      usage_mode: "INSPIRATION_ONLY",
      rights_confirmed: true,
      notes: "Học nhịp kể",
    }],
    provider_budget: approvedProviderBudget,
  }), /Tên miền URL không khớp/);
});

test("API tạo kịch bản từ chối nguồn chưa xác nhận quyền", () => {
  assert.throws(() => ShortFilmScriptGenerationRequestSchema.parse({
    idea: "Hai chị em cùng giải quyết một biến cố gia đình quan trọng.",
    target_duration_minutes: 6,
    language: "vi",
    characters: shortFilmWorkflow.film_characters,
    reference_sources: [{
      platform: "TIKTOK",
      url: "https://www.tiktok.com/@tuhau/video/123",
      usage_mode: "STRUCTURE_REFERENCE",
      rights_confirmed: false,
      notes: "Học cấu trúc",
    }],
    provider_budget: approvedProviderBudget,
  }), /Phải xác nhận quyền sử dụng/);
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
      project_type: "SHORT_FILM",
      story_idea: "Một câu chuyện hậu trường",
      social_theme: "Tình thân",
      story_genre: "Hài tình cảm",
      primary_setting: "Đoàn Lô Tô",
      ending_direction: "Kết thúc trọn vẹn",
      dialogue_source: "AI_GENERATED",
      short_film_workflow: shortFilmWorkflow,
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
    short_film_workflow: shortFilmWorkflow,
  });

  assert.deepEqual(result.characters[0]?.selected_costume_ids, []);
});

test("khóa Shot Plan khi SCRIPT_APPROVED chưa đạt", () => {
  assert.throws(() => ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    shot_plan: { summary: "Hai cảnh", shots: ["Cận Vy"] },
  }));
});

test("ba pilot 15 giây từ Shot Plan 10 giây luôn giữ đúng tổng 45 giây và trần chi phí", () => {
  const shots = Array.from({ length: 18 }, (_, index) => ({
    shot_id: `SHOT-${String(index + 1).padStart(3, "0")}`,
    summary: `Shot ${index + 1}`,
    runway_prompt: `Cinematic natural performance for approved character in shot ${index + 1}`,
    duration_seconds: 10,
    risk_tags: index === 0 ? ["IDENTITY_DIALOGUE"] : index === 2 ? ["MOTION_PERFORMANCE"] : index === 4 ? ["MULTI_CHARACTER_CONTINUITY"] : [],
  }));
  const parsed = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    script_review: { decision: "APPROVE", notes: "ok", reviewer: "PROJECT_OWNER" },
    shot_plan: { summary: "Eighteen shots", shots: shots.map((shot) => shot.summary), execution_shots: shots },
  });
  const samples = selectShortFilmPilotSamples(parsed);
  assert.deepEqual(samples.map((sample) => sample.expected_duration_seconds), [15, 15, 15]);
  assert.equal(samples.flatMap((sample) => sample.shots).reduce((sum, shot) => sum + shot.duration_seconds, 0), 45);
  assert.equal(new Set(samples.flatMap((sample) => sample.shots.map((shot) => shot.shot_id))).size, 6);
  const budget = calculateShortFilmPilotBudget(parsed);
  assert.equal(budget.unique_shot_seconds, 45);
  assert.deepEqual(budget.proposed_caps, {
    runway_credits: 648,
    elevenlabs_characters: 810,
    sync_usd: 2.7,
  });
  const pilotShotIds = samples.flatMap((sample) => sample.shots.map((shot) => shot.shot_id));
  const withDialogue = ShortFilmWorkflowSchema.parse({
    ...parsed,
    pilot_budget_approval: {
      sample_count: 3, clip_duration_seconds: 15, runway_credits_cap: 700,
      elevenlabs_credits_cap: 1_000, sync_usd_cap: 3, decision: "APPROVE",
      reviewer: "PROJECT_OWNER", reviewed_at: "2026-08-11T00:00:00.000Z",
    },
    production_readiness: {
      ...productionReadiness,
      dialogue_line_approvals: pilotShotIds.map((shot_id, index) => ({
        ...productionReadiness.dialogue_line_approvals[0],
        line_id: `LINE-${index + 1}`,
        shot_id,
        dialogue_text: "Một câu thoại thử nghiệm điện ảnh miền Tây cần đủ độ dài để kiểm tra chính xác hạn mức ký tự của nhà cung cấp giọng nói trước khi chạy clip pilot thật.",
      })),
    },
  });
  const dialogueBudget = calculateShortFilmPilotBudget(withDialogue);
  assert.ok(dialogueBudget.required.elevenlabs_characters > 810);
  assert.ok(dialogueBudget.required.elevenlabs_characters <= 1_000);
  assert.equal(shortFilmPilotBudgetApprovalIsSufficient(withDialogue), true);
});

test("cho phép lưu kịch bản đã sửa khi chủ dự án vừa duyệt lại", () => {
  const existing = {
    full_script: "Bản kịch bản cũ",
    script_review: { decision: "APPROVE" as const, reviewer: "PROJECT_OWNER" as const, notes: "", reviewed_at: "2026-08-11T08:00:00.000Z" },
  };
  const incoming = {
    full_script: "Bản kịch bản mới có đủ diễn biến",
    script_review: { decision: "APPROVE" as const, reviewer: "PROJECT_OWNER" as const, notes: "", reviewed_at: "2026-08-11T08:05:00.000Z" },
  };

  assert.equal(shortFilmScriptApprovalIsFresh(existing, incoming), true);
});

test("không cho kịch bản sửa giữ lại lần duyệt cũ", () => {
  const existing = {
    full_script: "Bản kịch bản cũ",
    script_review: { decision: "APPROVE" as const, reviewer: "PROJECT_OWNER" as const, notes: "", reviewed_at: "2026-08-11T08:00:00.000Z" },
  };
  const incoming = {
    full_script: "Bản kịch bản bị đổi nhưng chưa duyệt lại",
    script_review: { ...existing.script_review },
  };

  assert.equal(shortFilmScriptApprovalIsFresh(existing, incoming), false);
});

test("khóa toàn phim khi PILOT_APPROVED chưa đạt", () => {
  assert.throws(() => ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    script_review: { decision: "APPROVE", notes: "Đạt", reviewer: "PROJECT_OWNER" },
    shot_plan: { summary: "Hai cảnh", shots: ["Cận Vy"] },
    production_readiness: productionReadiness,
    pilot: {
      duration_seconds: 15,
      video_url: "https://drive.google.com/file/d/pilot/view",
      qc: { identity: true, motion: true, lip_sync: true, voice: true, background: true, lighting: true, continuity: true },
      review: { decision: "REQUEST_CHANGES", notes: "Sửa khẩu hình", reviewer: "PROJECT_OWNER" },
    },
    full_film: {
      video_url: "https://drive.google.com/file/d/full/view",
      qc: { identity: true, motion: true, lip_sync: true, voice: true, background: true, lighting: true, continuity: true },
      review: { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" },
    },
  }));
});

test("chỉ READY_TO_PUBLISH sau SCRIPT, PILOT và phim hoàn chỉnh được duyệt QC", () => {
  const approvedQc = { identity: true, motion: true, lip_sync: true, voice: true, background: true, lighting: true, continuity: true };
  const approved = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    script_review: { decision: "APPROVE", notes: "Đạt", reviewer: "PROJECT_OWNER" },
    shot_plan: { summary: "Hai cảnh", shots: ["Cận Vy"] },
    production_readiness: productionReadiness,
    pilot_batch: {
      samples: ["IDENTITY_DIALOGUE", "MOTION_PERFORMANCE", "MULTI_CHARACTER_CONTINUITY"].map((purpose, index) => ({
        sample_id: `PILOT-${index + 1}`,
        purpose,
        shot_ids: [`SHOT-00${index + 1}`],
        duration_seconds: 15,
        video_url: `https://drive.google.com/file/d/pilot-${index + 1}/view`,
        qc: approvedQc,
        review: { decision: "APPROVE", notes: "Đạt", reviewer: "PROJECT_OWNER" },
      })),
      batch_review: { decision: "APPROVE", notes: "Đạt", reviewer: "PROJECT_OWNER" },
    },
    full_film: {
      video_url: "https://drive.google.com/file/d/full/view",
      qc: { identity: true, motion: true, lip_sync: true, voice: true, background: true, lighting: true, continuity: true },
      review: { decision: "APPROVE", notes: "Đạt", reviewer: "PROJECT_OWNER" },
    },
  });
  assert.equal(shortFilmNextAction(approved), "READY_TO_PUBLISH");
});

test("không cho PILOT_APPROVED khi một mục QC chưa đạt", () => {
  assert.throws(() => ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    script_review: { decision: "APPROVE", notes: "Đạt", reviewer: "PROJECT_OWNER" },
    shot_plan: { summary: "Hai cảnh", shots: ["Cận Vy"] },
    production_readiness: productionReadiness,
    pilot: {
      duration_seconds: 15,
      video_url: "https://drive.google.com/file/d/pilot/view",
      qc: { identity: true, motion: true, lip_sync: false, voice: true, background: true, lighting: true, continuity: true },
      review: { decision: "APPROVE", notes: "", reviewer: "PROJECT_OWNER" },
    },
  }));
});

test("lưu provenance bản nháp AI nhưng không ảnh hưởng SCRIPT_APPROVED", () => {
  const result = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    script_generation: {
      provider: "OPENAI_RESPONSES",
      model: "gpt-5.6-terra",
      provider_request_id: "resp_test",
      generated_at: "2026-08-08T14:00:00.000Z",
      usage: { input_tokens: 100, output_tokens: 500, total_tokens: 600 },
    },
  });
  assert.equal(result.script_generation?.provider_request_id, "resp_test");
  assert.equal(result.script_review.decision, "PENDING");
});

test("media providers remain locked when production readiness is missing", () => {
  const parsed = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
    shot_plan: { summary: "One shot", shots: ["Close-up Vy"] },
  });
  assert.deepEqual(shortFilmProductionReadinessBlockers(parsed), ["PRODUCTION_READINESS_MISSING"]);
  assert.equal(shortFilmMediaExecutionDecision(parsed).provider_execution_allowed, false);
  assert.equal(shortFilmNextAction(parsed), "LOCK_SHORT_FILM_PRODUCTION_READINESS");
});

test("AI-only pilot does not require owner footage or a paid animatic before generation", () => {
  const parsed = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
    shot_plan: { summary: "One shot", shots: ["Close-up Vy"], review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" } },
    production_readiness: { ...productionReadiness, performance_plan: undefined },
  });
  const decision = shortFilmMediaExecutionDecision(parsed, "PILOT");
  assert.equal(decision.provider_execution_allowed, true);
  assert.doesNotMatch(decision.blockers.join(","), /PERFORMANCE_PLAN|PERFORMANCE_SOURCE|ANIMATIC|GOLDEN_SCENE/);
});

test("pilot QC is the golden-scene gate, so an unreviewed pre-provider animatic cannot block AI-only pilot", () => {
  const parsed = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
    shot_plan: { summary: "One shot", shots: ["Close-up Vy"], review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" } },
    production_readiness: {
      ...productionReadiness,
      performance_plan: {
        ...productionReadiness.performance_plan,
        golden_scene: { ...productionReadiness.performance_plan.golden_scene, natural_cut_after_dialogue: false },
      },
    },
  });
  const decision = shortFilmMediaExecutionDecision(parsed, "PILOT");
  assert.equal(decision.provider_execution_allowed, true);
  assert.doesNotMatch(decision.blockers.join(","), /GOLDEN_SCENE_NOT_APPROVED/);
});

test("temporary Character sources are rejected at the contract boundary", () => {
  assert.throws(() => ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    source_actors: [{ ...shortFilmWorkflow.source_actors[0], master_identity_status: "TEMPORARY" }],
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
    shot_plan: { summary: "One shot", shots: ["Close-up Vy"] },
    production_readiness: productionReadiness,
    pilot: {
      duration_seconds: 10,
      video_url: "https://drive.google.com/file/d/pilot/view",
      qc: { identity: true, motion: true, lip_sync: true, voice: true, background: true, lighting: true, continuity: true },
      review: { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" },
    },
  }));
});

test("pilot is blocked when an approved Voice Master is missing", () => {
  const parsed = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
    shot_plan: { summary: "One shot", shots: ["Close-up Vy"] },
    production_readiness: { ...productionReadiness, voice_masters: [] },
    pilot: {
      duration_seconds: 10,
      video_url: "https://drive.google.com/file/d/pilot/view",
      qc: { identity: true, motion: true, lip_sync: true, voice: true, background: true, lighting: true, continuity: true },
      review: { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" },
    },
  });
  assert.equal(shortFilmMediaExecutionDecision(parsed).provider_execution_allowed, false);
  assert.match(shortFilmProductionReadinessBlockers(parsed).join(","), /VOICE_MASTER_NOT_LOCKED/);
});

test("multi-face dialogue rejects automatic single-face selection", () => {
  assert.throws(() => ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
    shot_plan: { summary: "One shot", shots: ["Two-shot"] },
    production_readiness: {
      ...productionReadiness,
      speaker_locks: [{
        ...productionReadiness.speaker_locks[0],
        visible_face_count: 2,
        selection_mode: "SINGLE_VISIBLE_FACE",
      }],
    },
  }));
});

test("media providers unlock only after all production readiness gates pass", () => {
  const parsed = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
    shot_plan: { summary: "One shot", shots: ["Close-up Vy"] },
    production_readiness: productionReadiness,
  });
  assert.deepEqual(shortFilmMediaExecutionDecision(parsed), {
    provider_execution_allowed: true,
    blockers: [],
  });
  assert.equal(shortFilmNextAction(parsed), "PREPARE_SHORT_FILM_PILOT");
});

test("production readiness draft can be saved before the first keyframe approval", () => {
  const parsed = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
    shot_plan: {
      summary: "One shot",
      shots: Array.from({ length: 9 }, (_, index) => `Close-up Vy ${index + 1}`),
      execution_shots: Array.from({ length: 9 }, (_, index) => ({
        shot_id: `SHOT-${String(index + 1).padStart(3, "0")}`,
        summary: `Close-up Vy ${index + 1}`,
        runway_prompt: `Cinematic close-up preserving approved identity ${index + 1}`,
        duration_seconds: 5,
        risk_tags: index === 0 ? ["IDENTITY_DIALOGUE"] : [],
      })),
      review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
    },
    production_readiness: { ...productionReadiness, keyframes: [], review: { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" } },
  });
  assert.deepEqual(parsed.production_readiness?.keyframes, []);
  assert.match(shortFilmProductionReadinessBlockers(parsed, "PILOT").join(","), /KEYFRAME_IDENTITY_APPROVAL_INCOMPLETE/);
});

test("pilot readiness requires only selected pilot shots while full-film readiness remains locked", () => {
  const executionShots = Array.from({ length: 5 }, (_, index) => ({
    shot_id: `SHOT-${String(index + 1).padStart(3, "0")}`,
    summary: `Pilot scope shot ${index + 1}`,
    runway_prompt: `Cinematic approved identity shot ${index + 1}`,
    duration_seconds: 5,
    risk_tags: index === 0 ? ["IDENTITY_DIALOGUE"] : index === 2 ? ["MOTION_PERFORMANCE"] : [],
  }));
  const pilotShotIds = executionShots.slice(0, 4).map((shot) => shot.shot_id);
  const scopedReadiness = {
    ...productionReadiness,
    keyframes: pilotShotIds.map((shot_id) => ({ ...productionReadiness.keyframes[0], shot_id })),
    dialogue_shot_ids: executionShots.map((shot) => shot.shot_id),
    speaker_locks: pilotShotIds.map((shot_id) => ({ ...productionReadiness.speaker_locks[0], shot_id })),
    dialogue_line_approvals: pilotShotIds.map((shot_id, index) => ({
      ...productionReadiness.dialogue_line_approvals[0],
      line_id: `LINE-${String(index + 1).padStart(3, "0")}`,
      shot_id,
    })),
    performance_plan: {
      ...productionReadiness.performance_plan,
      shots: pilotShotIds.map((shot_id) => ({ ...productionReadiness.performance_plan.shots[0], shot_id })),
      timing_contracts: pilotShotIds.map((shot_id, index) => ({
        ...productionReadiness.performance_plan.timing_contracts[0],
        shot_id,
        dialogue_line_id: `LINE-${String(index + 1).padStart(3, "0")}`,
      })),
      golden_scene: { ...productionReadiness.performance_plan.golden_scene, shot_ids: pilotShotIds.slice(0, 3) },
    },
  };
  const parsed = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    pilot_sampling: {
      sample_count: 2,
      clip_duration_seconds: 10,
      selection_mode: "RISK_BASED_REPRESENTATIVE_SHOTS",
      required_purposes: ["IDENTITY_DIALOGUE", "MOTION_PERFORMANCE"],
    },
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
    shot_plan: {
      summary: "Five shots",
      shots: executionShots.map((shot) => shot.summary),
      execution_shots: executionShots,
      review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
    },
    production_readiness: scopedReadiness,
  });

  assert.deepEqual(shortFilmMediaExecutionDecision(parsed, "PILOT"), { provider_execution_allowed: true, blockers: [] });
  assert.match(shortFilmProductionReadinessBlockers(parsed, "FULL").join(","), /KEYFRAME_IDENTITY_APPROVAL_INCOMPLETE/);
  assert.equal(shortFilmMediaExecutionDecision(parsed, "FULL").provider_execution_allowed, false);
  assert.equal(shortFilmNextAction(parsed), "PREPARE_SHORT_FILM_PILOT");
});

test("pilot budget approval is durable and cannot authorize a different sampling plan", () => {
  const approvedBudget = {
    sample_count: 3,
    clip_duration_seconds: 15,
    runway_credits_cap: 700,
    elevenlabs_credits_cap: 1_000,
    sync_usd_cap: 3,
    decision: "APPROVE",
    reviewer: "PROJECT_OWNER",
    reviewed_at: "2026-08-11T00:00:00.000Z",
  } as const;
  const parsed = ShortFilmWorkflowSchema.parse({ ...shortFilmWorkflow, pilot_budget_approval: approvedBudget });
  assert.equal(parsed.pilot_budget_approval?.runway_credits_cap, 700);
  assert.equal(shortFilmPilotBudgetApprovalIsSufficient(parsed), false);
  assert.throws(() => ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    pilot_sampling: {
      sample_count: 2,
      clip_duration_seconds: 10,
      selection_mode: "RISK_BASED_REPRESENTATIVE_SHOTS",
      required_purposes: ["IDENTITY_DIALOGUE", "MOTION_PERFORMANCE"],
    },
    pilot_budget_approval: approvedBudget,
  }), /PILOT_BUDGET_APPROVAL_MUST_MATCH_SAMPLING/);
});

test("legacy voice records remain parseable but media stays locked until voice audition gates pass", () => {
  const legacy = {
    ...productionReadiness,
    voice_masters: [{
      source_actor_id: "CHAR_TUONG_VY",
      voice_master_id: "TUONG_VY_VOICE_MASTER_AI_V1",
      casting_profile: "Vietnamese female",
      status: "APPROVED_LOCKED",
    }],
  };
  const parsed = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
    shot_plan: { summary: "One shot", shots: ["Close-up Vy"] },
    production_readiness: legacy,
  });
  const blockers = shortFilmProductionReadinessBlockers(parsed).join(",");
  assert.match(blockers, /VOICE_AGE_NOT_LOCKED/);
  assert.match(blockers, /VOICE_AUDITION_NOT_APPROVED/);
  assert.equal(shortFilmMediaExecutionDecision(parsed).provider_execution_allowed, false);
});

test("dialogue line approval must match the locked speaker and voice", () => {
  const parsed = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
    shot_plan: { summary: "One shot", shots: ["Close-up Vy"] },
    production_readiness: {
      ...productionReadiness,
      dialogue_line_approvals: [{
        ...productionReadiness.dialogue_line_approvals[0],
        voice_master_id: "WRONG_VOICE",
      }],
    },
  });
  assert.match(shortFilmProductionReadinessBlockers(parsed).join(","), /DIALOGUE_LINE_VOICE_MISMATCH/);
  assert.equal(shortFilmMediaExecutionDecision(parsed).provider_execution_allowed, false);
});

test("dialogue pronunciation, age casting and target duration require approval before generation", () => {
  const parsed = ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
    shot_plan: { summary: "One shot", shots: ["Close-up Vy"] },
    production_readiness: {
      ...productionReadiness,
      dialogue_line_approvals: [{
        ...productionReadiness.dialogue_line_approvals[0],
        pronunciation_decision: "PENDING",
        timing_decision: "PENDING",
      }],
    },
  });
  const blockers = shortFilmProductionReadinessBlockers(parsed).join(",");
  assert.match(blockers, /PRONUNCIATION_NOT_APPROVED/);
  assert.match(blockers, /DIALOGUE_TIMING_NOT_APPROVED/);
});

test("approving dialogue target duration never approves actual lip-sync QC before an output exists", () => {
  assert.throws(() => ShortFilmWorkflowSchema.parse({
    ...shortFilmWorkflow,
    script_review: { decision: "APPROVE", notes: "Approved", reviewer: "PROJECT_OWNER" },
    shot_plan: { summary: "One shot", shots: ["Close-up Vy"] },
    production_readiness: productionReadiness,
    pilot: {
      duration_seconds: 15,
      video_url: "https://drive.google.com/file/d/pilot/view",
      qc: { identity: true, motion: true, lip_sync: false, voice: true, background: true, lighting: true, continuity: true },
      review: { decision: "APPROVE", notes: "", reviewer: "PROJECT_OWNER" },
    },
  }), /PILOT_APPROVED/);
});
