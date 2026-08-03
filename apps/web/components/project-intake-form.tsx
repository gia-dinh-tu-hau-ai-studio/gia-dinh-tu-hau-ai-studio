"use client";

import { FormEvent, useState } from "react";

type FormProjectType = "SHORT_FILM" | "MUSIC_VIDEO" | "SHORT_MUSIC_CLIP";

const projectTypes: Array<{ value: FormProjectType; label: string; description: string }> = [
  { value: "SHORT_FILM", label: "Phim ngắn / Web Drama", description: "Tập phim 10–15 phút, kết thúc trọn vẹn." },
  { value: "MUSIC_VIDEO", label: "MV ca nhạc", description: "MV đầy đủ, lyrics, music và vocal." },
  { value: "SHORT_MUSIC_CLIP", label: "Clip ca nhạc ngắn", description: "Đoạn biểu diễn 30 giây–3 phút." },
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
  const [result, setResult] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setResult("");

    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(
      [...form.entries()].filter(([, value]) => String(value).trim() !== ""),
    );

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
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

      <button disabled={submitting} type="submit">{submitting ? "Đang kiểm tra…" : "Kiểm tra payload"}</button>
      {result && <pre>{result}</pre>}
    </form>
  );
}
