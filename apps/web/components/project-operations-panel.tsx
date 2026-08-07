"use client";

import { useState } from "react";

const DEFAULT_PROJECT_ID = "GDTH-MV-20260804092100-63D8";
const RP015_VERIFIED_VOCAL_MASTER_FILE_ID = "1k9sgXZfFwo42XY0Y0NoWKXUQ-CuA63M5";

type CleanVoiceReferenceResult = {
  project_id?: string;
  current_stage?: string;
  next_action?: string;
  job_status?: string;
  job_id?: string;
  manifest_file_url?: string;
  output_file_url?: string;
  proof_status?: string;
  layout_version?: string;
  has_audio?: boolean;
  cleaned_reference_status?: string;
  approval_status?: string;
  approved_at?: string;
  provider_execution_allowed?: boolean;
  render_allowed?: boolean;
  message?: string;
  code?: string;
  error_message?: string;
  result?: CleanVoiceReferenceResult;
};

const FINAL_PROOF_POLL_INTERVAL_MS = 5_000;
const FINAL_PROOF_POLL_LIMIT = 240;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export function ProjectOperationsPanel() {
  const [projectId, setProjectId] = useState(DEFAULT_PROJECT_ID);
  const [running, setRunning] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approvingPilot, setApprovingPilot] = useState(false);
  const [creatingProof, setCreatingProof] = useState(false);
  const [result, setResult] = useState<CleanVoiceReferenceResult | null>(null);
  const [error, setError] = useState("");

  async function prepareCleanVoiceReferences() {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId) return;

    setRunning(true);
    setResult(null);
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(normalizedProjectId)}/prepare-rp015-clean-voice-references`,
        { method: "POST" },
      );
      const body = (await response.json()) as CleanVoiceReferenceResult;
      setResult(body);
      if (!response.ok) {
        setError(body.message ?? body.code ?? "Không chuẩn hóa được Voice Reference RP015.");
      }
    } catch {
      setError(
        "Không kết nối được API. Hệ thống không tự động gửi lại để tránh tạo tác vụ trùng.",
      );
    } finally {
      setRunning(false);
    }
  }

  async function approveCleanVoiceReferences() {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId) return;

    setApproving(true);
    setResult(null);
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(normalizedProjectId)}/approve-rp015-clean-voice-references`,
        { method: "POST" },
      );
      const body = (await response.json()) as CleanVoiceReferenceResult;
      setResult(body);
      if (!response.ok) {
        setError(body.message ?? body.code ?? "Không duyệt được hai vocal stem Demucs RP015.");
      }
    } catch {
      setError("Không kết nối được API khi duyệt vocal stem RP015.");
    } finally {
      setApproving(false);
    }
  }

  async function approveVocalPilot() {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId) return;

    setApprovingPilot(true);
    setResult(null);
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(normalizedProjectId)}/approve-rp015-vocal-pilot`,
        { method: "POST" },
      );
      const body = (await response.json()) as CleanVoiceReferenceResult;
      setResult(body);
      if (!response.ok) {
        setError(body.message ?? body.code ?? "Không duyệt được hai Voice Reference Pilot RP015.");
      }
    } catch {
      setError("Không kết nối được API khi duyệt Voice Reference Pilot RP015.");
    } finally {
      setApprovingPilot(false);
    }
  }

  async function createFinalProofV4() {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId) return;

    setCreatingProof(true);
    setResult(null);
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(normalizedProjectId)}/create-rp015-final-proof`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            vocal_master_file_id: RP015_VERIFIED_VOCAL_MASTER_FILE_ID,
          }),
        },
      );
      const body = (await response.json()) as CleanVoiceReferenceResult;
      setResult(body);
      if (!response.ok) {
        setError(body.message ?? body.code ?? "Không tạo được Final Proof V4 RP015.");
        return;
      }

      if (body.job_status === "SUCCEEDED") return;

      for (let attempt = 0; attempt < FINAL_PROOF_POLL_LIMIT; attempt += 1) {
        await wait(FINAL_PROOF_POLL_INTERVAL_MS);
        const statusResponse = await fetch(
          `/api/projects/${encodeURIComponent(normalizedProjectId)}/rp015-final-proof-status`,
          { method: "GET", cache: "no-store" },
        );
        const status = (await statusResponse.json()) as CleanVoiceReferenceResult;
        setResult(status);
        if (!statusResponse.ok) {
          setError(status.message ?? status.code ?? "Không đọc được trạng thái Final Proof V4 RP015.");
          return;
        }
        if (status.job_status === "SUCCEEDED") return;
        if (status.job_status === "FAILED") {
          setError(status.error_message ?? "Final Proof V4 RP015 thất bại.");
          return;
        }
      }

      setError("Final Proof V4 vẫn đang chạy. Có thể bấm lại để tiếp tục theo dõi cùng job, không tạo job trùng.");
    } catch {
      setError(
        "Mất kết nối khi theo dõi Final Proof V4. Có thể bấm lại; API sẽ trả về job đang chạy thay vì tạo trùng.",
      );
    } finally {
      setCreatingProof(false);
    }
  }

  return (
    <section className="operations-panel" aria-labelledby="project-operations-title">
      <div className="section-heading">
        <span>05</span>
        <div>
          <h2 id="project-operations-title">Vận hành dự án hiện hữu</h2>
          <p>
            Tách hai vocal stem RP015 bằng Demucs htdemucs_ft trên CPU. Tác vụ có thể
            mất đến 10 phút; không gọi Suno, Kits AI, Runway và không mở render tổng.
          </p>
        </div>
      </div>

      <div className="character-picker">
        <label>
          <span>Project ID *</span>
          <input
            aria-label="Project ID vận hành"
            onChange={(event) => {
              setProjectId(event.target.value);
              setResult(null);
              setError("");
            }}
            type="text"
            value={projectId}
          />
        </label>
        <button
          disabled={running || !projectId.trim()}
          onClick={prepareCleanVoiceReferences}
          type="button"
        >
          {running ? "Đang tách stem Demucs…" : "Tách 2 vocal stem RP015 bằng Demucs"}
        </button>
        <button
          disabled={running || approving || approvingPilot || creatingProof || !projectId.trim()}
          onClick={approveCleanVoiceReferences}
          type="button"
        >
          {approving ? "Đang ghi phê duyệt…" : "Duyệt 2 vocal stem Demucs RP015"}
        </button>
        <button
          disabled={running || approving || approvingPilot || creatingProof || !projectId.trim()}
          onClick={approveVocalPilot}
          type="button"
        >
          {approvingPilot ? "Đang ghi phê duyệt Pilot…" : "Duyệt 2 Voice Reference Pilot RP015"}
        </button>
        <button
          disabled={running || approving || approvingPilot || creatingProof || !projectId.trim()}
          onClick={createFinalProofV4}
          type="button"
        >
          {creatingProof ? "Đang theo dõi Final Proof V4…" : "Chạy Final Proof V4 RP015"}
        </button>
      </div>

      <p className="library-status">
        Sau khi nghe xác nhận hết nhạc nền, cổng duyệt chuyển sang
        PREPARE_RP015_VOICE_CONVERSION_PILOT. Final Proof V4 dùng Vocal Master đã kiểm chứng;
        provider và render tổng vẫn khóa.
      </p>

      {error && <p className="operation-error" role="alert">{error}</p>}
      {result && (
        <div className="operation-result">
          <pre>{JSON.stringify(result, null, 2)}</pre>
          {(result.result?.output_file_url ?? result.output_file_url) && (
            <a href={result.result?.output_file_url ?? result.output_file_url} rel="noreferrer" target="_blank">
              Mở Final Proof V4 RP015 trên Drive
            </a>
          )}
          {result.manifest_file_url && (
            <a href={result.manifest_file_url} rel="noreferrer" target="_blank">
              Mở manifest và hai Voice Reference sạch trên Drive
            </a>
          )}
        </div>
      )}
    </section>
  );
}
