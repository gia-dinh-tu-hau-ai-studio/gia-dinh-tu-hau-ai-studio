import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { selectShortFilmPilotSamples, shortFilmMediaExecutionDecision } from "@tu-hau/contracts";
import { DriveConnector } from "../connectors/google-drive/drive.connector";
import { CharacterLibraryConnector } from "../connectors/google-sheets/character-library.connector";
import { ProjectRegistryConnector } from "../connectors/google-sheets/project-registry.connector";
import { checkProviderAccounts } from "./provider-account-preflight";
import { ElevenLabsPilotProvider, RunwayPilotProvider, SyncPilotProvider } from "./short-film-pilot.providers";
import { assembleVideoBuffers } from "../media/short-film-pilot-assembler";

const MANIFEST_NAME = "SHORT_FILM_PILOT_PROVIDER_EXECUTION_V1.json";

type PilotTask = {
  sample_id: string;
  shot_id: string;
  runway_task_id?: string;
  runway_status: string;
  runway_output_url?: string;
  dialogue_line_id?: string;
  audio_drive_file_id?: string;
  elevenlabs_request_id?: string;
  sync_generation_id?: string;
  sync_status?: string;
  sync_output_url?: string;
  final_drive_file_id?: string;
};

type PilotExecutionManifest = {
  schema_version: "SHORT_FILM_PILOT_PROVIDER_EXECUTION_V1";
  execution_id: string;
  project_id: string;
  status: "SUBMITTING" | "PROCESSING_RUNWAY" | "PROCESSING_SYNC" | "READY_FOR_ASSEMBLY" | "AWAITING_PILOT_QC" | "FAILED";
  samples: ReturnType<typeof selectShortFilmPilotSamples>;
  tasks: PilotTask[];
  caps: { runway_credits: number; elevenlabs_characters: number; sync_usd: number };
  provider_calls_made: boolean;
  heartbeat_at: string;
  started_at: string;
  error?: { stage: string; message: string };
  outputs?: Array<{ sample_id: string; drive_file_id: string; video_url: string; width: 1920; height: 1080 }>;
};

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
    const samples = selectShortFilmPilotSamples(context.workflow);
    const uniqueShots = [...new Map(samples.flatMap((sample) => sample.shots.map((shot) => [shot.shot_id, shot]))).values()];
    const dialogueByShot = new Map(context.workflow.production_readiness!.dialogue_line_approvals.map((line) => [line.shot_id, line]));
    const requiredCredits = uniqueShots.reduce((sum, shot) => sum + shot.duration_seconds * 12, 0);
    const requiredCharacters = uniqueShots.reduce((sum, shot) => sum + (dialogueByShot.get(shot.shot_id)?.dialogue_text.length ?? 0), 0);
    const requiredSyncUsd = uniqueShots.reduce((sum, shot) => sum + (dialogueByShot.has(shot.shot_id) ? shot.duration_seconds * 0.05 : 0), 0);
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
      status: "PROCESSING_RUNWAY", samples, tasks, caps, provider_calls_made: false, heartbeat_at: now, started_at: now,
    };
    await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest);
    return { ...manifest, idempotent_replay: false };
  }

  async status(projectId: string) {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const stored = await this.drive.readPilotJson<PilotExecutionManifest>(context.project_folder_id, MANIFEST_NAME);
    if (!stored) throw new Error("PILOT_EXECUTION_NOT_FOUND");
    const manifest = stored.value;
    if (["AWAITING_PILOT_QC", "FAILED"].includes(manifest.status)) return manifest;
    const secrets = this.secrets();
    const runway = new RunwayPilotProvider(secrets.runway);
    const eleven = new ElevenLabsPilotProvider(secrets.eleven);
    const sync = new SyncPilotProvider(secrets.sync);
    try {
    const dialogueByShot = new Map(context.workflow.production_readiness!.dialogue_line_approvals.map((line) => [line.shot_id, line]));
    const keyframeByShot = new Map(context.workflow.production_readiness!.keyframes.map((keyframe) => [keyframe.shot_id, keyframe.approved_image_url]));
    const shotsById = new Map(manifest.samples.flatMap((sample) => sample.shots.map((shot) => [shot.shot_id, shot])));
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
        const audio = await eleven.synthesize({ voiceId: providerVoiceId, text: line.dialogue_text });
        const uploaded = await this.drive.uploadPilotArtifact(context.project_folder_id, `${pendingRunway.sample_id}_${pendingRunway.shot_id}.mp3`, "audio/mpeg", audio.audio);
        pendingRunway.audio_drive_file_id = uploaded.id as string;
        pendingRunway.elevenlabs_request_id = audio.requestId;
        await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest);
      }
      const submitted = await runway.submit({ imageUrl, prompt: shot.runway_prompt, durationSeconds: shot.duration_seconds, ratio: "1280:720" });
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

  async output(projectId: string, fileId: string) {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const stored = await this.drive.readPilotJson<PilotExecutionManifest>(context.project_folder_id, MANIFEST_NAME);
    if (!stored?.value.outputs?.some((output) => output.drive_file_id === fileId)) throw new Error("PILOT_OUTPUT_NOT_FOUND");
    return this.drive.downloadBuffer(fileId);
  }
}
