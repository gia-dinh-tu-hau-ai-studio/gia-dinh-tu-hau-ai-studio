import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { calculateShortFilmPilotBudget, selectShortFilmPilotSamples, shortFilmMediaExecutionDecision } from "@tu-hau/contracts";
import { DriveConnector } from "../connectors/google-drive/drive.connector";
import { CharacterLibraryConnector } from "../connectors/google-sheets/character-library.connector";
import { ProjectRegistryConnector } from "../connectors/google-sheets/project-registry.connector";
import { checkProviderAccounts } from "./provider-account-preflight";
import { ElevenLabsPilotProvider, RunwayPilotProvider, SyncPilotProvider } from "./short-film-pilot.providers";
import { assembleVideoBuffers, fitAudioBuffer, probeVideoBuffer, trimVideoBuffer, type VideoTechnicalEvidence } from "../media/short-film-pilot-assembler";
import { preparePrivateRunwayCharacterFace, preparePrivateRunwayKeyframe, type RunwayAssetCache } from "./runway-private-keyframe";

const MANIFEST_NAME = "SHORT_FILM_PILOT_PROVIDER_EXECUTION_V1.json";
const LEGACY_VARIANT_MANIFEST_NAME = "SHORT_FILM_PILOT_PERFORMANCE_VARIANT_V1.json";
const VARIANT_MANIFEST_NAME = "SHORT_FILM_PILOT_PERFORMANCE_VARIANT_IDENTITY_LOCKED_V2.json";
const EVALUATION_REEL_MANIFEST_NAME = "SHORT_FILM_PILOT_EVALUATION_REEL_30S_V1.json";

type PilotTask = {
  sample_id: string;
  shot_id: string;
  runway_task_id?: string;
  runway_status: string;
  runway_output_url?: string;
  dialogue_line_id?: string;
  audio_drive_file_id?: string;
  elevenlabs_request_id?: string;
  voice_master_id?: string;
  elevenlabs_voice_id?: string;
  tts_model_id?: "eleven_v3";
  tts_language_code?: "vi";
  transcript_text?: string;
  transcript_language_code?: string;
  transcript_language_probability?: number;
  transcript_similarity?: number;
  transcript_verified?: boolean;
  audio_review_decision?: "PENDING" | "APPROVE" | "REJECT";
  audio_reviewed_at?: string;
  sync_generation_id?: string;
  sync_status?: string;
  sync_output_url?: string;
  final_drive_file_id?: string;
};

