import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { selectShortFilmPilotSamples, type ShortFilmWorkflow } from "@tu-hau/contracts";
import { DriveConnector } from "../connectors/google-drive/drive.connector";
import { ProjectRegistryConnector } from "../connectors/google-sheets/project-registry.connector";

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

export type GoldenSceneMotionPlan = {
  schema_version: "SHORT_FILM_GOLDEN_SCENE_MOTION_PLAN_V1";
  execution_id: string;
  project_id: string;
  status: "AWAITING_MOTION_BUDGET_APPROVAL";
  source_character_keyframe_execution_id: string;
  provider_calls_made: false;
  immutable_inputs: true;
  tasks: GoldenSceneMotionTask[];
  stages: readonly ["DIALOGUE_AUDIO_REVIEW", "SILENT_MOTION_REVIEW", "LIP_SYNC_REVIEW"];
  proposed_caps: { runway_credits: 432; elevenlabs_characters: 2000; sync_usd: 1.8 };
  created_at: string;
  heartbeat_at: string;
};

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
  constructor(private readonly registry: ProjectRegistryConnector, private readonly drive: DriveConnector) {}

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
    return (await this.drive.readPilotJson<GoldenSceneMotionPlan>(context.project_folder_id, MOTION_PLAN_MANIFEST))?.value ?? { project_id: projectId, status: "NOT_PREPARED" };
  }
}
