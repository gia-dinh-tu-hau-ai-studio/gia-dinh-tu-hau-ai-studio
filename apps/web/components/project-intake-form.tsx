"use client";

import { FormEvent, useEffect, useState } from "react";

type FormProjectType = "SHORT_FILM" | "MUSIC_VIDEO" | "SHORT_MUSIC_CLIP";
type IdentityMode = "LIBRARY_MASTER" | "ORIGINAL_FACE_COMPOSITE";

type EligibleCharacter = {
  character_id: string;
  character_name: string;
  character_type: string;
  default_costume_id: string;
  voice_available: boolean;
  readiness: {
    character: "ACTIVE";
    image: "IMAGE_READY";
    legal: "LEGAL_CLEARED";
  };
};

type CharacterSelection = {
  character_id: string;
  project_role: string;
  performance_role: string;
  voice_required: boolean;
  lip_sync_required: boolean;
  identity_mode: IdentityMode;
  original_video_file_id: string;
};

type ValidatedSubmission = {
  submissionId: string;
  payload: Record<string, unknown>;
};

type CreatedProject = {
  project_id: string;
  current_stage: "CONTRACT" | "PRE_PRODUCTION";
  next_action: "APPROVE_CONTRACT" | "PREPARE_MV_PRODUCTION" | "APPROVE_MV_PRODUCTION_PLAN";
};

const projectTypes: Array<{ value: FormProjectType; label: string; description: string; disabled?: boolean }> = [
  { value: "SHORT_FILM", label: "Phim ngắn / Web Drama", description: "Tạm khóa; chỉ mở sau khi quy trình MV đạt.", disabled: true },
  { value: "MUSIC_VIDEO", label: "MV ca nhạc", description: "Ưu tiên hiện tại: MV người thật, lyrics, music và vocal." },
  { value: "SHORT_MUSIC_CLIP", label: "Clip ca nhạc ngắn", description: "Đoạn biểu diễn 30 giây–3 phút." },
];

const projectRoles = ["MAIN", "SUPPORTING", "GUEST", "CAMEO", "BACKGROUND"];
const performanceRoles = [
  "ACTOR",
  "SINGER",
  "DANCER",
  "MC",
  "COMEDIAN",
  "BAND_MEMBER",
  "AUDIENCE",
  "EXTRA",
];
const platformOptions = ["YOUTUBE", "TIKTOK", "FACEBOOK"];

function TextField({ name, label, required = true, type = "text" }: { name: string; label: string; required?: boolean; type?: string }) {
  return (
    <label>
      <span>{label}{required ? " *" : ""}</span>
      <input name={name} type={type} required={required} />
    </label>
  );
}

