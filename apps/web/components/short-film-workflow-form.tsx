"use client";

import { useEffect } from "react";
import { shortFilmProductionReadinessBlockers, type ShortFilmWorkflow } from "@tu-hau/contracts";

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
  providerBudgetApproved?: boolean;
  providerStatus?: Record<string, { configured: boolean }>;
};

const temporaryActors = [
  { source_actor_id: "GDTH-CHAR-001", source_actor_name: "Tường Vy", source_kind: "TEMPORARY_APPROVED_SOURCE", master_identity_status: "TEMPORARY" },
  { source_actor_id: "GDTH-CHAR-002", source_actor_name: "Phương An", source_kind: "TEMPORARY_APPROVED_SOURCE", master_identity_status: "TEMPORARY" },
] as const;

const emptyQc = {
  identity: false,
  motion: false,
  lip_sync: false,
  voice: false,
  background: false,
  lighting: false,
  continuity: false,
};

export function createInitialShortFilmWorkflow(): ShortFilmWorkflow {
  return {
    schema_version: "SHORT_FILM_FORM_V1",
    character_count: 2,
    source_actors: temporaryActors.map((actor) => ({ ...actor })),
    film_characters: temporaryActors.map((actor, index) => ({
      source_actor_id: actor.source_actor_id,
      film_character_name: index === 0 ? "Nhân vật A" : "Nhân vật B",
      film_role: index === 0 ? "PROTAGONIST" : "SUPPORTING",
      relationships: "Chưa xác định",
      personality: "Chưa xác định",
      appearance: "Bám Character Master đã duyệt",
    })),
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
      sample_count: 3,
      clip_duration_seconds: 15,
      selection_mode: "RISK_BASED_REPRESENTATIVE_SHOTS",
      required_purposes: ["IDENTITY_DIALOGUE", "MOTION_PERFORMANCE", "MULTI_CHARACTER_CONTINUITY"],
    },
  };
}

function allQcPassed(qc: typeof emptyQc) {
  return Object.values(qc).every(Boolean);
}

