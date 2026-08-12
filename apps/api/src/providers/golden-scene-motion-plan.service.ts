import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { selectShortFilmPilotSamples, type ShortFilmWorkflow } from "@tu-hau/contracts";
import { DriveConnector } from "../connectors/google-drive/drive.connector";
import { ProjectRegistryConnector } from "../connectors/google-sheets/project-registry.connector";
import { CharacterLibraryConnector } from "../connectors/google-sheets/character-library.connector";
import { ElevenLabsPilotProvider } from "./short-film-pilot.providers";
import { verifyVietnameseTranscript } from "./short-film-pilot-execution.service";
import { RunwayPilotProvider } from "./short-film-pilot.providers";
import { SyncPilotProvider } from "./short-film-pilot.providers";
import { preparePrivateRunwayKeyframe, type RunwayAssetCache } from "./runway-private-keyframe";
import { assembleVideoBuffers, createPurposefulCoverageClip, fitAudioBuffer, probeVideoBuffer, trimVideoBuffer } from "../media/short-film-pilot-assembler";

const CHARACTER_KEYFRAME_MANIFEST = "SHORT_FILM_OPENAI_CHARACTER_KEYFRAMES_V1.json";
const MOTION_PLAN_MANIFEST = "SHORT_FILM_GOLDEN_SCENE_MOTION_PLAN_V1.json";

type CharacterKeyframeManifest = {
  execution_id: string;
  status: string;
  review?: { decision: string };
  tasks: Array<{ shot_id: string; actor_id: string; status: string; drive_file_id?: string; drive_url?: string }>;
};

export type GoldenSceneMotionTask = {
  shot_id: string;
  duration_seconds: number;
  actor_id: string;
  character_keyframe_file_id: string;
  character_keyframe_url: string;
  dialogue_line_id: string;
  dialogue_text: string;
  voice_master_id: string;
  speech_window_ms: { start: number; end: number };
  direction: { prepare: string; speak: string; settle: string };
};

type GoldenSceneAudio = { drive_file_id: string; drive_url: string; transcript_text: string; transcript_language_code: string; transcript_language_probability: number; transcript_similarity: number; verified: true; review: "PENDING" | "APPROVE" };
type SilentMotion = { runway_task_id?: string; runway_status: string; output_url?: string; drive_file_id?: string; drive_url?: string; review: "PENDING" | "APPROVE" };
type LipSync = { sync_generation_id?: string; sync_status: string; output_url?: string; drive_file_id?: string; drive_url?: string; review: "PENDING" };

export type GoldenSceneMotionPlan = {
  schema_version: "SHORT_FILM_GOLDEN_SCENE_MOTION_PLAN_V1";
  execution_id: string;
  project_id: string;
  status: "AWAITING_MOTION_BUDGET_APPROVAL" | "PREPARING_DIALOGUE_AUDIO" | "AWAITING_DIALOGUE_AUDIO_APPROVAL" | "PROCESSING_SILENT_MOTION" | "AWAITING_SILENT_MOTION_APPROVAL" | "PROCESSING_LIP_SYNC" | "AWAITING_FINAL_CLIP_APPROVAL" | "FINAL_CLIPS_REJECTED" | "AWAITING_RECOVERY_REEL_APPROVAL" | "FAILED";
  source_character_keyframe_execution_id: string;
  provider_calls_made: boolean;
  immutable_inputs: true;
  tasks: Array<GoldenSceneMotionTask & { audio?: GoldenSceneAudio; silent_motion?: SilentMotion; lip_sync?: LipSync }>;
  stages: readonly ["DIALOGUE_AUDIO_REVIEW", "SILENT_MOTION_REVIEW", "LIP_SYNC_REVIEW"];
  proposed_caps: { runway_credits: 432; elevenlabs_characters: 2000; sync_usd: 1.8 };
  created_at: string;
  heartbeat_at: string;
  approved_caps?: { runway_credits: 432; elevenlabs_characters: 2000; sync_usd: 1.8; approved_at: string; reviewer: "PROJECT_OWNER" };
  elevenlabs_characters_used?: number;
  error?: { stage: string; message: string };
  runway_assets?: RunwayAssetCache;
  editorial_recovery?: EditorialRecoveryPlan;
  recovery_reel?: { drive_file_id: string; drive_url: string; duration_seconds: number; width: number; height: number; has_audio: boolean; review: "PENDING" };
};

