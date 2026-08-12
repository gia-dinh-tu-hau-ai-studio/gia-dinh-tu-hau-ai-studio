import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { matchShortFilmShotActor, selectShortFilmPilotSamples } from "@tu-hau/contracts";
import { z } from "zod";
import { DriveConnector } from "../connectors/google-drive/drive.connector";
import { CharacterLibraryConnector } from "../connectors/google-sheets/character-library.connector";
import { ProjectRegistryConnector } from "../connectors/google-sheets/project-registry.connector";
import { preparePrivateRunwayKeyframe, type RunwayAssetCache } from "./runway-private-keyframe";
import { RunwayPilotProvider } from "./short-film-pilot.providers";

const MANIFEST_NAME = "SHORT_FILM_GOLDEN_SCENE_KEYFRAMES_V1.json";
export const GoldenSceneKeyframeRequestSchema = z.object({ execution_approved: z.literal(true), runway_credits_cap: z.literal(24) }).strict();

type Task = { shot_id: string; actor_id: string; prompt: string; runway_task_id?: string; runway_status: string; output_url?: string; drive_file_id?: string; drive_url?: string };
type Manifest = { schema_version: "SHORT_FILM_GOLDEN_SCENE_KEYFRAMES_V1"; execution_id: string; project_id: string; status: "PROCESSING_RUNWAY" | "AWAITING_KEYFRAME_QC" | "FAILED"; caps: { runway_credits: 24 }; provider_calls_made: boolean; tasks: Task[]; runway_assets: RunwayAssetCache; started_at: string; heartbeat_at: string; error?: { stage: string; message: string } };

function promptFor(shotId: string, summary: string, actorName: string, allTags: string[]) {
  const composition = shotId.endsWith("006") ? "medium two-shot, Phuong An receives the phone from Tuong Vy" : shotId.endsWith("007") ? "close-up of Phuong An reading a suspicious recruitment message, Tuong Vy softly out of focus behind" : "close-up of Tuong Vy replying with visible worry";
  return `Vietnamese cinematic social drama keyframe. ${composition}. Location continuity: modest boarding-house corridor at noon, warm natural side light, realistic lived-in walls, restrained production design. Preserve the exact approved identity, face, age, hair and clothing of ${actorName}; references ${allTags.map((tag) => `@${tag}`).join(" and ")}. Shot context: ${summary}. Natural Vietnamese body language, consistent eyelines and screen direction, photorealistic, feature-film lighting, 16:9. No text, subtitles, logos, microphone, singing, glamour retouching or identity changes.`.slice(0, 1000);
}

@Injectable()
export class GoldenSceneKeyframeService {
  constructor(private readonly registry: ProjectRegistryConnector, private readonly characters: CharacterLibraryConnector, private readonly drive: DriveConnector) {}