export function ShortFilmWorkflowForm({ eligibleCharacters, value, onChange, onGenerateScript, onRequestBudgetApproval, generatingScript = false, providerBudgetApproved = false, providerStatus }: Props) {
  const libraryActors = eligibleCharacters
    .filter((actor) => actor.readiness?.master_identity === "APPROVED_LOCKED")
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
    }));
  const availableActors = libraryActors.length > 0 ? libraryActors : temporaryActors;
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
    ) || value.film_characters.some((character) => !libraryActorIds.has(character.source_actor_id));
    if (!needsLibraryMigration) return;

    const filmCharacters = value.film_characters.map((character, index) => ({
      ...character,
      source_actor_id: libraryActorIds.has(character.source_actor_id)
        ? character.source_actor_id
        : libraryActors[index % libraryActors.length].source_actor_id,
    }));
    const selectedActorIds = new Set(filmCharacters.map((character) => character.source_actor_id));
    onChange({
      ...value,
      film_characters: filmCharacters,
      source_actors: libraryActors.filter((actor) => selectedActorIds.has(actor.source_actor_id)),
    });
  }, [eligibleCharacters, value, onChange]);

  function patch(patchValue: Partial<ShortFilmWorkflow>) {
    onChange({ ...value, ...patchValue });
  }

  function setCharacterCount(count: number) {
    const characterCount = Math.max(1, Math.min(20, count));
    const filmCharacters = Array.from({ length: characterCount }, (_, index) =>
      value.film_characters[index] ?? {
        source_actor_id: availableActors[index % availableActors.length]?.source_actor_id ?? "GDTH-CHAR-001",
        film_character_name: `Nhân vật ${index + 1}`,
        film_role: index === 0 ? "PROTAGONIST" as const : "SUPPORTING" as const,
        relationships: "Chưa xác định",
        personality: "Chưa xác định",
        appearance: "Bám Character Master đã duyệt",
      },
    );
    patch({ character_count: characterCount, film_characters: filmCharacters });
  }

  function initializeProductionReadiness() {
    if (!value.shot_plan) return;
    const usedActorIds = new Set(value.film_characters.map((character) => character.source_actor_id));
    const usedActors = libraryActors.filter((actor) => usedActorIds.has(actor.source_actor_id));
    const firstActor = usedActors[0];
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
          })),
        keyframes: [],
        dialogue_shot_ids: value.dialogue.dialogue_mode === "DIALOGUE"
          ? value.shot_plan.shots.map((_, index) => `SHOT-${String(index + 1).padStart(3, "0")}`)
          : [],
        speaker_locks: value.dialogue.dialogue_mode === "DIALOGUE" ? value.shot_plan.shots.map((_, index) => ({
          shot_id: `SHOT-${String(index + 1).padStart(3, "0")}`,
          speaker_source_actor_id: firstActor?.source_actor_id ?? "",
          voice_master_id: firstActor?.voice_master_id ?? "",
          visible_face_count: 1,
          selection_mode: "SINGLE_VISIBLE_FACE" as const,
        })) : [],
        dialogue_line_approvals: [],
        review: { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" },
      },
    });
  }

  function initializeExecutionShots() {
    if (!value.shot_plan) return;
    patch({ shot_plan: {
      ...value.shot_plan,
      execution_shots: value.shot_plan.shots.map((summary, index) => ({
        shot_id: `SHOT-${String(index + 1).padStart(3, "0")}`,
        summary,
        runway_prompt: `${summary}. Cinematic Vietnamese television drama, natural acting and movement, preserve the approved character identity, costume and continuity.`,
        duration_seconds: 5,
        risk_tags: index === 0 ? ["IDENTITY_DIALOGUE"] : index === 1 ? ["MOTION_PERFORMANCE"] : index === 2 ? ["MULTI_CHARACTER_CONTINUITY"] : [],
      })),
    } });
  }

  const readinessBlockers = value.production_readiness
    ? shortFilmProductionReadinessBlockers(value)
    : ["PRODUCTION_READINESS_MISSING"];
  const productionReady = readinessBlockers.length === 0;

  return (
    <div className="short-film-workflow">
      <div className="workflow-banner">
        <strong>Quy trình phim ngắn an toàn</strong>
        <span>Kịch bản, nhân vật, giọng nói, pilot và phim hoàn chỉnh đều phải được duyệt trước khi đi tiếp.</span>
      </div>

      <fieldset>
        <legend>Diễn viên nguồn và nhân vật trong phim</legend>
        <label><span>Số lượng nhân vật</span><input min={1} max={20} type="number" value={value.character_count} onChange={(event) => setCharacterCount(Number(event.target.value))} /></label>
        <p className="gate-note">Gallery chỉ hiển thị nguồn trong CHARACTER_LIBRARY có MASTER_IDENTITY APPROVED+LOCKED. Ảnh chính diện và toàn thân phải được xem trước khi duyệt Production Readiness.</p>
        <div className="character-master-gallery">
          {libraryActors.map((actor) => <article className="character-master-preview" key={actor.source_actor_id}>
            <header><strong>{actor.source_actor_name}</strong><span>{actor.character_type}</span></header>
            <div className="character-master-images">
              <ReferenceImage label="Chính diện" url={actor.face_reference_url} />
              <ReferenceImage label="Toàn thân" url={actor.body_reference_url} />
            </div>
            <dl>
              <div><dt>Identity</dt><dd>{actor.master_identity_status}</dd></div>
              <div><dt>Voice</dt><dd>{actor.voice_master_status ?? "NOT_READY"}</dd></div>
              <div><dt>Master ID</dt><dd>{actor.master_identity_id ?? "MISSING"}</dd></div>
            </dl>
          </article>)}
        </div>
        {value.film_characters.map((character, index) => (
          <article className="workflow-card" key={`${index}-${character.source_actor_id}`}>
            <h4>Nhân vật {index + 1}</h4>
            <label><span>Diễn viên nguồn</span><select value={character.source_actor_id} onChange={(event) => {
              const next = [...value.film_characters]; next[index] = { ...character, source_actor_id: event.target.value };
              const selected = availableActors.find((actor) => actor.source_actor_id === event.target.value);
              patch({ film_characters: next, source_actors: selected && !value.source_actors.some((actor) => actor.source_actor_id === selected.source_actor_id) ? [...value.source_actors, { ...selected }] : value.source_actors });
            }}>{availableActors.map((actor) => <option key={actor.source_actor_id} value={actor.source_actor_id}>{actor.source_actor_name}</option>)}</select></label>
            <label><span>Tên nhân vật trong phim</span><input placeholder="Ví dụ: Vy, An, Má Lan" value={character.film_character_name} onChange={(event) => { const next = [...value.film_characters]; next[index] = { ...character, film_character_name: event.target.value }; patch({ film_characters: next }); }} /></label>
            <label><span>Vai diễn</span><select value={character.film_role} onChange={(event) => { const next = [...value.film_characters]; next[index] = { ...character, film_role: event.target.value as typeof character.film_role }; patch({ film_characters: next }); }}><option value="PROTAGONIST">Nhân vật chính</option><option value="ANTAGONIST">Đối trọng</option><option value="SUPPORTING">Hỗ trợ</option><option value="CAMEO">Khách mời</option><option value="EXTRA">Quần chúng</option></select></label>
            <label><span>Quan hệ</span><input placeholder="Ví dụ: chị của An, con của Má Lan" value={character.relationships} onChange={(event) => { const next = [...value.film_characters]; next[index] = { ...character, relationships: event.target.value }; patch({ film_characters: next }); }} /></label>
            <label><span>Tính cách</span><textarea placeholder="Ví dụ: mạnh mẽ, chân thành, phản ứng nhanh" value={character.personality} onChange={(event) => { const next = [...value.film_characters]; next[index] = { ...character, personality: event.target.value }; patch({ film_characters: next }); }} /></label>
            <label><span>Ngoại hình</span><textarea placeholder="Chỉ mô tả trang phục hoặc tạo hình trong phim; gương mặt luôn bám Character Master" value={character.appearance} onChange={(event) => { const next = [...value.film_characters]; next[index] = { ...character, appearance: event.target.value }; patch({ film_characters: next }); }} /></label>
          </article>
        ))}
      </fieldset>

      <fieldset>
        <legend>Kịch bản và duyệt kịch bản</legend>
        <label><span>Nguồn kịch bản</span><select value={value.script_source} onChange={(event) => patch({ script_source: event.target.value as ShortFilmWorkflow["script_source"] })}><option value="AI_GENERATED">AI tạo</option><option value="PROJECT_OWNER_PROVIDED">Chủ dự án cung cấp</option><option value="AI_DEVELOPED_FROM_IDEA">AI phát triển từ ý tưởng</option></select></label>
        <label><span>Thời lượng mục tiêu (phút)</span><input min={1} max={60} type="number" value={value.target_duration_minutes} onChange={(event) => patch({ target_duration_minutes: Number(event.target.value) })} /></label>
        <label className="wide-field"><span>Ý tưởng để AI phát triển</span><textarea placeholder="Nhập xung đột chính, thông điệp, bối cảnh và hướng kết thúc (tối thiểu 20 ký tự)." rows={6} value={value.idea_brief} onChange={(event) => patch({ idea_brief: event.target.value, script_review: { ...value.script_review, decision: "PENDING" } })} /></label>
        {value.script_source !== "PROJECT_OWNER_PROVIDED" && onGenerateScript && <><button disabled={generatingScript || (providerBudgetApproved && value.idea_brief.trim().length < 20)} onClick={providerBudgetApproved ? onGenerateScript : onRequestBudgetApproval} type="button">{generatingScript ? "AI đang tạo kịch bản…" : providerBudgetApproved ? "Tạo bản nháp kịch bản từ ý tưởng" : "Đi đến duyệt kinh phí"}</button>{!providerBudgetApproved && <p className="gate-note">Bấm nút trên để đi thẳng đến dự toán. OpenAI vẫn bị khóa cho đến khi cổng Duyệt kinh phí đạt.</p>}</>}
        <label><span>Tên kịch bản</span><input placeholder="Ví dụ: Chiếc bẫy sau lời hứa" value={value.script_title} onChange={(event) => patch({ script_title: event.target.value })} /></label>
        <label><span>Tóm tắt nội dung</span><textarea placeholder="Tóm tắt câu chuyện trong 3–5 câu" value={value.script_synopsis} onChange={(event) => patch({ script_synopsis: event.target.value })} /></label>
        <label className="wide-field"><span>Toàn bộ kịch bản để duyệt</span><textarea placeholder="Kịch bản AI hoặc kịch bản của chủ dự án sẽ hiển thị tại đây" rows={14} value={value.full_script} onChange={(event) => patch({ full_script: event.target.value, script_review: { ...value.script_review, decision: "PENDING" } })} /></label>
        <div className="approval-gate script-approval-gate">
          <strong>Quyết định kịch bản</strong>
          <p className="gate-note">Chọn một hành động rõ ràng. Duyệt kịch bản chỉ mở phần chuẩn bị tiếp theo, chưa gọi nhà cung cấp và chưa phát sinh chi phí media.</p>
          <div className="script-approval-actions" role="group" aria-label="Quyết định kịch bản">
            <button
              className={value.script_review.decision === "APPROVE" ? "approval-action selected" : "approval-action"}
              onClick={() => patch({ script_review: { ...value.script_review, decision: "APPROVE", reviewed_at: new Date().toISOString() } })}
              type="button"
            >Duyệt và mở bước tiếp theo</button>
            <button
              className={value.script_review.decision === "REQUEST_CHANGES" ? "secondary-button selected" : "secondary-button"}
              onClick={() => patch({ script_review: { ...value.script_review, decision: "REQUEST_CHANGES", reviewed_at: new Date().toISOString() } })}
              type="button"
            >Yêu cầu sửa</button>
            <button
              className={value.script_review.decision === "REJECT" ? "remove-button selected" : "remove-button"}
              onClick={() => patch({ script_review: { ...value.script_review, decision: "REJECT", reviewed_at: new Date().toISOString() } })}
              type="button"
            >Từ chối</button>
          </div>
          <p className={`script-review-status ${scriptApproved ? "approved" : ""}`} aria-live="polite">
            {scriptApproved ? "Đã duyệt — phần tiếp theo đã được mở." : value.script_review.decision === "REQUEST_CHANGES" ? "Đang yêu cầu sửa kịch bản." : value.script_review.decision === "REJECT" ? "Kịch bản đã bị từ chối." : "Đang chờ chủ dự án duyệt."}
          </p>
          <textarea placeholder="Ghi rõ điểm cần sửa hoặc lý do duyệt/từ chối" value={value.script_review.notes} onChange={(event) => patch({ script_review: { ...value.script_review, notes: event.target.value } })} />
        </div>
      </fieldset>

      <fieldset className="provider-status" aria-label="Trạng thái dịch vụ">
        <legend>Liên kết nhà cung cấp theo chức năng</legend>
        <p className="gate-note">Kịch bản: OpenAI Responses API · ảnh thành video: Runway · khẩu hình: Sync · giọng: Voice Master đã duyệt. Secret chỉ nằm ở runtime; mọi tác vụ media vẫn chờ approval gate.</p>
        <div className="provider-grid"><span>Script — {value.providers.script} · {providerStatus?.script?.configured ? "CONNECTED" : "NOT_CONFIGURED"}</span><span>Video — {value.providers.image_to_video} · {providerStatus?.image_to_video?.configured ? "CONNECTED" : "NOT_CONFIGURED"}</span><span>Lip-sync — {value.providers.lip_sync} · {providerStatus?.lip_sync?.configured ? "CONNECTED" : "NOT_CONFIGURED"}</span><span>Voice — {value.providers.voice} · {providerStatus?.voice?.configured ? "READY" : "NOT_READY"}</span></div>
      </fieldset>

      <fieldset>
        <legend>Thoại, ngôn ngữ và cảnh hát</legend>
        <label><span>Ngôn ngữ</span><input value={value.dialogue.language} onChange={(event) => patch({ dialogue: { ...value.dialogue, language: event.target.value } })} /></label>
        <label><span>Cấu hình thoại</span><select value={value.dialogue.dialogue_mode} onChange={(event) => patch({ dialogue: { ...value.dialogue, dialogue_mode: event.target.value as ShortFilmWorkflow["dialogue"]["dialogue_mode"] } })}><option value="DIALOGUE">Đối thoại</option><option value="VOICE_OVER">Voice-over</option><option value="MIXED">Kết hợp</option></select></label>
        <label><span>Voice master</span><select value={value.dialogue.voice_master_mode} onChange={(event) => patch({ dialogue: { ...value.dialogue, voice_master_mode: event.target.value as ShortFilmWorkflow["dialogue"]["voice_master_mode"] } })}><option value="APPROVED_VOICE_MASTER_ONLY">Chỉ Voice Master đã duyệt</option><option value="OWNER_RECORDED_DIALOGUE">Chủ dự án thu thoại</option><option value="NO_DIALOGUE">Không thoại</option></select></label>
        <label><input checked={value.dialogue.singing_scene} type="checkbox" onChange={(event) => patch({ dialogue: { ...value.dialogue, singing_scene: event.target.checked } })} /> Có cảnh hát</label>
        {value.dialogue.singing_scene && <label><span>Mô tả/nguồn cảnh hát</span><textarea value={value.dialogue.singing_scene_notes} onChange={(event) => patch({ dialogue: { ...value.dialogue, singing_scene_notes: event.target.value } })} /></label>}
      </fieldset>

      <fieldset disabled={!scriptApproved} className={!scriptApproved ? "locked-stage" : ""}>
        <legend>Shot Plan — chỉ mở sau SCRIPT_APPROVED</legend>
        <label><span>Tóm tắt Shot Plan</span><textarea value={value.shot_plan?.summary ?? ""} onChange={(event) => patch({ shot_plan: { summary: event.target.value, shots: value.shot_plan?.shots ?? ["Shot 01"], execution_shots: value.shot_plan?.execution_shots ?? [] } })} /></label>
        <label><span>Danh sách shot (mỗi dòng một shot)</span><textarea value={(value.shot_plan?.shots ?? []).join("\n")} onChange={(event) => patch({ shot_plan: { summary: value.shot_plan?.summary ?? "Shot Plan", shots: event.target.value.split("\n").filter(Boolean), execution_shots: [] } })} /></label>
        <button type="button" disabled={!value.shot_plan?.shots.length} onClick={initializeExecutionShots}>Tạo execution shots để kiểm tra</button>
        {(value.shot_plan?.execution_shots ?? []).map((shot, index) => <article className="workflow-card" key={shot.shot_id}>
          <h4>{shot.shot_id} · {shot.summary}</h4>
          <label><span>Prompt chuyển động</span><textarea value={shot.runway_prompt} onChange={(event) => patch({ shot_plan: { ...value.shot_plan!, execution_shots: value.shot_plan!.execution_shots.map((item, itemIndex) => itemIndex === index ? { ...item, runway_prompt: event.target.value } : item) } })} /></label>
          <label><span>Thời lượng shot</span><select value={shot.duration_seconds} onChange={(event) => patch({ shot_plan: { ...value.shot_plan!, execution_shots: value.shot_plan!.execution_shots.map((item, itemIndex) => itemIndex === index ? { ...item, duration_seconds: Number(event.target.value) } : item) } })}>{[2,3,4,5,6,7,8,9,10].map((seconds) => <option key={seconds} value={seconds}>{seconds} giây</option>)}</select></label>
        </article>)}
      </fieldset>

      <fieldset disabled={!scriptApproved || !value.shot_plan} className={!scriptApproved || !value.shot_plan ? "locked-stage" : ""}>
        <legend>Production readiness — khóa trước mọi provider media</legend>
        <p className="gate-note">Chỉ dùng Character Master và Voice Master APPROVED+LOCKED từ kho. Mỗi keyframe phải được duyệt Identity/Continuity; cảnh nhiều mặt bắt buộc MANUAL_FACE_TRACK.</p>
        {!value.production_readiness && <button type="button" onClick={initializeProductionReadiness}>Nạp khóa từ CHARACTER_LIBRARY</button>}
        {value.production_readiness && <>
          <div className="provider-grid">
            <span>Identity Masters — {value.production_readiness.identity_masters.length}/{new Set(value.film_characters.map((character) => character.source_actor_id)).size}</span>
            <span>Voice Masters — {value.production_readiness.voice_masters.length}/{new Set(value.film_characters.map((character) => character.source_actor_id)).size}</span>
          </div>
          {value.production_readiness.voice_masters.map((voice) => <article className="workflow-card" key={voice.source_actor_id}>
            <h4>Voice &amp; Lip-sync Readiness — {availableActors.find((actor) => actor.source_actor_id === voice.source_actor_id)?.source_actor_name ?? voice.source_actor_id}</h4>
            <label><span>Độ tuổi cảm nhận</span><select value={voice.perceived_age_band ?? ""} onChange={(event) => {
              const voice_masters = value.production_readiness!.voice_masters.map((item) => item.source_actor_id === voice.source_actor_id ? { ...item, perceived_age_band: event.target.value as "YOUNG_ADULT" | "ADULT" | "MIDDLE_AGED" | "OLDER_ADULT" } : item);
              patch({ production_readiness: { ...value.production_readiness!, voice_masters, review: { ...value.production_readiness!.review, decision: "PENDING" } } });
            }}><option value="">Chưa khóa</option><option value="YOUNG_ADULT">Nữ trẻ</option><option value="ADULT">Nữ trưởng thành</option><option value="MIDDLE_AGED">Trung niên</option><option value="OLDER_ADULT">Người lớn tuổi</option></select></label>
            <label><span>Giọng vùng</span><select value={voice.locale ?? ""} onChange={(event) => {
              const voice_masters = value.production_readiness!.voice_masters.map((item) => item.source_actor_id === voice.source_actor_id ? { ...item, locale: event.target.value ? "vi-VN-southwest" as const : undefined } : item);
              patch({ production_readiness: { ...value.production_readiness!, voice_masters, review: { ...value.production_readiness!.review, decision: "PENDING" } } });
            }}><option value="">Chưa khóa</option><option value="vi-VN-southwest">Nữ miền Tây Nam Bộ</option></select></label>
            <label><span>Diễn giọng</span><select value={voice.performance_style ?? ""} onChange={(event) => {
              const voice_masters = value.production_readiness!.voice_masters.map((item) => item.source_actor_id === voice.source_actor_id ? { ...item, performance_style: event.target.value ? "SOUTHERN_TV_DRAMA_DUBBING" as const : undefined } : item);
              patch({ production_readiness: { ...value.production_readiness!, voice_masters, review: { ...value.production_readiness!.review, decision: "PENDING" } } });
            }}><option value="">Chưa khóa</option><option value="SOUTHERN_TV_DRAMA_DUBBING">Lồng tiếng phim truyền hình miền Nam</option></select></label>
            <label><span>Pronunciation lexicon ID</span><input value={voice.pronunciation_lexicon_id ?? ""} onChange={(event) => {
              const voice_masters = value.production_readiness!.voice_masters.map((item) => item.source_actor_id === voice.source_actor_id ? { ...item, pronunciation_lexicon_id: event.target.value || undefined } : item);
              patch({ production_readiness: { ...value.production_readiness!, voice_masters, review: { ...value.production_readiness!.review, decision: "PENDING" } } });
            }} /></label>
            <label><span>Audition audio URL</span><input type="url" value={voice.audition_audio_url ?? ""} onChange={(event) => {
              const voice_masters = value.production_readiness!.voice_masters.map((item) => item.source_actor_id === voice.source_actor_id ? { ...item, audition_audio_url: event.target.value || undefined, audition_review: { decision: "PENDING" as const, notes: "", reviewer: "PROJECT_OWNER" as const } } : item);
              patch({ production_readiness: { ...value.production_readiness!, voice_masters, review: { ...value.production_readiness!.review, decision: "PENDING" } } });
            }} /></label>
            {voice.audition_audio_url && <audio controls src={voice.audition_audio_url} />}
            <label><span>Duyệt audition</span><select value={voice.audition_review?.decision ?? "PENDING"} onChange={(event) => {
              const decision = event.target.value as "PENDING" | "REQUEST_CHANGES" | "APPROVE" | "REJECT";
              const voice_masters = value.production_readiness!.voice_masters.map((item) => item.source_actor_id === voice.source_actor_id ? { ...item, audition_review: { decision, notes: item.audition_review?.notes ?? "", reviewer: "PROJECT_OWNER" as const, reviewed_at: new Date().toISOString() } } : item);
              patch({ production_readiness: { ...value.production_readiness!, voice_masters, review: { ...value.production_readiness!.review, decision: "PENDING" } } });
            }}><option value="PENDING">Chờ nghe</option><option value="REQUEST_CHANGES">REQUEST_CHANGES</option><option value="APPROVE">APPROVE</option><option value="REJECT">REJECT</option></select></label>
          </article>)}
          {(value.shot_plan?.shots ?? []).map((shot, index) => {
            const shotId = `SHOT-${String(index + 1).padStart(3, "0")}`;
            const keyframe = value.production_readiness?.keyframes.find((item) => item.shot_id === shotId);
            const speaker = value.production_readiness?.speaker_locks.find((item) => item.shot_id === shotId);
            const isDialogueShot = value.dialogue.dialogue_mode === "DIALOGUE" || Boolean(value.production_readiness?.dialogue_shot_ids.includes(shotId));
            return <article className="workflow-card" key={shotId}>
              <h4>{shotId} — {shot}</h4>
              <label><span>Keyframe URL đã duyệt</span><input type="url" value={keyframe?.approved_image_url ?? ""} onChange={(event) => {
                if (!value.production_readiness) return;
                const keyframes = value.production_readiness.keyframes.filter((item) => item.shot_id !== shotId);
                if (event.target.value) keyframes.push({ shot_id: shotId, approved_image_url: event.target.value, identity_decision: "APPROVE", continuity_decision: "APPROVE", reviewer: "PROJECT_OWNER", reviewed_at: new Date().toISOString() });
                patch({ production_readiness: { ...value.production_readiness, keyframes, review: { ...value.production_readiness.review, decision: "PENDING" } } });
              }} /></label>
              {value.dialogue.dialogue_mode === "MIXED" && <label><input checked={isDialogueShot} type="checkbox" onChange={(event) => {
                if (!value.production_readiness) return;
                const dialogue_shot_ids = event.target.checked
                  ? [...new Set([...value.production_readiness.dialogue_shot_ids, shotId])]
                  : value.production_readiness.dialogue_shot_ids.filter((item) => item !== shotId);
                let speaker_locks = value.production_readiness.speaker_locks.filter((item) => item.shot_id !== shotId);
                if (event.target.checked) {
                  const actor = value.production_readiness.voice_masters[0];
                  speaker_locks.push({ shot_id: shotId, speaker_source_actor_id: actor?.source_actor_id ?? "", voice_master_id: actor?.voice_master_id ?? "", visible_face_count: 1, selection_mode: "SINGLE_VISIBLE_FACE" });
                }
                patch({ production_readiness: { ...value.production_readiness, dialogue_shot_ids, speaker_locks, review: { ...value.production_readiness.review, decision: "PENDING" } } });
              }} /> Thoại trực diện cần lip-sync</label>}
              {speaker && <>
                <label><span>Nhân vật nói</span><select value={speaker.speaker_source_actor_id} onChange={(event) => {
                  if (!value.production_readiness) return;
                  const voice = value.production_readiness.voice_masters.find((item) => item.source_actor_id === event.target.value);
                  const speaker_locks = value.production_readiness.speaker_locks.map((item) => item.shot_id === shotId ? { ...item, speaker_source_actor_id: event.target.value, voice_master_id: voice?.voice_master_id ?? "" } : item);
                  patch({ production_readiness: { ...value.production_readiness, speaker_locks, review: { ...value.production_readiness.review, decision: "PENDING" } } });
                }}>{value.film_characters.map((character) => <option key={character.source_actor_id} value={character.source_actor_id}>{character.film_character_name}</option>)}</select></label>
                <label><span>Số khuôn mặt thấy được</span><input min={1} type="number" value={speaker.visible_face_count} onChange={(event) => {
                  if (!value.production_readiness) return;
                  const visible_face_count = Math.max(1, Number(event.target.value));
                  const speaker_locks = value.production_readiness.speaker_locks.map((item) => item.shot_id === shotId ? { ...item, visible_face_count, selection_mode: visible_face_count > 1 ? "MANUAL_FACE_TRACK" as const : item.selection_mode } : item);
                  patch({ production_readiness: { ...value.production_readiness, speaker_locks, review: { ...value.production_readiness.review, decision: "PENDING" } } });
                }} /></label>
                <label><span>Khóa người nói</span><select value={speaker.selection_mode} onChange={(event) => {
                  if (!value.production_readiness) return;
                  const selection_mode = event.target.value as typeof speaker.selection_mode;
                  const speaker_locks = value.production_readiness.speaker_locks.map((item) => item.shot_id === shotId ? { ...item, selection_mode } : item);
                  patch({ production_readiness: { ...value.production_readiness, speaker_locks, review: { ...value.production_readiness.review, decision: "PENDING" } } });
                }}><option value="SINGLE_VISIBLE_FACE">Một khuôn mặt duy nhất</option><option value="MANUAL_FACE_TRACK">Manual face track</option></select></label>
                {speaker.selection_mode === "MANUAL_FACE_TRACK" && <label><span>Face track ID</span><input value={speaker.face_track_id ?? ""} onChange={(event) => {
                  if (!value.production_readiness) return;
                  const speaker_locks = value.production_readiness.speaker_locks.map((item) => item.shot_id === shotId ? { ...item, face_track_id: event.target.value || undefined } : item);
                  patch({ production_readiness: { ...value.production_readiness, speaker_locks, review: { ...value.production_readiness.review, decision: "PENDING" } } });
                }} /></label>}
                {(() => {
                  const line = value.production_readiness?.dialogue_line_approvals.find((item) => item.shot_id === shotId);
                  return <>
                    <label><span>Câu thoại đã kiểm tra phát âm</span><textarea value={line?.dialogue_text ?? ""} onChange={(event) => {
                      if (!value.production_readiness) return;
                      const dialogue_line_approvals = value.production_readiness.dialogue_line_approvals.filter((item) => item.shot_id !== shotId);
                      if (event.target.value) dialogue_line_approvals.push({ line_id: `LINE-${String(index + 1).padStart(3, "0")}`, shot_id: shotId, speaker_source_actor_id: speaker.speaker_source_actor_id, voice_master_id: speaker.voice_master_id, dialogue_text: event.target.value, target_duration_ms: line?.target_duration_ms ?? 2000, pronunciation_decision: "PENDING", age_casting_decision: "PENDING", timing_decision: "PENDING", reviewer: "PROJECT_OWNER", reviewed_at: new Date().toISOString() });
                      patch({ production_readiness: { ...value.production_readiness, dialogue_line_approvals, review: { ...value.production_readiness.review, decision: "PENDING" } } });
                    }} /></label>
                    <label><span>Timing khẩu hình mục tiêu (ms)</span><input min={250} max={60000} type="number" value={line?.target_duration_ms ?? 2000} onChange={(event) => {
                      if (!value.production_readiness || !line) return;
                      const dialogue_line_approvals = value.production_readiness.dialogue_line_approvals.map((item) => item.shot_id === shotId ? { ...item, target_duration_ms: Number(event.target.value), reviewed_at: new Date().toISOString() } : item);
                      patch({ production_readiness: { ...value.production_readiness, dialogue_line_approvals, review: { ...value.production_readiness.review, decision: "PENDING" } } });
                    }} /></label>
                    {line && <label><span>Duyệt câu thoại</span><select value={line.pronunciation_decision === "APPROVE" && line.age_casting_decision === "APPROVE" && line.timing_decision === "APPROVE" ? "APPROVE" : "PENDING"} onChange={(event) => {
                      if (!value.production_readiness) return;
                      const decision = event.target.value as "PENDING" | "APPROVE";
                      const dialogue_line_approvals = value.production_readiness.dialogue_line_approvals.map((item) => item.shot_id === shotId ? { ...item, pronunciation_decision: decision, age_casting_decision: decision, timing_decision: decision, reviewed_at: new Date().toISOString() } : item);
                      patch({ production_readiness: { ...value.production_readiness, dialogue_line_approvals, review: { ...value.production_readiness.review, decision: "PENDING" } } });
                    }}><option value="PENDING">Chờ nghe và kiểm tra</option><option value="APPROVE">APPROVE độ tuổi · phát âm · timing</option></select></label>}
                    <p className="gate-note">{line?.pronunciation_decision === "APPROVE" && line.age_casting_decision === "APPROVE" && line.timing_decision === "APPROVE" ? "PROJECT_OWNER APPROVED: độ tuổi · phát âm miền Tây · timing khẩu hình" : "Chưa duyệt câu thoại — provider bị khóa"}</p>
                  </>;
                })()}
              </>}
            </article>;
          })}
          <div className="approval-gate"><strong>Production readiness gate</strong><select value={value.production_readiness.review.decision} onChange={(event) => {
            if (!value.production_readiness) return;
            patch({ production_readiness: { ...value.production_readiness, review: { ...value.production_readiness.review, decision: event.target.value as ShortFilmWorkflow["script_review"]["decision"], reviewed_at: new Date().toISOString() } } });
          }}><option value="PENDING">Chờ review</option><option value="REQUEST_CHANGES">REQUEST_CHANGES</option><option disabled={readinessBlockers.some((blocker) => blocker !== "PRODUCTION_READINESS_NOT_APPROVED")} value="APPROVE">APPROVE</option><option value="REJECT">REJECT</option></select><textarea value={value.production_readiness.review.notes} onChange={(event) => patch({ production_readiness: { ...value.production_readiness!, review: { ...value.production_readiness!.review, notes: event.target.value } } })} /></div>
          <p className="gate-note">{productionReady ? "PROVIDER_EXECUTION_ALLOWED" : `PROVIDER_LOCKED: ${readinessBlockers.join(", ")}`}</p>
        </>}
      </fieldset>

      <fieldset disabled={!scriptApproved || !value.shot_plan || !productionReady} className={!scriptApproved || !value.shot_plan || !productionReady ? "locked-stage" : ""}>
        <legend>Pilot 10–20 giây và QC</legend>
        <p className="gate-note">TuhauAI chỉ tạo đợt clip mẫu đại diện trước. Toàn bộ clip còn lại và bước ghép phim bị khóa cho đến khi từng mẫu và cổng duyệt tổng đều APPROVE.</p>
        <label><span>Số clip mẫu cần xem</span><select value={value.pilot_sampling.sample_count} onChange={(event) => patch({ pilot_sampling: { ...value.pilot_sampling, sample_count: Number(event.target.value) } })}><option value={2}>2 clip</option><option value={3}>3 clip — khuyến nghị</option><option value={4}>4 clip</option><option value={5}>5 clip</option></select></label>
        <label><span>Thời lượng mỗi clip</span><select value={value.pilot_sampling.clip_duration_seconds} onChange={(event) => patch({ pilot_sampling: { ...value.pilot_sampling, clip_duration_seconds: Number(event.target.value) } })}><option value={10}>10 giây</option><option value={15}>15 giây — khuyến nghị</option><option value={20}>20 giây</option></select></label>
        <p className="gate-note">Mẫu bắt buộc phủ nhận dạng + thoại, diễn xuất chuyển động và nhiều nhân vật/continuity. Shot Plan ưu tiên thêm cảnh rủi ro cao khi chọn 4–5 mẫu.</p>
        {value.pilot_batch?.samples.map((sample, index) => <article className="workflow-card" key={sample.sample_id}>
          <h4>Clip mẫu {index + 1} · {sample.purpose}</h4>
          <video controls src={sample.video_url} />
          <QcChecklist qc={sample.qc} onChange={(qc) => patch({ pilot_batch: { ...value.pilot_batch!, samples: value.pilot_batch!.samples.map((item) => item.sample_id === sample.sample_id ? { ...item, qc, review: { ...item.review, decision: "PENDING" } } : item) } })} />
          <ReviewGate label={`Duyệt ${sample.sample_id}`} review={sample.review} onChange={(review) => patch({ pilot_batch: { ...value.pilot_batch!, samples: value.pilot_batch!.samples.map((item) => item.sample_id === sample.sample_id ? { ...item, review } : item), batch_review: { ...value.pilot_batch!.batch_review, decision: "PENDING" } } })} />
        </article>)}
        {value.pilot_batch && <ReviewGate label="Duyệt toàn bộ đợt clip mẫu" review={value.pilot_batch.batch_review} onChange={(batch_review) => patch({ pilot_batch: { samples: value.pilot_batch!.samples, batch_review } })} />}
        {!value.pilot_batch && <p className="gate-note">Chưa tạo clip mẫu — sản xuất toàn phim đang khóa.</p>}
        <details><summary>Tương thích pilot đơn cũ</summary>
        <label><span>Player URL</span><input type="url" value={value.pilot?.video_url ?? ""} onChange={(event) => patch({ pilot: { duration_seconds: value.pilot?.duration_seconds ?? 15, video_url: event.target.value, qc: value.pilot?.qc ?? { ...emptyQc }, review: value.pilot?.review ?? { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" } } })} /></label>
        <label><span>Thời lượng</span><input min={10} max={20} type="number" value={value.pilot?.duration_seconds ?? 15} onChange={(event) => value.pilot && patch({ pilot: { ...value.pilot, duration_seconds: Number(event.target.value) } })} /></label>
        {value.pilot?.video_url && <video controls src={value.pilot.video_url} />}
        <QcChecklist qc={value.pilot?.qc ?? emptyQc} onChange={(qc) => value.pilot && patch({ pilot: { ...value.pilot, qc } })} />
        <ReviewGate label="Pilot gate" review={value.pilot?.review} onChange={(review) => value.pilot && patch({ pilot: { ...value.pilot, review } })} />
        </details>
      </fieldset>

      <fieldset disabled={!pilotApproved} className={!pilotApproved ? "locked-stage" : ""}>
        <legend>Sản xuất toàn phim — chỉ mở sau PILOT_APPROVED</legend>
        <label><span>Player phim hoàn chỉnh</span><input type="url" value={value.full_film?.video_url ?? ""} onChange={(event) => patch({ full_film: { video_url: event.target.value, qc: value.full_film?.qc ?? { ...emptyQc }, review: value.full_film?.review ?? { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" } } })} /></label>
        {value.full_film?.video_url && <video controls src={value.full_film.video_url} />}
        <QcChecklist qc={value.full_film?.qc ?? emptyQc} onChange={(qc) => value.full_film && patch({ full_film: { ...value.full_film, qc } })} />
        <ReviewGate label="Final film gate" review={value.full_film?.review} onChange={(review) => value.full_film && patch({ full_film: { ...value.full_film, review } })} />
        <p className="gate-note">{finalApproved ? "FULL_FILM_APPROVED — sẵn sàng xuất bản." : "Chưa thể xuất bản khi QC và cổng duyệt phim hoàn chỉnh chưa APPROVE."}</p>
      </fieldset>
    </div>
  );
}

function QcChecklist({ qc, onChange }: { qc: typeof emptyQc; onChange: (qc: typeof emptyQc) => void }) {
  const labels: Record<keyof typeof emptyQc, string> = { identity: "Identity", motion: "Chuyển động", lip_sync: "Khẩu hình", voice: "Giọng", background: "Bối cảnh", lighting: "Ánh sáng", continuity: "Continuity" };
  return <div className="qc-grid">{Object.entries(labels).map(([key, label]) => <label key={key}><input checked={qc[key as keyof typeof qc]} type="checkbox" onChange={(event) => onChange({ ...qc, [key]: event.target.checked })} /> {label}</label>)}</div>;
}

function ReviewGate({ label, review, onChange }: { label: string; review?: ShortFilmWorkflow["script_review"]; onChange: (review: ShortFilmWorkflow["script_review"]) => void }) {
  const current = review ?? { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" };
  return <div className="approval-gate"><strong>{label}</strong><select value={current.decision} onChange={(event) => onChange({ ...current, decision: event.target.value as typeof current.decision, reviewed_at: new Date().toISOString() })}><option value="PENDING">Chờ review</option><option value="REQUEST_CHANGES">REQUEST_CHANGES</option><option value="APPROVE">APPROVE</option><option value="REJECT">REJECT</option></select><textarea placeholder="Ghi chú review" value={current.notes} onChange={(event) => onChange({ ...current, notes: event.target.value })} /></div>;
}

function ReferenceImage({ label, url }: { label: string; url?: string }) {
  if (!url) return <div className="reference-image-missing"><span>{label}</span><strong>Thiếu ảnh</strong></div>;
  const previewUrl = drivePreviewUrl(url);
  return <figure><a href={url} rel="noreferrer" target="_blank"><img alt={`${label} Character Master`} loading="lazy" src={previewUrl} /></a><figcaption>{label} · mở ảnh gốc</figcaption></figure>;
}

function drivePreviewUrl(url: string) {
  const driveId = url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? url.match(/[?&]id=([a-zA-Z0-9_-]+)/)?.[1];
  return driveId ? `https://drive.google.com/thumbnail?id=${driveId}&sz=w1200` : url;
}