export function ProjectIntakeForm() {
  const [projectType, setProjectType] = useState<FormProjectType>("MUSIC_VIDEO");
  const [eligibleCharacters, setEligibleCharacters] = useState<EligibleCharacter[]>([]);
  const [characters, setCharacters] = useState<CharacterSelection[]>([]);
  const [characterToAdd, setCharacterToAdd] = useState("");
  const [libraryMessage, setLibraryMessage] = useState("Đang đọc CHARACTER_LIBRARY…");
  const [result, setResult] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [validatedSubmission, setValidatedSubmission] = useState<ValidatedSubmission | null>(null);
  const [creating, setCreating] = useState(false);
  const [creationResult, setCreationResult] = useState<string>("");
  const [createdProject, setCreatedProject] = useState<CreatedProject | null>(null);
  const [approving, setApproving] = useState(false);
  const [approvalResult, setApprovalResult] = useState<string>("");
  const [preparing, setPreparing] = useState(false);
  const [preparationResult, setPreparationResult] = useState<string>("");

  function invalidateConfirmation() {
    setValidatedSubmission(null);
    setCreationResult("");
  }

  useEffect(() => {
    void fetch("/api/characters/eligible")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.message ?? body.code ?? "Không đọc được thư viện nhân vật");
        }
        setEligibleCharacters(body as EligibleCharacter[]);
        setCharacterToAdd(body[0]?.character_id ?? "");
        setLibraryMessage(
          body.length > 0
            ? `${body.length} nhân vật đạt ACTIVE + IMAGE_READY + LEGAL_CLEARED.`
            : "Chưa có nhân vật đủ điều kiện.",
        );
      })
      .catch((error: unknown) => {
        setLibraryMessage(error instanceof Error ? error.message : "Không đọc được thư viện nhân vật");
      });
  }, []);

  function addCharacter() {
    if (!characterToAdd || characters.some((item) => item.character_id === characterToAdd)) {
      return;
    }

    invalidateConfirmation();

    setCharacters((current) => [
      ...current,
      {
        character_id: characterToAdd,
        project_role: current.length === 0 ? "MAIN" : "SUPPORTING",
        performance_role: "SINGER",
        voice_required: false,
        lip_sync_required: false,
        identity_mode: "ORIGINAL_FACE_COMPOSITE",
        original_video_file_id: "",
      },
    ]);
  }

  function updateCharacter(index: number, patch: Partial<CharacterSelection>) {
    invalidateConfirmation();
    setCharacters((current) =>
      current.map((character, characterIndex) =>
        characterIndex === index ? { ...character, ...patch } : character,
      ),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setResult("");
    setValidatedSubmission(null);
    setCreationResult("");

    const form = new FormData(event.currentTarget);
    const payload = {
      ...Object.fromEntries(
        [...form.entries()].filter(([, value]) => String(value).trim() !== ""),
      ),
      platforms: form.getAll("platforms").map(String),
      characters: characters.map((character) => {
        const libraryCharacter = eligibleCharacters.find(
          (item) => item.character_id === character.character_id,
        );
        return {
          ...character,
          selected_costume_ids: libraryCharacter?.default_costume_id
            ? [libraryCharacter.default_costume_id]
            : [],
          costume_approval_status: libraryCharacter?.default_costume_id
            ? "APPROVED"
            : undefined,
          voice_approval_status: character.voice_required ? "APPROVED" : undefined,
          original_video_file_id:
            character.identity_mode === "ORIGINAL_FACE_COMPOSITE"
              ? character.original_video_file_id
              : undefined,
        };
      }),
    };

    try {
      const response = await fetch("/api/intake/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      setResult(JSON.stringify(body, null, 2));
      if (
        response.ok &&
        body.validation_status === "PASSED" &&
        typeof body.submission_id === "string"
      ) {
        setValidatedSubmission({
          submissionId: body.submission_id,
          payload,
        });
      }
    } catch {
      setResult("Không kết nối được API. Hãy thử lại hoặc liên hệ quản trị viên.");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmCreation() {
    if (!validatedSubmission) {
      return;
    }

    setCreating(true);
    setCreationResult("");
    try {
      const response = await fetch("/api/intake/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submission_id: validatedSubmission.submissionId,
          payload: validatedSubmission.payload,
        }),
      });
      const body = await response.json();
      setCreationResult(JSON.stringify(body, null, 2));
      if (
        response.ok &&
        body.project_id_created === true &&
        typeof body.project?.project_id === "string"
      ) {
        setValidatedSubmission(null);
        setCreatedProject(body.project as CreatedProject);
      }
    } catch {
      setCreationResult("Không kết nối được kho dự án Gia Đình Tư Hậu. Không tự động gửi lại để tránh tạo trùng dự án.");
    } finally {
      setCreating(false);
    }
  }

  async function approveContract() {
    if (!createdProject) {
      return;
    }

    setApproving(true);
    setApprovalResult("");
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(createdProject.project_id)}/approve-contract`,
        { method: "POST" },
      );
      const body = await response.json();
      setApprovalResult(JSON.stringify(body, null, 2));
      if (response.ok && body.approval_status === "APPROVED") {
        setCreatedProject({
          project_id: body.project_id,
          current_stage: body.current_stage,
          next_action: body.next_action,
        });
      }
    } catch {
      setApprovalResult(
        "Không kết nối được kho dự án. Không tự động gửi lại để tránh ghi lặp sự kiện duyệt.",
      );
    } finally {
      setApproving(false);
    }
  }

  async function prepareMvProduction() {
    if (!createdProject) {
      return;
    }

    setPreparing(true);
    setPreparationResult("");
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(createdProject.project_id)}/prepare-mv-production`,
        { method: "POST" },
      );
      const body = await response.json();
      setPreparationResult(JSON.stringify(body, null, 2));
      if (response.ok && body.approval_status === "PENDING") {
        setCreatedProject({
          project_id: body.project_id,
          current_stage: body.current_stage,
          next_action: body.next_action,
        });
      }
    } catch {
      setPreparationResult(
        "Không kết nối được kho dự án. Không tự động gửi lại để tránh ghi lặp kế hoạch.",
      );
    } finally {
      setPreparing(false);
    }
  }

  return (
    <form onChange={invalidateConfirmation} onSubmit={handleSubmit}>
      <section>
        <div className="section-heading"><span>01</span><div><h2>Chọn loại dự án</h2><p>Chỉ chọn một loại. Dữ liệu nhánh ẩn không đi vào payload.</p></div></div>
        <div className="project-grid">
          {projectTypes.map((item) => (
            <label className={`project-card ${projectType === item.value ? "selected" : ""} ${item.disabled ? "locked" : ""}`} key={item.value}>
              <input
                checked={projectType === item.value}
                disabled={item.disabled}
                name="project_type"
                onChange={() => setProjectType(item.value)}
                type="radio"
                value={item.value}
              />
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </label>
          ))}
        </div>
      </section>

      <section>
        <div className="section-heading"><span>02</span><div><h2>Thông tin chung</h2><p>Ba trường hợp đồng bắt buộc: tên dự án, loại dự án và khách hàng.</p></div></div>
        <div className="field-grid">
          <TextField name="project_name" label="Tên dự án" />
          <TextField name="client_name" label="Khách hàng / đơn vị" />
          <TextField name="phone" label="Số điện thoại" />
          <TextField name="email" label="Email" type="email" />
          <TextField name="project_subtype" label="Phân loại phụ" required={false} />
          <TextField name="priority" label="Mức ưu tiên" required={false} />
          <TextField name="execution_mode" label="Chế độ thực thi" required={false} />
          <TextField name="language" label="Ngôn ngữ" />
          <TextField name="content_rating" label="Độ tuổi nội dung" />
          <TextField name="target_audience" label="Khán giả mục tiêu" />
          <TextField name="duration_target" label="Thời lượng mục tiêu" />
          <TextField name="aspect_ratio" label="Tỷ lệ khung hình" />
        </div>
        <fieldset className="platform-field">
          <legend>Nền tảng xuất bản *</legend>
          <div className="check-row">
            {platformOptions.map((platform) => (
              <label key={platform}>
                <input name="platforms" type="checkbox" value={platform} /> {platform}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section>
        <div className="section-heading"><span>03</span><div><h2>Nội dung theo loại</h2><p>Khối này thay đổi theo project_type đã chọn.</p></div></div>
        <div className="field-grid">
          {projectType === "SHORT_FILM" && <>
            <TextField name="story_idea" label="Ý tưởng tập / phim" />
            <TextField name="social_theme" label="Chủ đề xã hội" />
            <TextField name="story_genre" label="Thể loại / tông" />
            <TextField name="primary_setting" label="Bối cảnh chính" />
            <TextField name="ending_direction" label="Hướng kết thúc" />
            <TextField name="dialogue_source" label="Nguồn hội thoại" />
          </>}

          {projectType === "MUSIC_VIDEO" && <>
            <TextField name="song_title" label="Tên bài hát" />
            <TextField name="song_topic" label="Chủ đề bài hát" />
            <TextField name="music_genre" label="Thể loại nhạc" />
            <TextField name="lyrics_source_mode" label="Nguồn lời" />
            <TextField name="lyrics" label="Lời / nguồn file lời" required={false} />
            <TextField name="music_source_mode" label="Nguồn nhạc" />
            <TextField name="vocal_source_mode" label="Nguồn giọng hát" />
            <TextField name="visual_direction" label="Định hướng hình ảnh" />
          </>}

          {projectType === "SHORT_MUSIC_CLIP" && <>
            <TextField name="music_source_mode" label="Nguồn bài / nhạc" />
            <TextField name="clip_start_time" label="Thời điểm bắt đầu" />
            <TextField name="clip_end_time" label="Thời điểm kết thúc" />
            <TextField name="vocal_source_mode" label="Nguồn giọng" required={false} />
            <TextField name="visual_direction" label="Phong cách biểu diễn" />
          </>}
        </div>
      </section>

      <section>
        <div className="section-heading"><span>04</span><div><h2>Nhân vật & vai trò</h2><p>Chỉ chọn người thật đã duyệt từ CHARACTER_LIBRARY; dùng ORIGINAL_FACE_COMPOSITE khi cần giữ gương mặt.</p></div></div>
        <p className="library-status">{libraryMessage}</p>
        <div className="character-picker">
          <label>
            <span>Nhân vật đủ điều kiện</span>
            <select value={characterToAdd} onChange={(event) => setCharacterToAdd(event.target.value)}>
              {eligibleCharacters.map((character) => (
                <option key={character.character_id} value={character.character_id}>
                  {character.character_name} · {character.character_type}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-button" disabled={!characterToAdd} onClick={addCharacter} type="button">Thêm nhân vật</button>
        </div>

        <div className="character-list">
          {characters.map((character, index) => {
            const libraryCharacter = eligibleCharacters.find(
              (item) => item.character_id === character.character_id,
            );
            return (
              <article className="character-card" key={character.character_id}>
                <div className="character-card-heading">
                  <div>
                    <strong>{libraryCharacter?.character_name}</strong>
                    <small>{character.character_id}</small>
                  </div>
                  <button className="remove-button" onClick={() => {
                    invalidateConfirmation();
                    setCharacters((current) => current.filter((_, itemIndex) => itemIndex !== index));
                  }} type="button">Xóa</button>
                </div>
                <div className="field-grid">
                  <label><span>Vai trò dự án *</span><select value={character.project_role} onChange={(event) => updateCharacter(index, { project_role: event.target.value })}>{projectRoles.map((role) => <option key={role}>{role}</option>)}</select></label>
                  <label><span>Vai trò biểu diễn *</span><select value={character.performance_role} onChange={(event) => updateCharacter(index, { performance_role: event.target.value })}>{performanceRoles.map((role) => <option key={role}>{role}</option>)}</select></label>
                  <label><span>Trang phục APPROVED</span><input disabled value={libraryCharacter?.default_costume_id || "Chưa chọn costume"} /></label>
                  <label><span>Chế độ danh tính *</span><select value={character.identity_mode} onChange={(event) => updateCharacter(index, { identity_mode: event.target.value as IdentityMode })}><option value="LIBRARY_MASTER">LIBRARY_MASTER</option><option value="ORIGINAL_FACE_COMPOSITE">ORIGINAL_FACE_COMPOSITE</option></select></label>
                  {character.identity_mode === "ORIGINAL_FACE_COMPOSITE" && <label><span>file_id video gốc *</span><input required value={character.original_video_file_id} onChange={(event) => updateCharacter(index, { original_video_file_id: event.target.value })} /></label>}
                </div>
                <div className="check-row">
                  <label><input checked={character.voice_required} disabled={!libraryCharacter?.voice_available} onChange={(event) => updateCharacter(index, { voice_required: event.target.checked })} type="checkbox" /> Dùng voice APPROVED</label>
                  <label><input checked={character.lip_sync_required} onChange={(event) => updateCharacter(index, { lip_sync_required: event.target.checked })} type="checkbox" /> Cần lip-sync</label>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <button disabled={submitting || characters.length === 0} type="submit">{submitting ? "Đang kiểm tra…" : "Kiểm tra dữ liệu"}</button>
      {result && <pre>{result}</pre>}
      {validatedSubmission && (
        <section className="confirmation-panel">
          <div>
            <h2>Xác nhận tạo dự án chính thức</h2>
            <p>
              Hệ thống Gia Đình Tư Hậu sẽ tạo một project_id, cấu trúc Drive và
              hợp đồng đầu vào trong bảng PROJECTS. Không đóng trang trong lúc xử lý.
            </p>
          </div>
          <button disabled={creating} onClick={confirmCreation} type="button">
            {creating ? "Đang tạo dự án…" : "Xác nhận tạo dự án Gia Đình Tư Hậu"}
          </button>
        </section>
      )}
      {creationResult && <pre className="creation-result">{creationResult}</pre>}
      {createdProject?.next_action === "APPROVE_CONTRACT" && (
        <section className="confirmation-panel">
          <div>
            <h2>Duyệt hợp đồng dự án</h2>
            <p>
              Duyệt project_id <strong>{createdProject.project_id}</strong> và chuyển
              dự án từ CONTRACT sang PRE_PRODUCTION. Mỗi project_id chỉ được ghi một
              sự kiện CONTRACT_APPROVED.
            </p>
          </div>
          <button disabled={approving} onClick={approveContract} type="button">
            {approving ? "Đang duyệt hợp đồng…" : "Duyệt hợp đồng và chuẩn bị sản xuất MV"}
          </button>
        </section>
      )}
      {approvalResult && <pre className="creation-result">{approvalResult}</pre>}
      {createdProject?.next_action === "PREPARE_MV_PRODUCTION" && (
        <section className="confirmation-panel">
          <div>
            <h2>Lập kế hoạch PRE_PRODUCTION</h2>
            <p>
              Tạo manifest MV cho <strong>{createdProject.project_id}</strong>, khóa
              người thật và ORIGINAL_FACE_COMPOSITE, rồi đưa kế hoạch vào trạng thái
              chờ duyệt. Bước này không render và không gọi nhà cung cấp.
            </p>
          </div>
          <button disabled={preparing} onClick={prepareMvProduction} type="button">
            {preparing ? "Đang lập kế hoạch…" : "Lập kế hoạch MV để duyệt"}
          </button>
        </section>
      )}
      {preparationResult && <pre className="creation-result">{preparationResult}</pre>}
      {createdProject?.next_action === "APPROVE_MV_PRODUCTION_PLAN" && (
        <section className="confirmation-panel">
          <div>
            <h2>Kế hoạch PRE_PRODUCTION đang chờ duyệt</h2>
            <p>
              Manifest đã được lập cho <strong>{createdProject.project_id}</strong>.
              Chưa có render hoặc lệnh gọi nhà cung cấp nào được phép chạy.
            </p>
          </div>
        </section>
      )}
    </form>
  );
}
