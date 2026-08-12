import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { matchShortFilmShotActor, selectShortFilmPilotSamples } from "@tu-hau/contracts";
import { z } from "zod";
import { spawn } from "node:child_process";
import { DriveConnector } from "../connectors/google-drive/drive.connector";
import { CharacterLibraryConnector } from "../connectors/google-sheets/character-library.connector";
import { ProjectRegistryConnector } from "../connectors/google-sheets/project-registry.connector";
import { preparePrivateRunwayKeyframe, type RunwayAssetCache } from "./runway-private-keyframe";
import { RunwayPilotProvider } from "./short-film-pilot.providers";

const MANIFEST_NAME = "SHORT_FILM_GOLDEN_SCENE_BACKGROUND_KEYFRAMES_V2.json";
export const GoldenSceneKeyframeRequestSchema = z.object({ execution_approved: z.literal(true), runway_credits_cap: z.literal(24) }).strict();

type Task = { shot_id: string; actor_id: string; prompt: string; runway_task_id?: string; runway_status: string; output_url?: string; drive_file_id?: string; drive_url?: string; error?: { code: string; message: string } };
type Manifest = { schema_version: "SHORT_FILM_GOLDEN_SCENE_KEYFRAMES_V1"; execution_id: string; project_id: string; status: "PROCESSING_RUNWAY" | "AWAITING_KEYFRAME_QC" | "APPROVED" | "REJECTED" | "PARTIAL_FAILURE" | "FAILED"; caps: { runway_credits: 24 }; provider_calls_made: boolean; tasks: Task[]; runway_assets: RunwayAssetCache; started_at: string; heartbeat_at: string; review?: { decision: "APPROVE" | "REJECT"; reviewer: "PROJECT_OWNER"; reviewed_at: string }; error?: { stage: string; message: string } };

export function reviewBackgroundGate(manifest: Manifest, decision: "APPROVE" | "REJECT", reviewedAt: string) {
  if (manifest.status !== "AWAITING_KEYFRAME_QC") throw new Error("GOLDEN_SCENE_BACKGROUND_NOT_AWAITING_QC");
  if (manifest.tasks.length !== 3 || manifest.tasks.some((task) => task.runway_status !== "SUCCEEDED" || !task.drive_file_id || !task.drive_url)) throw new Error("GOLDEN_SCENE_BACKGROUND_EVIDENCE_INCOMPLETE");
  manifest.status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
  manifest.review = { decision, reviewer: "PROJECT_OWNER", reviewed_at: reviewedAt };
  manifest.heartbeat_at = reviewedAt;
  return manifest;
}

async function createNeutralLocationReference() {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=#9b8b75:s=1920x1080", "-frames:v", "1", "-vf", "drawbox=x=0:y=0:w=1920:h=360:color=#d6c5a6:t=fill,drawbox=x=0:y=760:w=1920:h=320:color=#6f665c:t=fill", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], { stdio: ["ignore", "pipe", "pipe"] });
    const output: Buffer[] = [], errors: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk)); child.stderr.on("data", (chunk: Buffer) => errors.push(chunk)); child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(Buffer.concat(output)) : reject(new Error(`NEUTRAL_REFERENCE_FAILED:${Buffer.concat(errors).toString("utf8").slice(0, 300)}`)));
  });
}

export function referenceActorIdsForShot(shotId: string, primaryActorId: string, sceneActorIds: string[]) {
  return shotId.endsWith("006") ? [...new Set(sceneActorIds)] : [primaryActorId];
}

function promptFor(shotId: string, summary: string, actorName: string, allTags: string[]) {
  const composition = shotId.endsWith("006") ? "medium two-shot, Phuong An receives the phone from Tuong Vy" : shotId.endsWith("007") ? "close-up of Phuong An reading a suspicious recruitment message, Tuong Vy softly out of focus behind" : "close-up of Tuong Vy replying with visible worry";
  return `Vietnamese cinematic social drama keyframe. ${composition}. Location continuity: modest boarding-house corridor at noon, warm natural side light, realistic lived-in walls, restrained production design. Preserve the exact approved identity, face, age, hair and clothing of ${actorName}; references ${allTags.map((tag) => `@${tag}`).join(" and ")}. Shot context: ${summary}. Natural Vietnamese body language, consistent eyelines and screen direction, photorealistic, feature-film lighting, 16:9. No text, subtitles, logos, microphone, singing, glamour retouching or identity changes.`.slice(0, 1000);
}

