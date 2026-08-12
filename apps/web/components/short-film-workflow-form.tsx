"use client";

import { useEffect, useState } from "react";
import { calculateShortFilmPilotBudget, createShortFilmShotPlan, matchShortFilmDialogueSpeaker, matchShortFilmShotActor, selectShortFilmPilotSamples, shortFilmNextAction, shortFilmPilotBudgetApprovalIsSufficient, shortFilmProductionReadinessBlockers, shortFilmSourceActorsNeedSync, syncShortFilmSourceActors, type ShortFilmWorkflow } from "@tu-hau/contracts";

type LibraryActor = {
  character_id: string;
  character_name: string;
  character_type?: string;
  face_reference_url?: string;
  body_reference_url?: string;
  master_identity_id?: string;
  master_identity_version?: string;
  voice_master_id?: string;
  voice_casting_profile?: string;
  voice_perceived_age_band?: "YOUNG_ADULT" | "ADULT" | "MIDDLE_AGED" | "OLDER_ADULT";
  voice_locale?: "vi-VN-southwest";
  voice_performance_style?: "SOUTHERN_TV_DRAMA_DUBBING";
  pronunciation_lexicon_id?: string;
  voice_audition_audio_url?: string;
  voice_audition_approved?: boolean;
  readiness?: {
    master_identity?: "APPROVED_LOCKED" | "NOT_READY";
    voice_master?: "APPROVED_LOCKED" | "NOT_READY";
  };
};

type Props = {
  eligibleCharacters: LibraryActor[];
  value: ShortFilmWorkflow;
  onChange: (value: ShortFilmWorkflow) => void;
  onGenerateScript?: () => Promise<void>;
  onRequestBudgetApproval?: () => void;
  generatingScript?: boolean;
  checkingScriptAccount?: boolean;
  scriptGenerationReady?: boolean;
  scriptBudgetSummary?: string;
  scriptAccountSummary?: string;
  providerStatus?: Record<string, { configured: boolean }>;
  pilotBudgetApproved?: boolean;
  pilotBudgetSummary?: string;
  onApprovePilotBudget?: () => void;
};

const emptyQc = {
  identity: false,
  motion: false,
  lip_sync: false,
  voice: false,
  background: false,
  lighting: false,
  continuity: false,
};

const approvalSequence = [
  ["REVIEW_SHORT_FILM_SCRIPT", "Duyệt kịch bản"],
  ["PREPARE_SHORT_FILM_SHOT_PLAN", "Lập kế hoạch cảnh"],
  ["REVIEW_SHORT_FILM_SHOT_PLAN", "Duyệt kế hoạch cảnh"],
  ["LOCK_SHORT_FILM_PRODUCTION_READINESS", "Xác nhận nhân vật, giọng và ảnh cảnh"],
  ["PREPARE_SHORT_FILM_PILOT", "Tạo clip mẫu"],
  ["REVIEW_SHORT_FILM_PILOT", "Kiểm tra và duyệt clip mẫu"],
  ["PRODUCE_SHORT_FILM", "Sản xuất toàn phim"],
  ["REVIEW_SHORT_FILM_FINAL", "Kiểm tra và duyệt phim hoàn chỉnh"],
] as const;

