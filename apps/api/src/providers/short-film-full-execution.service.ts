import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ProviderBudgetPlanSchema, providerBudgetApproved, shortFilmProductionReadinessBlockers } from "@tu-hau/contracts";
import { DriveConnector } from "../connectors/google-drive/drive.connector";
import { CharacterLibraryConnector } from "../connectors/google-sheets/character-library.connector";
import { ProjectRegistryConnector } from "../connectors/google-sheets/project-registry.connector";
import { assembleVideoBuffers } from "../media/short-film-pilot-assembler";
import { ElevenLabsPilotProvider, RunwayPilotProvider, SyncPilotProvider } from "./short-film-pilot.providers";
import { verifyVietnameseTranscript } from "./short-film-pilot-execution.service";
import { preparePrivateRunwayKeyframe, type RunwayAssetCache } from "./runway-private-keyframe";

const FULL_MANIFEST = "SHORT_FILM_FULL_EXECUTION_V1.json";
const PILOT_MANIFEST = "SHORT_FILM_PILOT_PROVIDER_EXECUTION_V1.json";

type FullTask = {
  shot_id: string; prompt: string; duration_seconds: number; keyframe_url: string;
  status: "PENDING_SUBMIT" | "RUNWAY_PROCESSING" | "SYNC_PROCESSING" | "COMPLETED" | "FAILED";
  reused_from_pilot: boolean; final_drive_file_id?: string; runway_task_id?: string; runway_output_url?: string;
  audio_drive_file_id?: string; sync_generation_id?: string; sync_output_url?: string; error?: string;
  voice_master_id?: string; elevenlabs_voice_id?: string; tts_model_id?: "eleven_v3"; tts_language_code?: "vi";
  transcript_language_code?: string; transcript_language_probability?: number; transcript_similarity?: number; transcript_verified?: boolean;
};
type FullManifest = {
  schema_version: "SHORT_FILM_FULL_EXECUTION_V1"; execution_id: string; project_id: string;
  status: "IN_PROGRESS" | "ASSEMBLING" | "AWAITING_FINAL_QC" | "FAILED";
  tasks: FullTask[]; caps: { runway_credits: number; elevenlabs_characters: number; sync_usd: number };
  output?: { drive_file_id: string; video_url: string; width: 1920; height: 1080 };
  runway_assets?: RunwayAssetCache;
  heartbeat_at: string; started_at: string; error?: string;
};

@Injectable()
export class ShortFilmFullExecutionService {
  constructor(private readonly registry: ProjectRegistryConnector, private readonly characters: CharacterLibraryConnector, private readonly drive: DriveConnector) {}

  private secrets() {
    const runway = process.env.RUNWAYML_API_SECRET?.trim(), eleven = process.env.ELEVENLABS_API_KEY?.trim(), sync = process.env.SYNC_API_KEY?.trim();
    if (!runway || !eleven || !sync) throw new Error("FULL_FILM_PROVIDER_SECRET_NOT_CONFIGURED");
    return { runway, eleven, sync };
  }

