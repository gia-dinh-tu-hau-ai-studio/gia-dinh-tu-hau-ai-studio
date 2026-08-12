import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { matchShortFilmShotActor, selectShortFilmPilotSamples } from "@tu-hau/contracts";
import { DriveConnector } from "../connectors/google-drive/drive.connector";
import { CharacterLibraryConnector } from "../connectors/google-sheets/character-library.connector";
import { ProjectRegistryConnector } from "../connectors/google-sheets/project-registry.connector";

const BACKGROUND_MANIFEST = "SHORT_FILM_GOLDEN_SCENE_BACKGROUND_KEYFRAMES_V2.json";
const MANIFEST_NAME = "SHORT_FILM_OPENAI_CHARACTER_KEYFRAMES_V1.json";
export const OPENAI_CHARACTER_KEYFRAME_MAX_USD = 1 as const;

type BackgroundManifest = { status: string; tasks: Array<{ shot_id: string; drive_url?: string }> };
type Task = { shot_id: string; actor_id: string; character_name: string; status: "PENDING" | "SUCCEEDED" | "FAILED"; drive_file_id?: string; drive_url?: string; error?: string };
type Manifest = { schema_version: "SHORT_FILM_OPENAI_CHARACTER_KEYFRAMES_V1"; execution_id: string; project_id: string; status: "PROCESSING_OPENAI" | "AWAITING_CHARACTER_KEYFRAME_QC" | "FAILED"; caps: { openai_usd: 1; image_count: 3 }; model: "gpt-image-1.5"; tasks: Task[]; provider_calls_made: boolean; started_at: string; heartbeat_at: string; error?: { stage: string; message: string } };

export function validateCharacterKeyframeBudget(input: { execution_approved: boolean; openai_usd_cap: number; image_count: number }) {
  if (input.execution_approved !== true || input.openai_usd_cap !== 1 || input.image_count !== 3) throw new Error("OPENAI_CHARACTER_KEYFRAME_EXACT_CAP_REQUIRED");
  return input;
}

async function normalize1920x1080(content: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vf", "scale=1920:1280:flags=lanczos,crop=1920:1080:0:100", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], { stdio: ["pipe", "pipe", "pipe"] });
    const output: Buffer[] = [], errors: Buffer[] = []; child.stdout.on("data", (chunk: Buffer) => output.push(chunk)); child.stderr.on("data", (chunk: Buffer) => errors.push(chunk)); child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(Buffer.concat(output)) : reject(new Error(`OPENAI_IMAGE_NORMALIZE_FAILED:${Buffer.concat(errors).toString("utf8").slice(0, 300)}`))); child.stdin.end(content);
  });
}

