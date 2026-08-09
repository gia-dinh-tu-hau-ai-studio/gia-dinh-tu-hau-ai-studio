"use client";

import { useEffect } from "react";
import { shortFilmProductionReadinessBlockers, type ShortFilmWorkflow } from "@tu-hau/contracts";

type LibraryActor = {
  character_id: string;
  character_name: string;
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
  generatingScript?: boolean;
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
  };
}

function allQcPassed(qc: typeof emptyQc) {
  return Object.values(qc).every(Boolean);
}

export function ShortFilmWorkflowForm({ eligibleCharacters, value, onChange, onGenerateScript, generatingScript = false, providerStatus }: Props) {
  const libraryActors = eligibleCharacters
    .filter((actor) => actor.readiness?.master_identity === "APPROVED_LOCKED")
    .map((actor) => ({
    source_actor_id: actor.character_id,
    source_actor_name: actor.character_name,
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
  const pilotApproved = Boolean(value.pilot && value.pilot.review.decision === "APPROVE" && allQcPassed(value.pilot.qc));
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
        review: { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" },
      },
    });
  }

  const readinessBlockers = value.production_readiness
    ? shortFilmProductionReadinessBlockers(value)
    : ["PRODUCTION_READINESS_MISSING"];
  const productionReady = readinessBlockers.length === 0;

  return (
    <div className="short-film-workflow">
      <div className="workflow-banner">
        <strong>SHORT_FILM_FORM_V1</strong>
        <span>Không dùng segmentation Final Proof. Provider và sản xuất toàn phim luôn bị khóa bởi approval gates.</span>
      </div>

      <fieldset>
        <legend>Diễn viên nguồn và nhân vật trong phim</legend>
        <label><span>Số lượng nhân vật</span><input min={1} max={20} type="number" value={value.character_count} onChange={(event) => setCharacterCount(Number(event.target.value))} /></label>
        <p className="gate-note">Hiện dùng nguồn tạm Tường Vy/Phương An. Khi CHARACTER_LIBRARY trả MASTER_IDENTITY APPROVED+LOCKED, dropdown tự dùng danh sách đó.</p>
        {value.film_characters.map((character, index) => (
          <article className="workflow-card" key={`${index}-${character.source_actor_id}`}>
            <h4>Nhân vật {index + 1}</h4>
            <label><span>Diễn viên nguồn</span><select value={character.source_actor_id} onChange={(event) => {
              const next = [...value.film_characters]; next[index] = { ...character, source_actor_id: event.target.value };
              const selected = availableActors.find((actor) => actor.source_actor_id === event.target.value);
              patch({ film_characters: next, source_actors: selected && !value.source_actors.some((actor) => actor.source_actor_id === selected.source_actor_id) ? [...value.source_actors, { ...selected }] : value.source_actors });
            }}>{availableActors.map((actor) => <option key={actor.source_actor_id} value={actor.source_actor_id}>{actor.source_actor_name}</option>)}</select></label>
            <label><span>Tên nhân vật trong phim</span><input value={character.film_character_name} onChange={(event) => { const next = [...value.film_characters]; next[index] = { ...character, film_character_name: event.target.value }; patch({ film_characters: next }); }} /></label>
            <label><span>Vai diễn</span><select value={character.film_role} onChange={(event) => { const next = [...value.film_characters]; next[index] = { ...character, film_role: event.target.value as typeof character.film_role }; patch({ film_characters: next }); }}><option value="PROTAGONIST">Nhân vật chính</option><option value="ANTAGONIST">Đối trọng</option><option value="SUPPORTING">Hỗ trợ</option><option value="CAMEO">Khách mời</option><option value="EXTRA">Quần chúng</option></select></label>
            <label><span>Quan hệ</span><input value={character.relationships} onChange={(event) => { const next = [...value.film_characters]; next[index] = { ...character, relationships: event.target.value }; patch({ film_characters: next }); }} /></label>
            <label><span>Tính cách</span><textarea value={character.personality} onChange={(event) => { const next = [...value.film_characters]; next[index] = { ...character, personality: event.target.value }; patch({ film_characters: next }); }} /></label>
            <label><span>Ngoại hình</span><textarea value={character.appearance} onChange={(event) => { const next = [...value.film_characters]; next[index] = { ...character, appearance: event.target.value }; patch({ film_characters: next }); }} /></label>
          </article>
        ))}
      </fieldset>

      <fieldset>
        <legend>Kịch bản và SCRIPT_APPROVED</legend>
        <label><span>Nguồn kịch bản</span><select value={value.script_source} onChange={(event) => patch({ script_source: event.target.value as ShortFilmWorkflow["script_source"] })}><option value="AI_GENERATED">AI tạo</option><option value="PROJECT_OWNER_PROVIDED">Chủ dự án cung cấp</option><option value="AI_DEVELOPED_FROM_IDEA">AI phát triển từ ý tưởng</option></select></label>
        <label><span>Nhà cung cấp kịch bản</span><select disabled value={value.providers.script}><option value="OPENAI_RESPONSES">OpenAI Responses API</option></select></label>
        <label><span>Thời lượng mục tiêu (phút)</span><input min={1} max={60} type="number" value={value.target_duration_minutes} onChange={(event) => patch({ target_duration_minutes: Number(event.target.value) })} /></label>
        <label className="wide-field"><span>Ý tưởng để AI phát triển</span><textarea placeholder="Nhập xung đột chính, thông điệp, bối cảnh và hướng kết thúc (tối thiểu 20 ký tự)." rows={6} value={value.idea_brief} onChange={(event) => patch({ idea_brief: event.target.value, script_review: { ...value.script_review, decision: "PENDING" } })} /></label>
        {value.script_source !== "PROJECT_OWNER_PROVIDED" && onGenerateScript && <button disabled={generatingScript || value.idea_brief.trim().length < 20} onClick={onGenerateScript} type="button">{generatingScript ? "AI đang tạo kịch bản…" : "Tạo bản nháp kịch bản từ ý tưởng"}</button>}
        <label><span>Tên kịch bản</span><input value={value.script_title} onChange={(event) => patch({ script_title: event.target.value })} /></label>
        <label><span>Synopsis</span><textarea value={value.script_synopsis} onChange={(event) => patch({ script_synopsis: event.target.value })} /></label>
        <label className="wide-field"><span>Review toàn bộ kịch bản</span><textarea rows={14} value={value.full_script} onChange={(event) => patch({ full_script: event.target.value, script_review: { ...value.script_review, decision: "PENDING" } })} /></label>
        <div className="approval-gate"><strong>Script gate</strong><select value={value.script_review.decision} onChange={(event) => patch({ script_review: { ...value.script_review, decision: event.target.value as ShortFilmWorkflow["script_review"]["decision"], reviewed_at: new Date().toISOString() } })}><option value="PENDING">Chờ review</option><option value="REQUEST_CHANGES">REQUEST_CHANGES</option><option value="APPROVE">APPROVE</option><option value="REJECT">REJECT</option></select><textarea placeholder="Ghi chú review" value={value.script_review.notes} onChange={(event) => patch({ script_review: { ...value.script_review, notes: event.target.value } })} /></div>
      </fieldset>

      <fieldset>
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
        <label><span>Tóm tắt Shot Plan</span><textarea value={value.shot_plan?.summary ?? ""} onChange={(event) => patch({ shot_plan: { summary: event.target.value, shots: value.shot_plan?.shots ?? ["Shot 01"] } })} /></label>
        <label><span>Danh sách shot (mỗi dòng một shot)</span><textarea value={(value.shot_plan?.shots ?? []).join("\n")} onChange={(event) => patch({ shot_plan: { summary: value.shot_plan?.summary ?? "Shot Plan", shots: event.target.value.split("\n").filter(Boolean) } })} /></label>
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
        <label><span>Player URL</span><input type="url" value={value.pilot?.video_url ?? ""} onChange={(event) => patch({ pilot: { duration_seconds: value.pilot?.duration_seconds ?? 15, video_url: event.target.value, qc: value.pilot?.qc ?? { ...emptyQc }, review: value.pilot?.review ?? { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" } } })} /></label>
        <label><span>Thời lượng</span><input min={10} max={20} type="number" value={value.pilot?.duration_seconds ?? 15} onChange={(event) => value.pilot && patch({ pilot: { ...value.pilot, duration_seconds: Number(event.target.value) } })} /></label>
        {value.pilot?.video_url && <video controls src={value.pilot.video_url} />}
        <QcChecklist qc={value.pilot?.qc ?? emptyQc} onChange={(qc) => value.pilot && patch({ pilot: { ...value.pilot, qc } })} />
        <ReviewGate label="Pilot gate" review={value.pilot?.review} onChange={(review) => value.pilot && patch({ pilot: { ...value.pilot, review } })} />
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