  async start(projectId: string, caps: FullManifest["caps"]) {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const existing = await this.drive.readPilotJson<FullManifest>(context.project_folder_id, FULL_MANIFEST);
    if (existing && existing.value.status !== "FAILED") return { ...existing.value, idempotent_replay: true };
    if (context.workflow.pilot_batch?.batch_review.decision !== "APPROVE") throw new Error("PILOT_BATCH_APPROVED_REQUIRED");
    if (shortFilmProductionReadinessBlockers(context.workflow).length) throw new Error("PRODUCTION_READINESS_BLOCKED");
    const budget = ProviderBudgetPlanSchema.parse(context.provider_budget);
    if (!providerBudgetApproved(budget)) throw new Error("BUDGET_APPROVED_REQUIRED");
    const shots = context.workflow.shot_plan?.execution_shots ?? [];
    if (!shots.length) throw new Error("STRUCTURED_EXECUTION_SHOTS_REQUIRED");
    const pilot = await this.drive.readPilotJson<{ tasks?: Array<{ shot_id: string; final_drive_file_id?: string }> }>(context.project_folder_id, PILOT_MANIFEST);
    const reused = new Map((pilot?.value.tasks ?? []).filter((task) => task.final_drive_file_id).map((task) => [task.shot_id, task.final_drive_file_id as string]));
    const remaining = shots.filter((shot) => !reused.has(shot.shot_id));
    const dialogue = new Map(context.workflow.production_readiness!.dialogue_line_approvals.map((line) => [line.shot_id, line]));
    const required = {
      runway: remaining.reduce((sum, shot) => sum + shot.duration_seconds * 12, 0),
      eleven: remaining.reduce((sum, shot) => sum + (dialogue.get(shot.shot_id)?.dialogue_text.length ?? 0), 0),
      sync: remaining.reduce((sum, shot) => sum + (dialogue.has(shot.shot_id) ? shot.duration_seconds * 0.05 : 0), 0),
    };
    if (caps.runway_credits < required.runway || caps.elevenlabs_characters < required.eleven || caps.sync_usd < required.sync) throw new Error(`FULL_FILM_CAP_TOO_LOW:RUNWAY=${required.runway},ELEVENLABS=${required.eleven},SYNC=${required.sync.toFixed(2)}`);
    const keyframes = new Map(context.workflow.production_readiness!.keyframes.map((keyframe) => [keyframe.shot_id, keyframe.approved_image_url]));
    const tasks: FullTask[] = shots.map((shot) => {
      const reusedFile = reused.get(shot.shot_id);
      const keyframe = keyframes.get(shot.shot_id);
      if (!reusedFile && !keyframe) throw new Error(`APPROVED_KEYFRAME_MISSING:${shot.shot_id}`);
      return { shot_id: shot.shot_id, prompt: shot.runway_prompt, duration_seconds: shot.duration_seconds, keyframe_url: keyframe ?? "REUSED", status: reusedFile ? "COMPLETED" : "PENDING_SUBMIT", reused_from_pilot: Boolean(reusedFile), final_drive_file_id: reusedFile };
    });
    const now = new Date().toISOString();
    const manifest: FullManifest = { schema_version: "SHORT_FILM_FULL_EXECUTION_V1", execution_id: randomUUID(), project_id: projectId, status: "IN_PROGRESS", tasks, caps, heartbeat_at: now, started_at: now };
    await this.drive.writePilotJson(context.project_folder_id, FULL_MANIFEST, manifest);
    return { ...manifest, required, idempotent_replay: false };
  }

