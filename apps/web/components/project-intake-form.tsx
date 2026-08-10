"use client";

import { FormEvent, useEffect, useState, type FocusEvent } from "react";
import { approveProviderBudgetForProjectCreation, calculateSuggestedProviderBudget, canResumeContractApproval, canResumeShortFilmWorkflow, deriveShortFilmCharacterMediaRequirements, migrateShortFilmWorkflowDraft, resetProviderBudgetApprovalForDraft, shortFilmScriptProvider, shortFilmScriptReadyForProjectCreation, synchronizeShortFilmIntakeFields, type ProviderBudgetPlan, type ShortFilmResumeSnapshot, type ShortFilmWorkflow } from "@tu-hau/contracts";
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
  voice_perceived_age_band?: "YOUNG_ADULT" | "ADULT" | "MIDDLE_AGED" | "OLDER_ADULT";
  voice_locale?: "vi-VN-southwest";
  voice_performance_style?: "SOUTHERN_TV_DRAMA_DUBBING";
  pronunciation_lexicon_id?: string;
  voice_audition_audio_url?: string;
  voice_audition_approved?: boolean;
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

type ValidationFeedback = {
  kind: "checking" | "error" | "success";
  title: string;
  message: string;
  targetPath?: string;
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
  current_stage: string;
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
    | "REVIEW_SHORT_FILM_SHOT_PLAN"
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
  script_generation_gate?: "READY" | "BLOCKED";
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

function TextField({ name, label, required = true, type = "text", placeholder, help, defaultValue = "" }: { name: string; label: string; required?: boolean; type?: string; placeholder?: string; help?: string; defaultValue?: string }) {
  return (
    <label>
      <span>{label}{required ? " *" : ""}</span>
      <input defaultValue={defaultValue} name={name} type={type} required={required} placeholder={placeholder} />
      {help && <small className="field-help">Ví dụ: {help}</small>}
    </label>
  );
}

function SelectField({ name, label, options, defaultValue = "" }: { name: string; label: string; options: Array<[string, string]>; defaultValue?: string }) {
  return <label><span>{label} *</span><select name={name} required defaultValue={defaultValue}><option value="" disabled>Chọn một phương án</option>{options.map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select></label>;
}

function shortFilmIntakeOnly(workflow: ShortFilmWorkflow): ShortFilmWorkflow {
  const intake = { ...workflow };
  delete intake.shot_plan;
  delete intake.production_readiness;
  delete intake.pilot;
  delete intake.pilot_batch;
  delete intake.full_film;
  return intake;
}

function validationTargetForIssue(path: Array<string | number>) {
  const normalized = path[0] === "short_film_workflow" ? path.slice(1) : path;
  const field = String(normalized.at(-1) ?? "");
  const labels: Record<string, string> = {
    idea_brief: "Ý tưởng phim",
    script_title: "Tên kịch bản",
    script_synopsis: "Tóm tắt kịch bản",
    full_script: "Nội dung kịch bản",
    singing_scene_notes: "Mô tả hoặc nguồn cảnh hát",
    source_actor_id: "Diễn viên nguồn",
    source_actor_name: "Diễn viên nguồn",
    film_character_name: "Tên nhân vật trong phim",
    film_role: "Vai diễn",
    relationships: "Quan hệ",
    personality: "Tính cách",
    appearance: "Ngoại hình trong cảnh",
    language: "Ngôn ngữ thoại",
    dialogue_mode: "Cấu hình thoại",
    character_count: "Số lượng nhân vật",
    decision: "Quyết định duyệt kịch bản",
    reviewed_at: "Thời điểm duyệt kịch bản",
  };
  const label = labels[field];
  const characterIndex = normalized[0] === "film_characters" || normalized[0] === "source_actors"
    ? Number(normalized[1])
    : Number.NaN;
  const message = label
    ? Number.isInteger(characterIndex)
      ? `Nhân vật ${characterIndex + 1}: kiểm tra mục “${label}”.`
      : `Kiểm tra mục “${label}”.`
    : "Còn nội dung chưa hoàn chỉnh.";
  const targetParts = normalized[0] === "source_actors" && Number.isInteger(characterIndex)
    ? ["film_characters", characterIndex, "source_actor_id"]
    : normalized;
  return { message, targetPath: targetParts.join(".") };
}

function ResultDetails({ value }: { value: string }) {
  if (!value) return null;
  if (value.startsWith("Không") || value.startsWith("Lỗi")) {
    return <p className="operation-error" role="alert">{value}</p>;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    const result = parsed && typeof parsed === "object" ? parsed as { message?: string; error?: string } : {};
    if (result.error || result.message) {
      return <p className={result.error ? "operation-error" : "operation-success"}>{result.error ?? result.message}</p>;
    }
    return <p className="operation-success">Thao tác đã hoàn tất. Bước tiếp theo đã được mở.</p>;
  } catch {
    return <p className="operation-success">{value}</p>;
  }
}

const providerLabels: Record<string, string> = {
  OPENAI: "OpenAI",
  RUNWAY: "Runway",
  ELEVENLABS: "ElevenLabs",
  SYNC: "Sync",
  SYSTEM: "Hệ thống",
};

const accountStatusLabels: Record<string, string> = {
  SUFFICIENT: "Đủ hạn mức",
  INSUFFICIENT: "Không đủ hạn mức",
  UNVERIFIED: "Cần xác nhận thủ công",
  NOT_CONFIGURED: "Chưa kết nối",
  ERROR: "Không kiểm tra được",
};

function accountAction(status: string) {
  if (status === "INSUFFICIENT") return "Nạp thêm credit hoặc giảm thời lượng/dịch vụ rồi kiểm tra lại.";
  if (status === "NOT_CONFIGURED") return "Cấu hình API key/secret của đúng nhà cung cấp.";
  if (status === "AUTH_ERROR") return "Tạo hoặc lưu lại API key hợp lệ và kiểm tra quyền đọc tài khoản.";
  if (status === "UNVERIFIED") return "Thử lại; nếu vẫn lỗi, mở trang Billing của nhà cung cấp để kiểm tra thủ công.";
  if (status === "SUFFICIENT") return "Không cần xử lý.";
  return "Báo quản trị hệ thống kèm mã HTTP hiển thị ở trên.";
}

const providerAccountLinks = {
  OPENAI: {
    billing: "https://platform.openai.com/settings/organization/billing/overview",
    apiKeys: "https://platform.openai.com/api-keys",
  },
  RUNWAY: {
    billing: "https://dev.runwayml.com/organization/de9a6a51-b476-4666-b8f5-17773177dabf/billing",
    apiKeys: "https://dev.runwayml.com/organization/de9a6a51-b476-4666-b8f5-17773177dabf/api-keys",
  },
  ELEVENLABS: {
    billing: "https://elevenlabs.io/app/subscription",
    apiKeys: "https://elevenlabs.io/app/developers/api-keys",
  },
  SYNC: {
    billing: "https://sync.so/billing/subscription",
    apiKeys: "https://sync.so/settings/api-keys",
  },
} as const;

function ProviderAccountLinks({ provider, status }: { provider: string; status: string }) {
  const links = providerAccountLinks[provider as keyof typeof providerAccountLinks];
  if (!links) return null;
  const showBilling = status === "INSUFFICIENT" || status === "UNVERIFIED";
  const showApiKeys = status === "AUTH_ERROR" || status === "NOT_CONFIGURED";
  if (!showBilling && !showApiKeys) return null;
  return (
    <small className="provider-account-links">
      {showBilling && <a href={links.billing} target="_blank" rel="noreferrer">Mở Billing</a>}
      {showApiKeys && <a href={links.apiKeys} target="_blank" rel="noreferrer">Mở API Keys</a>}
    </small>
  );
}

export function ProjectIntakeForm() {
  const [projectType, setProjectType] = useState<FormProjectType>("SHORT_FILM");
  const [projectStarted, setProjectStarted] = useState(false);
  const [frameMessage, setFrameMessage] = useState("");
  const [referenceSources, setReferenceSources] = useState<ReferenceSource[]>([]);
  const [shortFilmWorkflow, setShortFilmWorkflow] = useState<ShortFilmWorkflow>(createInitialShortFilmWorkflow);
  const [eligibleCharacters, setEligibleCharacters] = useState<EligibleCharacter[]>([]);
  const [characters, setCharacters] = useState<CharacterSelection[]>([]);
  const [characterToAdd, setCharacterToAdd] = useState("");
  const [libraryMessage, setLibraryMessage] = useState("Đang đọc CHARACTER_LIBRARY…");
  const [result, setResult] = useState<string>("");
  const [validationFeedback, setValidationFeedback] = useState<ValidationFeedback | null>(null);
  const [submitting, setSubmitting] = useState(false);
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
  const [approvingProgressContract, setApprovingProgressContract] = useState(false);
  const [progressActionMessage, setProgressActionMessage] = useState("");
  const [resumingProject, setResumingProject] = useState(false);
  const [draftFormValues, setDraftFormValues] = useState<Record<string, string[]> | null>(null);
  const [initialFormValues, setInitialFormValues] = useState<Record<string, string[]>>({});
  const [draftSavedAt, setDraftSavedAt] = useState("");
  const [inputHistory, setInputHistory] = useState<Record<string, string[]>>({});
  const [accountPreflight, setAccountPreflight] = useState<AccountPreflight | null>(null);
  const [checkingAccounts, setCheckingAccounts] = useState(false);
  const [manualBalanceConfirmed, setManualBalanceConfirmed] = useState(false);
  const [preparingShortFilmPilot, setPreparingShortFilmPilot] = useState(false);
  const [pilotSyncBalanceConfirmed, setPilotSyncBalanceConfirmed] = useState(false);
  const [shortFilmPilotPlanResult, setShortFilmPilotPlanResult] = useState("");
  const [pilotExecutionApproved, setPilotExecutionApproved] = useState(false);
  const [pilotExecutionResult, setPilotExecutionResult] = useState("");
  const [runningPilotExecution, setRunningPilotExecution] = useState(false);
  const [monitoringPilotExecution, setMonitoringPilotExecution] = useState(false);
  const [fullFilmExecutionApproved, setFullFilmExecutionApproved] = useState(false);
  const [fullFilmExecutionResult, setFullFilmExecutionResult] = useState("");
  const [runningFullFilmExecution, setRunningFullFilmExecution] = useState(false);
  const [monitoringFullFilmExecution, setMonitoringFullFilmExecution] = useState(false);

  const budgetApproved = providerBudget.approval.decision === "APPROVE" &&
    Boolean(providerBudget.approval.reviewed_at) &&
    providerBudget.approval.approved_limit >= providerBudget.estimate.total;
  const accountExecutionReady = accountPreflight?.execution_gate === "READY" ||
    (accountPreflight?.execution_gate === "MANUAL_CONFIRMATION_REQUIRED" && manualBalanceConfirmed);
  const openAiAccountCheck = accountPreflight?.providers.find((provider) => provider.provider === "OPENAI");
  const scriptGenerationReady = accountPreflight?.script_generation_gate === "READY" ||
    (accountPreflight?.script_generation_gate === undefined && ["SUFFICIENT", "UNVERIFIED"].includes(openAiAccountCheck?.status ?? ""));
  const scriptReadyForCreation = projectType !== "SHORT_FILM" || shortFilmScriptReadyForProjectCreation(shortFilmWorkflow);

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
    if (projectType === "SHORT_FILM") {
      const durationMinutes = Math.max(1, Math.round(durationSeconds / 60));
      setShortFilmWorkflow((current) => synchronizeShortFilmIntakeFields(current, { target_duration_minutes: durationMinutes }));
    }
    setAccountPreflight(null);
    setManualBalanceConfirmed(false);
    setProviderBudget((current) => {
      const estimate = calculateSuggestedProviderBudget({ project_type: projectType, duration_seconds: durationSeconds, providers: current.providers });
      if (estimate.total === current.estimate.total && estimate.estimated_duration_seconds === current.estimate.estimated_duration_seconds) return current;
      return { ...current, estimate, approval: { ...current.approval, decision: "PENDING", approved_limit: estimate.total, reviewed_at: undefined } };
    });
  }, [durationTarget, projectType, providerBudget.providers.script, providerBudget.providers.video, providerBudget.providers.voice, providerBudget.providers.lip_sync]);

  useEffect(() => {
    if (projectType !== "SHORT_FILM") return;
    const scriptProvider = shortFilmScriptProvider(shortFilmWorkflow.script_source);
    setProviderBudget((current) => current.providers.script === scriptProvider
      ? current
      : { ...current, providers: { ...current.providers, script: scriptProvider }, approval: { ...current.approval, decision: "PENDING", reviewed_at: undefined } });
  }, [projectType, shortFilmWorkflow.script_source]);

  async function checkProjectProgress(projectIdOverride?: string) {
    const projectId = (projectIdOverride ?? progressProjectId).trim();
    if (!projectId) {
      setProgressMessage("Nhập mã dự án để kiểm tra tiến độ.");
      return;
    }
    setCheckingProgress(true);
    setProgressMessage("");
    setProgressActionMessage("");
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

  async function approveContractFromProgress() {
    if (!projectProgress || !canResumeContractApproval(projectProgress)) return;
    setApprovingProgressContract(true);
    setProgressActionMessage("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectProgress.project_id)}/approve-contract`, { method: "POST" });
      const body = await response.json();
      if (!response.ok || body.approval_status !== "APPROVED") {
        setProgressActionMessage(body.message ?? body.code ?? "Không duyệt được hợp đồng dự án.");
        return;
      }
      await checkProjectProgress(projectProgress.project_id);
      setProgressActionMessage("Đã duyệt hợp đồng và cập nhật tiến độ dự án.");
    } catch {
      setProgressActionMessage("Không kết nối được kho dự án. Hệ thống không tự gửi lại để tránh ghi lặp sự kiện duyệt.");
    } finally {
      setApprovingProgressContract(false);
    }
  }

  async function resumeShortFilmProject() {
    if (!projectProgress || !canResumeShortFilmWorkflow(projectProgress)) return;
    setResumingProject(true);
    setProgressActionMessage("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectProgress.project_id)}/short-film/workflow`);
      const body = await response.json();
      if (!response.ok || !body.resume_snapshot || typeof body.next_action !== "string") {
        setProgressActionMessage(body.message ?? body.code ?? "Không mở lại được workflow phim ngắn.");
        return;
      }
      const snapshot = body.resume_snapshot as ShortFilmResumeSnapshot;
      setProjectType("SHORT_FILM");
      setShortFilmWorkflow(snapshot.short_film_workflow);
      setReferenceSources(snapshot.reference_sources);
      setCharacters(snapshot.characters as CharacterSelection[]);
      setProviderBudget(snapshot.provider_budget);
      setDurationTarget(snapshot.duration_target);
      setDraftFormValues(snapshot.form_values);
      setInitialFormValues(snapshot.form_values);
      setAccountPreflight(null);
      setManualBalanceConfirmed(false);
      setCreatedProject({ project_id: projectProgress.project_id, current_stage: projectProgress.current_stage, next_action: body.next_action });
      setProjectStarted(true);
      setTimeout(() => document.getElementById("intake-frame-5")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    } catch {
      setProgressActionMessage("Không kết nối được kho dự án TuhauAI.");
    } finally {
      setResumingProject(false);
    }
  }

  function invalidateConfirmation() {
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

  function syncShortFilmUserField(target: EventTarget | null) {
    if (projectType !== "SHORT_FILM" || !(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
    if (target.name === "story_idea") {
      setShortFilmWorkflow((current) => synchronizeShortFilmIntakeFields(current, { idea_brief: target.value }));
    }
    if (target.name === "language") {
      setShortFilmWorkflow((current) => synchronizeShortFilmIntakeFields(current, { language: target.value }));
    }
  }

  function saveDraft(form: HTMLFormElement) {
    if (!projectStarted || createdProject) return;
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
    setCreatedProject(null);
    setCreationResult("");
    setAccountPreflight(null);
    setManualBalanceConfirmed(false);
    const fallbackDuration = type === "SHORT_MUSIC_CLIP" ? "30_SECONDS" : "5_MINUTES";
    try {
      const stored = localStorage.getItem(`${INTAKE_DRAFT_PREFIX}${type}`);
      if (stored) {
        const draft = JSON.parse(stored) as IntakeDraft;
        if (draft.version === 1) {
          setReferenceSources(draft.reference_sources ?? []);
          const defaults = createInitialShortFilmWorkflow();
          const migratedWorkflow = migrateShortFilmWorkflowDraft(draft.short_film_workflow, defaults);
          setShortFilmWorkflow({
            ...migratedWorkflow,
            idea_brief: draft.form_values?.story_idea?.[0] ?? migratedWorkflow.idea_brief,
            dialogue: { ...migratedWorkflow.dialogue, language: draft.form_values?.language?.[0] ?? migratedWorkflow.dialogue.language },
          });
          setCharacters(draft.characters ?? []);
          setProviderBudget(resetProviderBudgetApprovalForDraft(draft.provider_budget ?? initialProviderBudget));
          setDurationTarget(draft.duration_target ?? fallbackDuration);
          setDraftFormValues(draft.form_values ?? {});
          setInitialFormValues(draft.form_values ?? {});
          setDraftSavedAt(draft.saved_at ?? "");
        }
      } else {
        setDurationTarget(fallbackDuration);
        setDraftFormValues(null);
        setInitialFormValues({});
        setDraftSavedAt("");
      }
    } catch {
      setDurationTarget(fallbackDuration);
      setDraftFormValues(null);
      setInitialFormValues({});
      setDraftSavedAt("");
    }
    setProjectStarted(true);
    setFrameMessage("");
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
    if (projectType !== "SHORT_FILM") return;
    const syncedCharacters: CharacterSelection[] = shortFilmWorkflow.film_characters.map((character) => ({
      character_id: character.source_actor_id,
      project_role: character.film_role === "PROTAGONIST"
        ? "MAIN"
        : character.film_role === "CAMEO"
          ? "CAMEO"
          : character.film_role === "EXTRA"
            ? "BACKGROUND"
            : "SUPPORTING",
      performance_role: character.film_role === "EXTRA" ? "EXTRA" : "ACTOR",
      ...deriveShortFilmCharacterMediaRequirements(character.film_role, shortFilmWorkflow.dialogue.dialogue_mode),
      identity_mode: "LIBRARY_MASTER",
      original_video_file_id: "",
    }));
    setCharacters((current) => JSON.stringify(current) === JSON.stringify(syncedCharacters) ? current : syncedCharacters);
  }, [projectType, shortFilmWorkflow.film_characters, shortFilmWorkflow.dialogue.dialogue_mode]);

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
            ? `${approvedCharacters.length} nhân vật sẵn sàng sử dụng.`
            : "Chưa có nhân vật sẵn sàng sử dụng.",
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

  useEffect(() => {
    if (!monitoringPilotExecution || !createdProject) return;
    const timer = window.setInterval(() => void refreshShortFilmPilotStatus(), 10_000);
    return () => window.clearInterval(timer);
  }, [monitoringPilotExecution, createdProject?.project_id]);

  useEffect(() => {
    if (!monitoringFullFilmExecution || !createdProject) return;
    const timer = window.setInterval(() => void refreshShortFilmFullFilmStatus(), 10_000);
    return () => window.clearInterval(timer);
  }, [monitoringFullFilmExecution, createdProject?.project_id]);

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

  function focusValidationTarget(targetPath?: string) {
    document.querySelectorAll(".validation-target-error").forEach((element) => element.classList.remove("validation-target-error"));
    if (!targetPath) {
      document.querySelector("form[data-intake-form]")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const parts = targetPath.split(".");
    let target: HTMLElement | null = null;
    while (parts.length > 0 && !target) {
      target = document.querySelector<HTMLElement>(`[data-validation-path="${parts.join(".")}"]`);
      if (!target) parts.pop();
    }
    if (!target) {
      const fieldName = targetPath.split(".").at(-1);
      target = fieldName ? document.querySelector<HTMLElement>(`[name="${fieldName}"]`) : null;
    }
    if (!target) {
      document.querySelector("form[data-intake-form]")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    target.classList.add("validation-target-error");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    const control = target.matches("input, select, textarea, button")
      ? target
      : target.querySelector<HTMLElement>("input, select, textarea, button");
    window.setTimeout(() => control?.focus(), 250);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createdProject) return;
    const formElement = event.currentTarget;
    setSubmitting(true);
    setResult("");
    setCreationResult("");
    setValidationFeedback({ kind: "checking", title: "Đang kiểm tra dữ liệu…", message: "Vui lòng giữ nguyên trang trong giây lát." });

    const invalidField = Array.from(formElement.elements).find((element) =>
      (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) &&
      element.willValidate && !element.checkValidity(),
    ) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined;
    if (invalidField) {
      const label = invalidField.closest("label")?.querySelector("span")?.textContent?.replace(" *", "") ?? "mục bắt buộc";
      const message = `Mục còn thiếu hoặc chưa đúng: ${label}.`;
      setFrameMessage("");
      setValidationFeedback({ kind: "error", title: "Chưa thể tiếp tục", message: `${message} Hệ thống đã mở đúng ô để bạn chỉnh sửa.` });
      setSubmitting(false);
      window.setTimeout(() => { invalidField.focus(); invalidField.reportValidity(); invalidField.scrollIntoView({ behavior: "smooth", block: "center" }); }, 50);
      return;
    }

    if (!formElement.querySelector<HTMLInputElement>('input[name="platforms"]:checked')) {
      const platformField = formElement.querySelector<HTMLElement>(".platform-field");
      setValidationFeedback({ kind: "error", title: "Chưa thể khởi tạo dự án", message: "Bắt buộc chọn ít nhất một nền tảng xuất bản." });
      setSubmitting(false);
      platformField?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const incompleteReference = referenceSources.find(
      (source) => !source.url.trim() || !source.rights_confirmed,
    );
    if (incompleteReference) {
      setResult("Vui lòng nhập URL và xác nhận quyền sử dụng cho từng link tham khảo.");
      setFrameMessage("");
      setValidationFeedback({ kind: "error", title: "Chưa thể tiếp tục", message: "Có link tham khảo chưa hoàn chỉnh. Hệ thống đã đánh dấu đúng mục để bạn chỉnh sửa." });
      setSubmitting(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (!accountExecutionReady) {
      setValidationFeedback({ kind: "error", title: "Chưa thể khởi tạo dự án", message: "Hãy kiểm tra tài khoản và xử lý đầy đủ trạng thái từng nhà cung cấp trước khi duyệt kinh phí." });
      setSubmitting(false);
      document.getElementById("intake-frame-4")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const approvedProviderBudget = approveProviderBudgetForProjectCreation(providerBudget, new Date().toISOString());
    setProviderBudget(approvedProviderBudget);

    const form = new FormData(formElement);
    const payload = {
      ...Object.fromEntries(
        [...form.entries()].filter(([, value]) => String(value).trim() !== ""),
      ),
      platforms: form.getAll("platforms").map(String),
      reference_sources: referenceSources.filter((source) => source.url.trim()),
      provider_budget: approvedProviderBudget,
      short_film_workflow: projectType === "SHORT_FILM" ? shortFilmIntakeOnly(shortFilmWorkflow) : undefined,
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
          voice_approval_status: character.voice_required && libraryCharacter?.voice_available && libraryCharacter.readiness.voice_master === "APPROVED_LOCKED" ? "APPROVED" : undefined,
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
        const validated = {
          submissionId: body.submission_id,
          payload,
        };
        setValidationFeedback({ kind: "success", title: "Dữ liệu đã đạt", message: "Kinh phí đã được duyệt. Hệ thống đang khởi tạo dự án TuhauAI." });
        await confirmCreation(validated);
      } else {
        const issues = Array.isArray(body?.errors) ? body.errors : Array.isArray(body?.message?.errors) ? body.message.errors : [];
        const issue = issues[0] as { path?: Array<string | number> } | undefined;
        const path = Array.isArray(issue?.path) ? issue.path : [];
        const target = validationTargetForIssue(path);
        setFrameMessage("");
        setValidationFeedback({ kind: "error", title: "Dữ liệu chưa đạt", message: target.message, targetPath: target.targetPath });
        window.setTimeout(() => focusValidationTarget(target.targetPath), 80);
      }
    } catch {
      setResult("Không kết nối được API. Hãy thử lại hoặc liên hệ quản trị viên.");
      setValidationFeedback({ kind: "error", title: "Không thể kiểm tra dữ liệu", message: "Không kết nối được hệ thống kiểm tra. Hãy thử lại; dữ liệu bạn đã nhập vẫn được giữ nguyên." });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmCreation(submission: ValidatedSubmission) {
    setCreating(true);
    setCreationResult("");
    try {
      const response = await fetch("/api/intake/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submission_id: submission.submissionId,
          payload: submission.payload,
        }),
      });
      const body = await response.json();
      setCreationResult(JSON.stringify(body, null, 2));
      if (
        response.ok &&
        body.project_id_created === true &&
        typeof body.project?.project_id === "string"
      ) {
        setCreatedProject(body.project as CreatedProject);
        localStorage.removeItem(`${INTAKE_DRAFT_PREFIX}${projectType}`);
        setDraftSavedAt("");
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
      setShortFilmSaveResult("Không lưu được thay đổi. Hệ thống chưa tự gửi lại để tránh tạo thao tác trùng.");
    } finally {
      setSavingShortFilm(false);
    }
  }

  async function prepareShortFilmPilot() {
    if (!createdProject) return;
    setPreparingShortFilmPilot(true);
    setShortFilmPilotPlanResult("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(createdProject.project_id)}/short-film/pilot/prepare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider_budget: providerBudget,
          pilot_duration_seconds: shortFilmWorkflow.pilot_sampling.clip_duration_seconds,
          manual_sync_balance_confirmed: pilotSyncBalanceConfirmed,
        }),
      });
      const body = await response.json();
      setShortFilmPilotPlanResult(JSON.stringify(body, null, 2));
    } catch {
      setShortFilmPilotPlanResult("Không chuẩn bị được kế hoạch clip mẫu. Chưa phát sinh chi phí và hệ thống không tự gửi lại.");
    } finally {
      setPreparingShortFilmPilot(false);
    }
  }

  async function executeShortFilmPilot() {
    if (!createdProject || !shortFilmWorkflow.pilot_budget_approval) return;
    const totalSeconds = shortFilmWorkflow.pilot_sampling.sample_count * shortFilmWorkflow.pilot_sampling.clip_duration_seconds;
    setRunningPilotExecution(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(createdProject.project_id)}/short-film/pilot/execute`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ execution_approved: true, caps: {
          runway_credits: Math.ceil(totalSeconds * 12 * 1.2),
          elevenlabs_characters: Math.ceil(totalSeconds * 15 * 1.2),
          sync_usd: Number((totalSeconds * 0.05 * 1.2).toFixed(2)),
        } }),
      });
      const body = await response.json();
      setPilotExecutionResult(JSON.stringify(body, null, 2));
      if (response.ok && !["AWAITING_PILOT_QC", "FAILED"].includes(body.status)) setMonitoringPilotExecution(true);
    } catch { setPilotExecutionResult("Không submit được pilot batch; hệ thống không tự gửi lại để tránh tính phí trùng."); }
    finally { setRunningPilotExecution(false); }
  }

  async function approveShortFilmPilotBudget() {
    const workflow = {
      ...shortFilmWorkflow,
      pilot_budget_approval: {
        sample_count: 3 as const,
        clip_duration_seconds: 15 as const,
        runway_credits_cap: 700 as const,
        elevenlabs_credits_cap: 1_000 as const,
        sync_usd_cap: 3 as const,
        decision: "APPROVE" as const,
        reviewer: "PROJECT_OWNER" as const,
        reviewed_at: new Date().toISOString(),
      },
    };
    setShortFilmWorkflow(workflow);
    setPilotExecutionApproved(true);
    if (!createdProject) return;
    setSavingShortFilm(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(createdProject.project_id)}/short-film/workflow`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workflow }),
      });
      const body = await response.json();
      setShortFilmSaveResult(JSON.stringify(body, null, 2));
      if (response.ok && typeof body.next_action === "string") {
        setCreatedProject({ ...createdProject, next_action: body.next_action as CreatedProject["next_action"] });
      }
    } catch {
      setShortFilmSaveResult("Không lưu được phê duyệt ngân sách pilot. Chưa gọi nhà cung cấp và chưa phát sinh chi phí.");
    } finally {
      setSavingShortFilm(false);
    }
  }

  async function refreshShortFilmPilotStatus() {
    if (!createdProject) return;
    const response = await fetch(`/api/projects/${encodeURIComponent(createdProject.project_id)}/short-film/pilot/status`);
    const body = await response.json();
    setPilotExecutionResult(JSON.stringify(body, null, 2));
    if (["AWAITING_PILOT_QC", "FAILED"].includes(body.status)) setMonitoringPilotExecution(false);
    if (body.status === "AWAITING_PILOT_QC" && Array.isArray(body.outputs) && Array.isArray(body.samples)) {
      setShortFilmWorkflow((current) => ({ ...current, pilot_batch: {
        samples: body.outputs.map((output: { sample_id: string; video_url: string; drive_file_id: string }) => {
          const selected = body.samples.find((sample: { sample_id: string }) => sample.sample_id === output.sample_id);
          return {
            sample_id: output.sample_id,
            purpose: selected?.purpose ?? "HIGH_RISK_SHOT",
            shot_ids: (selected?.shots ?? []).map((shot: { shot_id: string }) => shot.shot_id),
            duration_seconds: selected?.expected_duration_seconds ?? current.pilot_sampling.clip_duration_seconds,
            video_url: `/api/projects/${encodeURIComponent(createdProject.project_id)}/short-film/pilot/outputs/${encodeURIComponent(output.drive_file_id)}`,
            qc: { identity: false, motion: false, lip_sync: false, voice: false, background: false, lighting: false, continuity: false },
            review: { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" },
          };
        }),
        batch_review: { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" },
      } }));
    }
  }

  function proposedFullFilmCaps() {
    const shots = shortFilmWorkflow.shot_plan?.execution_shots ?? [];
    const totalSeconds = shots.reduce((sum, shot) => sum + shot.duration_seconds, 0);
    const dialogueCharacters = shortFilmWorkflow.production_readiness?.dialogue_line_approvals.reduce(
      (sum, line) => sum + line.dialogue_text.length, 0,
    ) ?? 0;
    const dialogueSeconds = shots.filter((shot) => shortFilmWorkflow.production_readiness?.dialogue_line_approvals.some((line) => line.shot_id === shot.shot_id)).reduce((sum, shot) => sum + shot.duration_seconds, 0);
    return { runway_credits: Math.ceil(totalSeconds * 12 * 1.2), elevenlabs_characters: Math.ceil(dialogueCharacters * 1.2), sync_usd: Number((dialogueSeconds * 0.05 * 1.2).toFixed(2)) };
  }

  async function executeShortFilmFullFilm() {
    if (!createdProject || !fullFilmExecutionApproved) return;
    setRunningFullFilmExecution(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(createdProject.project_id)}/short-film/full-film/execute`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ execution_approved: true, caps: proposedFullFilmCaps() }),
      });
      const body = await response.json();
      setFullFilmExecutionResult(JSON.stringify(body, null, 2));
      if (response.ok && !["AWAITING_FINAL_QC", "FAILED"].includes(body.status)) setMonitoringFullFilmExecution(true);
    } catch { setFullFilmExecutionResult("Không thể bắt đầu sản xuất toàn phim; hệ thống không tự gửi lại để tránh tính phí trùng."); }
    finally { setRunningFullFilmExecution(false); }
  }

  async function refreshShortFilmFullFilmStatus() {
    if (!createdProject) return;
    const response = await fetch(`/api/projects/${encodeURIComponent(createdProject.project_id)}/short-film/full-film/status`, { method: "POST" });
    const body = await response.json();
    setFullFilmExecutionResult(JSON.stringify(body, null, 2));
    if (["AWAITING_FINAL_QC", "FAILED"].includes(body.status)) setMonitoringFullFilmExecution(false);
    if (body.status === "AWAITING_FINAL_QC" && body.output?.drive_file_id) {
      setShortFilmWorkflow((current) => ({ ...current, full_film: {
        video_url: `/api/projects/${encodeURIComponent(createdProject.project_id)}/short-film/full-film/outputs/${encodeURIComponent(body.output.drive_file_id)}`,
        qc: { identity: false, motion: false, lip_sync: false, voice: false, background: false, lighting: false, continuity: false },
        review: { decision: "PENDING", notes: "", reviewer: "PROJECT_OWNER" },
      } }));
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
    if (!scriptGenerationReady) {
      setShortFilmSaveResult("Hãy kiểm tra tài khoản OpenAI trước khi tạo kịch bản AI.");
      document.getElementById("intake-frame-4")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const approvedBudget = approveProviderBudgetForProjectCreation(providerBudget, new Date().toISOString());
    setProviderBudget(approvedBudget);
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
          provider_budget: approvedBudget,
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
      setShortFilmSaveResult("Đã tạo bản nháp kịch bản. Hãy đọc toàn bộ nội dung và bấm duyệt trước khi đi tiếp.");
    } catch {
      setShortFilmSaveResult("Không kết nối được dịch vụ tạo kịch bản. Chưa tạo hoặc lưu bản nháp.");
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
        "Không kết nối được kho dự án. Hệ thống chưa tự gửi lại để tránh tạo thao tác trùng.",
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
    <form data-intake-form noValidate onBlur={rememberInput} onChange={(event) => { syncShortFilmUserField(event.target); invalidateConfirmation(); saveDraft(event.currentTarget); }} onInput={(event) => { syncShortFilmUserField(event.target); saveDraft(event.currentTarget); }} onSubmit={handleSubmit}>
      {Object.entries(inputHistory).map(([name, values]) => <datalist id={`history-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}`} key={name}>{values.map((value) => <option key={value} value={value} />)}</datalist>)}
      {!projectStarted && <section className="project-gateway">
        <div className="section-heading"><span>01</span><div><h2>Chọn loại dự án</h2><p>Chọn đúng loại nội dung bạn muốn thực hiện.</p></div></div>
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
          <p>Bước hiện tại: <strong>{projectProgress.milestones.find((milestone) => milestone.status === "CURRENT")?.label ?? "Đã hoàn thành"}</strong></p>
          {canResumeContractApproval(projectProgress) && <button disabled={approvingProgressContract} type="button" onClick={() => void approveContractFromProgress()}>{approvingProgressContract ? "Đang duyệt hợp đồng…" : "Duyệt hợp đồng và tiếp tục dự án"}</button>}
          {canResumeShortFilmWorkflow(projectProgress) && <button disabled={resumingProject} type="button" onClick={() => void resumeShortFilmProject()}>{resumingProject ? "Đang mở dự án…" : "Mở dự án để tiếp tục review"}</button>}
          {progressActionMessage && <p className={progressActionMessage.startsWith("Đã duyệt") ? "operation-success" : "operation-error"}>{progressActionMessage}</p>}
          <ol>{projectProgress.milestones.map((milestone) => <li className={milestone.status.toLowerCase()} key={milestone.action}><span>{milestone.status === "COMPLETED" ? "✓" : milestone.status === "CURRENT" ? "●" : "○"}</span><div><strong>{milestone.label}</strong><small>{milestone.status === "CURRENT" ? "Đang thực hiện/chờ duyệt" : milestone.status === "COMPLETED" ? "Đã hoàn thành" : "Chưa bắt đầu"}</small></div></li>)}</ol>
        </div>}
      </section>}

      {projectStarted && <>
      <input name="project_type" type="hidden" value={projectType} />
      <div className="wizard-bar"><button className="secondary-button" type="button" onClick={() => setProjectStarted(false)}>← Đổi loại dự án</button><strong>{projectTypes.find((item) => item.value === projectType)?.label}</strong><small>{draftSavedAt ? "Đã tự động lưu nháp trên thiết bị này" : "Nội dung sẽ tự động lưu trên thiết bị này"}</small></div>
      {frameMessage && <p className="frame-message" role="alert">{frameMessage}</p>}
      {validationFeedback && <div className={`validation-feedback ${validationFeedback.kind}`} role={validationFeedback.kind === "error" ? "alert" : "status"} aria-live="polite"><strong>{validationFeedback.title}</strong><span>{validationFeedback.message}</span>{validationFeedback.kind === "error" && <button className="validation-target-button" onClick={() => focusValidationTarget(validationFeedback.targetPath)} type="button">Đi đến mục cần sửa ↓</button>}</div>}

      <section className="intake-frame active" id="intake-frame-2">
        <div className="section-heading"><span>02</span><div><h2>Thông tin cơ bản</h2><p>Chọn nhanh theo gợi ý; các trường kỹ thuật đã được ẩn.</p></div></div>
        <div className="field-grid">
          <TextField defaultValue={initialFormValues.project_name?.[0]} name="project_name" label="Tên dự án" placeholder="Tập 01 – Bữa cơm gia đình" help="Tập 01 – Bữa cơm gia đình" />
          <TextField defaultValue={initialFormValues.client_name?.[0]} name="client_name" label="Người phụ trách" placeholder="Nguyễn Văn A" help="Tên người tạo dự án" />
          <TextField defaultValue={initialFormValues.phone?.[0]} name="phone" label="Số điện thoại" type="tel" placeholder="0901 234 567" />
          <TextField defaultValue={initialFormValues.email?.[0]} name="email" label="Email" type="email" placeholder="tuhau@example.com" />
          <input name="project_subtype" type="hidden" value={projectType} />
          <input name="priority" type="hidden" value="NORMAL" />
          <input name="execution_mode" type="hidden" value="APPROVAL_GATED" />
          <SelectField defaultValue={initialFormValues.language?.[0]} name="language" label="Ngôn ngữ" options={[["vi-VN", "Tiếng Việt"], ["vi-VN-southwest", "Tiếng Việt – giọng miền Tây"], ["en", "Tiếng Anh"]]} />
          <SelectField defaultValue={initialFormValues.content_rating?.[0]} name="content_rating" label="Độ tuổi phù hợp" options={[["ALL", "Mọi độ tuổi"], ["13+", "Từ 13 tuổi"], ["16+", "Từ 16 tuổi"], ["18+", "Từ 18 tuổi"]]} />
          <SelectField defaultValue={initialFormValues.target_audience?.[0]} name="target_audience" label="Khán giả chính" options={[["FAMILY", "Gia đình"], ["YOUTH", "Người trẻ"], ["GENERAL", "Đại chúng"], ["SOUTHWEST_VIETNAM", "Khán giả miền Tây"]]} />
          <fieldset className="duration-picker"><legend>Thời lượng *</legend><div>{(projectType === "SHORT_MUSIC_CLIP" ? [["15_SECONDS", "15 giây"], ["30_SECONDS", "30 giây"], ["60_SECONDS", "60 giây"]] : [["3_MINUTES", "3 phút"], ["5_MINUTES", "5 phút"], ["7_MINUTES", "7 phút"], ["10_MINUTES", "10 phút"], ["15_MINUTES", "15 phút"]]).map(([value, text]) => <label className={durationTarget === value ? "selected" : ""} key={value}><input checked={durationTarget === value} name="duration_target" onChange={() => setDurationTarget(value)} required type="radio" value={value} /><span>{text}</span></label>)}</div><small>Chạm trực tiếp vào thời lượng mong muốn; dự toán sẽ tự tính lại.</small></fieldset>
          <SelectField defaultValue={initialFormValues.aspect_ratio?.[0]} name="aspect_ratio" label="Khung hình" options={[["9:16", "Dọc 9:16 – TikTok/Reels/Shorts"], ["16:9", "Ngang 16:9 – YouTube/Facebook"], ["1:1", "Vuông 1:1"]]} />
        </div>
        <fieldset className="platform-field">
          <legend>Nền tảng xuất bản *</legend>
          <div className="check-row">
            {platformOptions.map((platform) => (
              <label key={platform}>
                <input defaultChecked={initialFormValues.platforms?.includes(platform)} name="platforms" type="checkbox" value={platform} /> {platform}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="intake-frame active" id="intake-frame-3">
        <div className="section-heading"><span>03</span><div><h2>Video tham khảo</h2><p>Dán tối đa 5 link công khai. Hệ thống chỉ học cấu trúc/phong cách, không sao chép nguyên bản nếu chưa có quyền.</p></div></div>
        {referenceSources.map((source, index) => <article className="reference-row" key={index}>
          <label><span>Nền tảng *</span><select required value={source.platform} onChange={(event) => setReferenceSources((items) => items.map((item, i) => i === index ? {...item, platform: event.target.value as ReferenceSource["platform"]} : item))}><option value="YOUTUBE">YouTube</option><option value="TIKTOK">TikTok</option><option value="FACEBOOK">Facebook</option></select></label>
          <label><span>Link video *</span><input required type="url" placeholder="https://..." value={source.url} onChange={(event) => setReferenceSources((items) => items.map((item, i) => i === index ? {...item, url: event.target.value} : item))} /></label>
          <label><span>Cách sử dụng *</span><select required value={source.usage_mode} onChange={(event) => setReferenceSources((items) => items.map((item, i) => i === index ? {...item, usage_mode: event.target.value as ReferenceSource["usage_mode"]} : item))}><option value="INSPIRATION_ONLY">Chỉ lấy cảm hứng</option><option value="STRUCTURE_REFERENCE">Tham khảo cấu trúc</option><option value="AUTHORIZED_ADAPTATION">Chuyển thể – đã có quyền</option></select></label>
          <label className="wide-field"><span>Điểm muốn học theo</span><input placeholder="Ví dụ: nhịp dựng nhanh, mở đầu gây tò mò, tông hài gia đình" value={source.notes} onChange={(event) => setReferenceSources((items) => items.map((item, i) => i === index ? {...item, notes: event.target.value} : item))} /></label>
          <label className="consent"><input required type="checkbox" checked={source.rights_confirmed} onChange={(event) => setReferenceSources((items) => items.map((item, i) => i === index ? {...item, rights_confirmed: event.target.checked} : item))} /> Tôi xác nhận link công khai và có quyền sử dụng theo lựa chọn trên.</label>
          <button type="button" className="remove-button" onClick={() => setReferenceSources((items) => items.filter((_, i) => i !== index))}>Xóa link</button>
        </article>)}
        <button type="button" className="secondary-button" disabled={referenceSources.length >= 5} onClick={() => setReferenceSources((items) => [...items, {platform: "YOUTUBE", url: "", usage_mode: "INSPIRATION_ONLY", rights_confirmed: false, notes: ""}])}>+ Thêm link tham khảo</button>
      </section>

      <section className="intake-frame active" id="intake-frame-5">
        <div className="section-heading"><span>04</span><div><h2>Nội dung dự án</h2><p>Chỉ hiển thị thông tin cần cho loại dự án đã chọn.</p></div></div>
        <div className="field-grid">
          {projectType === "SHORT_FILM" && <>
            <TextField defaultValue={initialFormValues.story_idea?.[0]} name="story_idea" label="Ý tưởng tập / phim" placeholder="Hai chị em hiểu lầm nhau vì chuyện chăm sóc mẹ" help="Một câu kể chuyện chính" />
            <SelectField defaultValue={initialFormValues.social_theme?.[0]} name="social_theme" label="Chủ đề" options={[["FAMILY", "Gia đình"], ["LOVE", "Tình cảm"], ["FRIENDSHIP", "Bạn bè"], ["COMMUNITY", "Đời sống xã hội"], ["EDUCATION", "Giáo dục"]]} />
            <SelectField defaultValue={initialFormValues.story_genre?.[0]} name="story_genre" label="Thể loại" options={[["FAMILY_DRAMA", "Tâm lý gia đình"], ["COMEDY", "Hài"], ["ROMANCE", "Tình cảm"], ["INSPIRATIONAL", "Truyền cảm hứng"], ["MYSTERY", "Bí ẩn"]]} />
            <SelectField defaultValue={initialFormValues.primary_setting?.[0]} name="primary_setting" label="Bối cảnh chính" options={[["HOME", "Trong nhà"], ["RURAL", "Miền quê"], ["CITY", "Thành phố"], ["MARKET", "Chợ/quán ăn"], ["SCHOOL", "Trường học"]]} />
            <SelectField defaultValue={initialFormValues.ending_direction?.[0]} name="ending_direction" label="Kiểu kết thúc" options={[["HAPPY", "Có hậu"], ["EMOTIONAL", "Cảm động"], ["OPEN", "Kết thúc mở"], ["TWIST", "Bất ngờ"], ["LESSON", "Có bài học"]]} />
            <SelectField defaultValue={initialFormValues.dialogue_source?.[0]} name="dialogue_source" label="Nguồn lời thoại" options={[["AI_DRAFT_OWNER_APPROVES", "AI soạn, chủ dự án duyệt"], ["OWNER_PROVIDED", "Chủ dự án cung cấp"], ["MIXED", "Kết hợp cả hai"]]} />
            <ShortFilmWorkflowForm
              eligibleCharacters={eligibleCharacters}
              value={shortFilmWorkflow}
              generatingScript={generatingScript}
              checkingScriptAccount={checkingAccounts}
              onGenerateScript={generateShortFilmScript}
              onRequestBudgetApproval={() => { setFrameMessage("Đang kiểm tra tài khoản để mở tạo bản nháp. Chỉ thao tác tạo bản nháp mới gọi OpenAI."); void checkAccounts(); }}
              scriptGenerationReady={scriptGenerationReady}
              scriptBudgetSummary={`Kịch bản AI tối đa ${providerBudget.estimate.script.toLocaleString("vi-VN")} ${providerBudget.estimate.currency} · Tổng dự toán ${providerBudget.estimate.total.toLocaleString("vi-VN")} ${providerBudget.estimate.currency}`}
              scriptAccountSummary={openAiAccountCheck ? `OpenAI: ${openAiAccountCheck.status} · ${openAiAccountCheck.message}` : "OpenAI chưa được kiểm tra."}
              providerStatus={shortFilmProviderStatus}
              pilotBudgetApproved={Boolean(shortFilmWorkflow.pilot_budget_approval)}
              pilotBudgetSummary="3 clip × 15 giây · Runway tối đa 700 credits · ElevenLabs tối đa 1.000 credits · Sync tối đa 3 USD."
              onApprovePilotBudget={() => void approveShortFilmPilotBudget()}
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

      <section className="budget-panel intake-frame active" id="intake-frame-4">
        <div className="section-heading"><span>05</span><div><h2>Dự toán kinh phí</h2><p>Xem tổng chi phí dự kiến và kiểm tra tài khoản. Kịch bản AI chỉ phát sinh phí khi bạn bấm nút tạo bản nháp rõ ràng.</p></div></div>
        <div className="internal-service-grid">
          <label><span>Nguồn nhạc phim</span><select value={providerBudget.internal_services.music_source} onChange={(event) => setProviderBudget((current) => ({ ...current, internal_services: { ...current.internal_services, music_source: event.target.value as ProviderBudgetPlan["internal_services"]["music_source"] }, approval: { ...current.approval, decision: "PENDING", reviewed_at: undefined } }))}><option value="NOT_SELECTED">Chưa chọn</option><option value="PROJECT_OWNER_LICENSED">Chủ dự án cung cấp · đã có quyền</option><option value="LICENSED_LIBRARY">Thư viện nhạc đã cấp phép</option></select><small>Không sử dụng nhạc chưa xác nhận quyền.</small></label>
        </div>
        <div className="budget-estimate-grid">
          {(["script", "video", "voice", "lip_sync", "contingency"] as const).map((key) => <div className="budget-line" key={key}><span>{key === "script" && providerBudget.providers.script === "PROJECT_OWNER" ? "Kịch bản do bạn cung cấp" : ({ script: "Kịch bản AI", video: "Tạo video", voice: "Giọng nói", lip_sync: "Khớp khẩu hình", contingency: "Dự phòng 20%" } as const)[key]}</span><strong>{providerBudget.estimate[key].toLocaleString("vi-VN")} USD</strong></div>)}
          <div className="budget-total"><span>Kinh phí đề xuất</span><strong>{providerBudget.estimate.total.toLocaleString("vi-VN")} USD</strong><small>Ước tính cho {providerBudget.estimate.estimated_duration_seconds} giây</small></div>
        </div>
        <div className={`budget-approval ${budgetApproved ? "approved" : "pending"}`}>
          <div><strong>{budgetApproved ? "KINH PHÍ ĐÃ DUYỆT" : "CHỜ DUYỆT"}</strong><p>{budgetApproved ? `Hạn mức ${providerBudget.approval.approved_limit.toLocaleString("vi-VN")} ${providerBudget.estimate.currency}. Các bước sản xuất vẫn chờ bạn duyệt.` : projectType === "SHORT_FILM" && shortFilmWorkflow.script_source !== "PROJECT_OWNER_PROVIDED" ? "Sau khi tài khoản đạt, nút tạo bản nháp AI sẽ duyệt hạn mức và chỉ gọi OpenAI. Dự án chỉ được khởi tạo sau khi bạn duyệt kịch bản." : "Nút cuối trang sẽ đồng thời duyệt kinh phí và khởi tạo dự án. Chưa tạo hình ảnh, giọng nói hoặc video."}</p></div>
        </div>
        <div className={`account-preflight ${accountExecutionReady ? "approved" : "pending"}`}>
          <div><strong>KIỂM TRA TÀI KHOẢN TRƯỚC KHI CHẠY</strong><p>Chỉ đọc số dư/hạn mức. Không tạo ảnh, video, giọng hoặc trừ credit.</p></div>
          <button className={accountPreflight ? "action-completed" : "action-current"} disabled={checkingAccounts} type="button" onClick={() => void checkAccounts()}>{checkingAccounts ? "Đang kiểm tra…" : accountPreflight ? "✓ Đã kiểm tra · Kiểm tra lại" : "Kiểm tra tài khoản"}</button>
          {accountPreflight && <div className="account-check-results">{accountPreflight.providers.map((item) => <article key={item.provider}><strong>{providerLabels[item.provider] ?? item.provider} · {accountStatusLabels[item.status] ?? item.status}</strong><span>{item.message}</span>{item.required_units !== undefined && <small>Cần {item.required_units.toLocaleString("vi-VN")} {item.unit}{item.available_units !== undefined ? ` · Còn ${item.available_units.toLocaleString("vi-VN")} ${item.unit}` : ""}</small>}<small><b>Cần làm:</b> {accountAction(item.status)}</small><ProviderAccountLinks provider={item.provider} status={item.status} /></article>)}</div>}
          {accountPreflight?.execution_gate === "MANUAL_CONFIRMATION_REQUIRED" && <label className="consent"><input checked={manualBalanceConfirmed} type="checkbox" onChange={(event) => setManualBalanceConfirmed(event.target.checked)} /> Tôi đã kiểm tra Billing của các nhà cung cấp không có API số dư và xác nhận đủ hạn mức.</label>}
          {accountPreflight?.execution_gate === "BLOCKED" && <p className="operation-error">ĐÃ KHÓA CHẠY: xem đúng trạng thái và “Hành động” của từng nhà cung cấp ở trên; không mặc định rằng mọi lỗi đều do thiếu tiền.</p>}
          {accountExecutionReady && <p className="operation-success">TÀI KHOẢN ĐÃ SẴN SÀNG CHO DỰ TOÁN HIỆN TẠI.</p>}
        </div>
      </section>

      <section className="intake-frame active" id="intake-frame-6">
        <div className="section-heading"><span>06</span><div><h2>Kiểm tra &amp; tạo dự án</h2><p>Xem lại dữ liệu đã nhập ngay trên trang. Mục thiếu sẽ đỏ; mục đạt sẽ xanh.</p></div></div>
        <div className="next-step-guide" aria-live="polite">
          <strong>Bước tiếp theo cần làm</strong>
          <ol>
            <li className="current">Kéo lên trên để sửa trực tiếp bất kỳ mục màu đỏ nào.</li>
            <li>Kiểm tra tóm tắt nhân vật, tài khoản và kinh phí đề xuất.</li>
            <li>Bấm <b>“Duyệt kinh phí &amp; khởi tạo dự án”</b> để kiểm tra và tạo dự án trong một lần.</li>
          </ol>
          <p>Khởi tạo dự án không gọi nhà cung cấp sản xuất và chưa phát sinh credit.</p>
        </div>
        {projectType !== "SHORT_FILM" && <>
          <p className="library-status">{libraryMessage}</p>
          <div className="character-picker">
          <label>
            <span>1. Chọn nhân vật</span>
            <select value={characterToAdd} onChange={(event) => setCharacterToAdd(event.target.value)}>
              {eligibleCharacters.map((character) => (
                <option key={character.character_id} value={character.character_id}>
                  {character.character_name} · {character.character_type}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-button" disabled={!characterToAdd} onClick={addCharacter} type="button">2. Thêm nhân vật vào dự án</button>
          </div>
        </>}

        {projectType === "SHORT_FILM" && <div className="selected-character-summary">
          <strong>Nhân vật đã chọn ở phần trước</strong>
          <span>{shortFilmWorkflow.film_characters.length} nhân vật sẽ được đưa vào hợp đồng.</span>
          {shortFilmWorkflow.film_characters.map((character) => {
            const actor = eligibleCharacters.find((item) => item.character_id === character.source_actor_id);
            const roleLabel = ({ PROTAGONIST: "Nhân vật chính", ANTAGONIST: "Đối trọng", SUPPORTING: "Hỗ trợ", CAMEO: "Khách mời", EXTRA: "Quần chúng" } as const)[character.film_role];
            return <article key={character.source_actor_id}><div><b>{character.film_character_name}</b><small>{actor?.character_name ?? character.source_actor_id}</small></div><span>{roleLabel}</span></article>;
          })}
        </div>}

        {projectType !== "SHORT_FILM" && <div className="character-list">
          {characters.map((character, index) => {
            const libraryCharacter = eligibleCharacters.find(
              (item) => item.character_id === character.character_id,
            );
            return (
              <article className="character-card" key={character.character_id}>
                <div className="character-card-heading">
                  <div>
                    <strong>{libraryCharacter?.character_name}</strong>
                  </div>
                  <button className="remove-button" onClick={() => {
                    invalidateConfirmation();
                    setCharacters((current) => current.filter((_, itemIndex) => itemIndex !== index));
                  }} type="button">Xóa</button>
                </div>
                <div className="field-grid">
                  <label><span>Vai trò dự án *</span><select value={character.project_role} onChange={(event) => updateCharacter(index, { project_role: event.target.value })}>{projectRoles.map((role) => <option key={role}>{role}</option>)}</select></label>
                  <label><span>Vai trò biểu diễn *</span><select value={character.performance_role} onChange={(event) => updateCharacter(index, { performance_role: event.target.value })}>{performanceRoles.map((role) => <option key={role}>{role}</option>)}</select></label>
                </div>
              </article>
            );
          })}
        </div>}
        <div className="final-action-panel">
          <strong>{characters.length === 0 ? "Chưa có nhân vật trong dự án" : `Sẵn sàng kiểm tra ${characters.length} nhân vật`}</strong>
          <span>{characters.length === 0 ? "Quay lại phần nội dung để chọn nhân vật." : "Nhân vật đã được đồng bộ tự động; không cần chọn lại."}</span>
          <button className={`final-check-button${createdProject ? " action-completed" : ""}`} disabled={submitting || creating || Boolean(createdProject) || characters.length === 0 || !accountExecutionReady || !scriptReadyForCreation} type="submit">{createdProject ? `✓ Dự án ${createdProject.project_id} đã được tạo` : submitting || creating ? "Đang kiểm tra và khởi tạo…" : characters.length === 0 ? "Chưa thể tạo — chưa có nhân vật" : !accountExecutionReady ? "Kiểm tra tài khoản trước khi tạo" : !scriptReadyForCreation ? "Hoàn thiện và duyệt kịch bản trước khi tạo" : `Duyệt ${providerBudget.estimate.total.toLocaleString("vi-VN")} USD & khởi tạo dự án`}</button>
        </div>
      </section>
      </>}
      {result && <ResultDetails value={result} />}
      {creationResult && <ResultDetails value={creationResult} />}
      {createdProject?.next_action === "APPROVE_CONTRACT" && (
        <section className="confirmation-panel">
          <div>
            <h2>Duyệt hợp đồng dự án</h2>
            <p>Dự án <strong>{createdProject.project_id}</strong> đã được tạo. Duyệt để mở phần chuẩn bị nội dung tiếp theo.</p>
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
            <h2>Tiếp tục hoàn thiện phim ngắn</h2>
            <p className="library-status">Lưu các quyết định duyệt hiện tại để mở đúng bước tiếp theo. Thao tác này chưa sản xuất hình ảnh hoặc video.</p>
          </div>
          <button disabled={savingShortFilm} onClick={saveShortFilmWorkflow} type="button">
            {savingShortFilm ? "Đang lưu…" : "Lưu thay đổi và tiếp tục"}
          </button>
          {shortFilmSaveResult && <ResultDetails value={shortFilmSaveResult} />}
        </section>
      )}
      {createdProject?.next_action === "PREPARE_SHORT_FILM_PILOT" && (
        <section className="confirmation-panel">
          <div>
            <h2>Chuẩn bị kế hoạch clip mẫu</h2>
            <p>Chuẩn bị {shortFilmWorkflow.pilot_sampling.sample_count} clip mẫu × {shortFilmWorkflow.pilot_sampling.clip_duration_seconds} giây để chủ dự án đánh giá trước khi sản xuất toàn phim. Bước này chưa tạo clip.</p>
            <label className="consent"><input checked={pilotSyncBalanceConfirmed} type="checkbox" onChange={(event) => setPilotSyncBalanceConfirmed(event.target.checked)} /> Tôi đã mở Sync Billing và xác nhận đủ hạn mức cho đợt clip mẫu này.</label>
          </div>
          <button disabled={!budgetApproved || !pilotSyncBalanceConfirmed || preparingShortFilmPilot} onClick={() => void prepareShortFilmPilot()} type="button">
            {preparingShortFilmPilot ? "Đang chuẩn bị…" : "Chuẩn bị kế hoạch clip mẫu"}
          </button>
          {shortFilmPilotPlanResult && <ResultDetails value={shortFilmPilotPlanResult} />}
          {shortFilmPilotPlanResult && <div className="approval-gate">
            <strong>Duyệt chi phí chạy thật đợt clip mẫu</strong>
            <p>Đề xuất tối đa: {Math.ceil(shortFilmWorkflow.pilot_sampling.sample_count * shortFilmWorkflow.pilot_sampling.clip_duration_seconds * 12 * 1.2).toLocaleString("vi-VN")} Runway credits · {Math.ceil(shortFilmWorkflow.pilot_sampling.sample_count * shortFilmWorkflow.pilot_sampling.clip_duration_seconds * 15 * 1.2).toLocaleString("vi-VN")} ElevenLabs characters · {(shortFilmWorkflow.pilot_sampling.sample_count * shortFilmWorkflow.pilot_sampling.clip_duration_seconds * 0.05 * 1.2).toFixed(2)} USD Sync.</p>
            <label className="consent"><input checked={pilotExecutionApproved} type="checkbox" onChange={(event) => setPilotExecutionApproved(event.target.checked)} /> Tôi duyệt đúng hạn mức trên cho đợt clip mẫu; không duyệt sản xuất toàn phim.</label>
            <button disabled={!pilotExecutionApproved || runningPilotExecution} onClick={() => void executeShortFilmPilot()} type="button">{runningPilotExecution ? "Đang bắt đầu…" : "Chạy đợt clip mẫu"}</button>
            <button className="secondary-button" onClick={() => void refreshShortFilmPilotStatus()} type="button">Cập nhật tiến độ</button>
            {pilotExecutionResult && <ResultDetails value={pilotExecutionResult} />}
          </div>}
        </section>
      )}
      {createdProject?.next_action === "PREPARE_MV_PRODUCTION" && (
        <section className="confirmation-panel">
          <div>
            <h2>Lập kế hoạch sản xuất MV</h2>
            <p>Chuẩn bị kế hoạch cho dự án <strong>{createdProject.project_id}</strong> và đưa vào trạng thái chờ bạn duyệt. Bước này chưa tạo video.</p>
          </div>
          <button disabled={preparing} onClick={prepareMvProduction} type="button">
            {preparing ? "Đang lập kế hoạch…" : "Lập kế hoạch MV để duyệt"}
          </button>
        </section>
      )}
      {createdProject?.next_action === "PRODUCE_SHORT_FILM" && (() => {
        const caps = proposedFullFilmCaps();
        return <section className="confirmation-panel">
          <div>
            <h2>Sản xuất toàn phim sau khi clip mẫu đã duyệt</h2>
            <p>Hệ thống xử lý lần lượt từng cảnh và tái sử dụng các clip mẫu đã duyệt. Đây là hạn mức tối đa; chi phí thực tế có thể thấp hơn.</p>
            <p><strong>Đề xuất tối đa:</strong> {caps.runway_credits.toLocaleString("vi-VN")} Runway credits · {caps.elevenlabs_characters.toLocaleString("vi-VN")} ElevenLabs characters · {caps.sync_usd.toFixed(2)} USD Sync.</p>
            <label className="consent"><input checked={fullFilmExecutionApproved} type="checkbox" onChange={(event) => setFullFilmExecutionApproved(event.target.checked)} /> Tôi duyệt đúng hạn mức trên để sản xuất toàn phim.</label>
          </div>
          <button disabled={!fullFilmExecutionApproved || runningFullFilmExecution} onClick={() => void executeShortFilmFullFilm()} type="button">{runningFullFilmExecution ? "Đang khởi tạo…" : "Bắt đầu sản xuất toàn phim"}</button>
          <button className="secondary-button" onClick={() => void refreshShortFilmFullFilmStatus()} type="button">Xử lý bước tiếp theo / cập nhật tiến độ</button>
          {fullFilmExecutionResult && <ResultDetails value={fullFilmExecutionResult} />}
        </section>;
      })()}
      {preparationResult && <ResultDetails value={preparationResult} />}
      {createdProject?.next_action === "APPROVE_MV_PRODUCTION_PLAN" && (
        <section className="confirmation-panel">
          <div>
            <h2>Kế hoạch sản xuất đang chờ duyệt</h2>
            <p>Kế hoạch đã được chuẩn bị cho <strong>{createdProject.project_id}</strong>. Chưa tạo hình ảnh hoặc video.</p>
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
            <h2>Chuẩn bị nhạc và tài liệu MV</h2>
            <p>Nhập link Google Drive của beat hoặc nhạc nền chính. Hệ thống chỉ kiểm tra nguồn và chờ bạn duyệt, chưa tạo video.</p>
            <label>
              <span>Link Google Drive của beat/nhạc nền *</span>
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
            <p>Nhạc, lời và video nguồn của dự án <strong>{createdProject.project_id}</strong> đã được kiểm tra. Duyệt để mở bước lập kế hoạch cảnh; chưa tạo video.</p>
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
            <p>Tài sản của <strong>{createdProject.project_id}</strong> đã sẵn sàng để lập kế hoạch cảnh. Chưa tạo video.</p>
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
            <h2>Kế hoạch cảnh MV đang chờ duyệt</h2>
            <p>Kế hoạch cảnh của <strong>{createdProject.project_id}</strong> đã bám theo lời và nhạc. Chưa tạo video.</p>
          </div>
        </section>
      )}
    </form>
  );
}