function backgroundPrompt(shotId: string, summary: string) {
  const framing = shotId.endsWith("006") ? "wide establishing view with clear floor marks for two actors" : shotId.endsWith("007") ? "medium reverse-angle view toward the shaded wall" : "matching close-up background plate facing the opposite eyeline";
  return `@LocationPalette. Empty Vietnamese boarding-house corridor at noon, ${framing}. Modest contemporary Mekong Delta rental housing, weathered plaster, practical doors, small potted plant, warm natural side light, realistic feature-film production design, continuous geography and screen direction across the scene, photorealistic cinematic background plate, 16:9. Context: ${summary}. Absolutely no people, human figures, faces, silhouettes, mannequins, text, subtitles, logos, microphones or vehicles.`.slice(0, 1000);
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
    const actorIds = shots.map((shot) => matchShortFilmShotActor(shot.summary, context.workflow.film_characters, context.workflow.source_actors));
    if (actorIds.some((id) => !id)) throw new Error("GOLDEN_SCENE_ACTOR_ASSIGNMENT_MISSING");
    const runway = new RunwayPilotProvider(secret);
    const cache: RunwayAssetCache = {};
    const neutral = await createNeutralLocationReference();
    const uploadedNeutral = await runway.uploadImage({ content: neutral, fileName: "GOLDEN_SCENE_NEUTRAL_LOCATION_PALETTE.png", mimeType: "image/png" });
    const now = new Date().toISOString();
    const manifest: Manifest = { schema_version: "SHORT_FILM_GOLDEN_SCENE_KEYFRAMES_V1", execution_id: randomUUID(), project_id: projectId, status: "PROCESSING_RUNWAY", caps: { runway_credits: 24 }, provider_calls_made: false, tasks: [], runway_assets: cache, started_at: now, heartbeat_at: now };
    await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest);
    try {
      for (let index = 0; index < shots.length; index += 1) {
        const shot = shots[index]!, actorId = actorIds[index]!;
        const referenceImages = [{ uri: uploadedNeutral.uri, tag: "LocationPalette" }];
        const prompt = backgroundPrompt(shot.shot_id, shot.summary);
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
    if (manifest.status === "AWAITING_KEYFRAME_QC") return manifest;
    if (!manifest.tasks.some((task) => !task.drive_file_id && !task.error)) return manifest;
    const secret = process.env.RUNWAYML_API_SECRET?.trim(); if (!secret) throw new Error("RUNWAY_SECRET_NOT_CONFIGURED");
    const runway = new RunwayPilotProvider(secret);
    try {
      for (const task of manifest.tasks) {
        if (task.drive_file_id || task.error) continue;
        const result = await runway.status(task.runway_task_id!); task.runway_status = result.status;
        if (result.status === "FAILED") { task.error = { code: result.errorCode ?? "RUNWAY_FAILED", message: result.error ?? "Keyframe generation failed" }; continue; }
        if (result.status === "SUCCEEDED" && result.outputUrl) {
          const response = await fetch(result.outputUrl, { signal: AbortSignal.timeout(60_000) });
          if (!response.ok) throw new Error(`RUNWAY_OUTPUT_DOWNLOAD_HTTP_${response.status}`);
          const content = Buffer.from(await response.arrayBuffer()); if (content.length < 512) throw new Error("RUNWAY_OUTPUT_EMPTY");
          const uploaded = await this.drive.uploadPilotArtifact(context.project_folder_id, `${task.shot_id}_GOLDEN_SCENE_KEYFRAME_1920x1080.png`, response.headers.get("content-type") ?? "image/png", content);
          task.output_url = result.outputUrl; task.drive_file_id = uploaded.id!; task.drive_url = uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.id}/view`;
        }
      }
      if (manifest.tasks.length === 3 && manifest.tasks.every((task) => task.drive_file_id)) manifest.status = "AWAITING_KEYFRAME_QC";
      else if (manifest.tasks.every((task) => task.drive_file_id || task.error)) {
        manifest.status = manifest.tasks.some((task) => task.drive_file_id) ? "PARTIAL_FAILURE" : "FAILED";
        manifest.error = { stage: "RUNWAY_STATUS", message: manifest.tasks.filter((task) => task.error).map((task) => `${task.shot_id}:${task.error!.code}`).join(",") };
      } else manifest.status = "PROCESSING_RUNWAY";
      manifest.heartbeat_at = new Date().toISOString(); await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest); return manifest;
    } catch (error) {
      manifest.status = "FAILED"; manifest.error = { stage: "RUNWAY_STATUS", message: error instanceof Error ? error.message : String(error) }; manifest.heartbeat_at = new Date().toISOString();
      await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest); return manifest;
    }
  }

  async review(projectId: string, decision: "APPROVE" | "REJECT") {
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const stored = await this.drive.readPilotJson<Manifest>(context.project_folder_id, MANIFEST_NAME);
    if (!stored) throw new Error("GOLDEN_SCENE_BACKGROUND_EXECUTION_NOT_FOUND");
    const manifest = reviewBackgroundGate(stored.value, decision, new Date().toISOString());
    await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest);
    return manifest;
  }
}