type EditorialRecoveryPlan = {
  schema_version: "GOLDEN_SCENE_PURPOSEFUL_EDIT_V1";
  dialogue_shots: Array<{ shot_id: string; source_file_id: string; trim_to_seconds: number; max_post_dialogue_seconds: 1 }>;
  coverage_shots: Array<{ purpose: "PHONE_EVIDENCE_INSERT" | "LISTENER_REACTION" | "LOCATION_CONTEXT"; duration_seconds: number; requirement: string }>;
  total_duration_seconds: 30;
  paid_provider_calls_required: false;
  review: "PENDING";
};

export function rejectAndPlanPurposefulGoldenSceneEdit(plan: GoldenSceneMotionPlan, now: string) {
  if (plan.status !== "AWAITING_FINAL_CLIP_APPROVAL" || plan.tasks.some((task) => !task.lip_sync?.drive_file_id)) throw new Error("COMPLETED_FINAL_CLIPS_REQUIRED");
  const dialogueShots = plan.tasks.map((task) => ({ shot_id: task.shot_id, source_file_id: task.lip_sync!.drive_file_id!, trim_to_seconds: Math.ceil((task.speech_window_ms.end + 1000) / 1000), max_post_dialogue_seconds: 1 as const }));
  const dialogueDuration = dialogueShots.reduce((sum, shot) => sum + shot.trim_to_seconds, 0);
  if (dialogueDuration >= 30) throw new Error("PURPOSEFUL_COVERAGE_WINDOW_MISSING");
  const remaining = 30 - dialogueDuration;
  const first = Math.floor(remaining / 3), second = Math.floor((remaining - first) / 2), third = remaining - first - second;
  plan.editorial_recovery = {
    schema_version: "GOLDEN_SCENE_PURPOSEFUL_EDIT_V1", dialogue_shots: dialogueShots,
    coverage_shots: [
      { purpose: "PHONE_EVIDENCE_INSERT", duration_seconds: first, requirement: "Cận cảnh tin tuyển dụng và yêu cầu chuyển tiền; không có khuôn mặt nói." },
      { purpose: "LISTENER_REACTION", duration_seconds: second, requirement: "Phản ứng lắng nghe có điểm nhìn và cảm xúc rõ; không cử động môi." },
      { purpose: "LOCATION_CONTEXT", duration_seconds: third, requirement: "Bối cảnh phòng trọ hỗ trợ nhịp cắt và continuity; không có chuyển động nhân vật ngẫu nhiên." },
    ], total_duration_seconds: 30, paid_provider_calls_required: false, review: "PENDING",
  };
  plan.status = "FINAL_CLIPS_REJECTED"; plan.heartbeat_at = now; return plan;
}

export function approveGoldenSceneMotionBudget(plan: GoldenSceneMotionPlan, caps: { runway_credits: number; elevenlabs_characters: number; sync_usd: number }, now: string) {
  if (plan.status !== "AWAITING_MOTION_BUDGET_APPROVAL") throw new Error("MOTION_PLAN_NOT_AWAITING_BUDGET_APPROVAL");
  if (caps.runway_credits !== 432 || caps.elevenlabs_characters !== 2000 || caps.sync_usd !== 1.8) throw new Error("GOLDEN_SCENE_EXACT_CAPS_REQUIRED");
  const requiredCharacters = plan.tasks.reduce((sum, task) => sum + task.dialogue_text.length, 0);
  if (requiredCharacters > caps.elevenlabs_characters) throw new Error(`ELEVENLABS_CAP_TOO_LOW:${requiredCharacters}`);
  plan.approved_caps = { runway_credits: 432, elevenlabs_characters: 2000, sync_usd: 1.8, approved_at: now, reviewer: "PROJECT_OWNER" };
  plan.elevenlabs_characters_used = 0;
  plan.status = "PREPARING_DIALOGUE_AUDIO";
  plan.heartbeat_at = now;
  return plan;
}

