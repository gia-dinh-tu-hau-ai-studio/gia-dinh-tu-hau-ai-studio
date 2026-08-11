"use client";

import { useMemo, useState } from "react";

type ReelQc = {
  identity_locked: boolean;
  cinematic_setting: boolean;
  purposeful_action: boolean;
  emotional_arc: boolean;
  dialogue_lip_sync: boolean;
  voice_match: boolean;
  continuity: boolean;
  exact_duration_30s: boolean;
};

type EvaluationReel = {
  status: string;
  final_drive_file_id?: string;
  technical_evidence?: { duration_seconds: number; width: number; height: number; has_audio: boolean };
  tasks?: Array<{
    shot_id: string;
    character_id: string;
    performance_contract?: { required_beats?: string[] };
    technical_evidence?: { duration_seconds: number };
  }>;
  error?: { message?: string };
};

const emptyQc: ReelQc = {
  identity_locked: false,
  cinematic_setting: false,
  purposeful_action: false,
  emotional_arc: false,
  dialogue_lip_sync: false,
  voice_match: false,
  continuity: false,
  exact_duration_30s: false,
};

const qcLabels: Record<keyof ReelQc, string> = {
  identity_locked: "Đúng Character Master đã khóa trong toàn bộ ba shot",
  cinematic_setting: "Có bối cảnh phim thực tế; không phải nền xám hoặc phòng quay phỏng vấn",
  purposeful_action: "Nhân vật có hành động có mục đích, phù hợp nội dung thoại",
  emotional_arc: "Có diễn biến cảm xúc rõ, không chỉ đọc thoại trước máy quay",
  dialogue_lip_sync: "Khẩu hình khớp đúng câu thoại tiếng Việt",
  voice_match: "Đúng Voice Master, độ tuổi và chất giọng của nhân vật",
  continuity: "Trang phục, ánh sáng, hướng nhìn và không gian giữ continuity",
  exact_duration_30s: "Reel đủ 30 giây và mỗi shot đủ 10 giây",
};

export function EvaluationReelQcPanel({ projectId }: { projectId: string }) {
  const [reel, setReel] = useState<EvaluationReel | null>(null);
  const [qc, setQc] = useState<ReelQc>(emptyQc);
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [message, setMessage] = useState("");
  const technicalPassed = Boolean(
    reel?.technical_evidence
      && Math.abs(reel.technical_evidence.duration_seconds - 30) <= 0.25
      && reel.technical_evidence.width === 1920
      && reel.technical_evidence.height === 1080
      && reel.technical_evidence.has_audio,
  );
  const allQcPassed = useMemo(() => Object.values(qc).every(Boolean), [qc]);

  async function refresh() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/short-film/pilot/evaluation-reel/status`);
      const body = await response.json() as EvaluationReel;
      if (!response.ok) throw new Error(body.error?.message ?? "Chưa có reel đánh giá cho dự án này.");
      setReel(body);
      const evidence = body.technical_evidence;
      const durationsPassed = Boolean(
        evidence
          && Math.abs(evidence.duration_seconds - 30) <= 0.25
          && body.tasks?.length === 3
          && body.tasks.every((task) => task.technical_evidence && Math.abs(task.technical_evidence.duration_seconds - 10) <= 0.25),
      );
      setQc((current) => ({ ...current, exact_duration_30s: durationsPassed }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không đọc được trạng thái reel.");
    } finally {
      setLoading(false);
    }
  }

  async function review(decision: "APPROVE" | "REJECT") {
    if (decision === "APPROVE" && (!technicalPassed || !allQcPassed)) return;
    setReviewing(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/short-film/pilot/evaluation-reel/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, qc }),
      });
      const body = await response.json() as EvaluationReel;
      if (!response.ok) throw new Error(body.error?.message ?? "Không lưu được quyết định QC.");
      setReel(body);
      setMessage(decision === "APPROVE" ? "Đã duyệt reel diễn xuất." : "Đã yêu cầu sửa reel; sản xuất toàn phim vẫn bị khóa.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không lưu được quyết định QC.");
    } finally {
      setReviewing(false);
    }
  }

  return (
    <section className="confirmation-panel">
      <div>
        <h2>QC reel diễn xuất trước khi sản xuất toàn phim</h2>
        <p>Xem đủ ba shot, đánh dấu từng tiêu chí theo thứ tự. Nút duyệt chỉ mở khi bằng chứng kỹ thuật và toàn bộ tiêu chí đều đạt.</p>
        <button className="secondary-button" disabled={loading} onClick={() => void refresh()} type="button">
          {loading ? "Đang kiểm tra…" : "Kiểm tra reel mới nhất"}
        </button>
        {reel && (
          <div className="approval-gate">
            <strong>Trạng thái: {reel.status}</strong>
            {reel.technical_evidence && (
              <p className={technicalPassed ? "operation-success" : "operation-error"}>
                Thực tế: {reel.technical_evidence.duration_seconds.toFixed(2)} giây · {reel.technical_evidence.width}×{reel.technical_evidence.height} · {reel.technical_evidence.has_audio ? "có audio" : "thiếu audio"}
              </p>
            )}
            {reel.final_drive_file_id && (
              <video
                controls
                preload="metadata"
                style={{ width: "100%" }}
                src={`/api/projects/${encodeURIComponent(projectId)}/short-film/pilot/evaluation-reel/outputs/${encodeURIComponent(reel.final_drive_file_id)}`}
              />
            )}
            {reel.tasks?.map((task) => (
              <article className="account-check-results" key={task.shot_id}>
                <strong>{task.shot_id} · {task.character_id}</strong>
                <span>{task.technical_evidence ? `${task.technical_evidence.duration_seconds.toFixed(2)} giây` : "Chưa có bằng chứng thời lượng shot"}</span>
                <small>Nhịp diễn bắt buộc: {task.performance_contract?.required_beats?.join(" → ") ?? "chưa ghi nhận"}</small>
              </article>
            ))}
            <div className="approval-gate">
              {Object.entries(qcLabels).map(([key, label]) => (
                <label className="consent" key={key}>
                  <input
                    checked={qc[key as keyof ReelQc]}
                    disabled={reel.status !== "AWAITING_REEL_QC" || key === "exact_duration_30s"}
                    onChange={(event) => setQc((current) => ({ ...current, [key]: event.target.checked }))}
                    type="checkbox"
                  /> {label}
                </label>
              ))}
            </div>
            <div className="action-row">
              <button disabled={reviewing || reel.status !== "AWAITING_REEL_QC" || !technicalPassed || !allQcPassed} onClick={() => void review("APPROVE")} type="button">
                Duyệt reel và mở bước tiếp theo
              </button>
              <button className="secondary-button" disabled={reviewing || reel.status !== "AWAITING_REEL_QC"} onClick={() => void review("REJECT")} type="button">
                REQUEST_CHANGES — Chưa đạt
              </button>
            </div>
          </div>
        )}
        {message && <p className={message.startsWith("Đã") ? "operation-success" : "operation-error"}>{message}</p>}
      </div>
    </section>
  );
}