  async execute(projectId: string, body: unknown) {
    GoldenSceneKeyframeRequestSchema.parse(body);
    const secret = process.env.RUNWAYML_API_SECRET?.trim();
    if (!secret) throw new Error("RUNWAY_SECRET_NOT_CONFIGURED");
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const existing = await this.drive.readPilotJson<Manifest>(context.project_folder_id, MANIFEST_NAME);
    if (existing) return { ...existing.value, idempotent_replay: true };
    const shots = selectShortFilmPilotSamples(context.workflow)[0]?.shots ?? [];
    if (shots.length !== 3) throw new Error(`GOLDEN_SCENE_EXACTLY_THREE_KEYFRAMES_REQUIRED:${shots.length}`);
    const library = await this.characters.listEligibleCharacters();
    const byId = new Map(library.map((item) => [item.character_id, item]));
    const actorIds = shots.map((shot) => matchShortFilmShotActor(shot.summary, context.workflow.film_characters, context.workflow.source_actors));
    if (actorIds.some((id) => !id || !byId.has(id))) throw new Error("GOLDEN_SCENE_LOCKED_CHARACTER_REFERENCE_MISSING");
    const runway = new RunwayPilotProvider(secret);
    const cache: RunwayAssetCache = {};
    const uniqueActors = [...new Set(actorIds as string[])];
    const refs = new Map<string, { uri: string; tag: string }>();
    for (const [index, actorId] of uniqueActors.entries()) {
      const character = byId.get(actorId)!;
      if (character.readiness.master_identity !== "APPROVED_LOCKED") throw new Error(`MASTER_IDENTITY_NOT_LOCKED:${actorId}`);
      refs.set(actorId, { uri: await preparePrivateRunwayKeyframe({ referenceUrl: character.face_reference_url || character.body_reference_url, cache, drive: this.drive, runway }), tag: `Character${index + 1}` });
    }
    const now = new Date().toISOString();
    const manifest: Manifest = { schema_version: "SHORT_FILM_GOLDEN_SCENE_KEYFRAMES_V1", execution_id: randomUUID(), project_id: projectId, status: "PROCESSING_RUNWAY", caps: { runway_credits: 24 }, provider_calls_made: false, tasks: [], runway_assets: cache, started_at: now, heartbeat_at: now };
    await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest);
    try {
      for (let index = 0; index < shots.length; index += 1) {
        const shot = shots[index]!, actorId = actorIds[index]!, character = byId.get(actorId)!;
        const referenceImages = uniqueActors.map((id) => refs.get(id)!);
        const prompt = promptFor(shot.shot_id, shot.summary, character.character_name, referenceImages.map((item) => item.tag));
        const submitted = await runway.submitKeyframe({ prompt, referenceImages, ratio: "1920:1080" });
        manifest.tasks.push({ shot_id: shot.shot_id, actor_id: actorId, prompt, runway_task_id: submitted.taskId, runway_status: "PENDING" });
        manifest.provider_calls_made = true; manifest.heartbeat_at = new Date().toISOString();
        await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest);
      }
      return manifest;
    } catch (error) {
      manifest.status = "FAILED"; manifest.error = { stage: "RUNWAY_SUBMIT", message: error instanceof Error ? error.message : String(error) }; manifest.heartbeat_at = new Date().toISOString();
      await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest); throw error;
    }
  }

  async status(projectId: string) {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const stored = await this.drive.readPilotJson<Manifest>(context.project_folder_id, MANIFEST_NAME);
    if (!stored) return { project_id: projectId, status: "NOT_STARTED", provider_calls_made: false };
    const manifest = stored.value;
    if (manifest.status !== "PROCESSING_RUNWAY") return manifest;
    const secret = process.env.RUNWAYML_API_SECRET?.trim(); if (!secret) throw new Error("RUNWAY_SECRET_NOT_CONFIGURED");
    const runway = new RunwayPilotProvider(secret);
    try {
      for (const task of manifest.tasks) {
        if (task.drive_file_id) continue;
        const result = await runway.status(task.runway_task_id!); task.runway_status = result.status;
        if (result.status === "FAILED") throw new Error(`${result.errorCode ?? "RUNWAY_FAILED"}:${result.error ?? "Keyframe generation failed"}`);
        if (result.status === "SUCCEEDED" && result.outputUrl) {
          const response = await fetch(result.outputUrl, { signal: AbortSignal.timeout(60_000) });
          if (!response.ok) throw new Error(`RUNWAY_OUTPUT_DOWNLOAD_HTTP_${response.status}`);
          const content = Buffer.from(await response.arrayBuffer()); if (content.length < 512) throw new Error("RUNWAY_OUTPUT_EMPTY");
          const uploaded = await this.drive.uploadPilotArtifact(context.project_folder_id, `${task.shot_id}_GOLDEN_SCENE_KEYFRAME_1920x1080.png`, response.headers.get("content-type") ?? "image/png", content);
          task.output_url = result.outputUrl; task.drive_file_id = uploaded.id!; task.drive_url = uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.id}/view`;
        }
      }
      if (manifest.tasks.length === 3 && manifest.tasks.every((task) => task.drive_file_id)) manifest.status = "AWAITING_KEYFRAME_QC";
      manifest.heartbeat_at = new Date().toISOString(); await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest); return manifest;
    } catch (error) {
      manifest.status = "FAILED"; manifest.error = { stage: "RUNWAY_STATUS", message: error instanceof Error ? error.message : String(error) }; manifest.heartbeat_at = new Date().toISOString();
      await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest); return manifest;
    }
  }
}