function normalizeVietnamese(value: string) {
  return value.normalize("NFC").toLocaleLowerCase("vi").replace(/[^a-z\u00c0-\u024f\u1e00-\u1eff\d\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function dialogueSimilarity(expected: string, actual: string) {
  const left = normalizeVietnamese(expected), right = normalizeVietnamese(actual);
  if (!left || !right) return 0;
  const distances = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = distances[0]; distances[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = distances[column];
      distances[column] = Math.min(distances[column] + 1, distances[column - 1] + 1, diagonal + (left[row - 1] === right[column - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return 1 - distances[right.length] / Math.max(left.length, right.length);
}

export function verifyVietnameseTranscript(expected: string, evidence: { text: string; languageCode: string; languageProbability: number }) {
  const similarity = dialogueSimilarity(expected, evidence.text);
  return { passed: ["vi", "vie"].includes(evidence.languageCode.toLowerCase()) && evidence.languageProbability >= 0.8 && similarity >= 0.82, similarity };
}

export function reviewDialogueAudioGate(input: Pick<PilotExecutionManifest, "status" | "tasks">, decision: "APPROVE" | "REJECT", reviewedAt: string) {
  if (input.status !== "AWAITING_DIALOGUE_AUDIO_APPROVAL") throw new Error("DIALOGUE_AUDIO_NOT_AWAITING_APPROVAL");
  const dialogueTasks = input.tasks.filter((task) => task.dialogue_line_id);
  if (!dialogueTasks.length || dialogueTasks.some((task) => !task.audio_drive_file_id || !task.transcript_verified)) throw new Error("DIALOGUE_AUDIO_EVIDENCE_INCOMPLETE");
  for (const task of dialogueTasks) { task.audio_review_decision = decision; task.audio_reviewed_at = reviewedAt; }
  return decision === "APPROVE"
    ? { status: "PROCESSING_RUNWAY" as const }
    : { status: "FAILED" as const, error: { stage: "DIALOGUE_AUDIO_APPROVAL", message: "DIALOGUE_AUDIO_REJECTED_BY_PROJECT_OWNER" } };
}

type PilotExecutionManifest = {
  schema_version: "SHORT_FILM_PILOT_PROVIDER_EXECUTION_V1";
  execution_id: string;
  project_id: string;
  status: "SUBMITTING" | "PREPARING_DIALOGUE_AUDIO" | "AWAITING_DIALOGUE_AUDIO_APPROVAL" | "PROCESSING_RUNWAY" | "PROCESSING_SYNC" | "READY_FOR_ASSEMBLY" | "AWAITING_PILOT_QC" | "FAILED";
  samples: ReturnType<typeof selectShortFilmPilotSamples>;
  tasks: PilotTask[];
  caps: { runway_credits: number; elevenlabs_characters: number; sync_usd: number };
  provider_calls_made: boolean;
  heartbeat_at: string;
  started_at: string;
  error?: { stage: string; message: string };
  runway_assets?: RunwayAssetCache;
  outputs?: Array<{ sample_id: string; drive_file_id: string; video_url: string; width: 1920; height: 1080 }>;
};

type PilotPerformanceVariantManifest = {
  schema_version: "SHORT_FILM_PILOT_PERFORMANCE_VARIANT_IDENTITY_LOCKED_V2";
  execution_id: string;
  project_id: string;
  source_execution_id: string;
  shot_id: string;
  duration_seconds: 10;
  status: "PROCESSING_RUNWAY" | "PROCESSING_SYNC" | "AWAITING_VARIANT_QC" | "APPROVED" | "FAILED";
  caps: { runway_credits: 50; sync_usd: 0.5 };
  performance_prompt: string;
  source_audio_drive_file_id: string;
  performance_reference_drive_file_id: string;
  locked_character_id: string;
  locked_master_identity_id: string;
  locked_master_identity_version?: string;
  locked_character_image_url: string;
  locked_character_body_url: string;
  runway_task_id?: string;
  runway_status?: string;
  runway_output_url?: string;
  sync_generation_id?: string;
  sync_status?: string;
  sync_output_url?: string;
  final_drive_file_id?: string;
  video_url?: string;
  heartbeat_at: string;
  started_at: string;
  reviewed_at?: string;
  error?: { stage: string; message: string };
  runway_assets?: RunwayAssetCache;
};

type EvaluationReelTask = {
  shot_id: string;
  character_id: string;
  master_identity_id: string;
  face_reference_url: string;
  body_reference_url: string;
  source_video_drive_file_id: string;
  audio_drive_file_id: string;
  runway_task_id?: string;
  runway_status?: string;
  runway_output_url?: string;
  sync_generation_id?: string;
  sync_status?: string;
  sync_output_url?: string;
  completed_video?: string;
  generation_mode?: "APPROVED_FACE_IMAGE_TO_VIDEO";
  performance_contract?: EvaluationPerformanceContract;
  technical_evidence?: VideoTechnicalEvidence;
  sync_audio_duration_seconds?: 10;
  runway_assets?: RunwayAssetCache;
};

type EvaluationPerformanceContract = {
  framing: "CINEMATIC_MEDIUM_CLOSE_UP";
  setting: "SHOT_PLAN_LOCATION_NOT_STUDIO_BACKDROP";
  acting_mode: "DIALOGUE_DRIVEN_PHYSICAL_PERFORMANCE";
  required_beats: ["LISTEN_OR_CONSIDER", "EMOTIONAL_REACTION", "PURPOSEFUL_ACTION", "SETTLE_IN_CHARACTER"];
  forbidden: ["PRESENTER_DELIVERY", "STATIC_TALKING_HEAD", "PLAIN_GRAY_STUDIO", "RANDOM_GESTURES"];
};

type EvaluationReelQc = {
  identity_locked: boolean;
  cinematic_setting: boolean;
  purposeful_action: boolean;
  emotional_arc: boolean;
  dialogue_lip_sync: boolean;
  voice_match: boolean;
  continuity: boolean;
  exact_duration_30s: boolean;
};

type EvaluationReelManifest = {
  schema_version: "SHORT_FILM_PILOT_EVALUATION_REEL_30S_V1";
  execution_id: string;
  project_id: string;
  source_execution_id: string;
  duration_seconds: 30;
  status: "PROCESSING_RUNWAY" | "PROCESSING_SYNC" | "ASSEMBLING" | "AWAITING_REEL_QC" | "APPROVED" | "REJECTED" | "FAILED";
  caps: { runway_credits: 432; elevenlabs_characters: 2000; sync_usd: 1.8 };
  tasks: EvaluationReelTask[];
  current_task_index: number;
  final_drive_file_id?: string;
  video_url?: string;
  technical_evidence?: VideoTechnicalEvidence;
  qc?: EvaluationReelQc;
  reviewed_at?: string;
  heartbeat_at: string;
  started_at: string;
  error?: { stage: string; message: string };
};

export const EVALUATION_PERFORMANCE_CONTRACT: EvaluationPerformanceContract = {
  framing: "CINEMATIC_MEDIUM_CLOSE_UP",
  setting: "SHOT_PLAN_LOCATION_NOT_STUDIO_BACKDROP",
  acting_mode: "DIALOGUE_DRIVEN_PHYSICAL_PERFORMANCE",
  required_beats: ["LISTEN_OR_CONSIDER", "EMOTIONAL_REACTION", "PURPOSEFUL_ACTION", "SETTLE_IN_CHARACTER"],
  forbidden: ["PRESENTER_DELIVERY", "STATIC_TALKING_HEAD", "PLAIN_GRAY_STUDIO", "RANDOM_GESTURES"],
};

export function validateEvaluationReelTechnicalEvidence(evidence: VideoTechnicalEvidence) {
  if (Math.abs(evidence.duration_seconds - 30) > 0.25) throw new Error(`EVALUATION_REEL_ACTUAL_DURATION_MISMATCH:expected=30:actual=${evidence.duration_seconds.toFixed(3)}`);
  if (evidence.width !== 1920 || evidence.height !== 1080) throw new Error(`EVALUATION_REEL_RESOLUTION_MISMATCH:${evidence.width}x${evidence.height}`);
  if (!evidence.has_audio) throw new Error("EVALUATION_REEL_AUDIO_MISSING");
  return evidence;
}

export function reviewEvaluationReelGate(manifest: EvaluationReelManifest, input: { decision: "APPROVE" | "REJECT"; qc: EvaluationReelQc }, reviewedAt: string) {
  if (manifest.status !== "AWAITING_REEL_QC" || !manifest.final_drive_file_id || !manifest.technical_evidence) throw new Error("EVALUATION_REEL_NOT_READY_FOR_QC");
  validateEvaluationReelTechnicalEvidence(manifest.technical_evidence);
  manifest.qc = input.qc; manifest.reviewed_at = reviewedAt; manifest.heartbeat_at = reviewedAt;
  if (input.decision === "APPROVE") {
    if (Object.values(input.qc).some((value) => !value)) throw new Error("EVALUATION_REEL_QC_INCOMPLETE");
    manifest.status = "APPROVED";
  } else {
    manifest.status = "REJECTED";
    manifest.error = { stage: "EVALUATION_REEL_QC", message: "EVALUATION_REEL_REJECTED_BY_PROJECT_OWNER" };
  }
  return manifest;
}

export function rejectEvaluationReelForRestart(manifest: EvaluationReelManifest, rejectedAt: string) {
  if (manifest.status !== "AWAITING_REEL_QC") throw new Error("EVALUATION_REEL_NOT_AWAITING_QC_RESTART");
  return {
    archiveName: `SHORT_FILM_EVALUATION_REEL_REJECTED_${rejectedAt.replace(/[:.]/g, "-")}_${manifest.execution_id}.json`,
    archived: {
      ...manifest,
      status: "REJECTED" as const,
      reviewed_at: rejectedAt,
      heartbeat_at: rejectedAt,
      error: { stage: "EVALUATION_REEL_QC", message: "EVALUATION_REEL_REJECTED_BY_PROJECT_OWNER_FOR_RESTART" },
    },
  };
}

export function validateEvaluationReelRequest(input: { durationSeconds: number; caps: { runway_credits: number; elevenlabs_characters: number; sync_usd: number } }) {
  if (input.durationSeconds !== 30) throw new Error("EVALUATION_REEL_DURATION_MUST_BE_30_SECONDS");
  if (input.caps.runway_credits !== 432 || input.caps.elevenlabs_characters !== 2000 || input.caps.sync_usd !== 1.8) throw new Error("EVALUATION_REEL_CAP_MISMATCH");
}

export function selectEvaluationReelSourceTasks(pilot: Pick<PilotExecutionManifest, "samples" | "tasks">) {
  const tenSecondShotIds = new Set(pilot.samples.flatMap((sample) => sample.shots).filter((shot) => shot.duration_seconds === 10).map((shot) => shot.shot_id));
  const candidates = pilot.tasks.filter((task) => tenSecondShotIds.has(task.shot_id) && task.final_drive_file_id && task.audio_drive_file_id && task.transcript_verified && task.audio_review_decision === "APPROVE").slice(0, 3);
  if (candidates.length !== 3) throw new Error("EVALUATION_REEL_REQUIRES_THREE_APPROVED_TEN_SECOND_SHOTS");
  return candidates;
}

export function validateProviderReadyFaceReference(input: { face_reference_url: string; body_reference_url: string }) {
  if (!input.face_reference_url || input.face_reference_url === input.body_reference_url) throw new Error("FACE_REFERENCE_REQUIRES_SEPARATE_APPROVED_CLOSEUP");
  return input.face_reference_url;
}

export function buildEvaluationReelFacePrompt(input: { scenePrompt: string; dialogueText: string }) {
  return [
    "Cinematic medium close-up of the exact approved and locked character identity from the input image.",
    "Keep the full head, both eyes, nose, mouth and shoulders visible for the entire shot; never crop the face out of frame.",
    `Scene: ${input.scenePrompt}`,
    `Dialogue meaning: ${input.dialogueText}`,
    "Use the real location, lighting, props and camera axis described by the scene; never use a plain gray studio or interview backdrop.",
    "Perform four readable drama beats: listen or consider, react emotionally, complete one purposeful physical action motivated by the line, then settle in character.",
    "Natural Vietnamese television drama performance and acting timed to the dialogue meaning; never perform as a presenter or static talking head.",
    "Vietnamese speech only; no subtitles, text, identity change, face replacement, dancing or exaggerated random gestures.",
  ].join(" ").slice(0, 1_000);
}

export function resumeEvaluationReelManifest(manifest: EvaluationReelManifest, refreshed: Map<string, { face_reference_url: string; body_reference_url: string; master_identity_id?: string }>) {
  if (manifest.status !== "FAILED") throw new Error("EVALUATION_REEL_NOT_FAILED");
  const completedCount = manifest.tasks.findIndex((task) => !task.completed_video);
  manifest.current_task_index = completedCount < 0 ? manifest.tasks.length : completedCount;
  if (manifest.current_task_index >= manifest.tasks.length) throw new Error("EVALUATION_REEL_ALREADY_COMPLETE");
  for (let index = manifest.current_task_index; index < manifest.tasks.length; index += 1) {
    const task = manifest.tasks[index], character = refreshed.get(task.character_id);
    if (!character?.master_identity_id) throw new Error(`EVALUATION_REEL_CHARACTER_NOT_APPROVED_LOCKED:${task.character_id}`);
    validateProviderReadyFaceReference(character);
    task.face_reference_url = character.face_reference_url; task.body_reference_url = character.body_reference_url; task.master_identity_id = character.master_identity_id;
    delete task.runway_task_id; delete task.runway_status; delete task.runway_output_url; delete task.sync_generation_id; delete task.sync_status; delete task.sync_output_url; delete task.completed_video; delete task.runway_assets;
  }
  manifest.status = "PROCESSING_RUNWAY"; delete manifest.error; manifest.heartbeat_at = new Date().toISOString();
  return manifest;
}

export function validatePilotPerformanceVariant(input: {
  pilot: Pick<PilotExecutionManifest, "status" | "execution_id" | "tasks">;
  shotId: string;
  durationSeconds: number;
  caps: { runway_credits: number; sync_usd: number };
}) {
  if (input.pilot.status !== "AWAITING_PILOT_QC") throw new Error("PILOT_VARIANT_REQUIRES_AWAITING_QC");
  if (input.shotId !== "SHOT-005") throw new Error("PILOT_VARIANT_ONLY_APPROVED_FOR_SHOT_005");
  if (input.durationSeconds !== 10) throw new Error("PILOT_VARIANT_DURATION_MUST_BE_10_SECONDS");
  if (input.caps.runway_credits !== 50 || input.caps.sync_usd !== 0.5) throw new Error("PILOT_VARIANT_CAP_MISMATCH");
  const sourceTask = input.pilot.tasks.find((task) => task.shot_id === input.shotId);
  if (!sourceTask?.final_drive_file_id || !sourceTask.audio_drive_file_id || !sourceTask.transcript_verified || sourceTask.audio_review_decision !== "APPROVE") {
    throw new Error("PILOT_VARIANT_SOURCE_EVIDENCE_INCOMPLETE");
  }
  return sourceTask;
}

export function validateLockedCharacterPerformanceSource(input: {
  dialogue: { speaker_source_actor_id: string };
  keyframe: { approved_image_url: string };
  character?: {
    character_id: string;
    body_reference_url: string;
    face_reference_url: string;
    master_identity_id?: string;
    master_identity_version?: string;
    readiness: { master_identity: string };
  };
}) {
  const character = input.character;
  if (!character || character.character_id !== input.dialogue.speaker_source_actor_id) throw new Error("LOCKED_CHARACTER_ASSIGNMENT_MISMATCH");
  if (character.readiness.master_identity !== "APPROVED_LOCKED" || !character.master_identity_id) throw new Error("CHARACTER_MASTER_NOT_APPROVED_LOCKED");
  if (!character.face_reference_url || !character.body_reference_url) throw new Error("CHARACTER_MASTER_REFERENCE_SET_INCOMPLETE");
  if (input.keyframe.approved_image_url !== character.body_reference_url) throw new Error("APPROVED_KEYFRAME_NOT_FROM_LOCKED_CHARACTER_MASTER");
  return character;
}

export function selectLockedCharacterPerformanceImage(character: ReturnType<typeof validateLockedCharacterPerformanceSource>) {
  if (!character.face_reference_url) throw new Error("CHARACTER_MASTER_FACE_REFERENCE_MISSING");
  return character.face_reference_url;
}

export function approvePilotPerformanceVariant(input: {
  variant: Pick<PilotPerformanceVariantManifest, "status" | "shot_id" | "final_drive_file_id">;
  pilot: Pick<PilotExecutionManifest, "status" | "tasks">;
}) {
  if (input.variant.status !== "AWAITING_VARIANT_QC" || !input.variant.final_drive_file_id) throw new Error("PILOT_VARIANT_NOT_AWAITING_QC");
  if (input.pilot.status !== "AWAITING_PILOT_QC") throw new Error("PILOT_NOT_AWAITING_QC");
  const target = input.pilot.tasks.find((task) => task.shot_id === input.variant.shot_id);
  if (!target) throw new Error("PILOT_VARIANT_TARGET_NOT_FOUND");
  target.final_drive_file_id = input.variant.final_drive_file_id;
  return target;
}

export function buildPilotPerformancePrompt(basePrompt: string, dialogueText: string) {
  const prompt = [
    "Preserve the exact approved Tường Vy Character Master face, body proportions, wardrobe, room continuity and camera axis.",
    "Natural Vietnamese television drama acting timed to the approved Vietnamese dialogue; no identity change, subtitles, text, dancing, random gestures or foreign-language mouth movement.",
    "Tường Vy holds her phone naturally. Her finger pauses immediately before confirming a money transfer. Her shoulders and face show believable tension.",
    "On the words about two million dong she looks toward Phương An for reassurance. When explaining the promised first-workday refund, she draws the phone back toward her body and hesitates.",
    `Dialogue meaning: ${dialogueText}`,
    `Scene: ${basePrompt}`,
  ].join(" ");
  return prompt.slice(0, 1_000);
}

export function rejectPilotForRestart(manifest: PilotExecutionManifest, rejectedAt: string) {
  if (manifest.status !== "AWAITING_PILOT_QC") throw new Error("PILOT_NOT_AWAITING_QC_REJECTION");
  const archiveName = `SHORT_FILM_PILOT_REJECTED_${rejectedAt.replace(/[:.]/g, "-")}_${manifest.execution_id}.json`;
  return {
    archiveName,
    archived: { ...manifest, qc_rejection: { decision: "REJECT" as const, reviewer: "PROJECT_OWNER" as const, rejected_at: rejectedAt } },
    failed: { ...manifest, status: "FAILED" as const, heartbeat_at: rejectedAt, error: { stage: "PILOT_QC", message: "PILOT_REJECTED_BY_PROJECT_OWNER_FOR_RESTART" } },
  };
}

@Injectable()
export class ShortFilmPilotExecutionService {
  constructor(
    private readonly registry: ProjectRegistryConnector,
    private readonly characters: CharacterLibraryConnector,
    private readonly drive: DriveConnector,
  ) {}

  private secrets() {
    const runway = process.env.RUNWAYML_API_SECRET?.trim();
    const eleven = process.env.ELEVENLABS_API_KEY?.trim();
    const sync = process.env.SYNC_API_KEY?.trim();
    if (!runway || !eleven || !sync) throw new Error("PILOT_PROVIDER_SECRET_NOT_CONFIGURED");
    return { runway, eleven, sync };
  }

  async submit(projectId: string, caps: PilotExecutionManifest["caps"]) {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const existing = await this.drive.readPilotJson<PilotExecutionManifest>(context.project_folder_id, MANIFEST_NAME);
    if (existing && existing.value.status !== "FAILED") return { ...existing.value, idempotent_replay: true };
    const media = shortFilmMediaExecutionDecision(context.workflow, "PILOT");
    if (!media.provider_execution_allowed) throw new Error(`PRODUCTION_READINESS_BLOCKED:${media.blockers.join(",")}`);
    const approval = context.workflow.pilot_budget_approval;
    if (!approval) throw new Error("PILOT_BUDGET_APPROVAL_REQUIRED");
    if (caps.runway_credits > approval.runway_credits_cap || caps.elevenlabs_characters > approval.elevenlabs_credits_cap || caps.sync_usd > approval.sync_usd_cap) {
      throw new Error("EXECUTION_CAP_EXCEEDS_APPROVED_BUDGET");
    }
    const samples = selectShortFilmPilotSamples(context.workflow);
    const uniqueShots = [...new Map(samples.flatMap((sample) => sample.shots.map((shot) => [shot.shot_id, shot]))).values()];
    const dialogueByShot = new Map(context.workflow.production_readiness!.dialogue_line_approvals.map((line) => [line.shot_id, line]));
    const required = calculateShortFilmPilotBudget(context.workflow).required;
    const requiredCredits = required.runway_credits;
    const requiredCharacters = required.elevenlabs_characters;
    const requiredSyncUsd = required.sync_usd;
    if (caps.runway_credits < requiredCredits || caps.elevenlabs_characters < requiredCharacters || caps.sync_usd < requiredSyncUsd) {
      throw new Error(`EXECUTION_CAP_TOO_LOW:RUNWAY=${requiredCredits},ELEVENLABS=${requiredCharacters},SYNC=${requiredSyncUsd.toFixed(2)}`);
    }
    const account = await checkProviderAccounts({
      project_type: "SHORT_FILM",
      duration_seconds: uniqueShots.reduce((sum, shot) => sum + shot.duration_seconds, 0),
      providers: { script: "PROJECT_OWNER", video: "RUNWAY", voice: "ELEVENLABS", lip_sync: "SYNC" },
    }, process.env);
    if (account.providers.some((provider) => ["INSUFFICIENT", "AUTH_ERROR", "NOT_CONFIGURED"].includes(provider.status))) {
      throw new Error(`PROVIDER_ACCOUNT_BLOCKED:${account.providers.map((provider) => `${provider.provider}:${provider.status}`).join(",")}`);
    }
    const library = await this.characters.listEligibleCharacters();
    const charactersById = new Map(library.map((character) => [character.character_id, character]));
    const voiceMastersById = new Map(context.workflow.production_readiness!.voice_masters.map((voice) => [voice.voice_master_id, voice]));
    for (const line of dialogueByShot.values()) {
      const voice = voiceMastersById.get(line.voice_master_id);
      const providerVoiceId = voice ? charactersById.get(voice.source_actor_id)?.elevenlabs_voice_id : undefined;
      if (!providerVoiceId) throw new Error(`ELEVENLABS_VOICE_ID_MISSING:${line.voice_master_id}`);
    }
    const keyframeByShot = new Map(context.workflow.production_readiness!.keyframes.map((keyframe) => [keyframe.shot_id, keyframe.approved_image_url]));
    const now = new Date().toISOString();
    const tasks = samples.flatMap((sample) => sample.shots.map((shot) => {
      if (!keyframeByShot.has(shot.shot_id)) throw new Error(`APPROVED_KEYFRAME_MISSING:${shot.shot_id}`);
      return { sample_id: sample.sample_id, shot_id: shot.shot_id, runway_status: "PENDING_SUBMIT", dialogue_line_id: dialogueByShot.get(shot.shot_id)?.line_id };
    }));
    const manifest: PilotExecutionManifest = {
      schema_version: "SHORT_FILM_PILOT_PROVIDER_EXECUTION_V1", execution_id: randomUUID(), project_id: projectId,
      status: "PREPARING_DIALOGUE_AUDIO", samples, tasks, caps, provider_calls_made: false, heartbeat_at: now, started_at: now,
    };
    await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest);
    return { ...manifest, idempotent_replay: false };
  }

  async rejectAndRestartForDialogueAudio(projectId: string, caps: PilotExecutionManifest["caps"]) {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const existing = await this.drive.readPilotJson<PilotExecutionManifest>(context.project_folder_id, MANIFEST_NAME);
    if (!existing) throw new Error("PILOT_EXECUTION_NOT_FOUND");
    const rejectedAt = new Date().toISOString();
    const rejected = rejectPilotForRestart(existing.value, rejectedAt);
    await this.drive.writePilotJson(context.project_folder_id, rejected.archiveName, rejected.archived);
    await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, rejected.failed);

    const media = shortFilmMediaExecutionDecision(context.workflow, "PILOT");
    if (!media.provider_execution_allowed) throw new Error(`PRODUCTION_READINESS_BLOCKED:${media.blockers.join(",")}`);
    const approval = context.workflow.pilot_budget_approval;
    if (!approval) throw new Error("PILOT_BUDGET_APPROVAL_REQUIRED");
    if (caps.runway_credits > approval.runway_credits_cap || caps.elevenlabs_characters > approval.elevenlabs_credits_cap || caps.sync_usd > approval.sync_usd_cap) throw new Error("EXECUTION_CAP_EXCEEDS_APPROVED_BUDGET");
    const samples = selectShortFilmPilotSamples(context.workflow);
    const dialogueByShot = new Map(context.workflow.production_readiness!.dialogue_line_approvals.map((line) => [line.shot_id, line]));
    const keyframeByShot = new Map(context.workflow.production_readiness!.keyframes.map((keyframe) => [keyframe.shot_id, keyframe.approved_image_url]));
    const required = calculateShortFilmPilotBudget(context.workflow).required;
    if (caps.runway_credits < required.runway_credits || caps.elevenlabs_characters < required.elevenlabs_characters || caps.sync_usd < required.sync_usd) throw new Error(`EXECUTION_CAP_TOO_LOW:RUNWAY=${required.runway_credits},ELEVENLABS=${required.elevenlabs_characters},SYNC=${required.sync_usd.toFixed(2)}`);
    const tasks = samples.flatMap((sample) => sample.shots.map((shot) => {
      if (!keyframeByShot.has(shot.shot_id)) throw new Error(`APPROVED_KEYFRAME_MISSING:${shot.shot_id}`);
      return { sample_id: sample.sample_id, shot_id: shot.shot_id, runway_status: "PENDING_SUBMIT", dialogue_line_id: dialogueByShot.get(shot.shot_id)?.line_id };
    }));
    const now = new Date().toISOString();
    const manifest: PilotExecutionManifest = { schema_version: "SHORT_FILM_PILOT_PROVIDER_EXECUTION_V1", execution_id: randomUUID(), project_id: projectId, status: "PREPARING_DIALOGUE_AUDIO", samples, tasks, caps, provider_calls_made: false, heartbeat_at: now, started_at: now };
    await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest);
    return { ...manifest, previous_execution_id: existing.value.execution_id, archived_manifest_name: rejected.archiveName };
  }

  async status(projectId: string) {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const stored = await this.drive.readPilotJson<PilotExecutionManifest>(context.project_folder_id, MANIFEST_NAME);
    if (!stored) throw new Error("PILOT_EXECUTION_NOT_FOUND");
    const manifest = stored.value;
    if (["AWAITING_DIALOGUE_AUDIO_APPROVAL", "AWAITING_PILOT_QC", "FAILED"].includes(manifest.status)) return manifest;
    try {
    const dialogueByShot = new Map(context.workflow.production_readiness!.dialogue_line_approvals.map((line) => [line.shot_id, line]));
    const keyframeByShot = new Map(context.workflow.production_readiness!.keyframes.map((keyframe) => [keyframe.shot_id, keyframe.approved_image_url]));
    const shotsById = new Map(manifest.samples.flatMap((sample) => sample.shots.map((shot) => [shot.shot_id, shot])));
    if (manifest.status === "PREPARING_DIALOGUE_AUDIO") {
      const elevenKey = process.env.ELEVENLABS_API_KEY?.trim();
      if (!elevenKey) throw new Error("ELEVENLABS_API_KEY_NOT_CONFIGURED");
      const eleven = new ElevenLabsPilotProvider(elevenKey);
      const pendingAudio = manifest.tasks.find((task) => task.dialogue_line_id && !task.audio_drive_file_id);
      if (pendingAudio) {
        const line = dialogueByShot.get(pendingAudio.shot_id);
        if (!line) throw new Error(`APPROVED_DIALOGUE_MISSING:${pendingAudio.shot_id}`);
        const library = await this.characters.listEligibleCharacters();
        const voice = context.workflow.production_readiness!.voice_masters.find((item) => item.voice_master_id === line.voice_master_id);
        const providerVoiceId = voice ? library.find((item) => item.character_id === voice.source_actor_id)?.elevenlabs_voice_id : undefined;
        if (!providerVoiceId) throw new Error(`ELEVENLABS_VOICE_ID_MISSING:${line.voice_master_id}`);
        if (context.workflow.dialogue.language !== "vi-VN-southwest" || voice?.locale !== "vi-VN-southwest") throw new Error(`VIETNAMESE_LANGUAGE_LOCK_MISSING:${line.line_id}`);
        if (voice.source_actor_id !== line.speaker_source_actor_id || voice.voice_master_id !== line.voice_master_id) throw new Error(`VOICE_SPEAKER_LOCK_MISMATCH:${line.line_id}`);
        const audio = await eleven.synthesize({ voiceId: providerVoiceId, text: line.dialogue_text, languageCode: "vi" });
        const transcript = await eleven.transcribeVietnamese(audio.audio);
        const verification = verifyVietnameseTranscript(line.dialogue_text, transcript);
        Object.assign(pendingAudio, { voice_master_id: voice.voice_master_id, elevenlabs_voice_id: providerVoiceId, tts_model_id: audio.modelId, tts_language_code: audio.languageCode, transcript_text: transcript.text, transcript_language_code: transcript.languageCode, transcript_language_probability: transcript.languageProbability, transcript_similarity: verification.similarity, transcript_verified: verification.passed, audio_review_decision: "PENDING" });
        if (!verification.passed) throw new Error(`VIETNAMESE_AUDIO_VERIFICATION_FAILED:${line.line_id}:LANG=${transcript.languageCode}:PROB=${transcript.languageProbability.toFixed(3)}:SIM=${verification.similarity.toFixed(3)}`);
        const uploaded = await this.drive.uploadPilotArtifact(context.project_folder_id, `${pendingAudio.sample_id}_${pendingAudio.shot_id}.mp3`, "audio/mpeg", audio.audio);
        pendingAudio.audio_drive_file_id = uploaded.id as string;
        pendingAudio.elevenlabs_request_id = audio.requestId;
        manifest.provider_calls_made = true;
      }
      if (manifest.tasks.filter((task) => task.dialogue_line_id).every((task) => task.audio_drive_file_id && task.transcript_verified)) manifest.status = "AWAITING_DIALOGUE_AUDIO_APPROVAL";
      manifest.heartbeat_at = new Date().toISOString();
      await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest);
      return manifest;
    }
    const secrets = this.secrets();
    const runway = new RunwayPilotProvider(secrets.runway);
    const eleven = new ElevenLabsPilotProvider(secrets.eleven);
    const sync = new SyncPilotProvider(secrets.sync);
    if (manifest.tasks.some((task) => task.dialogue_line_id && task.audio_review_decision !== "APPROVE")) throw new Error("RUNWAY_BLOCKED_DIALOGUE_AUDIO_NOT_APPROVED");
    const activeRunway = manifest.tasks.find((task) => !["PENDING_SUBMIT", "SUCCEEDED", "FAILED", "CANCELLED"].includes(task.runway_status));
    const pendingRunway = manifest.tasks.find((task) => task.runway_status === "PENDING_SUBMIT");
    if (!activeRunway && pendingRunway) {
      const shot = shotsById.get(pendingRunway.shot_id);
      const imageUrl = keyframeByShot.get(pendingRunway.shot_id);
      if (!shot || !imageUrl) throw new Error(`APPROVED_KEYFRAME_MISSING:${pendingRunway.shot_id}`);
      const line = dialogueByShot.get(pendingRunway.shot_id);
      if (line && !pendingRunway.audio_drive_file_id) {
        const library = await this.characters.listEligibleCharacters();
        const voice = context.workflow.production_readiness!.voice_masters.find((item) => item.voice_master_id === line.voice_master_id);
        const providerVoiceId = voice ? library.find((item) => item.character_id === voice.source_actor_id)?.elevenlabs_voice_id : undefined;
        if (!providerVoiceId) throw new Error(`ELEVENLABS_VOICE_ID_MISSING:${line.voice_master_id}`);
        if (context.workflow.dialogue.language !== "vi-VN-southwest" || voice?.locale !== "vi-VN-southwest") throw new Error(`VIETNAMESE_LANGUAGE_LOCK_MISSING:${line.line_id}`);
        if (voice.source_actor_id !== line.speaker_source_actor_id || voice.voice_master_id !== line.voice_master_id) throw new Error(`VOICE_SPEAKER_LOCK_MISMATCH:${line.line_id}`);
        const audio = await eleven.synthesize({ voiceId: providerVoiceId, text: line.dialogue_text, languageCode: "vi" });
        const transcript = await eleven.transcribeVietnamese(audio.audio);
        const verification = verifyVietnameseTranscript(line.dialogue_text, transcript);
        Object.assign(pendingRunway, { voice_master_id: voice.voice_master_id, elevenlabs_voice_id: providerVoiceId, tts_model_id: audio.modelId, tts_language_code: audio.languageCode, transcript_text: transcript.text, transcript_language_code: transcript.languageCode, transcript_language_probability: transcript.languageProbability, transcript_similarity: verification.similarity, transcript_verified: verification.passed });
        if (!verification.passed) throw new Error(`VIETNAMESE_AUDIO_VERIFICATION_FAILED:${line.line_id}:LANG=${transcript.languageCode}:PROB=${transcript.languageProbability.toFixed(3)}:SIM=${verification.similarity.toFixed(3)}`);
        const uploaded = await this.drive.uploadPilotArtifact(context.project_folder_id, `${pendingRunway.sample_id}_${pendingRunway.shot_id}.mp3`, "audio/mpeg", audio.audio);
        pendingRunway.audio_drive_file_id = uploaded.id as string;
        pendingRunway.elevenlabs_request_id = audio.requestId;
        await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest);
      }
      manifest.runway_assets ??= {};
      const imageUri = await preparePrivateRunwayKeyframe({ referenceUrl: imageUrl, cache: manifest.runway_assets, drive: this.drive, runway });
      await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest);
      const submitted = await runway.submit({ imageUrl: imageUri, prompt: shot.runway_prompt, durationSeconds: shot.duration_seconds, ratio: "1280:720" });
      pendingRunway.runway_task_id = submitted.taskId;
      pendingRunway.runway_status = "PENDING";
      manifest.provider_calls_made = true;
      manifest.heartbeat_at = new Date().toISOString();
      await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest);
      return manifest;
    }
    if (activeRunway) {
      const state = await runway.status(activeRunway.runway_task_id as string);
      activeRunway.runway_status = state.status;
      activeRunway.runway_output_url = state.outputUrl;
      if (["FAILED", "CANCELLED"].includes(state.status)) throw new Error(`RUNWAY_TASK_FAILED:${activeRunway.shot_id}:${state.errorCode ?? state.error ?? state.status}`);
    }
    if (manifest.tasks.every((task) => task.runway_status === "SUCCEEDED")) {
      const syncTask = manifest.tasks.find((task) => task.audio_drive_file_id && (!task.sync_generation_id || !["COMPLETED", "FAILED", "REJECTED"].includes(task.sync_status ?? "")));
      if (syncTask) {
        if (!syncTask.sync_generation_id) {
          if (!syncTask.transcript_verified) throw new Error(`SYNC_BLOCKED_UNVERIFIED_VIETNAMESE_AUDIO:${syncTask.shot_id}`);
          const audio = await this.drive.downloadBuffer(syncTask.audio_drive_file_id as string);
          const generation = await sync.submit({ videoUrl: syncTask.runway_output_url as string, audio, fileName: `${syncTask.shot_id}.mp3` });
          syncTask.sync_generation_id = generation.generationId;
          syncTask.sync_status = "PENDING";
          await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest);
        } else {
          const state = await sync.status(syncTask.sync_generation_id);
          syncTask.sync_status = state.status;
          syncTask.sync_output_url = state.outputUrl;
          if (["FAILED", "REJECTED"].includes(state.status ?? "")) throw new Error(`SYNC_TASK_FAILED:${syncTask.shot_id}:${state.errorCode ?? state.error ?? state.status}`);
        }
      }
      manifest.status = manifest.tasks.filter((task) => task.audio_drive_file_id).every((task) => task.sync_status === "COMPLETED") ? "READY_FOR_ASSEMBLY" : "PROCESSING_SYNC";
    }
    if (manifest.status === "READY_FOR_ASSEMBLY") {
      manifest.outputs = [];
      for (const sample of manifest.samples) {
        const tasks = manifest.tasks.filter((task) => task.sample_id === sample.sample_id);
        const urls = tasks.map((task) => task.audio_drive_file_id ? task.sync_output_url : task.runway_output_url);
        if (urls.some((url) => !url)) throw new Error(`PILOT_SAMPLE_OUTPUT_MISSING:${sample.sample_id}`);
        const buffers: Buffer[] = [];
        for (let index = 0; index < tasks.length; index += 1) {
          const task = tasks[index];
          const response = await fetch(urls[index] as string, { signal: AbortSignal.timeout(60_000) });
          if (!response.ok) throw new Error(`PILOT_OUTPUT_DOWNLOAD_HTTP_${response.status}`);
          const buffer = Buffer.from(await response.arrayBuffer());
          buffers.push(buffer);
          if (!task.final_drive_file_id) {
            const shotFile = await this.drive.uploadPilotArtifact(context.project_folder_id, `${sample.sample_id}_${task.shot_id}_FINAL.mp4`, "video/mp4", buffer);
            task.final_drive_file_id = shotFile.id as string;
          }
        }
        const video = await assembleVideoBuffers(buffers);
        const uploaded = await this.drive.uploadPilotArtifact(context.project_folder_id, `${sample.sample_id}_1920x1080.mp4`, "video/mp4", video);
        manifest.outputs.push({ sample_id: sample.sample_id, drive_file_id: uploaded.id as string, video_url: uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.id}/view`, width: 1920, height: 1080 });
      }
      manifest.status = "AWAITING_PILOT_QC";
    }
    manifest.heartbeat_at = new Date().toISOString();
    await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest);
    return manifest;
    } catch (error) {
      manifest.status = "FAILED";
      manifest.error = { stage: "PROVIDER_PROCESSING", message: error instanceof Error ? error.message : String(error) };
      manifest.heartbeat_at = new Date().toISOString();
      await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest);
      return manifest;
    }
  }

  async reviewDialogueAudio(projectId: string, decision: "APPROVE" | "REJECT") {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const stored = await this.drive.readPilotJson<PilotExecutionManifest>(context.project_folder_id, MANIFEST_NAME);
    if (!stored) throw new Error("DIALOGUE_AUDIO_NOT_AWAITING_APPROVAL");
    const manifest = stored.value;
    const reviewedAt = new Date().toISOString();
    const transition = reviewDialogueAudioGate(manifest, decision, reviewedAt);
    manifest.status = transition.status;
    if ("error" in transition) manifest.error = transition.error;
    manifest.heartbeat_at = reviewedAt;
    await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest);
    return manifest;
  }

  async startPerformanceVariant(projectId: string, request: { shot_id: string; duration_seconds: number; caps: { runway_credits: number; sync_usd: number } }) {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const pilotStored = await this.drive.readPilotJson<PilotExecutionManifest>(context.project_folder_id, MANIFEST_NAME);
    if (!pilotStored) throw new Error("PILOT_EXECUTION_NOT_FOUND");
    const existing = await this.drive.readPilotJson<PilotPerformanceVariantManifest>(context.project_folder_id, VARIANT_MANIFEST_NAME);
    if (existing && existing.value.status !== "FAILED") return { ...existing.value, idempotent_replay: true };
    const legacy = await this.drive.readPilotJson<PilotPerformanceVariantManifest>(context.project_folder_id, LEGACY_VARIANT_MANIFEST_NAME);
    if (!legacy?.value.final_drive_file_id || legacy.value.status !== "AWAITING_VARIANT_QC") throw new Error("IDENTITY_CORRECTION_REQUIRES_UNAPPROVED_PERFORMANCE_REFERENCE");
    const sourceTask = validatePilotPerformanceVariant({ pilot: pilotStored.value, shotId: request.shot_id, durationSeconds: request.duration_seconds, caps: request.caps });
    const shot = pilotStored.value.samples.flatMap((sample) => sample.shots).find((item) => item.shot_id === request.shot_id);
    const keyframe = context.workflow.production_readiness?.keyframes.find((item) => item.shot_id === request.shot_id);
    const dialogue = context.workflow.production_readiness?.dialogue_line_approvals.find((item) => item.shot_id === request.shot_id);
    if (!shot || !keyframe?.approved_image_url || !dialogue) throw new Error("PILOT_VARIANT_LOCKED_SOURCE_MISSING");
    const library = await this.characters.listEligibleCharacters();
    const lockedCharacter = validateLockedCharacterPerformanceSource({
      dialogue,
      keyframe,
      character: library.find((character) => character.character_id === dialogue.speaker_source_actor_id),
    });
    const account = await checkProviderAccounts({
      project_type: "SHORT_FILM",
      duration_seconds: 10,
      providers: { script: "PROJECT_OWNER", video: "RUNWAY", voice: "APPROVED_VOICE_MASTER", lip_sync: "SYNC" },
    }, process.env);
    if (account.providers.some((provider) => ["INSUFFICIENT", "AUTH_ERROR", "NOT_CONFIGURED"].includes(provider.status))) {
      throw new Error(`PROVIDER_ACCOUNT_BLOCKED:${account.providers.map((provider) => `${provider.provider}:${provider.status}`).join(",")}`);
    }
    const performancePrompt = buildPilotPerformancePrompt(shot.runway_prompt, dialogue.dialogue_text);
    const now = new Date().toISOString();
    const manifest: PilotPerformanceVariantManifest = {
      schema_version: "SHORT_FILM_PILOT_PERFORMANCE_VARIANT_IDENTITY_LOCKED_V2",
      execution_id: randomUUID(), project_id: projectId, source_execution_id: pilotStored.value.execution_id,
      shot_id: request.shot_id, duration_seconds: 10, status: "PROCESSING_RUNWAY", caps: { runway_credits: 50, sync_usd: 0.5 },
      performance_prompt: performancePrompt, source_audio_drive_file_id: sourceTask.audio_drive_file_id as string,
      performance_reference_drive_file_id: legacy.value.final_drive_file_id,
      locked_character_id: lockedCharacter.character_id,
      locked_master_identity_id: lockedCharacter.master_identity_id as string,
      locked_master_identity_version: lockedCharacter.master_identity_version,
      // Act-Two must receive the clear face reference. The body reference remains
      // the approved keyframe/provenance gate and the reference video supplies motion.
      locked_character_image_url: selectLockedCharacterPerformanceImage(lockedCharacter),
      locked_character_body_url: lockedCharacter.body_reference_url,
      heartbeat_at: now, started_at: now,
    };
    await this.drive.writePilotJson(context.project_folder_id, VARIANT_MANIFEST_NAME, manifest);
    return { ...manifest, idempotent_replay: false };
  }

  async performanceVariantStatus(projectId: string) {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const stored = await this.drive.readPilotJson<PilotPerformanceVariantManifest>(context.project_folder_id, VARIANT_MANIFEST_NAME);
    if (!stored) throw new Error("PILOT_VARIANT_NOT_FOUND");
    const manifest = stored.value;
    if (["AWAITING_VARIANT_QC", "APPROVED", "FAILED"].includes(manifest.status)) return manifest;
    try {
      const runwayKey = process.env.RUNWAYML_API_SECRET?.trim(), syncKey = process.env.SYNC_API_KEY?.trim();
      if (!runwayKey || !syncKey) throw new Error("PILOT_VARIANT_PROVIDER_SECRET_NOT_CONFIGURED");
      const runway = new RunwayPilotProvider(runwayKey), sync = new SyncPilotProvider(syncKey);
      if (manifest.status === "PROCESSING_RUNWAY") {
        if (!manifest.runway_task_id) {
          manifest.runway_assets ??= {};
          const imageUri = await preparePrivateRunwayCharacterFace({ faceReferenceUrl: manifest.locked_character_image_url, bodyReferenceUrl: manifest.locked_character_body_url, cache: manifest.runway_assets, drive: this.drive, runway });
          const referenceVideo = await this.drive.downloadBuffer(manifest.performance_reference_drive_file_id);
          const referenceUri = await runway.uploadVideo({ content: referenceVideo, fileName: `${manifest.shot_id}_APPROVED_PERFORMANCE_REFERENCE.mp4`, mimeType: "video/mp4" });
          const submitted = await runway.submitCharacterPerformance({ characterImageUrl: imageUri, referenceVideoUrl: referenceUri.uri, ratio: "1280:720" });
          manifest.runway_task_id = submitted.taskId; manifest.runway_status = "PENDING";
        } else {
          const state = await runway.status(manifest.runway_task_id);
          manifest.runway_status = state.status; manifest.runway_output_url = state.outputUrl;
          if (["FAILED", "CANCELLED"].includes(state.status)) throw new Error(`PILOT_VARIANT_RUNWAY_FAILED:${state.errorCode ?? state.error ?? state.status}`);
          if (state.status === "SUCCEEDED") manifest.status = "PROCESSING_SYNC";
        }
      } else if (manifest.status === "PROCESSING_SYNC") {
        if (!manifest.sync_generation_id) {
          const audio = await this.drive.downloadBuffer(manifest.source_audio_drive_file_id);
          const generation = await sync.submit({ videoUrl: manifest.runway_output_url as string, audio, fileName: `${manifest.shot_id}_PERFORMANCE_VARIANT.mp3` });
          manifest.sync_generation_id = generation.generationId; manifest.sync_status = "PENDING";
        } else {
          const state = await sync.status(manifest.sync_generation_id);
          manifest.sync_status = state.status; manifest.sync_output_url = state.outputUrl;
          if (["FAILED", "REJECTED"].includes(state.status ?? "")) throw new Error(`PILOT_VARIANT_SYNC_FAILED:${state.errorCode ?? state.error ?? state.status}`);
          if (state.status === "COMPLETED") {
            const response = await fetch(state.outputUrl as string, { signal: AbortSignal.timeout(60_000) });
            if (!response.ok) throw new Error(`PILOT_VARIANT_OUTPUT_HTTP_${response.status}`);
            const normalized = await assembleVideoBuffers([Buffer.from(await response.arrayBuffer())]);
            const uploaded = await this.drive.uploadPilotArtifact(context.project_folder_id, `${manifest.shot_id}_PERFORMANCE_VARIANT_10S_1920x1080.mp4`, "video/mp4", normalized);
            manifest.final_drive_file_id = uploaded.id as string;
            manifest.video_url = uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.id}/view`;
            manifest.status = "AWAITING_VARIANT_QC";
          }
        }
      }
      manifest.heartbeat_at = new Date().toISOString();
      await this.drive.writePilotJson(context.project_folder_id, VARIANT_MANIFEST_NAME, manifest);
      return manifest;
    } catch (error) {
      manifest.status = "FAILED";
      manifest.error = { stage: "PILOT_PERFORMANCE_VARIANT", message: error instanceof Error ? error.message : String(error) };
      manifest.heartbeat_at = new Date().toISOString();
      await this.drive.writePilotJson(context.project_folder_id, VARIANT_MANIFEST_NAME, manifest);
      return manifest;
    }
  }

  async reviewPerformanceVariant(projectId: string, decision: "APPROVE" | "REJECT") {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const variantStored = await this.drive.readPilotJson<PilotPerformanceVariantManifest>(context.project_folder_id, VARIANT_MANIFEST_NAME);
    const pilotStored = await this.drive.readPilotJson<PilotExecutionManifest>(context.project_folder_id, MANIFEST_NAME);
    if (!variantStored || !pilotStored) throw new Error("PILOT_VARIANT_NOT_FOUND");
    const variant = variantStored.value, reviewedAt = new Date().toISOString();
    if (decision === "APPROVE") {
      approvePilotPerformanceVariant({ variant, pilot: pilotStored.value });
      await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, pilotStored.value);
      variant.status = "APPROVED";
    } else {
      if (variant.status !== "AWAITING_VARIANT_QC") throw new Error("PILOT_VARIANT_NOT_AWAITING_QC");
      variant.status = "FAILED"; variant.error = { stage: "PILOT_VARIANT_QC", message: "PILOT_PERFORMANCE_VARIANT_REJECTED" };
    }
    variant.reviewed_at = reviewedAt; variant.heartbeat_at = reviewedAt;
    await this.drive.writePilotJson(context.project_folder_id, VARIANT_MANIFEST_NAME, variant);
    return variant;
  }

  async performanceVariantOutput(projectId: string, fileId: string) {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const stored = await this.drive.readPilotJson<PilotPerformanceVariantManifest>(context.project_folder_id, VARIANT_MANIFEST_NAME);
    if (stored?.value.final_drive_file_id !== fileId) throw new Error("PILOT_VARIANT_OUTPUT_NOT_FOUND");
    return this.drive.downloadBuffer(fileId);
  }

  async startEvaluationReel(projectId: string, request: { duration_seconds: number; caps: { runway_credits: number; elevenlabs_characters: number; sync_usd: number } }) {
    validateEvaluationReelRequest({ durationSeconds: request.duration_seconds, caps: request.caps });
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const pilotStored = await this.drive.readPilotJson<PilotExecutionManifest>(context.project_folder_id, MANIFEST_NAME);
    if (!pilotStored || pilotStored.value.status !== "AWAITING_PILOT_QC") throw new Error("EVALUATION_REEL_REQUIRES_PILOT_AWAITING_QC");
    const existing = await this.drive.readPilotJson<EvaluationReelManifest>(context.project_folder_id, EVALUATION_REEL_MANIFEST_NAME);
    if (existing) return { ...existing.value, idempotent_replay: true };
    const candidates = selectEvaluationReelSourceTasks(pilotStored.value);
    const library = await this.characters.listEligibleCharacters();
    const tasks = candidates.map((task): EvaluationReelTask => {
      const keyframe = context.workflow.production_readiness?.keyframes.find((item) => item.shot_id === task.shot_id);
      const dialogue = context.workflow.production_readiness?.dialogue_line_approvals.find((item) => item.shot_id === task.shot_id);
      if (!keyframe?.approved_image_url || !dialogue) throw new Error(`EVALUATION_REEL_LOCKED_SOURCE_MISSING:${task.shot_id}`);
      const character = validateLockedCharacterPerformanceSource({ dialogue, keyframe, character: library.find((item) => item.character_id === dialogue.speaker_source_actor_id) });
      return { shot_id: task.shot_id, character_id: character.character_id, master_identity_id: character.master_identity_id as string, face_reference_url: character.face_reference_url, body_reference_url: character.body_reference_url, source_video_drive_file_id: task.final_drive_file_id as string, audio_drive_file_id: task.audio_drive_file_id as string };
    });
    const account = await checkProviderAccounts({ project_type: "SHORT_FILM", duration_seconds: 30, providers: { script: "PROJECT_OWNER", video: "RUNWAY", voice: "APPROVED_VOICE_MASTER", lip_sync: "SYNC" } }, process.env);
    if (account.providers.some((provider) => ["INSUFFICIENT", "AUTH_ERROR", "NOT_CONFIGURED"].includes(provider.status))) throw new Error(`PROVIDER_ACCOUNT_BLOCKED:${account.providers.map((provider) => `${provider.provider}:${provider.status}`).join(",")}`);
    const now = new Date().toISOString();
    const manifest: EvaluationReelManifest = { schema_version: "SHORT_FILM_PILOT_EVALUATION_REEL_30S_V1", execution_id: randomUUID(), project_id: projectId, source_execution_id: pilotStored.value.execution_id, duration_seconds: 30, status: "PROCESSING_RUNWAY", caps: { runway_credits: 432, elevenlabs_characters: 2000, sync_usd: 1.8 }, tasks, current_task_index: 0, heartbeat_at: now, started_at: now };
    await this.drive.writePilotJson(context.project_folder_id, EVALUATION_REEL_MANIFEST_NAME, manifest);
    return { ...manifest, idempotent_replay: false };
  }

  async restartEvaluationReel(projectId: string, request: { duration_seconds: number; caps: { runway_credits: number; elevenlabs_characters: number; sync_usd: number } }) {
    validateEvaluationReelRequest({ durationSeconds: request.duration_seconds, caps: request.caps });
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const pilotStored = await this.drive.readPilotJson<PilotExecutionManifest>(context.project_folder_id, MANIFEST_NAME);
    if (!pilotStored || pilotStored.value.status !== "AWAITING_PILOT_QC") throw new Error("EVALUATION_REEL_REQUIRES_PILOT_AWAITING_QC");
    const existing = await this.drive.readPilotJson<EvaluationReelManifest>(context.project_folder_id, EVALUATION_REEL_MANIFEST_NAME);
    if (!existing) throw new Error("EVALUATION_REEL_NOT_FOUND");
    const rejectedAt = new Date().toISOString();
    const rejected = rejectEvaluationReelForRestart(existing.value, rejectedAt);

    const candidates = selectEvaluationReelSourceTasks(pilotStored.value);
    const library = await this.characters.listEligibleCharacters();
    const tasks = candidates.map((task): EvaluationReelTask => {
      const keyframe = context.workflow.production_readiness?.keyframes.find((item) => item.shot_id === task.shot_id);
      const dialogue = context.workflow.production_readiness?.dialogue_line_approvals.find((item) => item.shot_id === task.shot_id);
      if (!keyframe?.approved_image_url || !dialogue) throw new Error(`EVALUATION_REEL_LOCKED_SOURCE_MISSING:${task.shot_id}`);
      const character = validateLockedCharacterPerformanceSource({ dialogue, keyframe, character: library.find((item) => item.character_id === dialogue.speaker_source_actor_id) });
      return { shot_id: task.shot_id, character_id: character.character_id, master_identity_id: character.master_identity_id as string, face_reference_url: character.face_reference_url, body_reference_url: character.body_reference_url, source_video_drive_file_id: task.final_drive_file_id as string, audio_drive_file_id: task.audio_drive_file_id as string };
    });
    const account = await checkProviderAccounts({ project_type: "SHORT_FILM", duration_seconds: 30, providers: { script: "PROJECT_OWNER", video: "RUNWAY", voice: "APPROVED_VOICE_MASTER", lip_sync: "SYNC" } }, process.env);
    if (account.providers.some((provider) => ["INSUFFICIENT", "AUTH_ERROR", "NOT_CONFIGURED"].includes(provider.status))) throw new Error(`PROVIDER_ACCOUNT_BLOCKED:${account.providers.map((provider) => `${provider.provider}:${provider.status}`).join(",")}`);

    const now = new Date().toISOString();
    const manifest: EvaluationReelManifest = { schema_version: "SHORT_FILM_PILOT_EVALUATION_REEL_30S_V1", execution_id: randomUUID(), project_id: projectId, source_execution_id: pilotStored.value.execution_id, duration_seconds: 30, status: "PROCESSING_RUNWAY", caps: { runway_credits: 432, elevenlabs_characters: 2000, sync_usd: 1.8 }, tasks, current_task_index: 0, heartbeat_at: now, started_at: now };
    await this.drive.writePilotJson(context.project_folder_id, rejected.archiveName, rejected.archived);
    await this.drive.writePilotJson(context.project_folder_id, EVALUATION_REEL_MANIFEST_NAME, manifest);
    return { ...manifest, previous_execution_id: existing.value.execution_id, archived_manifest_name: rejected.archiveName };
  }

  async evaluationReelStatus(projectId: string) {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const stored = await this.drive.readPilotJson<EvaluationReelManifest>(context.project_folder_id, EVALUATION_REEL_MANIFEST_NAME);
    if (!stored) throw new Error("EVALUATION_REEL_NOT_FOUND");
    const manifest = stored.value;
    if (["AWAITING_REEL_QC", "APPROVED", "REJECTED", "FAILED"].includes(manifest.status)) return manifest;
    try {
      const runwayKey = process.env.RUNWAYML_API_SECRET?.trim(), syncKey = process.env.SYNC_API_KEY?.trim();
      if (!runwayKey || !syncKey) throw new Error("EVALUATION_REEL_PROVIDER_SECRET_NOT_CONFIGURED");
      const runway = new RunwayPilotProvider(runwayKey), sync = new SyncPilotProvider(syncKey);
      const task = manifest.tasks[manifest.current_task_index];
      if (task && manifest.status === "PROCESSING_RUNWAY") {
        if (!task.runway_task_id) {
          task.runway_assets ??= {};
          const imageUri = await preparePrivateRunwayCharacterFace({ faceReferenceUrl: task.face_reference_url, bodyReferenceUrl: task.body_reference_url, cache: task.runway_assets, drive: this.drive, runway });
          const shot = context.workflow.shot_plan?.execution_shots.find((item) => item.shot_id === task.shot_id);
          const dialogue = context.workflow.production_readiness?.dialogue_line_approvals.find((item) => item.shot_id === task.shot_id);
          if (!shot || !dialogue) throw new Error(`EVALUATION_REEL_LOCKED_PROMPT_MISSING:${task.shot_id}`);
          const prompt = buildEvaluationReelFacePrompt({ scenePrompt: shot.runway_prompt, dialogueText: dialogue.dialogue_text });
          task.performance_contract = EVALUATION_PERFORMANCE_CONTRACT;
          task.runway_task_id = (await runway.submit({ imageUrl: imageUri, prompt, durationSeconds: 10, ratio: "1280:720" })).taskId;
          task.generation_mode = "APPROVED_FACE_IMAGE_TO_VIDEO";
          task.runway_status = "PENDING";
        } else {
          const state = await runway.status(task.runway_task_id); task.runway_status = state.status; task.runway_output_url = state.outputUrl;
          if (["FAILED", "CANCELLED"].includes(state.status)) throw new Error(`EVALUATION_REEL_RUNWAY_FAILED:${task.shot_id}:${state.errorCode ?? state.error ?? state.status}`);
          if (state.status === "SUCCEEDED") manifest.status = "PROCESSING_SYNC";
        }
      } else if (task && manifest.status === "PROCESSING_SYNC") {
        if (!task.sync_generation_id) {
          const audio = await fitAudioBuffer(await this.drive.downloadBuffer(task.audio_drive_file_id), 10);
          const generation = await sync.submit({ videoUrl: task.runway_output_url as string, audio, fileName: `${task.shot_id}_APPROVED_VOICE.mp3` });
          task.sync_generation_id = generation.generationId; task.sync_status = "PENDING"; task.sync_audio_duration_seconds = 10;
        } else {
          const state = await sync.status(task.sync_generation_id); task.sync_status = state.status; task.sync_output_url = state.outputUrl;
          if (["FAILED", "REJECTED"].includes(state.status ?? "")) throw new Error(`EVALUATION_REEL_SYNC_FAILED:${task.shot_id}:${state.errorCode ?? state.error ?? state.status}`);
          if (state.status === "COMPLETED") {
            task.completed_video = state.outputUrl;
            manifest.current_task_index += 1;
            manifest.status = manifest.current_task_index === manifest.tasks.length ? "ASSEMBLING" : "PROCESSING_RUNWAY";
          }
        }
      }
      if (manifest.status === "ASSEMBLING") {
        const buffers: Buffer[] = [];
        for (const completed of manifest.tasks) {
          const response = await fetch(completed.completed_video as string, { signal: AbortSignal.timeout(60_000) });
          if (!response.ok) throw new Error(`EVALUATION_REEL_OUTPUT_HTTP_${response.status}`);
          const source = Buffer.from(await response.arrayBuffer());
          const trimmed = await trimVideoBuffer(source, 10);
          completed.technical_evidence = await probeVideoBuffer(trimmed);
          buffers.push(trimmed);
        }
        const reel = await assembleVideoBuffers(buffers, 30);
        manifest.technical_evidence = validateEvaluationReelTechnicalEvidence(await probeVideoBuffer(reel));
        const uploaded = await this.drive.uploadPilotArtifact(context.project_folder_id, "SHORT_FILM_EVALUATION_REEL_30S_1920x1080.mp4", "video/mp4", reel);
        manifest.final_drive_file_id = uploaded.id as string; manifest.video_url = uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.id}/view`; manifest.status = "AWAITING_REEL_QC";
      }
      manifest.heartbeat_at = new Date().toISOString();
      await this.drive.writePilotJson(context.project_folder_id, EVALUATION_REEL_MANIFEST_NAME, manifest);
      return manifest;
    } catch (error) {
      manifest.status = "FAILED"; manifest.error = { stage: "EVALUATION_REEL_30S", message: error instanceof Error ? error.message : String(error) }; manifest.heartbeat_at = new Date().toISOString();
      await this.drive.writePilotJson(context.project_folder_id, EVALUATION_REEL_MANIFEST_NAME, manifest);
      return manifest;
    }
  }

  async resumeEvaluationReel(projectId: string, request: { duration_seconds: number; caps: { runway_credits: number; elevenlabs_characters: number; sync_usd: number } }) {
    validateEvaluationReelRequest({ durationSeconds: request.duration_seconds, caps: request.caps });
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const stored = await this.drive.readPilotJson<EvaluationReelManifest>(context.project_folder_id, EVALUATION_REEL_MANIFEST_NAME);
    if (!stored) throw new Error("EVALUATION_REEL_NOT_FOUND");
    const library = await this.characters.listEligibleCharacters();
    const refreshed = new Map(library.map((character) => [character.character_id, character]));
    const manifest = resumeEvaluationReelManifest(stored.value, refreshed);
    await this.drive.writePilotJson(context.project_folder_id, EVALUATION_REEL_MANIFEST_NAME, manifest);
    return { ...manifest, resumed: true, preserved_completed_shots: manifest.current_task_index };
  }

  async reviewEvaluationReel(projectId: string, request: { decision: "APPROVE" | "REJECT"; qc: EvaluationReelQc }) {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const stored = await this.drive.readPilotJson<EvaluationReelManifest>(context.project_folder_id, EVALUATION_REEL_MANIFEST_NAME);
    if (!stored) throw new Error("EVALUATION_REEL_NOT_FOUND");
    const manifest = reviewEvaluationReelGate(stored.value, request, new Date().toISOString());
    await this.drive.writePilotJson(context.project_folder_id, EVALUATION_REEL_MANIFEST_NAME, manifest);
    return manifest;
  }

  async evaluationReelOutput(projectId: string, fileId: string) {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const stored = await this.drive.readPilotJson<EvaluationReelManifest>(context.project_folder_id, EVALUATION_REEL_MANIFEST_NAME);
    if (stored?.value.final_drive_file_id !== fileId) throw new Error("EVALUATION_REEL_OUTPUT_NOT_FOUND");
    return this.drive.downloadBuffer(fileId);
  }

  async audio(projectId: string, fileId: string) {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const stored = await this.drive.readPilotJson<PilotExecutionManifest>(context.project_folder_id, MANIFEST_NAME);
    if (!stored?.value.tasks.some((task) => task.audio_drive_file_id === fileId && task.transcript_verified)) throw new Error("PILOT_AUDIO_NOT_FOUND");
    return this.drive.downloadBuffer(fileId);
  }

  async output(projectId: string, fileId: string) {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const stored = await this.drive.readPilotJson<PilotExecutionManifest>(context.project_folder_id, MANIFEST_NAME);
    if (!stored?.value.outputs?.some((output) => output.drive_file_id === fileId)) throw new Error("PILOT_OUTPUT_NOT_FOUND");
    return this.drive.downloadBuffer(fileId);
  }
}