export class OpenAiImageEditProvider {
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {}
  async edit(input: { background: { content: Buffer; fileName: string; mimeType: string }; characterImages: Array<{ content: Buffer; fileName: string; mimeType: string }>; prompt: string }) {
    if (input.characterImages.length < 1 || input.characterImages.length > 2) throw new Error("OPENAI_CHARACTER_REFERENCE_COUNT_INVALID");
    const form = new FormData(); form.set("model", "gpt-image-1.5"); form.set("prompt", input.prompt); form.set("size", "1536x1024"); form.set("quality", "high"); form.set("input_fidelity", "high"); form.set("n", "1");
    for (const image of [input.background, ...input.characterImages]) form.append("image[]", new Blob([Uint8Array.from(image.content)], { type: image.mimeType }), image.fileName);
    const response = await this.fetcher("https://api.openai.com/v1/images/edits", { method: "POST", headers: { authorization: `Bearer ${this.apiKey}` }, body: form, signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`OPENAI_IMAGE_EDIT_HTTP_${response.status}:${(await response.text()).slice(0, 500)}`);
    const payload = await response.json() as { data?: Array<{ b64_json?: string }>; usage?: unknown };
    const encoded = payload.data?.[0]?.b64_json; if (!encoded) throw new Error("OPENAI_IMAGE_EDIT_OUTPUT_MISSING");
    return { image: Buffer.from(encoded, "base64"), usage: payload.usage };
  }
}

@Injectable()
export class OpenAiCharacterKeyframeService {
  constructor(private readonly registry: ProjectRegistryConnector, private readonly characters: CharacterLibraryConnector, private readonly drive: DriveConnector) {}
  async execute(projectId: string, request: unknown) {
    validateCharacterKeyframeBudget(request as { execution_approved: boolean; openai_usd_cap: number; image_count: number });
    const apiKey = process.env.OPENAI_API_KEY?.trim(); if (!apiKey) throw new Error("OPENAI_API_KEY_NOT_CONFIGURED");
    const context = await this.registry.getShortFilmExecutionContext(projectId);
    const existing = await this.drive.readPilotJson<Manifest>(context.project_folder_id, MANIFEST_NAME); if (existing) return { ...existing.value, idempotent_replay: true };
    const backgrounds = await this.drive.readPilotJson<BackgroundManifest>(context.project_folder_id, BACKGROUND_MANIFEST);
    if (!backgrounds || backgrounds.value.status !== "APPROVED" || backgrounds.value.tasks.length !== 3) throw new Error("APPROVED_GOLDEN_SCENE_BACKGROUNDS_REQUIRED");
    const shots = selectShortFilmPilotSamples(context.workflow)[0]?.shots ?? []; if (shots.length !== 3) throw new Error("EXACTLY_THREE_GOLDEN_SCENE_SHOTS_REQUIRED");
    const library = await this.characters.listEligibleCharacters(); const byId = new Map(library.map((item) => [item.character_id, item]));
    const actorIds = shots.map((shot) => matchShortFilmShotActor(shot.summary, context.workflow.film_characters, context.workflow.source_actors));
    if (actorIds.some((id) => !id || byId.get(id)?.readiness.master_identity !== "APPROVED_LOCKED")) throw new Error("LOCKED_CHARACTER_MASTER_REQUIRED");
    const now = new Date().toISOString(); const manifest: Manifest = { schema_version: "SHORT_FILM_OPENAI_CHARACTER_KEYFRAMES_V1", execution_id: randomUUID(), project_id: projectId, status: "PROCESSING_OPENAI", caps: { openai_usd: 1, image_count: 3 }, model: "gpt-image-1.5", tasks: [], provider_calls_made: false, started_at: now, heartbeat_at: now };
    await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest); const provider = new OpenAiImageEditProvider(apiKey);
    try {
      for (let index = 0; index < shots.length; index += 1) {
        const shot = shots[index]!, actorId = actorIds[index]!, character = byId.get(actorId)!; const background = backgrounds.value.tasks.find((item) => item.shot_id === shot.shot_id);
        if (!background?.drive_url) throw new Error(`BACKGROUND_MISSING:${shot.shot_id}`);
        const backgroundImage = await this.drive.downloadPrivateRunwayImage(background.drive_url); const refs = [character.face_reference_url, character.body_reference_url].filter((value, refIndex, values) => value && values.indexOf(value) === refIndex);
        const characterImages = await Promise.all(refs.map((url) => this.drive.downloadPrivateRunwayImage(url)));
        const prompt = `Edit the first image as the immutable approved background plate. Insert only ${character.character_name}, matching the supplied approved Character Master face and body references exactly: same identity, apparent age, facial geometry, hair and wardrobe. ${shot.summary}. Natural Vietnamese screen acting pose, correct perspective, contact shadows and the background's existing noon light. Do not alter the location. No extra people, face blending, identity changes, text, logos or microphones.`;
        const edited = await provider.edit({ background: backgroundImage, characterImages, prompt }); manifest.provider_calls_made = true;
        const normalized = await normalize1920x1080(edited.image); const uploaded = await this.drive.uploadPilotArtifact(context.project_folder_id, `${shot.shot_id}_CHARACTER_MASTER_COMPOSITE_1920x1080.png`, "image/png", normalized);
        manifest.tasks.push({ shot_id: shot.shot_id, actor_id: actorId, character_name: character.character_name, status: "SUCCEEDED", drive_file_id: uploaded.id!, drive_url: uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.id}/view` }); manifest.heartbeat_at = new Date().toISOString(); await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest);
      }
      manifest.status = "AWAITING_CHARACTER_KEYFRAME_QC"; manifest.heartbeat_at = new Date().toISOString(); await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest); return manifest;
    } catch (error) {
      manifest.status = "FAILED"; manifest.error = { stage: "OPENAI_IMAGE_EDIT", message: error instanceof Error ? error.message : String(error) }; manifest.heartbeat_at = new Date().toISOString(); await this.drive.writePilotJson(context.project_folder_id, MANIFEST_NAME, manifest); return manifest;
    }
  }
  async status(projectId: string) { const context = await this.registry.getShortFilmExecutionContext(projectId); return (await this.drive.readPilotJson<Manifest>(context.project_folder_id, MANIFEST_NAME))?.value ?? { project_id: projectId, status: "NOT_STARTED" }; }
}