export function approveGoldenSceneDialogueAudio(plan: GoldenSceneMotionPlan, now: string) {
  if (plan.status !== "AWAITING_DIALOGUE_AUDIO_APPROVAL" || plan.tasks.some((task) => !task.audio?.verified)) throw new Error("VERIFIED_DIALOGUE_AUDIO_REQUIRED");
  for (const task of plan.tasks) { task.audio!.review = "APPROVE"; task.silent_motion = { runway_status: "PENDING_SUBMIT", review: "PENDING" }; }
  plan.status = "PROCESSING_SILENT_MOTION"; plan.heartbeat_at = now; return plan;
}

export function buildGoldenSceneSilentMotionPrompt(task: GoldenSceneMotionTask) {
  const prompt = `Vietnamese cinematic drama. Preserve the exact approved character identity, face, age, hair, wardrobe, framing, location and lighting from the input image. Natural purposeful acting for this meaning: ${task.dialogue_text} Physical performance: begin with a brief attentive hold; during the dialogue window use restrained eye focus, breathing, one motivated hand or body gesture, and a clear emotional reaction; after the line, stop speaking motion and settle naturally. No identity drift, no extra person, no camera jump, no text, no microphone, no exaggerated repeated movement.`;
  if (prompt.length > 1000) throw new Error(`SILENT_MOTION_PROMPT_TOO_LONG:${task.shot_id}`);
  return prompt;
}

export function approveGoldenSceneSilentMotion(plan: GoldenSceneMotionPlan, now: string) {
  if (plan.status !== "AWAITING_SILENT_MOTION_APPROVAL" || plan.tasks.some((task) => task.silent_motion?.runway_status !== "SUCCEEDED" || !task.silent_motion.drive_file_id || !task.audio?.verified)) throw new Error("COMPLETED_SILENT_MOTION_AND_AUDIO_REQUIRED");
  for (const task of plan.tasks) { task.silent_motion!.review = "APPROVE"; task.lip_sync = { sync_status: "PENDING_SUBMIT", review: "PENDING" }; }
  plan.status = "PROCESSING_LIP_SYNC"; plan.heartbeat_at = now; return plan;
}

export function validateGoldenSceneMotionBinding(input: {
  shotId: string;
  keyframe: { actor_id: string };
  dialogue: { speaker_source_actor_id: string; voice_master_id: string; pronunciation_decision: string; age_casting_decision: string; timing_decision: string };
  speaker: { speaker_source_actor_id: string; voice_master_id: string };
  voice: { source_actor_id: string; voice_master_id: string; status: string } | undefined;
}) {
  const { shotId, keyframe, dialogue, speaker, voice } = input;
  if ([dialogue.pronunciation_decision, dialogue.age_casting_decision, dialogue.timing_decision].some((decision) => decision !== "APPROVE")) {
    throw new Error(`DIALOGUE_QC_INCOMPLETE:${shotId}`);
  }
  if (speaker.speaker_source_actor_id !== dialogue.speaker_source_actor_id || keyframe.actor_id !== dialogue.speaker_source_actor_id) {
    throw new Error(`CHARACTER_SPEAKER_KEYFRAME_MISMATCH:${shotId}`);
  }
  if (speaker.voice_master_id !== dialogue.voice_master_id) throw new Error(`VOICE_SPEAKER_MISMATCH:${shotId}`);
  if (!voice || voice.status !== "APPROVED_LOCKED" || voice.source_actor_id !== dialogue.speaker_source_actor_id || voice.voice_master_id !== dialogue.voice_master_id) {
    throw new Error(`APPROVED_LOCKED_VOICE_REQUIRED:${shotId}`);
  }
  return true;
}