export function createInitialShortFilmWorkflow(): ShortFilmWorkflow {
  return {
    schema_version: "SHORT_FILM_FORM_V1",
    character_count: 1,
    source_actors: [],
    film_characters: [{
      source_actor_id: "",
      film_character_name: "Nhân vật 1",
      film_role: "PROTAGONIST",
      relationships: "",
      personality: "",
      appearance: "",
    }],
    script_source: "AI_DEVELOPED_FROM_IDEA",
    idea_brief: "",
    target_duration_minutes: 8,
    providers: {
      script: "OPENAI_RESPONSES",
      image_to_video: "RUNWAY_IMAGE_TO_VIDEO",
      lip_sync: "SYNC_LIP_SYNC",
      voice: "APPROVED_VOICE_MASTER",
      execution_mode: "APPROVAL_GATED",
    },
    script_title: "",
    script_synopsis: "",
    full_script: "",
    script_review: { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" },
    dialogue: {
      language: "vi",
      dialogue_mode: "DIALOGUE",
      voice_master_mode: "APPROVED_VOICE_MASTER_ONLY",
      singing_scene: false,
      singing_scene_notes: "",
    },
    pilot_sampling: {
      sample_count: 1,
      clip_duration_seconds: 30,
      selection_mode: "CONTIGUOUS_GOLDEN_SCENE",
      required_purposes: ["IDENTITY_DIALOGUE", "MOTION_PERFORMANCE", "MULTI_CHARACTER_CONTINUITY"],
    },
  };
}

function allQcPassed(qc: typeof emptyQc) {
  return Object.values(qc).every(Boolean);
}

function masterImagePreviewUrl(sourceUrl: string) {
  const driveFileId = sourceUrl.match(/\/file\/d\/([^/]+)/)?.[1] ?? new URL(sourceUrl).searchParams.get("id");
  return driveFileId
    ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveFileId)}&sz=w1200`
    : sourceUrl;
}

function readinessBlockerLabel(blocker: string) {
  const actorOrShot = blocker.split(":")[1];
  if (blocker === "PRODUCTION_READINESS_MISSING") return "Chưa tạo danh sách kiểm tra nhân vật, giọng và ảnh cảnh.";
  if (blocker === "KEYFRAME_IDENTITY_APPROVAL_INCOMPLETE") return "Chưa đủ ảnh đã duyệt cho toàn bộ cảnh.";
  if (blocker === "SPEAKER_FACE_LOCKS_INCOMPLETE") return "Chưa khóa đúng người nói và khuôn mặt cho toàn bộ cảnh thoại.";
  if (blocker === "PRODUCTION_READINESS_NOT_APPROVED") return "Chủ dự án chưa duyệt khóa sản xuất.";
  if (blocker.startsWith("IDENTITY_MASTER_NOT_LOCKED:")) return `Nhân vật chưa được duyệt và khóa: ${actorOrShot}`;
  if (blocker.startsWith("VOICE_MASTER_NOT_LOCKED:")) return `Giọng nhân vật chưa được duyệt và khóa: ${actorOrShot}`;
  if (blocker.startsWith("VOICE_AGE_NOT_LOCKED:")) return `Chưa khóa đúng độ tuổi giọng: ${actorOrShot}`;
  if (blocker.startsWith("VOICE_LOCALE_NOT_LOCKED:")) return `Chưa khóa giọng miền Tây Nam Bộ: ${actorOrShot}`;
  if (blocker.startsWith("VOICE_PERFORMANCE_STYLE_NOT_LOCKED:")) return `Chưa khóa phong cách lồng tiếng phim: ${actorOrShot}`;
  if (blocker.startsWith("VOICE_PRONUNCIATION_LEXICON_MISSING:")) return `Chưa có bộ phát âm đã duyệt: ${actorOrShot}`;
  if (blocker.startsWith("VOICE_AUDITION_NOT_APPROVED:")) return `Audition giọng chưa được duyệt: ${actorOrShot}`;
  if (blocker.startsWith("DIALOGUE_LINE_NOT_APPROVED:")) return `Câu thoại chưa được duyệt: ${actorOrShot}`;
  if (blocker.startsWith("PRONUNCIATION_NOT_APPROVED:")) return `Phát âm chưa được duyệt: ${actorOrShot}`;
  if (blocker.startsWith("AGE_CASTING_NOT_APPROVED:")) return `Độ tuổi giọng chưa được duyệt: ${actorOrShot}`;
  if (blocker.startsWith("DIALOGUE_TIMING_NOT_APPROVED:")) return `Thời lượng câu thoại chưa được duyệt: ${actorOrShot}`;
  if (blocker.startsWith("SPEAKER_VOICE_MISMATCH:") || blocker.startsWith("DIALOGUE_LINE_VOICE_MISMATCH:")) return `Người nói và giọng đã chọn chưa khớp: ${actorOrShot}`;
  if (blocker === "PERFORMANCE_PLAN_MISSING") return "Chưa có kế hoạch diễn xuất theo nhịp thoại cho các cảnh mẫu.";
  if (blocker.startsWith("PERFORMANCE_SOURCE_NOT_APPROVED:")) return `Video diễn xuất tham chiếu chưa được duyệt: ${actorOrShot}`;
  if (blocker.startsWith("SPEECH_TIMING_CONTRACT_NOT_APPROVED:")) return `Nhịp thoại, phản ứng và điểm cắt chưa được duyệt: ${actorOrShot}`;
  if (blocker === "ANIMATIC_NOT_APPROVED") return "Bản dựng nháp miễn phí chưa được duyệt.";
  if (blocker === "GOLDEN_SCENE_NOT_APPROVED") return "Cảnh chuẩn mẫu chưa đạt đủ nhận dạng, diễn xuất, nhịp thoại và tính liên tục.";
  if (blocker === "PERFORMANCE_PLAN_NOT_APPROVED") return "Kế hoạch diễn xuất chưa được chủ dự án khóa.";
  return blocker;
}

export function ShortFilmWorkflowForm({ eligibleCharacters, value, onChange, onGenerateScript, onRequestBudgetApproval, generatingScript = false, checkingScriptAccount = false, scriptGenerationReady = false, scriptBudgetSummary, scriptAccountSummary, pilotBudgetSummary, onApprovePilotBudget }: Props) {
  const [shotPlanError, setShotPlanError] = useState("");
  const libraryActors = eligibleCharacters
    .filter((actor) => actor.readiness?.master_identity === "APPROVED_LOCKED" && actor.readiness?.voice_master === "APPROVED_LOCKED")
    .map((actor) => ({
    source_actor_id: actor.character_id,
    source_actor_name: actor.character_name,
    character_type: actor.character_type,
    face_reference_url: actor.face_reference_url,
    body_reference_url: actor.body_reference_url,
    source_kind: "CHARACTER_LIBRARY_MASTER" as const,
    master_identity_status: "APPROVED_LOCKED" as const,
    master_identity_id: actor.master_identity_id,
    master_identity_version: actor.master_identity_version,
    voice_master_id: actor.voice_master_id,
    voice_casting_profile: actor.voice_casting_profile,
    voice_master_status: actor.readiness?.voice_master,
    voice_perceived_age_band: actor.voice_perceived_age_band,
    voice_locale: actor.voice_locale,
    voice_performance_style: actor.voice_performance_style,
    pronunciation_lexicon_id: actor.pronunciation_lexicon_id,
    voice_audition_audio_url: actor.voice_audition_audio_url,
    voice_audition_approved: actor.voice_audition_approved,
    }));
  const availableActors = libraryActors;
  const scriptApproved = value.script_review.decision === "APPROVE";
  const pilotApproved = Boolean(
    (value.pilot && value.pilot.review.decision === "APPROVE" && allQcPassed(value.pilot.qc)) ||
    value.pilot_batch?.batch_review.decision === "APPROVE",
  );
  const finalApproved = Boolean(value.full_film && value.full_film.review.decision === "APPROVE" && allQcPassed(value.full_film.qc));

  useEffect(() => {
    if (libraryActors.length === 0) return;

    const libraryActorIds = new Set(libraryActors.map((actor) => actor.source_actor_id));
    const needsLibraryMigration = value.source_actors.some(
      (actor) => actor.master_identity_status !== "APPROVED_LOCKED",
    ) || value.film_characters.some((character) => !libraryActorIds.has(character.source_actor_id)) ||
      shortFilmSourceActorsNeedSync(value.film_characters, value.source_actors);
    if (!needsLibraryMigration) return;

    const filmCharacters = value.film_characters.map((character, index) => ({
      ...character,
      source_actor_id: libraryActorIds.has(character.source_actor_id)
        ? character.source_actor_id
        : libraryActors[index % libraryActors.length].source_actor_id,
    }));
    onChange({
      ...value,
      film_characters: filmCharacters,
      source_actors: syncShortFilmSourceActors(filmCharacters, libraryActors, value.source_actors),
    });
  }, [eligibleCharacters, value, onChange]);

  function patch(patchValue: Partial<ShortFilmWorkflow>) {
    onChange({ ...value, ...patchValue });
  }

  function generateShotPlan() {
    try {
      setShotPlanError("");
      patch({ shot_plan: createShortFilmShotPlan(value), production_readiness: undefined });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setShotPlanError(message.startsWith("SHOT_PLAN_SCRIPT_DETAIL_INSUFFICIENT:")
        ? "Kịch bản chưa đủ chi tiết để lập kế hoạch cảnh đúng thời lượng mà không lặp. Hãy phát triển thêm diễn biến, hành động và lời thoại rồi duyệt lại kịch bản."
        : message.startsWith("SHOT_PLAN_CHARACTER_AMBIGUOUS:")
          ? "Có cảnh chưa nêu rõ nhân vật nào xuất hiện. Hãy sửa kịch bản để mỗi cảnh ghi rõ tên nhân vật, tránh hệ thống dùng nhầm người."
        : "Không thể tạo kế hoạch cảnh từ kịch bản hiện tại. Hãy kiểm tra lại kịch bản đã duyệt.");
    }
  }

  function setCharacterCount(count: number) {
    const characterCount = Math.max(1, Math.min(20, count));
    const filmCharacters = Array.from({ length: characterCount }, (_, index) =>
      value.film_characters[index] ?? {
        source_actor_id: availableActors[index % availableActors.length]?.source_actor_id ?? "",
        film_character_name: `Nhân vật ${index + 1}`,
        film_role: index === 0 ? "PROTAGONIST" as const : "SUPPORTING" as const,
        relationships: "",
        personality: "",
        appearance: "",
      },
    );
    patch({
      character_count: characterCount,
      film_characters: filmCharacters,
      source_actors: syncShortFilmSourceActors(filmCharacters, availableActors, value.source_actors),
    });
  }

  function initializeProductionReadiness() {
    if (!value.shot_plan) return;
    const usedActorIds = new Set(value.film_characters.map((character) => character.source_actor_id));
    const usedActors = libraryActors.filter((actor) => usedActorIds.has(actor.source_actor_id));
    const actorById = new Map(usedActors.map((actor) => [actor.source_actor_id, actor]));
    const dialogueRows = value.shot_plan.execution_shots.flatMap((shot, index) => {
      const dialogue = matchShortFilmDialogueSpeaker(shot.summary, value.film_characters, value.source_actors);
      if (!dialogue) return [];
      const actor = actorById.get(dialogue.source_actor_id);
      if (!actor?.voice_master_id) return [];
      const dialogueText = dialogue.dialogue_text;
      return [{
        shot_id: shot.shot_id,
        speaker_source_actor_id: dialogue.source_actor_id,
        voice_master_id: actor.voice_master_id,
        dialogue_text: dialogueText,
        target_duration_ms: Math.min(shot.duration_seconds * 1_000, Math.max(1_500, dialogueText.length * 90)),
        line_id: `LINE-${String(index + 1).padStart(3, "0")}`,
      }];
    });
    const keyframes = value.shot_plan.execution_shots.flatMap((shot) => {
      const actorId = matchShortFilmShotActor(shot.summary, value.film_characters, value.source_actors);
      const actor = actorId ? actorById.get(actorId) : usedActors[0];
      const approvedImageUrl = actor?.body_reference_url ?? actor?.face_reference_url;
      return approvedImageUrl ? [{
        shot_id: shot.shot_id,
        approved_image_url: approvedImageUrl,
        identity_decision: "APPROVE" as const,
        continuity_decision: "APPROVE" as const,
        reviewer: "PROJECT_OWNER" as const,
        reviewed_at: new Date().toISOString(),
      }] : [];
    });
    patch({
      production_readiness: {
        identity_masters: usedActors
          .filter((actor) => actor.master_identity_id && actor.master_identity_version)
          .map((actor) => ({
            source_actor_id: actor.source_actor_id,
            master_identity_id: actor.master_identity_id as string,
            reference_set_version: actor.master_identity_version as string,
            status: "APPROVED_LOCKED" as const,
          })),
        voice_masters: usedActors
          .filter((actor) => actor.voice_master_status === "APPROVED_LOCKED" && actor.voice_master_id && actor.voice_casting_profile)
          .map((actor) => ({
            source_actor_id: actor.source_actor_id,
            voice_master_id: actor.voice_master_id as string,
            casting_profile: actor.voice_casting_profile as string,
            status: "APPROVED_LOCKED" as const,
            perceived_age_band: actor.voice_perceived_age_band,
            locale: actor.voice_locale,
            performance_style: actor.voice_performance_style,
            pronunciation_lexicon_id: actor.pronunciation_lexicon_id,
            audition_audio_url: actor.voice_audition_audio_url,
            audition_review: actor.voice_audition_audio_url ? {
              decision: actor.voice_audition_approved ? "APPROVE" as const : "PENDING" as const,
              notes: actor.voice_audition_approved ? "Migrated from APPROVED + LOCKED Voice Master." : "",
              reviewer: "PROJECT_OWNER" as const,
            } : undefined,
          })),
        keyframes,
        dialogue_shot_ids: dialogueRows.map((row) => row.shot_id),
        speaker_locks: dialogueRows.map((row) => ({
          shot_id: row.shot_id,
          speaker_source_actor_id: row.speaker_source_actor_id,
          voice_master_id: row.voice_master_id,
          visible_face_count: 1,
          selection_mode: "SINGLE_VISIBLE_FACE" as const,
        })),
        dialogue_line_approvals: dialogueRows.map((row) => ({
          ...row,
          pronunciation_decision: "APPROVE" as const,
          age_casting_decision: "APPROVE" as const,
          timing_decision: "APPROVE" as const,
          reviewer: "PROJECT_OWNER" as const,
          reviewed_at: new Date().toISOString(),
        })),
        review: { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" },
      },
    });
  }

  const persistedPilotBudgetApproved = value.shot_plan?.execution_shots.length
    ? shortFilmPilotBudgetApprovalIsSufficient(value)
    : false;
  const pilotBudget = value.shot_plan?.execution_shots.length ? calculateShortFilmPilotBudget(value) : undefined;
  const pilotSamples = value.shot_plan?.execution_shots.length ? selectShortFilmPilotSamples(value) : [];
  const pilotShotIds = [...new Set(pilotSamples.flatMap((sample) => sample.shots.map((shot) => shot.shot_id)))];
  const characterVoiceSceneApprovalComplete = value.production_readiness?.review.decision === "APPROVE";
  const readinessBlockers = value.production_readiness
    ? shortFilmProductionReadinessBlockers(value, pilotApproved ? "FULL" : "PILOT")
    : ["PRODUCTION_READINESS_MISSING"];
  const productionReady = readinessBlockers.length === 0;
  const nextAction = shortFilmNextAction(value);
  const normalizedNextAction = nextAction === "SCRIPT_REJECTED" ? "REVIEW_SHORT_FILM_SCRIPT" : nextAction;
  const currentApprovalIndex = normalizedNextAction === "READY_TO_PUBLISH"
    ? approvalSequence.length
    : Math.max(0, approvalSequence.findIndex(([action]) => action === normalizedNextAction));
  const scriptDraftCreated = Boolean(value.script_generation || value.full_script.trim());
  const scriptInputsReady = value.idea_brief.trim().length >= 20 && value.script_title.trim().length > 0 && value.script_synopsis.trim().length > 0 && value.full_script.trim().length > 0;

  return (
    <div className="short-film-workflow">
      <div className="workflow-banner">
        <strong>Quy trình phim ngắn an toàn</strong>
        <span>Kịch bản, nhân vật, giọng nói, clip mẫu và phim hoàn chỉnh đều phải được duyệt trước khi đi tiếp.</span>
      </div>

      <section className="approval-sequence" aria-label="Thứ tự các bước cần thực hiện">
        <header>
          <strong>Các bước thực hiện theo thứ tự</strong>
          <span>Đi từ trên xuống. Xanh: đã xong · Vàng: đang làm · Xám: chưa tới lượt.</span>
        </header>
        <ol>
          {approvalSequence.map(([action, label], index) => {
            const status = index < currentApprovalIndex ? "completed" : index === currentApprovalIndex ? "current" : "pending";
            return <li className={status} key={action}>
              <b aria-hidden="true">{status === "completed" ? "✓" : index + 1}</b>
              <div><strong>{label}</strong><small>{status === "completed" ? "Đã thao tác" : status === "current" ? "Đang thực hiện" : "Chưa tới lượt"}</small></div>
            </li>;
          })}
        </ol>
      </section>

      <fieldset data-validation-path="film_characters">
        <legend>Nhân vật trong phim</legend>
        {availableActors.length === 0 && <p className="operation-error" role="alert">Chưa có nhân vật đã duyệt và khóa. Dự án được giữ an toàn và không thể sản xuất cho đến khi thư viện nhân vật sẵn sàng.</p>}
        <label data-validation-path="character_count"><span>Số lượng nhân vật *</span><input required min={1} max={20} type="number" value={value.character_count} onChange={(event) => setCharacterCount(Number(event.target.value))} /></label>
        <p className="gate-note">Chọn nhân vật và vai diễn. Hệ thống tự áp dụng hình ảnh, giọng nói và các thiết lập đã chốt.</p>
        {value.film_characters.map((character, index) => (
          <article className="workflow-card" key={`${index}-${character.source_actor_id}`}>
            <h4>Nhân vật {index + 1}</h4>
            <label data-validation-path={`film_characters.${index}.source_actor_id`}><span>Chọn nhân vật đã duyệt *</span><select disabled={availableActors.length === 0} required value={character.source_actor_id} onChange={(event) => {
              const next = [...value.film_characters]; next[index] = { ...character, source_actor_id: event.target.value };
              patch({
                film_characters: next,
                source_actors: syncShortFilmSourceActors(next, availableActors, value.source_actors),
              });
            }}><option value="" disabled>Chọn nhân vật</option>{availableActors.map((actor) => <option key={actor.source_actor_id} value={actor.source_actor_id}>{actor.source_actor_name}</option>)}</select></label>
            <label data-validation-path={`film_characters.${index}.film_character_name`}><span>Tên nhân vật trong phim *</span><input required placeholder="Ví dụ: Vy, An, Má Lan" value={character.film_character_name} onChange={(event) => { const next = [...value.film_characters]; next[index] = { ...character, film_character_name: event.target.value }; patch({ film_characters: next }); }} /></label>
            <label data-validation-path={`film_characters.${index}.film_role`}><span>Vai diễn *</span><select required value={character.film_role} onChange={(event) => { const next = [...value.film_characters]; next[index] = { ...character, film_role: event.target.value as typeof character.film_role }; patch({ film_characters: next }); }}><option value="PROTAGONIST">Nhân vật chính</option><option value="ANTAGONIST">Đối trọng</option><option value="SUPPORTING">Hỗ trợ</option><option value="CAMEO">Khách mời</option><option value="EXTRA">Quần chúng</option></select></label>
            {value.script_source === "PROJECT_OWNER_PROVIDED" ? <>
              <label data-validation-path={`film_characters.${index}.relationships`}><span>Quan hệ (không bắt buộc)</span><input placeholder="Ví dụ: chị của An, con của Má Lan" value={character.relationships} onChange={(event) => { const next = [...value.film_characters]; next[index] = { ...character, relationships: event.target.value }; patch({ film_characters: next }); }} /></label>
              <label data-validation-path={`film_characters.${index}.personality`}><span>Tính cách (không bắt buộc)</span><textarea placeholder="Ví dụ: mạnh mẽ, chân thành, phản ứng nhanh" value={character.personality} onChange={(event) => { const next = [...value.film_characters]; next[index] = { ...character, personality: event.target.value }; patch({ film_characters: next }); }} /></label>
              <label data-validation-path={`film_characters.${index}.appearance`}><span>Ngoại hình trong cảnh (không bắt buộc)</span><textarea placeholder="Chỉ mô tả trang phục hoặc tạo hình cần thấy trong phim" value={character.appearance} onChange={(event) => { const next = [...value.film_characters]; next[index] = { ...character, appearance: event.target.value }; patch({ film_characters: next }); }} /></label>
            </> : <p className="ai-character-note">AI sẽ tự xây dựng quan hệ, tính cách và ngoại hình trong cảnh từ ý tưởng và kịch bản. Bạn không cần nhập các mục này.</p>}
          </article>
        ))}
      </fieldset>

      <fieldset>
        <legend>Kịch bản và duyệt kịch bản</legend>
        <label data-validation-path="script_source"><span>Nguồn kịch bản *</span><select required value={value.script_source} onChange={(event) => patch({ script_source: event.target.value as ShortFilmWorkflow["script_source"] })}><option value="AI_GENERATED">AI tạo</option><option value="PROJECT_OWNER_PROVIDED">Chủ dự án cung cấp</option><option value="AI_DEVELOPED_FROM_IDEA">AI phát triển từ ý tưởng</option></select></label>
        {value.script_source !== "PROJECT_OWNER_PROVIDED" && onGenerateScript && <div className={`script-generation-controls${scriptGenerationReady ? " ready" : ""}`}>
          <div className="script-generation-summary">
            <strong>Tạo bản nháp kịch bản AI</strong>
            {scriptBudgetSummary && <span>{scriptBudgetSummary}</span>}
            <small>{scriptAccountSummary ?? "Kiểm tra tài khoản trước khi tạo bản nháp."}</small>
          </div>
          <button className={scriptDraftCreated ? "action-completed" : scriptGenerationReady ? "action-current" : "action-pending"} disabled={checkingScriptAccount || generatingScript || (scriptGenerationReady && value.idea_brief.trim().length < 20)} onClick={scriptGenerationReady ? onGenerateScript : onRequestBudgetApproval} type="button">{checkingScriptAccount ? "Đang kiểm tra tài khoản…" : generatingScript ? "AI đang tạo kịch bản…" : scriptDraftCreated ? "✓ Đã tạo bản nháp · Tạo lại nếu cần" : scriptGenerationReady ? "Duyệt kinh phí & tạo bản nháp kịch bản AI" : "Kiểm tra OpenAI & mở tạo bản nháp"}</button>
          <p className="gate-note">Nút kiểm tra chỉ đọc trạng thái tài khoản. Chỉ nút tạo bản nháp mới gọi OpenAI và phát sinh chi phí trong hạn mức hiển thị.</p>
        </div>}
        <label data-validation-path="script_title"><span>Tên kịch bản *</span><input required placeholder="Ví dụ: Chiếc bẫy sau lời hứa" value={value.script_title} onChange={(event) => patch({ script_title: event.target.value })} /></label>
        <label data-validation-path="script_synopsis"><span>Tóm tắt nội dung *</span><textarea required placeholder="Tóm tắt câu chuyện trong 3–5 câu" value={value.script_synopsis} onChange={(event) => patch({ script_synopsis: event.target.value })} /></label>
        <label className="wide-field" data-validation-path="full_script"><span>Toàn bộ kịch bản để duyệt *</span><textarea required placeholder="Kịch bản AI hoặc kịch bản của chủ dự án sẽ hiển thị tại đây" rows={14} value={value.full_script} onChange={(event) => patch({ full_script: event.target.value, script_review: { ...value.script_review, decision: "PENDING" } })} /></label>
        <div className="approval-gate script-approval-gate" data-validation-path="script_review">
          <strong>Quyết định kịch bản</strong>
          <p className="gate-note">Chọn một hành động rõ ràng. Duyệt kịch bản chỉ mở phần chuẩn bị tiếp theo, chưa gọi nhà cung cấp và chưa phát sinh chi phí media.</p>
          <div className="script-approval-actions" role="group" aria-label="Quyết định kịch bản">
            <button
              className={value.script_review.decision === "APPROVE" ? "approval-action decision-approve selected" : "approval-action decision-approve"}
              disabled={!scriptInputsReady}
              onClick={() => patch({ script_review: { ...value.script_review, decision: "APPROVE", reviewed_at: new Date().toISOString() } })}
              type="button"
            >Duyệt và mở bước tiếp theo</button>
            <button
              className={value.script_review.decision === "REQUEST_CHANGES" ? "secondary-button decision-change selected" : "secondary-button decision-change"}
              onClick={() => patch({ script_review: { ...value.script_review, decision: "REQUEST_CHANGES", reviewed_at: new Date().toISOString() } })}
              type="button"
            >Yêu cầu sửa</button>
            <button
              className={value.script_review.decision === "REJECT" ? "remove-button decision-reject selected" : "remove-button decision-reject"}
              onClick={() => patch({ script_review: { ...value.script_review, decision: "REJECT", reviewed_at: new Date().toISOString() } })}
              type="button"
            >Từ chối</button>
          </div>
          <p className={`script-review-status ${scriptApproved ? "approved" : ""}`} aria-live="polite">
            {scriptApproved ? "Đã duyệt — phần tiếp theo đã được mở." : !scriptInputsReady ? "Hoàn thiện tên, tóm tắt và toàn bộ kịch bản trước khi duyệt." : value.script_review.decision === "REQUEST_CHANGES" ? "Đang yêu cầu sửa kịch bản." : value.script_review.decision === "REJECT" ? "Kịch bản đã bị từ chối." : "Đang chờ chủ dự án duyệt."}
          </p>
          <textarea placeholder="Ghi rõ điểm cần sửa hoặc lý do duyệt/từ chối" value={value.script_review.notes} onChange={(event) => patch({ script_review: { ...value.script_review, notes: event.target.value } })} />
        </div>
      </fieldset>

      <fieldset>
        <legend>Thoại, ngôn ngữ và cảnh hát</legend>
        <label data-validation-path="dialogue.dialogue_mode"><span>Cấu hình thoại</span><select value={value.dialogue.dialogue_mode} onChange={(event) => patch({ dialogue: { ...value.dialogue, dialogue_mode: event.target.value as ShortFilmWorkflow["dialogue"]["dialogue_mode"] } })}><option value="DIALOGUE">Đối thoại</option><option value="VOICE_OVER">Voice-over</option><option value="MIXED">Kết hợp</option></select></label>
        <label><input checked={value.dialogue.singing_scene} type="checkbox" onChange={(event) => patch({ dialogue: { ...value.dialogue, singing_scene: event.target.checked } })} /> Có cảnh hát</label>
        {value.dialogue.singing_scene && <label data-validation-path="dialogue.singing_scene_notes"><span>Mô tả/nguồn cảnh hát</span><textarea value={value.dialogue.singing_scene_notes} onChange={(event) => patch({ dialogue: { ...value.dialogue, singing_scene_notes: event.target.value } })} /></label>}
      </fieldset>

      <fieldset disabled={!scriptApproved} className={!scriptApproved ? "locked-stage" : ""}>
        <legend>Kế hoạch cảnh — tạo từ kịch bản đã duyệt</legend>
        {!value.shot_plan && <>
          <p className="gate-note">Hệ thống tạo kế hoạch cảnh cục bộ từ kịch bản đã duyệt, không gọi nhà cung cấp và không phát sinh credit.</p>
          <button type="button" onClick={generateShotPlan}>Tạo kế hoạch cảnh để duyệt</button>
          {shotPlanError && <p className="operation-error" role="alert">{shotPlanError}</p>}
        </>}
        {value.shot_plan && <>
          <p><strong>{value.shot_plan.summary}</strong></p>
          <ol className="shot-plan-review-list">
            {value.shot_plan.execution_shots.map((shot, index) => <li key={shot.shot_id}><strong>Cảnh {index + 1} · {shot.duration_seconds} giây</strong><span>{shot.summary}</span></li>)}
          </ol>
          <ReviewGate label="Duyệt kế hoạch cảnh" review={value.shot_plan.review} onChange={(review) => patch({ shot_plan: { ...value.shot_plan!, review } })} />
          <button className="secondary-button" type="button" onClick={generateShotPlan}>Tạo lại kế hoạch cảnh từ kịch bản</button>
          {shotPlanError && <p className="operation-error" role="alert">{shotPlanError}</p>}
          <p className="gate-note">Sau khi duyệt, hệ thống mới mở bước kiểm tra nhân vật, giọng nói và hình ảnh cho từng cảnh.</p>
        </>}
      </fieldset>

      <fieldset disabled={value.shot_plan?.review.decision !== "APPROVE"} className={value.shot_plan?.review.decision !== "APPROVE" ? "locked-stage" : ""}>
        <legend>Xác nhận nhân vật, giọng nói và ảnh cảnh</legend>
        <p className="gate-note">Hệ thống tự kiểm tra đúng nhân vật, đúng giọng, đúng người nói và đúng ảnh đã duyệt trước khi cho phép tạo clip mẫu.</p>
        <div className={`budget-approval ${persistedPilotBudgetApproved ? "approved" : "pending"}`}>
          <div>
            <strong>{persistedPilotBudgetApproved ? "NGÂN SÁCH GOLDEN SCENE 30 GIÂY ĐÃ DUYỆT" : "DUYỆT NGÂN SÁCH GOLDEN SCENE 30 GIÂY"}</strong>
            <p>{pilotBudgetSummary ?? "1 cảnh phim hoàn chỉnh 30 giây · nhiều shot liền mạch cùng bối cảnh · audio-first và performance-driven."}</p>
            <small>Chỉ áp dụng cho một cảnh phim kiểm chuẩn; không duyệt sản xuất toàn phim.</small>
          </div>
          <button className={persistedPilotBudgetApproved ? "action-completed" : characterVoiceSceneApprovalComplete ? "action-current" : "action-pending"} disabled={persistedPilotBudgetApproved || !characterVoiceSceneApprovalComplete} type="button" onClick={() => {
            if (!pilotBudget) return;
            patch({ pilot_budget_approval: { sample_count: value.pilot_sampling.sample_count, clip_duration_seconds: value.pilot_sampling.clip_duration_seconds, runway_credits_cap: pilotBudget.proposed_caps.runway_credits, elevenlabs_credits_cap: pilotBudget.proposed_caps.elevenlabs_characters, sync_usd_cap: pilotBudget.proposed_caps.sync_usd, decision: "APPROVE", reviewer: "PROJECT_OWNER", reviewed_at: new Date().toISOString() } });
            onApprovePilotBudget?.();
          }}>
            {persistedPilotBudgetApproved ? "✓ Đã duyệt ngân sách Golden Scene" : "Duyệt ngân sách Golden Scene 30 giây"}
          </button>
          {!characterVoiceSceneApprovalComplete && <small>Ngân sách chỉ mở sau khi nhân vật, giọng nói và ảnh cảnh đã được xác nhận.</small>}
        </div>
        {!value.production_readiness && <button type="button" onClick={initializeProductionReadiness}>Chuẩn bị danh sách kiểm tra</button>}
        {value.production_readiness && <>
          <div className="provider-grid">
            <span>Nhân vật đã khóa: <strong>{value.production_readiness.identity_masters.length}/{new Set(value.film_characters.map((character) => character.source_actor_id)).size}</strong></span>
            <span>Giọng đã khóa: <strong>{value.production_readiness.voice_masters.length}/{new Set(value.film_characters.map((character) => character.source_actor_id)).size}</strong></span>
            <span>Ảnh cảnh mẫu đã duyệt: <strong>{value.production_readiness.keyframes.filter((item) => pilotShotIds.includes(item.shot_id)).length}/{pilotShotIds.length}</strong></span>
            <span>Cảnh mẫu có thoại đã khóa: <strong>{value.production_readiness.dialogue_line_approvals.filter((item) => pilotShotIds.includes(item.shot_id)).length}/{pilotShotIds.length}</strong></span>
          </div>
          <p className="gate-note">Giai đoạn này chỉ kiểm tra các shot liền mạch của Golden Scene: {pilotShotIds.join(", ")}. Các cảnh còn lại chỉ bị khóa sau khi bạn duyệt Golden Scene và quyết định sản xuất toàn phim.</p>
          <div className="pilot-readiness-list">
            {pilotShotIds.map((shotId) => {
              const shot = value.shot_plan?.execution_shots.find((item) => item.shot_id === shotId);
              const speaker = value.production_readiness?.speaker_locks.find((item) => item.shot_id === shotId);
              const speakerActor = availableActors.find((actor) => actor.source_actor_id === speaker?.speaker_source_actor_id) ?? availableActors[0];
              const masterReferenceUrl = speakerActor && "body_reference_url" in speakerActor
                ? speakerActor.body_reference_url ?? speakerActor.face_reference_url
                : undefined;
              const keyframe = value.production_readiness?.keyframes.find((item) => item.shot_id === shotId);
              const line = value.production_readiness?.dialogue_line_approvals.find((item) => item.shot_id === shotId);
              return <article className="workflow-card" key={`pilot-${shotId}`}>
                <h4>{shotId} · {shot?.summary}</h4>
                <label><span>Nhân vật nói *</span><select value={speaker?.speaker_source_actor_id ?? speakerActor?.source_actor_id ?? ""} onChange={(event) => {
                  if (!value.production_readiness) return;
                  const voice = value.production_readiness.voice_masters.find((item) => item.source_actor_id === event.target.value);
                  const speaker_locks = value.production_readiness.speaker_locks.map((item) => item.shot_id === shotId ? { ...item, speaker_source_actor_id: event.target.value, voice_master_id: voice?.voice_master_id ?? "" } : item);
                  const dialogue_line_approvals = value.production_readiness.dialogue_line_approvals.filter((item) => item.shot_id !== shotId);
                  patch({ production_readiness: { ...value.production_readiness, speaker_locks, dialogue_line_approvals, review: { ...value.production_readiness.review, decision: "PENDING" } } });
                }}>{value.film_characters.map((character) => <option key={character.source_actor_id} value={character.source_actor_id}>{character.film_character_name}</option>)}</select></label>
                <div className="approval-gate compact-approval">
                  <strong>Ảnh nhân vật dùng cho cảnh</strong>
                  {masterReferenceUrl ? <>
                    <figure className="pilot-master-preview">
                      <img alt={`Ảnh nhân vật ${value.film_characters.find((character) => character.source_actor_id === speakerActor?.source_actor_id)?.film_character_name ?? "nhân vật"}`} loading="lazy" src={masterImagePreviewUrl(masterReferenceUrl)} />
                      <figcaption>Ảnh nhân vật đã duyệt và khóa đang dùng cho {shotId}</figcaption>
                    </figure>
                    <a href={masterReferenceUrl} rel="noreferrer" target="_blank">Mở ảnh gốc trên Drive</a>
                  </> : <p className="operation-error">Nhân vật chưa có ảnh đã duyệt hợp lệ.</p>}
                  <button className={keyframe ? "action-completed" : "action-current"} disabled={!masterReferenceUrl || Boolean(keyframe)} type="button" onClick={() => {
                    if (!value.production_readiness || !masterReferenceUrl) return;
                    const keyframes = value.production_readiness.keyframes.filter((item) => item.shot_id !== shotId);
                    keyframes.push({ shot_id: shotId, approved_image_url: masterReferenceUrl, identity_decision: "APPROVE", continuity_decision: "APPROVE", reviewer: "PROJECT_OWNER", reviewed_at: new Date().toISOString() });
                    patch({ production_readiness: { ...value.production_readiness, keyframes, review: { ...value.production_readiness.review, decision: "PENDING" } } });
                  }}>{keyframe ? "✓ Đã duyệt ảnh" : "Duyệt ảnh nhân vật cho cảnh này"}</button>
                </div>
                <label><span>Câu thoại dùng trong clip *</span><textarea placeholder="Ví dụ: Con sẽ kiểm tra công ty trước, không chuyển tiền giữ chỗ đâu má." value={line?.dialogue_text ?? ""} onChange={(event) => {
                  if (!value.production_readiness || !speaker) return;
                  const dialogue_line_approvals = value.production_readiness.dialogue_line_approvals.filter((item) => item.shot_id !== shotId);
                  if (event.target.value.trim()) dialogue_line_approvals.push({ line_id: `LINE-${shotId.slice(-3)}`, shot_id: shotId, speaker_source_actor_id: speaker.speaker_source_actor_id, voice_master_id: speaker.voice_master_id, dialogue_text: event.target.value, target_duration_ms: Math.min(10_000, Math.max(1_500, event.target.value.trim().length * 90)), pronunciation_decision: "PENDING", age_casting_decision: "PENDING", timing_decision: "PENDING", reviewer: "PROJECT_OWNER", reviewed_at: new Date().toISOString() });
                  patch({ production_readiness: { ...value.production_readiness, dialogue_line_approvals, review: { ...value.production_readiness.review, decision: "PENDING" } } });
                }} /></label>
                <button className={line?.pronunciation_decision === "APPROVE" && line.age_casting_decision === "APPROVE" && line.timing_decision === "APPROVE" ? "action-completed" : "action-current"} disabled={!line?.dialogue_text.trim()} type="button" onClick={() => {
                  if (!value.production_readiness) return;
                  const dialogue_line_approvals = value.production_readiness.dialogue_line_approvals.map((item) => item.shot_id === shotId ? { ...item, pronunciation_decision: "APPROVE" as const, age_casting_decision: "APPROVE" as const, timing_decision: "APPROVE" as const, reviewed_at: new Date().toISOString() } : item);
                  patch({ production_readiness: { ...value.production_readiness, dialogue_line_approvals, review: { ...value.production_readiness.review, decision: "PENDING" } } });
                }}>{line?.pronunciation_decision === "APPROVE" && line.age_casting_decision === "APPROVE" && line.timing_decision === "APPROVE" ? "✓ Đã duyệt thoại và chất giọng dự kiến" : "Duyệt thoại, độ tuổi giọng và thời lượng dự kiến"}</button>
                <p className="gate-note">Chưa duyệt khẩu hình tại đây. Khẩu hình chỉ được kiểm tra sau khi clip có lời thoại đã tạo xong.</p>
              </article>;
            })}
          </div>
          {readinessBlockers.length > 0 && <div className="operation-error" role="status">
            <strong>Còn điều kiện cần hoàn tất</strong>
            <ul>{readinessBlockers.map((blocker) => <li key={blocker}>{readinessBlockerLabel(blocker)}</li>)}</ul>
          </div>}
          <button
            type="button"
            disabled={readinessBlockers.some((blocker) => blocker !== "PRODUCTION_READINESS_NOT_APPROVED")}
            onClick={() => patch({ production_readiness: { ...value.production_readiness!, review: { ...value.production_readiness!.review, decision: "APPROVE", reviewed_at: new Date().toISOString() } } })}
          >{value.production_readiness.review.decision === "APPROVE" ? "✓ Đã xác nhận toàn bộ" : "Xác nhận nhân vật, giọng và ảnh cảnh"}</button>
        </>}
      </fieldset>

      <fieldset disabled={!scriptApproved || !value.shot_plan || !productionReady} className={!scriptApproved || !value.shot_plan || !productionReady ? "locked-stage" : ""}>
        <legend>Clip mẫu 10–20 giây và kiểm tra chất lượng</legend>
        <p className="gate-note">TuhauAI tạo đúng một Golden Scene 30 giây từ một cảnh thật trong kịch bản. Cảnh gồm nhiều shot liền mạch, đủ thoại, phản ứng, chuyển động và continuity để đánh giá chuyên nghiệp.</p>
        <div className="provider-grid"><span>Số cảnh kiểm chuẩn: <strong>1</strong></span><span>Thời lượng: <strong>30 giây</strong></span><span>Phương pháp: <strong>Audio-first · Performance-driven</strong></span></div>
        <p className="gate-note">Toàn bộ phim vẫn khóa cho đến khi Golden Scene đạt đúng nhân vật, giọng, khẩu hình, diễn xuất, bối cảnh, ánh sáng và continuity.</p>
        {value.pilot_batch?.samples.map((sample, index) => <article className="workflow-card" key={sample.sample_id}>
          <h4>Clip mẫu {index + 1} · {sample.purpose}</h4>
          <video controls src={sample.video_url} />
          <QcChecklist qc={sample.qc} onChange={(qc) => patch({ pilot_batch: { ...value.pilot_batch!, samples: value.pilot_batch!.samples.map((item) => item.sample_id === sample.sample_id ? { ...item, qc, review: { ...item.review, decision: "PENDING" } } : item) } })} />
          <ReviewGate label={`Duyệt ${sample.sample_id}`} review={sample.review} onChange={(review) => patch({ pilot_batch: { ...value.pilot_batch!, samples: value.pilot_batch!.samples.map((item) => item.sample_id === sample.sample_id ? { ...item, review } : item), batch_review: { ...value.pilot_batch!.batch_review, decision: "PENDING" } } })} />
        </article>)}
        {value.pilot_batch && <ReviewGate label="Duyệt toàn bộ đợt clip mẫu" review={value.pilot_batch.batch_review} onChange={(batch_review) => patch({ pilot_batch: { samples: value.pilot_batch!.samples, batch_review } })} />}
        {!value.pilot_batch && <p className="gate-note">Chưa tạo clip mẫu — sản xuất toàn phim đang khóa.</p>}
        <details className="system-only"><summary>Dữ liệu tương thích cũ</summary>
        <label><span>Player URL</span><input type="url" value={value.pilot?.video_url ?? ""} onChange={(event) => patch({ pilot: { duration_seconds: value.pilot?.duration_seconds ?? 15, video_url: event.target.value, qc: value.pilot?.qc ?? { ...emptyQc }, review: value.pilot?.review ?? { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" } } })} /></label>
        <label><span>Thời lượng</span><input min={10} max={20} type="number" value={value.pilot?.duration_seconds ?? 15} onChange={(event) => value.pilot && patch({ pilot: { ...value.pilot, duration_seconds: Number(event.target.value) } })} /></label>
        {value.pilot?.video_url && <video controls src={value.pilot.video_url} />}
        <QcChecklist qc={value.pilot?.qc ?? emptyQc} onChange={(qc) => value.pilot && patch({ pilot: { ...value.pilot, qc } })} />
        <ReviewGate label="Pilot gate" review={value.pilot?.review} onChange={(review) => value.pilot && patch({ pilot: { ...value.pilot, review } })} />
        </details>
      </fieldset>

      <fieldset disabled={!pilotApproved} className={!pilotApproved ? "locked-stage" : ""}>
        <legend>Sản xuất toàn phim — chỉ mở sau khi clip mẫu được duyệt</legend>
        <label><span>Player phim hoàn chỉnh</span><input type="url" value={value.full_film?.video_url ?? ""} onChange={(event) => patch({ full_film: { video_url: event.target.value, qc: value.full_film?.qc ?? { ...emptyQc }, review: value.full_film?.review ?? { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" } } })} /></label>
        {value.full_film?.video_url && <video controls src={value.full_film.video_url} />}
        <QcChecklist qc={value.full_film?.qc ?? emptyQc} onChange={(qc) => value.full_film && patch({ full_film: { ...value.full_film, qc } })} />
        <ReviewGate label="Duyệt phim hoàn chỉnh" review={value.full_film?.review} onChange={(review) => value.full_film && patch({ full_film: { ...value.full_film, review } })} />
        <p className="gate-note">{finalApproved ? "Phim đã được duyệt và sẵn sàng xuất bản." : "Chưa thể xuất bản khi kiểm tra chất lượng và duyệt phim chưa hoàn tất."}</p>
      </fieldset>
      <section className="post-intake-note">
        <strong>Sau khi tạo dự án</strong>
        <p>Hệ thống sẽ tự lập Shot Plan từ kịch bản đã duyệt. Khi kế hoạch sẵn sàng, bạn chỉ cần chọn <b>Duyệt</b> hoặc <b>Yêu cầu sửa</b>; không phải nhập danh sách cảnh hay thông số kỹ thuật tại form này.</p>
      </section>
    </div>
  );
}

function QcChecklist({ qc, onChange }: { qc: typeof emptyQc; onChange: (qc: typeof emptyQc) => void }) {
  const labels: Record<keyof typeof emptyQc, string> = { identity: "Đúng nhân vật", motion: "Chuyển động", lip_sync: "Khẩu hình", voice: "Giọng nói", background: "Bối cảnh", lighting: "Ánh sáng", continuity: "Liền mạch giữa các cảnh" };
  return <div className="qc-grid">{Object.entries(labels).map(([key, label]) => <label key={key}><input checked={qc[key as keyof typeof qc]} type="checkbox" onChange={(event) => onChange({ ...qc, [key]: event.target.checked })} /> {label}</label>)}</div>;
}

function ReviewGate({ label, review, onChange }: { label: string; review?: ShortFilmWorkflow["script_review"]; onChange: (review: ShortFilmWorkflow["script_review"]) => void }) {
  const current = review ?? { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" };
  return <div className="approval-gate"><strong>{label}</strong><ReviewDecisionButtons value={current.decision} onChange={(decision) => onChange({ ...current, decision, reviewed_at: new Date().toISOString() })} /><textarea placeholder="Ghi chú review" value={current.notes} onChange={(event) => onChange({ ...current, notes: event.target.value })} /></div>;
}

function ReviewDecisionButtons({ value, onChange, approveDisabled = false, simple = false }: { value: ShortFilmWorkflow["script_review"]["decision"]; onChange: (decision: ShortFilmWorkflow["script_review"]["decision"]) => void; approveDisabled?: boolean; simple?: boolean }) {
  return <div className="review-click-actions" role="group" aria-label="Lựa chọn duyệt">
    <button className={value === "APPROVE" ? "decision-approve selected" : "decision-approve"} disabled={approveDisabled} onClick={() => onChange("APPROVE")} type="button">✓ Duyệt</button>
    {!simple && <button className={value === "REQUEST_CHANGES" ? "secondary-button decision-change selected" : "secondary-button decision-change"} onClick={() => onChange("REQUEST_CHANGES")} type="button">↻ Yêu cầu sửa</button>}
    {!simple && <button className={value === "REJECT" ? "remove-button decision-reject selected" : "remove-button decision-reject"} onClick={() => onChange("REJECT")} type="button">× Từ chối</button>}
    {simple && <button className={value === "PENDING" ? "secondary-button action-pending selected" : "secondary-button action-pending"} onClick={() => onChange("PENDING")} type="button">Chưa duyệt</button>}
  </div>;
}