  async tick(projectId: string) {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const stored = await this.drive.readPilotJson<FullManifest>(context.project_folder_id, FULL_MANIFEST);
    if (!stored) throw new Error("FULL_FILM_EXECUTION_NOT_FOUND");
    const manifest = stored.value;
    if (["AWAITING_FINAL_QC", "FAILED"].includes(manifest.status)) return manifest;
    const secrets = this.secrets();
    const runway = new RunwayPilotProvider(secrets.runway), eleven = new ElevenLabsPilotProvider(secrets.eleven), sync = new SyncPilotProvider(secrets.sync);
    const dialogue = new Map(context.workflow.production_readiness!.dialogue_line_approvals.map((line) => [line.shot_id, line]));
    const voices = await this.characters.listEligibleCharacters();
    const voiceIds = new Map(voices.map((voice) => [voice.character_id, voice.elevenlabs_voice_id]));
    try {
      const active = manifest.tasks.find((task) => task.status === "RUNWAY_PROCESSING" || task.status === "SYNC_PROCESSING");
      if (active?.status === "RUNWAY_PROCESSING") {
        const state = await runway.status(active.runway_task_id as string);
        if (["FAILED", "CANCELLED"].includes(state.status)) throw new Error(`RUNWAY_TASK_FAILED:${active.shot_id}:${state.errorCode ?? state.error}`);
        if (state.status === "SUCCEEDED") {
          active.runway_output_url = state.outputUrl;
          const line = dialogue.get(active.shot_id);
          if (line) {
            if (!active.transcript_verified) throw new Error(`SYNC_BLOCKED_UNVERIFIED_VIETNAMESE_AUDIO:${active.shot_id}`);
            const audio = await this.drive.downloadBuffer(active.audio_drive_file_id as string);
            const generation = await sync.submit({ videoUrl: state.outputUrl as string, audio, fileName: `${active.shot_id}.mp3` });
            active.sync_generation_id = generation.generationId; active.status = "SYNC_PROCESSING";
          } else {
            const response = await fetch(state.outputUrl as string); if (!response.ok) throw new Error(`RUNWAY_OUTPUT_HTTP_${response.status}`);
            const uploaded = await this.drive.uploadFullFilmArtifact(context.project_folder_id, `${active.shot_id}_FINAL.mp4`, "video/mp4", Buffer.from(await response.arrayBuffer()));
            active.final_drive_file_id = uploaded.id as string; active.status = "COMPLETED";
          }
        }
      } else if (active?.status === "SYNC_PROCESSING") {
        const state = await sync.status(active.sync_generation_id as string);
        if (["FAILED", "REJECTED"].includes(state.status ?? "")) throw new Error(`SYNC_TASK_FAILED:${active.shot_id}:${state.errorCode ?? state.error}`);
        if (state.status === "COMPLETED") {
          const response = await fetch(state.outputUrl as string); if (!response.ok) throw new Error(`SYNC_OUTPUT_HTTP_${response.status}`);
          const uploaded = await this.drive.uploadFullFilmArtifact(context.project_folder_id, `${active.shot_id}_FINAL.mp4`, "video/mp4", Buffer.from(await response.arrayBuffer()));
          active.final_drive_file_id = uploaded.id as string; active.sync_output_url = state.outputUrl; active.status = "COMPLETED";
        }
      } else {
        const next = manifest.tasks.find((task) => task.status === "PENDING_SUBMIT");
        if (next) {
          const line = dialogue.get(next.shot_id);
          if (line) {
            const voice = context.workflow.production_readiness!.voice_masters.find((item) => item.voice_master_id === line.voice_master_id);
            const providerVoiceId = voice ? voiceIds.get(voice.source_actor_id) : undefined;
            if (!providerVoiceId) throw new Error(`ELEVENLABS_VOICE_ID_MISSING:${line.voice_master_id}`);
            if (context.workflow.dialogue.language !== "vi-VN-southwest" || voice?.locale !== "vi-VN-southwest") throw new Error(`VIETNAMESE_LANGUAGE_LOCK_MISSING:${line.line_id}`);
            if (voice.source_actor_id !== line.speaker_source_actor_id || voice.voice_master_id !== line.voice_master_id) throw new Error(`VOICE_SPEAKER_LOCK_MISMATCH:${line.line_id}`);
            const audio = await eleven.synthesize({ voiceId: providerVoiceId, text: line.dialogue_text, languageCode: "vi" });
            const transcript = await eleven.transcribeVietnamese(audio.audio);
            const verification = verifyVietnameseTranscript(line.dialogue_text, transcript);
            Object.assign(next, { voice_master_id: voice.voice_master_id, elevenlabs_voice_id: providerVoiceId, tts_model_id: audio.modelId, tts_language_code: audio.languageCode, transcript_language_code: transcript.languageCode, transcript_language_probability: transcript.languageProbability, transcript_similarity: verification.similarity, transcript_verified: verification.passed });
            if (!verification.passed) throw new Error(`VIETNAMESE_AUDIO_VERIFICATION_FAILED:${line.line_id}:LANG=${transcript.languageCode}:PROB=${transcript.languageProbability.toFixed(3)}:SIM=${verification.similarity.toFixed(3)}`);
            const uploaded = await this.drive.uploadFullFilmArtifact(context.project_folder_id, `${next.shot_id}.mp3`, "audio/mpeg", audio.audio);
            next.audio_drive_file_id = uploaded.id as string;
          }
          manifest.runway_assets ??= {};
          const imageUri = await preparePrivateRunwayKeyframe({ referenceUrl: next.keyframe_url, cache: manifest.runway_assets, drive: this.drive, runway });
          await this.drive.writePilotJson(context.project_folder_id, FULL_MANIFEST, manifest);
          const submitted = await runway.submit({ imageUrl: imageUri, prompt: next.prompt, durationSeconds: next.duration_seconds, ratio: "1280:720" });
          next.runway_task_id = submitted.taskId; next.status = "RUNWAY_PROCESSING";
        } else if (manifest.tasks.every((task) => task.status === "COMPLETED")) {
          manifest.status = "ASSEMBLING";
          const buffers: Buffer[] = [];
          for (const task of manifest.tasks) buffers.push(await this.drive.downloadBuffer(task.final_drive_file_id as string));
          const movie = await assembleVideoBuffers(buffers);
          const output = await this.drive.uploadFullFilmArtifact(context.project_folder_id, `${projectId}_FULL_FILM_1920x1080.mp4`, "video/mp4", movie);
          manifest.output = { drive_file_id: output.id as string, video_url: output.webViewLink ?? `https://drive.google.com/file/d/${output.id}/view`, width: 1920, height: 1080 };
          manifest.status = "AWAITING_FINAL_QC";
        }
      }
      manifest.heartbeat_at = new Date().toISOString();
      await this.drive.writePilotJson(context.project_folder_id, FULL_MANIFEST, manifest);
      return manifest;
    } catch (error) {
      manifest.status = "FAILED"; manifest.error = error instanceof Error ? error.message : String(error); manifest.heartbeat_at = new Date().toISOString();
      await this.drive.writePilotJson(context.project_folder_id, FULL_MANIFEST, manifest);
      return manifest;
    }
  }

  async output(projectId: string, fileId: string) {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const stored = await this.drive.readPilotJson<FullManifest>(context.project_folder_id, FULL_MANIFEST);
    if (stored?.value.output?.drive_file_id !== fileId) throw new Error("FULL_FILM_OUTPUT_NOT_FOUND");
    return this.drive.downloadBuffer(fileId);
  }
}