export function buildGoldenSceneMotionPlan(input: {
  projectId: string;
  workflow: ShortFilmWorkflow;
  keyframes: CharacterKeyframeManifest;
  now: string;
  executionId?: string;
}): GoldenSceneMotionPlan {
  const { workflow, keyframes } = input;
  if (keyframes.status !== "APPROVED" || keyframes.review?.decision !== "APPROVE") {
    throw new Error("APPROVED_CHARACTER_KEYFRAMES_REQUIRED");
  }
  const readiness = workflow.production_readiness;
  if (!readiness || readiness.review.decision !== "APPROVE") {
    throw new Error("PRODUCTION_READINESS_APPROVAL_REQUIRED");
  }
  const sample = selectShortFilmPilotSamples(workflow)[0];
  if (!sample || sample.shots.length !== 3) throw new Error("EXACTLY_THREE_GOLDEN_SCENE_SHOTS_REQUIRED");
  if (keyframes.tasks.length !== 3) throw new Error("EXACTLY_THREE_CHARACTER_KEYFRAMES_REQUIRED");

  const tasks = sample.shots.map((shot): GoldenSceneMotionTask => {
    const keyframe = keyframes.tasks.find((item) => item.shot_id === shot.shot_id);
    if (!keyframe || keyframe.status !== "SUCCEEDED" || !keyframe.drive_file_id || !keyframe.drive_url) {
      throw new Error(`APPROVED_CHARACTER_KEYFRAME_MISSING:${shot.shot_id}`);
    }
    const dialogue = readiness.dialogue_line_approvals.find((item) => item.shot_id === shot.shot_id);
    if (!dialogue) throw new Error(`APPROVED_DIALOGUE_MISSING:${shot.shot_id}`);
    const speaker = readiness.speaker_locks.find((item) => item.shot_id === shot.shot_id);
    if (!speaker) throw new Error(`SPEAKER_LOCK_MISSING:${shot.shot_id}`);
    const voice = readiness.voice_masters.find((item) => item.source_actor_id === dialogue.speaker_source_actor_id);
    validateGoldenSceneMotionBinding({ shotId: shot.shot_id, keyframe, dialogue, speaker, voice });
    const shotDurationMs = Math.round(shot.duration_seconds * 1000);
    if (dialogue.target_duration_ms >= shotDurationMs - 500) throw new Error(`DIALOGUE_REQUIRES_SETTLE_WINDOW:${shot.shot_id}`);
    const speechStart = 500;
    const speechEnd = speechStart + dialogue.target_duration_ms;
    return {
      shot_id: shot.shot_id,
      duration_seconds: shot.duration_seconds,
      actor_id: dialogue.speaker_source_actor_id,
      character_keyframe_file_id: keyframe.drive_file_id,
      character_keyframe_url: keyframe.drive_url,
      dialogue_line_id: dialogue.line_id,
      dialogue_text: dialogue.dialogue_text,
      voice_master_id: dialogue.voice_master_id,
      speech_window_ms: { start: speechStart, end: speechEnd },
      direction: {
        prepare: "Giữ đúng tư thế và nét mặt của keyframe đã duyệt; chuyển động nhỏ, có chủ đích.",
        speak: "Diễn hình thể đúng nhịp câu thoại; môi chỉ nói trong cửa sổ thoại đã khóa.",
        settle: "Dừng khẩu hình ngay khi hết thoại; hoàn tất phản ứng tự nhiên trong phần thời gian còn lại.",
      },
    };
  });

  if (new Set(tasks.map((task) => task.shot_id)).size !== 3) throw new Error("DUPLICATE_GOLDEN_SCENE_SHOT");
  return {
    schema_version: "SHORT_FILM_GOLDEN_SCENE_MOTION_PLAN_V1",
    execution_id: input.executionId ?? randomUUID(),
    project_id: input.projectId,
    status: "AWAITING_MOTION_BUDGET_APPROVAL",
    source_character_keyframe_execution_id: keyframes.execution_id,
    provider_calls_made: false,
    immutable_inputs: true,
    tasks,
    stages: ["DIALOGUE_AUDIO_REVIEW", "SILENT_MOTION_REVIEW", "LIP_SYNC_REVIEW"],
    proposed_caps: { runway_credits: 432, elevenlabs_characters: 2000, sync_usd: 1.8 },
    created_at: input.now,
    heartbeat_at: input.now,
  };
}

