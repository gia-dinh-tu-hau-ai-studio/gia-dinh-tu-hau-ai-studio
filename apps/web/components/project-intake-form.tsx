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

const projectTypes: Array<{ value: FormProjectType; label: string; description: string }> = [
  { value: "SHORT_FILM", label: "Phim ngắn / Web Drama", description: "Tập phim 10–15 phút, kết thúc trọn vẹn." },
  { value: "MUSIC_VIDEO", label: "MV ca nhạc", description: "MV đầy đủ, lyrics, music và vocal." },
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

function TextField({ name, label, required = true, type = "text" }: { name: string; label: string; required?: boolean; type?: string }) {
  return (
    <label>
      <span>{label}{required ? " *" : ""}</span>
      <input name={name} type={type} required={required} />
    </label>
  );
}

export function ProjectIntakeForm() {
  const [projectType, setProjectType] = useState<FormProjectType>("SHORT_FILM");
  const [eligibleCharacters, setEligibleCharacters] = useState<EligibleCharacter[]>([]);
  const [characters, setCharacters] = useState<CharacterSelection[]>([]);
  const [characterToAdd, setCharacterToAdd] = useState("");
  const [libraryMessage, setLibraryMessage] = useState("Đang đọc 11_CHARACTER_LIBRARY…");
  const [result, setResult] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

  useEffect(() => {
    void fetch(`${apiUrl}/v1/characters/eligible`)
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
  }, [apiUrl]);

  function addCharacter() {
    if (!characterToAdd || characters.some((item) => item.character_id === characterToAdd)) {
      return;
    }

    setCharacters((current) => [
      ...current,
      {
        character_id: characterToAdd,
        project_role: current.length === 0 ? "MAIN" : "SUPPORTING",
        performance_role: projectType === "SHORT_FILM" ? "ACTOR" : "SINGER",
        voice_required: false,
        lip_sync_required: false,
        identity_mode: "LIBRARY_MASTER",
        original_video_file_id: "",
      },
    ]);
  }

  function updateCharacter(index: number, patch: Partial<CharacterSelection>) {
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

    const form = new FormData(event.currentTarget);
    const payload = {
      ...Object.fromEntries(
        [...form.entries()].filter(([, value]) => String(value).trim() !== ""),
      ),
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
      const response = await fetch(`${apiUrl}/v1/intake/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      setResult(JSON.stringify(body, null, 2));
    } catch {
      setResult("Không kết nối được API. Hãy kiểm tra Docker hoặc tiến trình API.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <section>
        <div className="section-heading"><span>01</span><div><h2>Chọn loại dự án</h2><p>Chỉ chọn một loại. Dữ liệu nhánh ẩn không đi vào payload.</p></div></div>
        <div className="project-grid">
          {projectTypes.map((item) => (
            <label className={`project-card ${projectType === item.value ? "selected" : ""}`} key={item.value}>
              <input
                checked={projectType === item.value}
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
          <TextField name="project_subtype" label="Phân loại phụ" required={false} />
          <TextField name="priority" label="Mức ưu tiên" required={false} />
          <TextField name="execution_mode" label="Chế độ thực thi" required={false} />
          <TextField name="language" label="Ngôn ngữ" />
          <TextField name="content_rating" label="Độ tuổi nội dung" />
          <TextField name="target_audience" label="Khán giả mục tiêu" />
          <TextField name="duration_target" label="Thời lượng mục tiêu" />
          <TextField name="aspect_ratio" label="Tỷ lệ khung hình" />
        </div>
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
        <div className="section-heading"><span>04</span><div><h2>Nhân vật & vai trò</h2><p>Chỉ chọn từ 11_CHARACTER_LIBRARY; không cho nhập tên tự do.</p></div></div>
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
                  <button className="remove-button" onClick={() => setCharacters((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button">Xóa</button>
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

      <button disabled={submitting || characters.length === 0} type="submit">{submitting ? "Đang kiểm tra…" : "Kiểm tra payload"}</button>
      {result && <pre>{result}</pre>}
    </form>
  );
}
