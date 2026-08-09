"use client";

import { FormEvent, useEffect, useState, type FocusEvent } from "react";
import { calculateSuggestedProviderBudget, type ProviderBudgetPlan, type ShortFilmWorkflow } from "@tu-hau/contracts";
import { createInitialShortFilmWorkflow, ShortFilmWorkflowForm } from "./short-film-workflow-form";

type FormProjectType = "SHORT_FILM" | "MUSIC_VIDEO" | "SHORT_MUSIC_CLIP";
type IdentityMode = "LIBRARY_MASTER" | "ORIGINAL_FACE_COMPOSITE";

type EligibleCharacter = {
  character_id: string;
  character_name: string;
  character_type: string;
  default_costume_id: string;
  voice_available: boolean;
  face_reference_url: string;
  body_reference_url: string;
  master_identity_id?: string;
  master_identity_version?: string;
  voice_master_id?: string;
  voice_casting_profile?: string;
  readiness: {
    character: "ACTIVE";
    image: "IMAGE_READY";
    legal: "LEGAL_CLEARED";
    master_identity: "APPROVED_LOCKED" | "NOT_READY";
    voice_master: "APPROVED_LOCKED" | "NOT_READY";
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

type ReferenceSource = {
  platform: "YOUTUBE" | "TIKTOK" | "FACEBOOK";
  url: string;
  usage_mode: "INSPIRATION_ONLY" | "STRUCTURE_REFERENCE" | "AUTHORIZED_ADAPTATION";
  rights_confirmed: boolean;
  notes: string;
};

type IntakeDraft = {
  version: 1;
  form_values: Record<string, string[]>;
  reference_sources: ReferenceSource[];
  short_film_workflow: ShortFilmWorkflow;
  characters: CharacterSelection[];
  provider_budget: ProviderBudgetPlan;
  duration_target: string;
  saved_at: string;
};

const INTAKE_DRAFT_PREFIX = "tuhauai:intake-draft:v1:";
const INPUT_HISTORY_KEY = "tuhauai:input-history:v1";
const INPUT_HISTORY_LIMIT = 12;

const initialProviderBudget: ProviderBudgetPlan = {
  internal_services: {
    post_production: "TUHAUAI_FFMPEG_CLOUD_RUN",
    music_source: "NOT_SELECTED",
  },
  providers: {
    script: "OPENAI_RESPONSES",
    video: "RUNWAY",
    voice: "ELEVENLABS",
    lip_sync: "SYNC",
  },
  estimate: {
    basis_version: "TUHAUAI_BUDGET_2026-08-09",
    estimated_duration_seconds: 300,
    currency: "USD",
    script: 1,
    video: 54,
    voice: 2.1,
    lip_sync: 5.25,
    contingency: 12.47,
    total: 74.82,
  },
  approval: {
    decision: "PENDING",
    approved_limit: 0,
    reviewer: "PROJECT_OWNER",
  },
};

type CreatedProject = {
  project_id: string;
  current_stage: "CONTRACT" | "PRE_PRODUCTION";
  next_action:
    | "APPROVE_CONTRACT"
    | "PREPARE_MV_PRODUCTION"
    | "APPROVE_MV_PRODUCTION_PLAN"
    | "PREPARE_MV_ASSETS"
    | "APPROVE_MV_ASSETS"
    | "PREPARE_MV_SHOT_PLAN"
    | "APPROVE_MV_SHOT_PLAN"
    | "REVIEW_SHORT_FILM_SCRIPT"
    | "PREPARE_SHORT_FILM_SHOT_PLAN"
    | "LOCK_SHORT_FILM_PRODUCTION_READINESS"
    | "PREPARE_SHORT_FILM_PILOT"
    | "REVIEW_SHORT_FILM_PILOT"
    | "PRODUCE_SHORT_FILM"
    | "REVIEW_SHORT_FILM_FINAL"
    | "READY_TO_PUBLISH"
    | "SCRIPT_REJECTED";
};

type ProjectProgress = {
  project_id: string;
  project_name: string;
  project_type: string;
  current_stage: string;
  next_action: string;
  updated_at: string;
  percent_complete: number;
  completed_steps: number;
  total_steps: number;
  milestones: Array<{ action: string; label: string; status: "COMPLETED" | "CURRENT" | "PENDING" }>;
};

type AccountPreflight = {
  checked_at: string;
  execution_gate: "READY" | "BLOCKED" | "MANUAL_CONFIRMATION_REQUIRED";
  providers: Array<{ provider: string; status: string; required_units?: number; available_units?: number; unit?: string; message: string }>;
};

const projectTypes: Array<{ value: FormProjectType; label: string; description: string }> = [
  { value: "SHORT_FILM", label: "Phim ngắn / Web Drama", description: "Kịch bản, nhân vật, thoại, pilot và phim hoàn chỉnh." },
  { value: "MUSIC_VIDEO", label: "MV âm nhạc", description: "Bài hát, giọng hát, hình ảnh và kế hoạch sản xuất MV." },
  { value: "SHORT_MUSIC_CLIP", label: "Clip âm nhạc ngắn", description: "Video dọc ngắn cho TikTok, Reels hoặc Shorts." },
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

function TextField({ name, label, required = true, type = "text", placeholder, help }: { name: string; label: string; required?: boolean; type?: string; placeholder?: string; help?: string }) {
  return (
    <label>
      <span>{label}{required ? " *" : ""}</span>
      <input name={name} type={type} required={required} placeholder={placeholder} />
      {help && <small className="field-help">Ví dụ: {help}</small>}
    </label>
  );
}

function SelectField({ name, label, options }: { name: string; label: string; options: Array<[string, string]> }) {
  return <label><span>{label} *</span><select name={name} required defaultValue=""><option value="" disabled>Chọn một phương án</option>{options.map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select></label>;
}

function ResultDetails({ value }: { value: string }) {
  return <details className="result-details"><summary>Xem chi tiết kỹ thuật</summary><pre>{value}</pre></details>;
}

function accountAction(status: string) {
  if (status === "INSUFFICIENT") return "Nạp thêm credit hoặc giảm thời lượng/dịch vụ rồi kiểm tra lại.";
  if (status === "NOT_CONFIGURED") return "Cấu hình API key/secret của đúng nhà cung cấp.";
  if (status === "AUTH_ERROR") return "Tạo hoặc lưu lại API key hợp lệ và kiểm tra quyền đọc tài khoản.";
  if (status === "UNVERIFIED") return "Thử lại; nếu vẫn lỗi, mở trang Billing của nhà cung cấp để kiểm tra thủ công.";
  if (status === "SUFFICIENT") return "Không cần xử lý.";
  return "Báo quản trị hệ thống kèm mã HTTP hiển thị ở trên.";
}

export function ProjectIntakeForm() {
  const [projectType, setProjectType] = useState<FormProjectType>("SHORT_FILM");
  const [projectStarted, setProjectStarted] = useState(false);
  const [referenceSources, setReferenceSources] = useState<ReferenceSource[]>([]);
  const [shortFilmWorkflow, setShortFilmWorkflow] = useState<ShortFilmWorkflow>(createInitialShortFilmWorkflow);
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
  const [approvingPlan, setApprovingPlan] = useState(false);
  const [planApprovalResult, setPlanApprovalResult] = useState<string>("");
  const [instrumentalMasterFileId, setInstrumentalMasterFileId] = useState("");
  const [preparingAssets, setPreparingAssets] = useState(false);
  const [assetPreparationResult, setAssetPreparationResult] = useState("");
  const [approvingAssets, setApprovingAssets] = useState(false);
  const [assetApprovalResult, setAssetApprovalResult] = useState("");
  const [preparingShotPlan, setPreparingShotPlan] = useState(false);
  const [shotPlanPreparationResult, setShotPlanPreparationResult] = useState("");
  const [savingShortFilm, setSavingShortFilm] = useState(false);
  const [shortFilmSaveResult, setShortFilmSaveResult] = useState("");
  const [generatingScript, setGeneratingScript] = useState(false);
  const [shortFilmProviderStatus, setShortFilmProviderStatus] = useState<Record<string, { configured: boolean }>>({});
  const [providerBudget, setProviderBudget] = useState<ProviderBudgetPlan>(initialProviderBudget);
  const [durationTarget, setDurationTarget] = useState("5_MINUTES");
  const [progressProjectId, setProgressProjectId] = useState("");
  const [projectProgress, setProjectProgress] = useState<ProjectProgress | null>(null);
  const [progressMessage, setProgressMessage] = useState("");
  const [checkingProgress, setCheckingProgress] = useState(false);
  const [draftFormValues, setDraftFormValues] = useState<Record<string, string[]> | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState("");
  const [inputHistory, setInputHistory] = useState<Record<string, string[]>>({});
  const [accountPreflight, setAccountPreflight] = useState<AccountPreflight | null>(null);
  const [checkingAccounts, setCheckingAccounts] = useState(false);
  const [manualBalanceConfirmed, setManualBalanceConfirmed] = useState(false);

  const budgetApproved = providerBudget.approval.decision === "APPROVE" &&
    Boolean(providerBudget.approval.reviewed_at) &&
    providerBudget.approval.approved_limit >= providerBudget.estimate.total;
  const accountExecutionReady = accountPreflight?.execution_gate === "READY" ||
    (accountPreflight?.execution_gate === "MANUAL_CONFIRMATION_REQUIRED" && manualBalanceConfirmed);
  const providerRunReady = budgetApproved && accountExecutionReady;

  function approveBudget() {
    setProviderBudget((current) => ({
      ...current,
      approval: {
        ...current.approval,
        decision: "APPROVE",
        approved_limit: Math.max(current.approval.approved_limit, current.estimate.total),
        reviewed_at: new Date().toISOString(),
      },
    }));
    invalidateConfirmation();
  }

  async function checkAccounts() {
    setCheckingAccounts(true);
    setAccountPreflight(null);
    setManualBalanceConfirmed(false);
    try {
      const response = await fetch("/api/short-film/providers/account-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_type: projectType, duration_seconds: providerBudget.estimate.estimated_duration_seconds, providers: providerBudget.providers }),
      });
      const body = await response.json();
      const errorDetail = [body.code, typeof body.message === "string" ? body.message : undefined].filter(Boolean).join(" · ");
      setAccountPreflight(response.ok ? body as AccountPreflight : { checked_at: new Date().toISOString(), execution_gate: "BLOCKED", providers: [{ provider: "SYSTEM", status: `HTTP_${response.status}`, message: errorDetail || "Không kiểm tra được tài khoản. Hãy thử lại; nếu lỗi lặp lại, báo quản trị hệ thống." }] });
    } catch {
      setAccountPreflight({ checked_at: new Date().toISOString(), execution_gate: "BLOCKED", providers: [{ provider: "SYSTEM", status: "ERROR", message: "Không kết nối được dịch vụ kiểm tra tài khoản." }] });
    } finally {
      setCheckingAccounts(false);
    }
  }

  useEffect(() => {
    const durationSeconds = ({
      "15_SECONDS": 15,
      "30_SECONDS": 30,
      "60_SECONDS": 60,
      "3_MINUTES": 180,
      "5_MINUTES": 300,
      "7_MINUTES": 420,
      "10_MINUTES": 600,
      "15_MINUTES": 900,
    } as Record<string, number>)[durationTarget] ?? 300;
    setAccountPreflight(null);
    setManualBalanceConfirmed(false);
    setProviderBudget((current) => {
      const estimate = calculateSuggestedProviderBudget({ project_type: projectType, duration_seconds: durationSeconds, providers: current.providers });
      if (estimate.total === current.estimate.total && estimate.estimated_duration_seconds === current.estimate.estimated_duration_seconds) return current;
      return { ...current, estimate, approval: { ...current.approval, decision: "PENDING", approved_limit: estimate.total, reviewed_at: undefined } };
    });
  }, [durationTarget, projectType, providerBudget.providers.script, providerBudget.providers.video, providerBudget.providers.voice, providerBudget.providers.lip_sync]);

  async function checkProjectProgress(projectIdOverride?: string) {
    const projectId = (projectIdOverride ?? progressProjectId).trim();
    if (!projectId) {
      setProgressMessage("Nhập mã dự án để kiểm tra tiến độ.");
      return;
    }
    setCheckingProgress(true);
    setProgressMessage("");
    setProjectProgress(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/progress`);
      const body = await response.json();
      if (!response.ok) {
        setProgressMessage(body.message ?? body.code ?? "Không đọc được tiến độ dự án.");
        return;
      }
      setProjectProgress(body as ProjectProgress);
      setProgressProjectId(projectId);
    } catch {
      setProgressMessage("Không kết nối được kho dự án TuhauAI.");
    } finally {
      setCheckingProgress(false);
    }
  }

  function invalidateConfirmation() {
    setValidatedSubmission(null);
    setCreationResult("");
  }

  function collectFormValues(form: HTMLFormElement) {
    const values: Record<string, string[]> = {};
    for (const [name, value] of new FormData(form).entries()) {
      if (typeof value !== "string" || name === "project_type" || name === "project_subtype") continue;
      (values[name] ??= []).push(value);
    }
    return values;
  }

  function rememberInput(event: FocusEvent<HTMLFormElement>) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.name || !["text", "email", "tel", "url"].includes(input.type)) return;
    const value = input.value.trim();
    if (value.length < 2 || value.length > 240) return;
    setInputHistory((current) => {
      const previous = current[input.name] ?? [];
      const nextValues = [value, ...previous.filter((item) => item.localeCompare(value, "vi", { sensitivity: "base" }) !== 0)].slice(0, INPUT_HISTORY_LIMIT);
      const next = { ...current, [input.name]: nextValues };
      localStorage.setItem(INPUT_HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }

  function saveDraft(form: HTMLFormElement) {
    if (!projectStarted) return;
    const draft: IntakeDraft = {
      version: 1,
      form_values: collectFormValues(form),
      reference_sources: referenceSources,
      short_film_workflow: shortFilmWorkflow,
      characters,
      provider_budget: providerBudget,
      duration_target: durationTarget,
      saved_at: new Date().toISOString(),
    };
    localStorage.setItem(`${INTAKE_DRAFT_PREFIX}${projectType}`, JSON.stringify(draft));
    setDraftSavedAt(draft.saved_at);
  }

  function startProject(type: FormProjectType) {
    setProjectType(type);
    const fallbackDuration = type === "SHORT_MUSIC_CLIP" ? "30_SECONDS" : "5_MINUTES";
    try {
      const stored = localStorage.getItem(`${INTAKE_DRAFT_PREFIX}${type}`);
      if (stored) {
        const draft = JSON.parse(stored) as IntakeDraft;
        if (draft.version === 1) {
          setReferenceSources(draft.reference_sources ?? []);
          setShortFilmWorkflow(draft.short_film_workflow ?? createInitialShortFilmWorkflow());
          setCharacters(draft.characters ?? []);
          setProviderBudget(draft.provider_budget ?? initialProviderBudget);
          setDurationTarget(draft.duration_target ?? fallbackDuration);
          setDraftFormValues(draft.form_values ?? {});
          setDraftSavedAt(draft.saved_at ?? "");
        }
      } else {
        setDurationTarget(fallbackDuration);
        setDraftFormValues(null);
        setDraftSavedAt("");
      }
    } catch {
      setDurationTarget(fallbackDuration);
      setDraftFormValues(null);
      setDraftSavedAt("");
    }
    setProjectStarted(true);
  }

  useEffect(() => {
    if (!projectStarted || !draftFormValues) return;
    const form = document.querySelector<HTMLFormElement>("form[data-intake-form]");
    if (!form) return;
    for (const element of Array.from(form.elements)) {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) || !element.name) continue;
      const values = draftFormValues[element.name];
      if (!values) continue;
      if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
        element.checked = values.includes(element.value);
      } else if (element.name !== "duration_target") {
        element.value = values[0] ?? "";
      }
    }
    setDraftFormValues(null);
  }, [projectStarted, draftFormValues]);

  useEffect(() => {
    if (!projectStarted || draftFormValues) return;
    const form = document.querySelector<HTMLFormElement>("form[data-intake-form]");
    if (form) saveDraft(form);
  }, [projectStarted, referenceSources, shortFilmWorkflow, characters, providerBudget, durationTarget]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(INPUT_HISTORY_KEY);
      if (stored) setInputHistory(JSON.parse(stored) as Record<string, string[]>);
    } catch {
      setInputHistory({});
    }
  }, []);

  useEffect(() => {
    if (!projectStarted) return;
    const form = document.querySelector<HTMLFormElement>("form[data-intake-form]");
    if (!form) return;
    for (const input of Array.from(form.querySelectorAll<HTMLInputElement>('input[name][type="text"], input[name][type="email"], input[name][type="tel"], input[name][type="url"]'))) {
      input.setAttribute("list", `history-${input.name.replace(/[^a-zA-Z0-9_-]/g, "-")}`);
      input.setAttribute("autocomplete", "off");
    }
  }, [projectStarted, projectType, inputHistory]);

  useEffect(() => {
    void fetch("/api/characters/eligible")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.message ?? body.code ?? "Không đọc được thư viện nhân vật");
        }
        const approvedCharacters = (body as EligibleCharacter[]).filter(
          (character) => character.readiness.master_identity === "APPROVED_LOCKED",
        );
        setEligibleCharacters(approvedCharacters);
        setCharacterToAdd(approvedCharacters[0]?.character_id ?? "");
        setLibraryMessage(
          approvedCharacters.length > 0
            ? `${approvedCharacters.length} nhân vật có Character Master APPROVED + LOCKED.`
            : "Chưa có Character Master APPROVED + LOCKED.",
        );
      })
      .catch((error: unknown) => {
        setLibraryMessage(error instanceof Error ? error.message : "Không đọc được thư viện nhân vật");
      });
  }, []);

  useEffect(() => {
    void fetch("/api/short-film/providers/status")
      .then((response) => response.json())
      .then((body) => setShortFilmProviderStatus(body.providers ?? {}))
      .catch(() => setShortFilmProviderStatus({}));
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
        performance_role: "ACTOR",
        voice_required: false,
        lip_sync_required: false,
        identity_mode: "LIBRARY_MASTER",
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

    const incompleteReference = referenceSources.find(
      (source) => !source.url.trim() || !source.rights_confirmed,
    );
    if (incompleteReference) {
      setResult("Vui lòng nhập URL và xác nhận quyền sử dụng cho từng link tham khảo.");
      setSubmitting(false);
      return;
    }

    const form = new FormData(event.currentTarget);
    const payload = {
      ...Object.fromEntries(
        [...form.entries()].filter(([, value]) => String(value).trim() !== ""),
      ),
      platforms: form.getAll("platforms").map(String),
      reference_sources: referenceSources.filter((source) => source.url.trim()),
      provider_budget: providerBudget,
      short_film_workflow: projectType === "SHORT_FILM" ? shortFilmWorkflow : undefined,
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
        setProgressProjectId(body.project.project_id);
        void checkProjectProgress(body.project.project_id);
      }
    } catch {
      setCreationResult("Không kết nối được kho dự án TuhauAI. Không tự động gửi lại để tránh tạo trùng dự án.");
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

  async function saveShortFilmWorkflow() {
    if (!createdProject) return;
    setSavingShortFilm(true);
    setShortFilmSaveResult("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(createdProject.project_id)}/short-film/workflow`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workflow: shortFilmWorkflow }),
      });
      const body = await response.json();
      setShortFilmSaveResult(JSON.stringify(body, null, 2));
      if (response.ok && typeof body.next_action === "string") {
        setCreatedProject({ ...createdProject, next_action: body.next_action as CreatedProject["next_action"] });
      }
    } catch {
      setShortFilmSaveResult("Không lưu được SHORT_FILM workflow. Không tự gửi lại để tránh ghi lặp approval.");
    } finally {
      setSavingShortFilm(false);
    }
  }

  async function generateShortFilmScript() {
    const incompleteReference = referenceSources.find(
      (source) => !source.url.trim() || !source.rights_confirmed,
    );
    if (incompleteReference) {
      setShortFilmSaveResult("Vui lòng nhập URL và xác nhận quyền sử dụng cho từng link trước khi gọi AI tạo kịch bản.");
      return;
    }
    setGeneratingScript(true);
    setShortFilmSaveResult("");
    try {
      const response = await fetch("/api/short-film/scripts/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idea: shortFilmWorkflow.idea_brief,
          target_duration_minutes: shortFilmWorkflow.target_duration_minutes,
          language: shortFilmWorkflow.dialogue.language,
          characters: shortFilmWorkflow.film_characters,
          reference_sources: referenceSources,
          provider_budget: providerBudget,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setShortFilmSaveResult(JSON.stringify(body, null, 2));
        return;
      }
      setShortFilmWorkflow({
        ...shortFilmWorkflow,
        script_source: "AI_DEVELOPED_FROM_IDEA",
        script_title: body.draft.title,
        script_synopsis: body.draft.synopsis,
        full_script: body.draft.full_script,
        script_generation: {
          provider: body.provider,
          model: body.model,
          provider_request_id: body.provider_request_id,
          generated_at: body.generated_at,
          usage: body.usage,
        },
        script_review: { decision: "PENDING", notes: "Bản nháp AI mới, chờ chủ dự án review.", reviewer: "PROJECT_OWNER" },
      });
      invalidateConfirmation();
      setShortFilmSaveResult(`Đã nhận bản nháp từ ${body.provider}/${body.model}. SCRIPT_APPROVED vẫn đang khóa.`);
    } catch {
      setShortFilmSaveResult("Không kết nối được provider kịch bản. Chưa tạo hoặc lưu bản nháp.");
    } finally {
      setGeneratingScript(false);
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

  async function approveMvProductionPlan() {
    if (!createdProject) {
      return;
    }

    setApprovingPlan(true);
    setPlanApprovalResult("");
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(createdProject.project_id)}/approve-mv-production-plan`,
        { method: "POST" },
      );
      const body = await response.json();
      setPlanApprovalResult(JSON.stringify(body, null, 2));
      if (response.ok && body.approval_status === "APPROVED") {
        setCreatedProject({
          project_id: body.project_id,
          current_stage: body.current_stage,
          next_action: body.next_action,
        });
      }
    } catch {
      setPlanApprovalResult(
        "Không kết nối được kho dự án. Không tự động gửi lại để tránh ghi lặp sự kiện duyệt kế hoạch.",
      );
    } finally {
      setApprovingPlan(false);
    }
  }

  async function prepareMvAssets() {
    if (!createdProject || !instrumentalMasterFileId.trim()) return;

    setPreparingAssets(true);
    setAssetPreparationResult("");
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(createdProject.project_id)}/prepare-mv-assets`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instrumental_master_file_id: instrumentalMasterFileId.trim(),
          }),
        },
      );
      const body = await response.json();
      setAssetPreparationResult(JSON.stringify(body, null, 2));
      if (response.ok && body.approval_status === "PENDING") {
        setCreatedProject({
          project_id: body.project_id,
          current_stage: body.current_stage,
          next_action: body.next_action,
        });
      }
    } catch {
      setAssetPreparationResult(
        "Không kết nối được kho dự án. Không tự động gửi lại để tránh ghi lặp manifest tài sản.",
      );
    } finally {
      setPreparingAssets(false);
    }
  }

  async function approveMvAssets() {
    if (!createdProject) return;

    setApprovingAssets(true);
    setAssetApprovalResult("");
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(createdProject.project_id)}/approve-mv-assets`,
        { method: "POST" },
      );
      const body = await response.json();
      setAssetApprovalResult(JSON.stringify(body, null, 2));
      if (response.ok && body.approval_status === "APPROVED") {
        setCreatedProject({
          project_id: body.project_id,
          current_stage: body.current_stage,
          next_action: body.next_action,
        });
      }
    } catch {
      setAssetApprovalResult(
        "Không kết nối được kho dự án. Không tự động gửi lại để tránh ghi lặp sự kiện duyệt tài sản.",
      );
    } finally {
      setApprovingAssets(false);
    }
  }

  async function prepareMvShotPlan() {
    if (!createdProject) return;

    setPreparingShotPlan(true);
    setShotPlanPreparationResult("");
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(createdProject.project_id)}/prepare-mv-shot-plan`,
        { method: "POST" },
      );
      const body = await response.json();
      setShotPlanPreparationResult(JSON.stringify(body, null, 2));
      if (response.ok && body.approval_status === "PENDING") {
        setCreatedProject({
          project_id: body.project_id,
          current_stage: body.current_stage,
          next_action: body.next_action,
        });
      }
    } catch {
      setShotPlanPreparationResult(
        "Không kết nối được kho dự án. Không tự động gửi lại để tránh ghi lặp shot plan.",
      );
    } finally {
      setPreparingShotPlan(false);
    }
  }

  return (
    <form data-intake-form onBlur={rememberInput} onChange={(event) => { invalidateConfirmation(); saveDraft(event.currentTarget); }} onInput={(event) => saveDraft(event.currentTarget)} onSubmit={handleSubmit}>
      {Object.entries(inputHistory).map(([name, values]) => <datalist id={`history-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}`} key={name}>{values.map((value) => <option key={value} value={value} />)}</datalist>)}
      {!projectStarted && <section className="project-gateway">
        <div className="section-heading"><span>01</span><div><h2>Chọn loại dự án</h2><p>Chỉ chọn một loại. Dữ liệu nhánh ẩn không đi vào payload.</p></div></div>
        <div className="project-grid">
          {projectTypes.map((item) => (
            <button className={`project-card ${projectType === item.value ? "selected" : ""}`} key={item.value} onClick={() => startProject(item.value)} type="button">
              <strong>{item.label}</strong>
              <small>{item.description}</small>
              <span>Bắt đầu →</span>
            </button>
          ))}
        </div>
      </section>}

      {!projectStarted && <section className="progress-lookup">
        <div className="section-heading"><span>↻</span><div><h2>Kiểm tra tiến độ dự án</h2><p>Nhập mã dự án để xem phần trăm hoàn thành, giai đoạn hiện tại và bước đang chờ duyệt.</p></div></div>
        <div className="progress-search"><label><span>Mã dự án</span><input placeholder="Ví dụ: GDTH-FILM-20260809150000-ABCD" value={progressProjectId} onChange={(event) => setProgressProjectId(event.target.value)} /></label><button disabled={checkingProgress || !progressProjectId.trim()} type="button" onClick={() => void checkProjectProgress()}>{checkingProgress ? "Đang kiểm tra…" : "Kiểm tra tiến độ"}</button></div>
        {progressMessage && <p className="operation-error">{progressMessage}</p>}
        {projectProgress && <div className="progress-result">
          <header><div><strong>{projectProgress.project_name}</strong><small>{projectProgress.project_id}</small></div><b>{projectProgress.percent_complete}%</b></header>
          <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={projectProgress.percent_complete}><span style={{ width: `${projectProgress.percent_complete}%` }} /></div>
          <p>Giai đoạn: <strong>{projectProgress.current_stage}</strong> · Bước tiếp theo: <strong>{projectProgress.next_action}</strong></p>
          <ol>{projectProgress.milestones.map((milestone) => <li className={milestone.status.toLowerCase()} key={milestone.action}><span>{milestone.status === "COMPLETED" ? "✓" : milestone.status === "CURRENT" ? "●" : "○"}</span><div><strong>{milestone.label}</strong><small>{milestone.status === "CURRENT" ? "Đang thực hiện/chờ duyệt" : milestone.status === "COMPLETED" ? "Đã hoàn thành" : "Chưa bắt đầu"}</small></div></li>)}</ol>
        </div>}
      </section>}

      {projectStarted && <>
      <input name="project_type" type="hidden" value={projectType} />
      <div className="wizard-bar"><button className="secondary-button" type="button" onClick={() => setProjectStarted(false)}>← Đổi loại dự án</button><strong>{projectTypes.find((item) => item.value === projectType)?.label}</strong><small>{draftSavedAt ? "Đã tự động lưu nháp trên thiết bị này" : "Nội dung sẽ tự động lưu trên thiết bị này"}</small></div>

      <section>
        <div className="section-heading"><span>02</span><div><h2>Thông tin cơ bản</h2><p>Chọn nhanh theo gợi ý; các trường kỹ thuật đã được ẩn.</p></div></div>
        <div className="field-grid">
          <TextField name="project_name" label="Tên dự án" placeholder="Tập 01 – Bữa cơm gia đình" help="Tập 01 – Bữa cơm gia đình" />
          <TextField name="client_name" label="Người phụ trách" placeholder="Nguyễn Văn A" help="Tên người tạo dự án" />
          <TextField name="phone" label="Số điện thoại" type="tel" placeholder="0901 234 567" />
          <TextField name="email" label="Email" type="email" placeholder="tuhau@example.com" />
          <input name="project_subtype" type="hidden" value={projectType} />
          <input name="priority" type="hidden" value="NORMAL" />
          <input name="execution_mode" type="hidden" value="APPROVAL_GATED" />
          <SelectField name="language" label="Ngôn ngữ" options={[["vi-VN", "Tiếng Việt"], ["vi-VN-southwest", "Tiếng Việt – giọng miền Tây"], ["en", "Tiếng Anh"]]} />
          <SelectField name="content_rating" label="Độ tuổi phù hợp" options={[["ALL", "Mọi độ tuổi"], ["13+", "Từ 13 tuổi"], ["16+", "Từ 16 tuổi"], ["18+", "Từ 18 tuổi"]]} />
          <SelectField name="target_audience" label="Khán giả chính" options={[["FAMILY", "Gia đình"], ["YOUTH", "Người trẻ"], ["GENERAL", "Đại chúng"], ["SOUTHWEST_VIETNAM", "Khán giả miền Tây"]]} />
          <fieldset className="duration-picker"><legend>Thời lượng *</legend><div>{(projectType === "SHORT_MUSIC_CLIP" ? [["15_SECONDS", "15 giây"], ["30_SECONDS", "30 giây"], ["60_SECONDS", "60 giây"]] : [["3_MINUTES", "3 phút"], ["5_MINUTES", "5 phút"], ["7_MINUTES", "7 phút"], ["10_MINUTES", "10 phút"], ["15_MINUTES", "15 phút"]]).map(([value, text]) => <label className={durationTarget === value ? "selected" : ""} key={value}><input checked={durationTarget === value} name="duration_target" onChange={() => setDurationTarget(value)} required type="radio" value={value} /><span>{text}</span></label>)}</div><small>Chạm trực tiếp vào thời lượng mong muốn; dự toán sẽ tự tính lại.</small></fieldset>
          <SelectField name="aspect_ratio" label="Khung hình" options={[["9:16", "Dọc 9:16 – TikTok/Reels/Shorts"], ["16:9", "Ngang 16:9 – YouTube/Facebook"], ["1:1", "Vuông 1:1"]]} />
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
        <div className="section-heading"><span>03</span><div><h2>Video tham khảo</h2><p>Dán tối đa 5 link công khai. Hệ thống chỉ học cấu trúc/phong cách, không sao chép nguyên bản nếu chưa có quyền.</p></div></div>
        {referenceSources.map((source, index) => <article className="reference-row" key={index}>
          <label><span>Nền tảng *</span><select value={source.platform} onChange={(event) => setReferenceSources((items) => items.map((item, i) => i === index ? {...item, platform: event.target.value as ReferenceSource["platform"]} : item))}><option value="YOUTUBE">YouTube</option><option value="TIKTOK">TikTok</option><option value="FACEBOOK">Facebook</option></select></label>
          <label><span>Link video *</span><input type="url" placeholder="https://..." value={source.url} onChange={(event) => setReferenceSources((items) => items.map((item, i) => i === index ? {...item, url: event.target.value} : item))} /></label>
          <label><span>Cách sử dụng *</span><select value={source.usage_mode} onChange={(event) => setReferenceSources((items) => items.map((item, i) => i === index ? {...item, usage_mode: event.target.value as ReferenceSource["usage_mode"]} : item))}><option value="INSPIRATION_ONLY">Chỉ lấy cảm hứng</option><option value="STRUCTURE_REFERENCE">Tham khảo cấu trúc</option><option value="AUTHORIZED_ADAPTATION">Chuyển thể – đã có quyền</option></select></label>
          <label className="wide-field"><span>Điểm muốn học theo</span><input placeholder="Ví dụ: nhịp dựng nhanh, mở đầu gây tò mò, tông hài gia đình" value={source.notes} onChange={(event) => setReferenceSources((items) => items.map((item, i) => i === index ? {...item, notes: event.target.value} : item))} /></label>
          <label className="consent"><input required type="checkbox" checked={source.rights_confirmed} onChange={(event) => setReferenceSources((items) => items.map((item, i) => i === index ? {...item, rights_confirmed: event.target.checked} : item))} /> Tôi xác nhận link công khai và có quyền sử dụng theo lựa chọn trên.</label>
          <button type="button" className="remove-button" onClick={() => setReferenceSources((items) => items.filter((_, i) => i !== index))}>Xóa link</button>
        </article>)}
        <button type="button" className="secondary-button" disabled={referenceSources.length >= 5} onClick={() => setReferenceSources((items) => [...items, {platform: "YOUTUBE", url: "", usage_mode: "INSPIRATION_ONLY", rights_confirmed: false, notes: ""}])}>+ Thêm link tham khảo</button>
      </section>

      <section>
        <div className="section-heading"><span>04</span><div><h2>Nội dung dự án</h2><p>Chỉ hiển thị thông tin cần cho loại dự án đã chọn.</p></div></div>
        <div className="field-grid">
          {projectType === "SHORT_FILM" && <>
            <TextField name="story_idea" label="Ý tưởng tập / phim" placeholder="Hai chị em hiểu lầm nhau vì chuyện chăm sóc mẹ" help="Một câu kể chuyện chính" />
            <SelectField name="social_theme" label="Chủ đề" options={[["FAMILY", "Gia đình"], ["LOVE", "Tình cảm"], ["FRIENDSHIP", "Bạn bè"], ["COMMUNITY", "Đời sống xã hội"], ["EDUCATION", "Giáo dục"]]} />
            <SelectField name="story_genre" label="Thể loại" options={[["FAMILY_DRAMA", "Tâm lý gia đình"], ["COMEDY", "Hài"], ["ROMANCE", "Tình cảm"], ["INSPIRATIONAL", "Truyền cảm hứng"], ["MYSTERY", "Bí ẩn"]]} />
            <SelectField name="primary_setting" label="Bối cảnh chính" options={[["HOME", "Trong nhà"], ["RURAL", "Miền quê"], ["CITY", "Thành phố"], ["MARKET", "Chợ/quán ăn"], ["SCHOOL", "Trường học"]]} />
            <SelectField name="ending_direction" label="Kiểu kết thúc" options={[["HAPPY", "Có hậu"], ["EMOTIONAL", "Cảm động"], ["OPEN", "Kết thúc mở"], ["TWIST", "Bất ngờ"], ["LESSON", "Có bài học"]]} />
            <SelectField name="dialogue_source" label="Nguồn lời thoại" options={[["AI_DRAFT_OWNER_APPROVES", "AI soạn, chủ dự án duyệt"], ["OWNER_PROVIDED", "Chủ dự án cung cấp"], ["MIXED", "Kết hợp cả hai"]]} />
            <ShortFilmWorkflowForm
              eligibleCharacters={eligibleCharacters}
              value={shortFilmWorkflow}
              generatingScript={generatingScript}
              onGenerateScript={generateShortFilmScript}
              onRequestBudgetApproval={() => document.getElementById("provider-budget")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              providerBudgetApproved={providerRunReady}
              providerStatus={shortFilmProviderStatus}
              onChange={(workflow) => {
                invalidateConfirmation();
                setShortFilmWorkflow(workflow);
              }}
            />
          </>}

          {projectType === "MUSIC_VIDEO" && <>
            <TextField name="song_title" label="Tên bài hát" placeholder="Nhà là nơi để về" />
            <SelectField name="song_topic" label="Chủ đề bài hát" options={[["FAMILY", "Gia đình"], ["LOVE", "Tình yêu"], ["HOMELAND", "Quê hương"], ["LIFE", "Cuộc sống"], ["CELEBRATION", "Lễ hội/sự kiện"]]} />
            <SelectField name="music_genre" label="Thể loại nhạc" options={[["BOLERO", "Bolero"], ["POP", "Pop"], ["BALLAD", "Ballad"], ["FOLK", "Dân ca"], ["DANCE", "Dance"]]} />
            <SelectField name="lyrics_source_mode" label="Nguồn lời" options={[["AI_GENERATED", "AI hỗ trợ sáng tác"], ["USER_PROVIDED_LOCKED", "Lời có sẵn và đã chốt"]]} />
            <TextField name="lyrics" label="Lời bài hát hoặc link file lời" required={false} placeholder="Dán lời đã có quyền hoặc link Google Drive" />
            <SelectField name="music_source_mode" label="Nguồn nhạc" options={[["AI_COMPOSITION", "AI hỗ trợ sáng tác"], ["EXISTING_INSTRUMENTAL", "Beat/instrumental có sẵn"], ["EXISTING_SONG", "Bài hát có sẵn"], ["NEW_STUDIO_PRODUCTION", "Thu mới tại studio"]]} />
            <SelectField name="vocal_source_mode" label="Nguồn giọng hát" options={[["REAL_RECORDED_VOCAL", "Giọng thu thật"], ["AUTHORIZED_VOICE_MODEL", "Voice model đã được cấp quyền"], ["EXISTING_MASTER_AUDIO", "Bản vocal master có sẵn"]]} />
            <TextField name="visual_direction" label="Định hướng hình ảnh" placeholder="Ví dụ: điện ảnh miền Tây, ấm áp, nhiều cảnh đời thường" />
          </>}

          {projectType === "SHORT_MUSIC_CLIP" && <>
            <SelectField name="music_source_mode" label="Nguồn bài / nhạc" options={[["AI_COMPOSITION", "AI hỗ trợ sáng tác"], ["EXISTING_INSTRUMENTAL", "Beat có sẵn"], ["EXISTING_SONG", "Bài hát có sẵn"], ["NEW_STUDIO_PRODUCTION", "Thu mới"]]} />
            <TextField name="clip_start_time" label="Thời điểm bắt đầu" placeholder="Ví dụ: 00:45" />
            <TextField name="clip_end_time" label="Thời điểm kết thúc" placeholder="Ví dụ: 01:15" />
            <SelectField name="vocal_source_mode" label="Nguồn giọng" options={[["REAL_RECORDED_VOCAL", "Giọng thu thật"], ["AUTHORIZED_VOICE_MODEL", "Voice model đã cấp quyền"], ["EXISTING_MASTER_AUDIO", "Vocal master có sẵn"]]} />
            <TextField name="visual_direction" label="Phong cách biểu diễn" placeholder="Ví dụ: năng động, cận mặt, chuyển động máy mượt" />
          </>}
        </div>
      </section>

      <section className="budget-panel" id="provider-budget">
        <div className="section-heading"><span>05</span><div><h2>Nhà cung cấp &amp; dự toán kinh phí</h2><p>Chọn dịch vụ theo chức năng. Không nhà cung cấp nào được gọi trước khi kinh phí được duyệt.</p></div></div>
        <div className="internal-service-grid">
          <label><span>Hậu kỳ nội bộ</span><select disabled value={providerBudget.internal_services.post_production}><option value="TUHAUAI_FFMPEG_CLOUD_RUN">TuhauAI · FFmpeg · Cloud Run</option></select><small>Cắt ghép, mix âm thanh và xuất bản master trong pipeline nội bộ.</small></label>
          <label><span>Nguồn nhạc phim</span><select value={providerBudget.internal_services.music_source} onChange={(event) => setProviderBudget((current) => ({ ...current, internal_services: { ...current.internal_services, music_source: event.target.value as ProviderBudgetPlan["internal_services"]["music_source"] }, approval: { ...current.approval, decision: "PENDING", reviewed_at: undefined } }))}><option value="NOT_SELECTED">Chưa chọn</option><option value="PROJECT_OWNER_LICENSED">Chủ dự án cung cấp · đã có quyền</option><option value="LICENSED_LIBRARY">Thư viện nhạc đã cấp phép</option></select><small>Không sử dụng nhạc chưa xác nhận quyền.</small></label>
        </div>
        <div className="provider-budget-grid">
          <label><span>Tạo kịch bản</span><select value={providerBudget.providers.script} onChange={(event) => setProviderBudget((current) => ({ ...current, providers: { ...current.providers, script: event.target.value as ProviderBudgetPlan["providers"]["script"] }, approval: { ...current.approval, decision: "PENDING", reviewed_at: undefined } }))}><option value="OPENAI_RESPONSES">OpenAI Responses API</option><option value="PROJECT_OWNER">Chủ dự án tự cung cấp</option></select><small>{providerBudget.providers.script === "OPENAI_RESPONSES" ? (shortFilmProviderStatus.script?.configured ? "Đã kết nối" : "Chưa cấu hình API") : "Không phát sinh phí AI"}</small></label>
          <label><span>Tạo video</span><select value={providerBudget.providers.video} onChange={(event) => setProviderBudget((current) => ({ ...current, providers: { ...current.providers, video: event.target.value as ProviderBudgetPlan["providers"]["video"] }, approval: { ...current.approval, decision: "PENDING", reviewed_at: undefined } }))}><option value="RUNWAY">Runway</option><option value="NONE">Chưa sử dụng</option></select><small>{providerBudget.providers.video === "RUNWAY" ? (shortFilmProviderStatus.image_to_video?.configured ? "Đã kết nối" : "Chưa cấu hình API") : "Đã tắt"}</small></label>
          <label><span>Giọng nói AI</span><select value={providerBudget.providers.voice} onChange={(event) => setProviderBudget((current) => ({ ...current, providers: { ...current.providers, voice: event.target.value as ProviderBudgetPlan["providers"]["voice"] }, approval: { ...current.approval, decision: "PENDING", reviewed_at: undefined } }))}><option value="ELEVENLABS">ElevenLabs</option><option value="APPROVED_VOICE_MASTER">Voice Master đã duyệt</option><option value="NONE">Không dùng giọng</option></select><small>{providerBudget.providers.voice === "ELEVENLABS" ? "Dùng Voice Master đã khóa qua ElevenLabs" : "Không gọi ElevenLabs"}</small></label>
          <label><span>Khớp khẩu hình</span><select value={providerBudget.providers.lip_sync} onChange={(event) => setProviderBudget((current) => ({ ...current, providers: { ...current.providers, lip_sync: event.target.value as ProviderBudgetPlan["providers"]["lip_sync"] }, approval: { ...current.approval, decision: "PENDING", reviewed_at: undefined } }))}><option value="SYNC">Sync</option><option value="NONE">Không lip-sync</option></select><small>{providerBudget.providers.lip_sync === "SYNC" ? (shortFilmProviderStatus.lip_sync?.configured ? "Đã kết nối" : "Chưa cấu hình API") : "Đã tắt"}</small></label>
        </div>
        <div className="budget-estimate-grid">
          {(["script", "video", "voice", "lip_sync", "contingency"] as const).map((key) => <div className="budget-line" key={key}><span>{({ script: "Kịch bản AI", video: "Tạo video", voice: "Giọng nói", lip_sync: "Khớp khẩu hình", contingency: "Dự phòng 20%" } as const)[key]}</span><strong>{providerBudget.estimate[key].toLocaleString("vi-VN")} USD</strong></div>)}
          <div className="budget-total"><span>Kinh phí đề xuất</span><strong>{providerBudget.estimate.total.toLocaleString("vi-VN")} USD</strong><small>Ước tính cho {providerBudget.estimate.estimated_duration_seconds} giây · {providerBudget.estimate.basis_version}</small></div>
        </div>
        <div className={`budget-approval ${budgetApproved ? "approved" : "pending"}`}>
          <div><strong>{budgetApproved ? "KINH PHÍ ĐÃ DUYỆT" : "KINH PHÍ CHƯA DUYỆT"}</strong><p>{budgetApproved ? `Hạn mức ${providerBudget.approval.approved_limit.toLocaleString("vi-VN")} ${providerBudget.estimate.currency}. Provider vẫn chờ các approval gate sản xuất.` : "Hãy kiểm tra dự toán và bấm Duyệt kinh phí. Việc bấm duyệt không gọi provider và không trừ tiền."}</p></div>
          <button type="button" onClick={approveBudget}>Duyệt {providerBudget.estimate.total.toLocaleString("vi-VN")} USD</button>
        </div>
        <div className={`account-preflight ${accountExecutionReady ? "approved" : "pending"}`}>
          <div><strong>KIỂM TRA TÀI KHOẢN TRƯỚC KHI CHẠY</strong><p>Chỉ đọc số dư/hạn mức. Không tạo ảnh, video, giọng hoặc trừ credit.</p></div>
          <button disabled={!budgetApproved || checkingAccounts} type="button" onClick={() => void checkAccounts()}>{checkingAccounts ? "Đang kiểm tra…" : "Kiểm tra tài khoản"}</button>
          {accountPreflight && <div className="account-check-results">{accountPreflight.providers.map((item) => <article key={item.provider}><strong>{item.provider} · {item.status}</strong><span>{item.message}</span>{item.required_units !== undefined && <small>Cần {item.required_units.toLocaleString("vi-VN")} {item.unit}{item.available_units !== undefined ? ` · Còn ${item.available_units.toLocaleString("vi-VN")} ${item.unit}` : ""}</small>}<small><b>Hành động:</b> {accountAction(item.status)}</small></article>)}</div>}
          {accountPreflight?.execution_gate === "MANUAL_CONFIRMATION_REQUIRED" && <label className="consent"><input checked={manualBalanceConfirmed} type="checkbox" onChange={(event) => setManualBalanceConfirmed(event.target.checked)} /> Tôi đã kiểm tra Billing của các nhà cung cấp không có API số dư và xác nhận đủ hạn mức.</label>}
          {accountPreflight?.execution_gate === "BLOCKED" && <p className="operation-error">ĐÃ KHÓA CHẠY: xem đúng trạng thái và “Hành động” của từng nhà cung cấp ở trên; không mặc định rằng mọi lỗi đều do thiếu tiền.</p>}
          {accountExecutionReady && <p className="operation-success">TÀI KHOẢN ĐÃ SẴN SÀNG CHO DỰ TOÁN HIỆN TẠI.</p>}
        </div>
      </section>

      <section>
        <div className="section-heading"><span>06</span><div><h2>Nhân vật & vai trò</h2><p>Chỉ chọn nhân vật đã duyệt; hệ thống khóa đúng gương mặt, giọng và người nói.</p></div></div>
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
                  <label><span>Danh tính nhân vật</span><input disabled value="Character Master đã duyệt và khóa" /></label>
                </div>
                <div className="check-row">
                  <label><input checked={character.voice_required} disabled={!libraryCharacter?.voice_available} onChange={(event) => updateCharacter(index, { voice_required: event.target.checked, ...(!event.target.checked ? { lip_sync_required: false } : {}) })} type="checkbox" /> Dùng voice APPROVED</label>
                  <label><input checked={character.lip_sync_required} disabled={!character.voice_required || !libraryCharacter?.voice_available} onChange={(event) => updateCharacter(index, { lip_sync_required: event.target.checked })} type="checkbox" /> Khớp khẩu hình với thoại</label>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <button disabled={submitting || characters.length === 0 || !providerRunReady} type="submit">{submitting ? "Đang kiểm tra…" : !budgetApproved ? "Duyệt kinh phí trước khi tiếp tục" : !accountExecutionReady ? "Kiểm tra tài khoản trước khi tiếp tục" : "Kiểm tra dữ liệu"}</button>
      </>}
      {result && <ResultDetails value={result} />}
      {validatedSubmission && (
        <section className="confirmation-panel">
          <div>
            <h2>Xác nhận tạo dự án chính thức</h2>
            <p>
              Hệ thống TuhauAI sẽ tạo mã dự án, cấu trúc Drive và
              hợp đồng đầu vào trong bảng PROJECTS. Không đóng trang trong lúc xử lý.
            </p>
          </div>
          <button disabled={creating} onClick={confirmCreation} type="button">
            {creating ? "Đang tạo dự án…" : "Xác nhận tạo dự án TuhauAI"}
          </button>
        </section>
      )}
      {creationResult && <ResultDetails value={creationResult} />}
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
            {approving
              ? "Đang duyệt hợp đồng…"
              : projectType === "SHORT_FILM"
                ? "Duyệt hợp đồng và chuyển sang review kịch bản"
                : "Duyệt hợp đồng và chuẩn bị sản xuất MV"}
          </button>
        </section>
      )}
      {approvalResult && <ResultDetails value={approvalResult} />}
      {createdProject && projectType === "SHORT_FILM" && createdProject.next_action !== "APPROVE_CONTRACT" && (
        <section className="operations-panel">
          <div>
            <h2>SHORT_FILM workflow — {createdProject.next_action}</h2>
            <p className="library-status">
              Lưu toàn bộ review và QC vào contract JSON versioned trong PROJECTS. Không gọi provider;
              Shot Plan, pilot, toàn phim và xuất bản chỉ mở theo approval gate ở trên.
            </p>
          </div>
          <button disabled={savingShortFilm} onClick={saveShortFilmWorkflow} type="button">
            {savingShortFilm ? "Đang lưu workflow…" : "Lưu SHORT_FILM workflow và approval gates"}
          </button>
          {shortFilmSaveResult && <ResultDetails value={shortFilmSaveResult} />}
        </section>
      )}
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
      {preparationResult && <ResultDetails value={preparationResult} />}
      {createdProject?.next_action === "APPROVE_MV_PRODUCTION_PLAN" && (
        <section className="confirmation-panel">
          <div>
            <h2>Kế hoạch PRE_PRODUCTION đang chờ duyệt</h2>
            <p>
              Manifest đã được lập cho <strong>{createdProject.project_id}</strong>.
              Chưa có render hoặc lệnh gọi nhà cung cấp nào được phép chạy.
            </p>
          </div>
          <button disabled={approvingPlan} onClick={approveMvProductionPlan} type="button">
            {approvingPlan ? "Đang duyệt kế hoạch…" : "Duyệt kế hoạch sản xuất MV"}
          </button>
        </section>
      )}
      {planApprovalResult && <ResultDetails value={planApprovalResult} />}
      {createdProject?.next_action === "PREPARE_MV_ASSETS" && (
        <section className="confirmation-panel">
          <div>
            <h2>Chuẩn bị tài sản MV đã khóa nguồn</h2>
            <p>
              Nhập Drive ID hoặc link beat/instrumental master. Hệ thống chỉ kiểm tra
              beat, lyrics và video gốc rồi tạo manifest chờ duyệt; không sao chép file,
              không render và không gọi nhà cung cấp.
            </p>
            <label>
              <span>Drive ID / link beat master *</span>
              <input
                onChange={(event) => setInstrumentalMasterFileId(event.target.value)}
                placeholder="1k9sgXZfFwo42XY0Y0NoWKXUQ-CuA63M5"
                type="text"
                value={instrumentalMasterFileId}
              />
            </label>
          </div>
          <button
            disabled={preparingAssets || !instrumentalMasterFileId.trim()}
            onClick={prepareMvAssets}
            type="button"
          >
            {preparingAssets ? "Đang kiểm tra tài sản…" : "Chuẩn bị tài sản MV để duyệt"}
          </button>
        </section>
      )}
      {assetPreparationResult && <ResultDetails value={assetPreparationResult} />}
      {createdProject?.next_action === "APPROVE_MV_ASSETS" && (
        <section className="confirmation-panel">
          <div>
            <h2>Tài sản MV đang chờ duyệt</h2>
            <p>
              Beat, lyrics và video ORIGINAL_FACE_COMPOSITE đã được kiểm tra cho
              <strong> {createdProject.project_id}</strong>. Khi duyệt, hệ thống buộc
              nguồn Tường Vy ở trạng thái tạm thời và khóa cận mặt. Render và provider
              vẫn bị khóa.
            </p>
          </div>
          <button disabled={approvingAssets} onClick={approveMvAssets} type="button">
            {approvingAssets ? "Đang duyệt tài sản…" : "Duyệt tài sản MV"}
          </button>
        </section>
      )}
      {assetApprovalResult && <ResultDetails value={assetApprovalResult} />}
      {createdProject?.next_action === "PREPARE_MV_SHOT_PLAN" && (
        <section className="confirmation-panel">
          <div>
            <h2>Tài sản MV đã được duyệt an toàn</h2>
            <p>
              Tài sản của <strong>{createdProject.project_id}</strong> đã khóa nguồn tạm
              Tường Vy và sẵn sàng lập shot plan. Chưa render và chưa gọi nhà cung cấp.
            </p>
          </div>
          <button disabled={preparingShotPlan} onClick={prepareMvShotPlan} type="button">
            {preparingShotPlan ? "Đang lập shot plan…" : "Lập shot plan MV để duyệt"}
          </button>
        </section>
      )}
      {shotPlanPreparationResult && <ResultDetails value={shotPlanPreparationResult} />}
      {createdProject?.next_action === "APPROVE_MV_SHOT_PLAN" && (
        <section className="confirmation-panel">
          <div>
            <h2>Shot plan MV đang chờ duyệt</h2>
            <p>
              Shot plan của <strong>{createdProject.project_id}</strong> đã bám lyrics
              master và giữ khóa cận mặt Tường Vy. Timecode vẫn chờ căn theo beat;
              chưa render và chưa gọi nhà cung cấp.
            </p>
          </div>
        </section>
      )}
    </form>
  );
}