@Injectable()
export class GoldenSceneMotionPlanService {
  constructor(private readonly registry: ProjectRegistryConnector, private readonly drive: DriveConnector, private readonly characters: CharacterLibraryConnector) {}

  async prepare(projectId: string) {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const existing = await this.drive.readPilotJson<GoldenSceneMotionPlan>(context.project_folder_id, MOTION_PLAN_MANIFEST);
    if (existing) return { ...existing.value, idempotent_replay: true };
    const stored = await this.drive.readPilotJson<CharacterKeyframeManifest>(context.project_folder_id, CHARACTER_KEYFRAME_MANIFEST);
    if (!stored) throw new Error("CHARACTER_KEYFRAME_EXECUTION_NOT_FOUND");
    const plan = buildGoldenSceneMotionPlan({ projectId, workflow: context.workflow, keyframes: stored.value, now: new Date().toISOString() });
    await this.drive.writePilotJson(context.project_folder_id, MOTION_PLAN_MANIFEST, plan);
    return plan;
  }

  async status(projectId: string) {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const stored = await this.drive.readPilotJson<GoldenSceneMotionPlan>(context.project_folder_id, MOTION_PLAN_MANIFEST);
    if (!stored) return { project_id: projectId, status: "NOT_PREPARED" };
    const plan = stored.value;
    if (plan.status === "PROCESSING_SILENT_MOTION") return this.advanceSilentMotion(context.project_folder_id, plan);
    if (plan.status === "PROCESSING_LIP_SYNC") return this.advanceLipSync(context.project_folder_id, plan);
    if (plan.status !== "PREPARING_DIALOGUE_AUDIO") return plan;
    try {
      const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
      if (!apiKey) throw new Error("ELEVENLABS_API_KEY_NOT_CONFIGURED");
      const pending = plan.tasks.find((task) => !task.audio);
      if (!pending) {
        plan.status = "AWAITING_DIALOGUE_AUDIO_APPROVAL";
      } else {
        const library = await this.characters.listEligibleCharacters();
        const character = library.find((item) => item.character_id === pending.actor_id);
        if (!character || character.readiness.voice_master !== "APPROVED_LOCKED" || character.voice_master_id !== pending.voice_master_id || !character.elevenlabs_voice_id) throw new Error(`LOCKED_PROVIDER_VOICE_MISSING:${pending.shot_id}`);
        const nextUsage = (plan.elevenlabs_characters_used ?? 0) + pending.dialogue_text.length;
        if (!plan.approved_caps || nextUsage > plan.approved_caps.elevenlabs_characters) throw new Error("ELEVENLABS_APPROVED_CAP_EXCEEDED");
        const provider = new ElevenLabsPilotProvider(apiKey);
        const output = await provider.synthesize({ voiceId: character.elevenlabs_voice_id, text: pending.dialogue_text, languageCode: "vi" });
        const transcript = await provider.transcribeVietnamese(output.audio);
        const verification = verifyVietnameseTranscript(pending.dialogue_text, transcript);
        if (!verification.passed) throw new Error(`VIETNAMESE_AUDIO_VERIFICATION_FAILED:${pending.shot_id}:LANG=${transcript.languageCode}:PROB=${transcript.languageProbability.toFixed(3)}:SIM=${verification.similarity.toFixed(3)}`);
        const uploaded = await this.drive.uploadPilotArtifact(context.project_folder_id, `${pending.shot_id}_GOLDEN_SCENE_APPROVED_VOICE.mp3`, "audio/mpeg", output.audio);
        pending.audio = { drive_file_id: uploaded.id as string, drive_url: uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.id}/view`, transcript_text: transcript.text, transcript_language_code: transcript.languageCode, transcript_language_probability: transcript.languageProbability, transcript_similarity: verification.similarity, verified: true, review: "PENDING" };
        plan.elevenlabs_characters_used = nextUsage;
        plan.provider_calls_made = true;
        if (plan.tasks.every((task) => task.audio?.verified)) plan.status = "AWAITING_DIALOGUE_AUDIO_APPROVAL";
      }
      plan.heartbeat_at = new Date().toISOString(); await this.drive.writePilotJson(context.project_folder_id, MOTION_PLAN_MANIFEST, plan); return plan;
    } catch (error) {
      plan.status = "FAILED"; plan.error = { stage: "DIALOGUE_AUDIO", message: error instanceof Error ? error.message : String(error) }; plan.heartbeat_at = new Date().toISOString(); await this.drive.writePilotJson(context.project_folder_id, MOTION_PLAN_MANIFEST, plan); return plan;
    }
  }

  async approveBudget(projectId: string, caps: { runway_credits: number; elevenlabs_characters: number; sync_usd: number }) {
    const context = await this.registry.getShortFilmExecutionContext(projectId); const stored = await this.drive.readPilotJson<GoldenSceneMotionPlan>(context.project_folder_id, MOTION_PLAN_MANIFEST);
    if (!stored) throw new Error("GOLDEN_SCENE_MOTION_PLAN_NOT_FOUND"); const plan = approveGoldenSceneMotionBudget(stored.value, caps, new Date().toISOString()); await this.drive.writePilotJson(context.project_folder_id, MOTION_PLAN_MANIFEST, plan); return plan;
  }

  async approveAudio(projectId: string) {
    const context = await this.registry.getShortFilmExecutionContext(projectId); const stored = await this.drive.readPilotJson<GoldenSceneMotionPlan>(context.project_folder_id, MOTION_PLAN_MANIFEST);
    if (!stored) throw new Error("GOLDEN_SCENE_MOTION_PLAN_NOT_FOUND"); const plan = approveGoldenSceneDialogueAudio(stored.value, new Date().toISOString()); await this.drive.writePilotJson(context.project_folder_id, MOTION_PLAN_MANIFEST, plan); return plan;
  }

  async approveSilentMotion(projectId: string) {
    const context = await this.registry.getShortFilmExecutionContext(projectId); const stored = await this.drive.readPilotJson<GoldenSceneMotionPlan>(context.project_folder_id, MOTION_PLAN_MANIFEST);
    if (!stored) throw new Error("GOLDEN_SCENE_MOTION_PLAN_NOT_FOUND"); const plan = approveGoldenSceneSilentMotion(stored.value, new Date().toISOString()); await this.drive.writePilotJson(context.project_folder_id, MOTION_PLAN_MANIFEST, plan); return plan;
  }

  async rejectFinalClipsForPurposefulEdit(projectId: string) {
    const context = await this.registry.getShortFilmExecutionContext(projectId); const stored = await this.drive.readPilotJson<GoldenSceneMotionPlan>(context.project_folder_id, MOTION_PLAN_MANIFEST);
    if (!stored) throw new Error("GOLDEN_SCENE_MOTION_PLAN_NOT_FOUND"); const plan = rejectAndPlanPurposefulGoldenSceneEdit(stored.value, new Date().toISOString()); await this.drive.writePilotJson(context.project_folder_id, MOTION_PLAN_MANIFEST, plan); return plan;
  }

  async buildRecoveryReel(projectId: string) {
    const context = await this.registry.getShortFilmExecutionContext(projectId); const stored = await this.drive.readPilotJson<GoldenSceneMotionPlan>(context.project_folder_id, MOTION_PLAN_MANIFEST);
    if (!stored) throw new Error("GOLDEN_SCENE_MOTION_PLAN_NOT_FOUND"); const plan = stored.value;
    if (plan.status === "AWAITING_RECOVERY_REEL_APPROVAL" && plan.recovery_reel) return { ...plan, idempotent_replay: true };
    if (plan.status !== "FINAL_CLIPS_REJECTED" || !plan.editorial_recovery || plan.editorial_recovery.paid_provider_calls_required) throw new Error("PURPOSEFUL_EDITORIAL_RECOVERY_REQUIRED");
    const [shot6, shot7, shot8] = plan.editorial_recovery.dialogue_shots;
    const task6 = plan.tasks.find((task) => task.shot_id === shot6.shot_id)!, task7 = plan.tasks.find((task) => task.shot_id === shot7.shot_id)!, task8 = plan.tasks.find((task) => task.shot_id === shot8.shot_id)!;
    const [video6, video7, video8, locationImage, phoneImage, reactionImage] = await Promise.all([
      this.drive.downloadBuffer(shot6.source_file_id), this.drive.downloadBuffer(shot7.source_file_id), this.drive.downloadBuffer(shot8.source_file_id),
      this.drive.downloadBuffer(task6.character_keyframe_file_id), this.drive.downloadBuffer(task7.character_keyframe_file_id), this.drive.downloadBuffer(task8.character_keyframe_file_id),
    ]);
    const [trim6, trim7, trim8, location, phone, reaction] = await Promise.all([
      trimVideoBuffer(video6, shot6.trim_to_seconds), trimVideoBuffer(video7, shot7.trim_to_seconds), trimVideoBuffer(video8, shot8.trim_to_seconds),
      createPurposefulCoverageClip(locationImage, "LOCATION_CONTEXT", 4), createPurposefulCoverageClip(phoneImage, "PHONE_EVIDENCE_INSERT", 3), createPurposefulCoverageClip(reactionImage, "LISTENER_REACTION", 3),
    ]);
    const reel = await assembleVideoBuffers([location, trim6, phone, trim7, reaction, trim8], 30); const evidence = await probeVideoBuffer(reel);
    if (Math.abs(evidence.duration_seconds - 30) > 0.25 || evidence.width !== 1920 || evidence.height !== 1080 || !evidence.has_audio) throw new Error("RECOVERY_REEL_TECHNICAL_QC_FAILED");
    const uploaded = await this.drive.uploadPilotArtifact(context.project_folder_id, "GOLDEN_SCENE_PURPOSEFUL_RECOVERY_REEL_30S_1920x1080.mp4", "video/mp4", reel);
    plan.recovery_reel = { drive_file_id: uploaded.id as string, drive_url: uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.id}/view`, ...evidence, review: "PENDING" }; plan.status = "AWAITING_RECOVERY_REEL_APPROVAL"; plan.heartbeat_at = new Date().toISOString(); await this.drive.writePilotJson(context.project_folder_id, MOTION_PLAN_MANIFEST, plan); return plan;
  }

  private async advanceSilentMotion(projectFolderId: string, plan: GoldenSceneMotionPlan) {
    try {
      const apiKey = process.env.RUNWAYML_API_SECRET?.trim(); if (!apiKey) throw new Error("RUNWAYML_API_SECRET_NOT_CONFIGURED");
      const runway = new RunwayPilotProvider(apiKey); plan.runway_assets ??= {};
      const active = plan.tasks.find((task) => task.silent_motion?.runway_task_id && !["SUCCEEDED", "FAILED", "CANCELLED"].includes(task.silent_motion.runway_status));
      const pending = plan.tasks.find((task) => task.silent_motion?.runway_status === "PENDING_SUBMIT");
      if (active) {
        const state = await runway.status(active.silent_motion!.runway_task_id!); active.silent_motion!.runway_status = state.status; active.silent_motion!.output_url = state.outputUrl;
        if (["FAILED", "CANCELLED"].includes(state.status)) throw new Error(`SILENT_MOTION_RUNWAY_FAILED:${active.shot_id}:${state.errorCode ?? state.error ?? state.status}`);
        if (state.status === "SUCCEEDED" && state.outputUrl) {
          const response = await fetch(state.outputUrl, { signal: AbortSignal.timeout(60_000) }); if (!response.ok) throw new Error(`SILENT_MOTION_OUTPUT_HTTP_${response.status}`);
          const uploaded = await this.drive.uploadPilotArtifact(projectFolderId, `${active.shot_id}_GOLDEN_SCENE_SILENT_MOTION_10S.mp4`, "video/mp4", Buffer.from(await response.arrayBuffer()));
          active.silent_motion!.drive_file_id = uploaded.id as string; active.silent_motion!.drive_url = uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.id}/view`;
        }
      } else if (pending) {
        const imageUri = await preparePrivateRunwayKeyframe({ referenceUrl: pending.character_keyframe_url, cache: plan.runway_assets, drive: this.drive, runway });
        const submitted = await runway.submit({ imageUrl: imageUri, prompt: buildGoldenSceneSilentMotionPrompt(pending), durationSeconds: pending.duration_seconds, ratio: "1280:720" });
        pending.silent_motion!.runway_task_id = submitted.taskId; pending.silent_motion!.runway_status = "PENDING"; plan.provider_calls_made = true;
      }
      if (plan.tasks.every((task) => task.silent_motion?.runway_status === "SUCCEEDED" && task.silent_motion.drive_file_id)) plan.status = "AWAITING_SILENT_MOTION_APPROVAL";
      plan.heartbeat_at = new Date().toISOString(); await this.drive.writePilotJson(projectFolderId, MOTION_PLAN_MANIFEST, plan); return plan;
    } catch (error) {
      plan.status = "FAILED"; plan.error = { stage: "SILENT_MOTION", message: error instanceof Error ? error.message : String(error) }; plan.heartbeat_at = new Date().toISOString(); await this.drive.writePilotJson(projectFolderId, MOTION_PLAN_MANIFEST, plan); return plan;
    }
  }

  private async advanceLipSync(projectFolderId: string, plan: GoldenSceneMotionPlan) {
    try {
      const apiKey = process.env.SYNC_API_KEY?.trim(); if (!apiKey) throw new Error("SYNC_API_KEY_NOT_CONFIGURED"); const sync = new SyncPilotProvider(apiKey);
      const active = plan.tasks.find((task) => task.lip_sync?.sync_generation_id && !["COMPLETED", "FAILED", "REJECTED"].includes(task.lip_sync.sync_status));
      const pending = plan.tasks.find((task) => task.lip_sync?.sync_status === "PENDING_SUBMIT");
      if (active) {
        const state = await sync.status(active.lip_sync!.sync_generation_id!); active.lip_sync!.sync_status = state.status ?? "UNKNOWN"; active.lip_sync!.output_url = state.outputUrl;
        if (["FAILED", "REJECTED"].includes(state.status ?? "")) throw new Error(`GOLDEN_SCENE_SYNC_FAILED:${active.shot_id}:${state.errorCode ?? state.error ?? state.status}`);
        if (state.status === "COMPLETED" && state.outputUrl) {
          const response = await fetch(state.outputUrl, { signal: AbortSignal.timeout(60_000) }); if (!response.ok) throw new Error(`GOLDEN_SCENE_SYNC_OUTPUT_HTTP_${response.status}`);
          const uploaded = await this.drive.uploadPilotArtifact(projectFolderId, `${active.shot_id}_GOLDEN_SCENE_FINAL_LIPSYNC_10S.mp4`, "video/mp4", Buffer.from(await response.arrayBuffer()));
          active.lip_sync!.drive_file_id = uploaded.id as string; active.lip_sync!.drive_url = uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.id}/view`;
        }
      } else if (pending) {
        if (!pending.audio?.verified || !pending.silent_motion?.output_url) throw new Error(`LIP_SYNC_APPROVED_INPUT_MISSING:${pending.shot_id}`);
        const audio = await fitAudioBuffer(await this.drive.downloadBuffer(pending.audio.drive_file_id), pending.duration_seconds);
        const submitted = await sync.submit({ videoUrl: pending.silent_motion.output_url, audio, fileName: `${pending.shot_id}_APPROVED_VOICE_10S.mp3` }); pending.lip_sync!.sync_generation_id = submitted.generationId; pending.lip_sync!.sync_status = "PENDING"; plan.provider_calls_made = true;
      }
      if (plan.tasks.every((task) => task.lip_sync?.sync_status === "COMPLETED" && task.lip_sync.drive_file_id)) plan.status = "AWAITING_FINAL_CLIP_APPROVAL";
      plan.heartbeat_at = new Date().toISOString(); await this.drive.writePilotJson(projectFolderId, MOTION_PLAN_MANIFEST, plan); return plan;
    } catch (error) { plan.status = "FAILED"; plan.error = { stage: "LIP_SYNC", message: error instanceof Error ? error.message : String(error) }; plan.heartbeat_at = new Date().toISOString(); await this.drive.writePilotJson(projectFolderId, MOTION_PLAN_MANIFEST, plan); return plan; }
  }
}
