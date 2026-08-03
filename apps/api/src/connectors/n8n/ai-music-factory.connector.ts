import { Injectable } from "@nestjs/common";
import type { NormalizedProjectIntake } from "@tu-hau/contracts";

export class AiMusicFactoryNotConfiguredError extends Error {}
export class AiMusicFactoryUnavailableError extends Error {}
export class AiMusicFactoryInvalidResponseError extends Error {}

export type AiMusicFactoryProject = Record<string, unknown> & {
  project_id: string;
};

function configuredWebhookUrl() {
  const value = process.env.AI_MUSIC_FACTORY_WEBHOOK_URL?.trim();
  if (!value) {
    throw new AiMusicFactoryNotConfiguredError();
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AiMusicFactoryNotConfiguredError();
  }
  if (
    url.protocol !== "https:" &&
    url.hostname !== "localhost" &&
    url.hostname !== "127.0.0.1"
  ) {
    throw new AiMusicFactoryNotConfiguredError();
  }
  return url.toString();
}

function normalizeResponse(body: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(body)) {
    return body[0] && typeof body[0] === "object"
      ? (body[0] as Record<string, unknown>)
      : undefined;
  }
  return body && typeof body === "object"
    ? (body as Record<string, unknown>)
    : undefined;
}

@Injectable()
export class AiMusicFactoryConnector {
  async createProject(
    contract: NormalizedProjectIntake,
    submissionId: string,
  ): Promise<AiMusicFactoryProject> {
    const url = configuredWebhookUrl();
    const headers = new Headers({
      "content-type": "application/json",
      "x-idempotency-key": submissionId,
    });
    const token = process.env.AI_MUSIC_FACTORY_WEBHOOK_TOKEN?.trim();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          contract_name: "AI_MUSIC_FACTORY_INPUT_CONTRACT",
          contract_version: "3.1",
          source_system: "AI_EXECUTOR-01",
          submission_id: submissionId,
          ...contract,
        }),
      });
    } catch (error) {
      throw new AiMusicFactoryUnavailableError(
        error instanceof Error ? error.message : "Không gọi được AI_MUSIC_FACTORY",
      );
    }

    if (!response.ok) {
      throw new AiMusicFactoryUnavailableError(
        `AI_MUSIC_FACTORY trả HTTP ${response.status}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AiMusicFactoryInvalidResponseError();
    }

    const project = normalizeResponse(body);
    const nestedOutput =
      project?.output && typeof project.output === "object"
        ? (project.output as Record<string, unknown>)
        : undefined;
    const projectId = project?.project_id ?? nestedOutput?.project_id;

    if (typeof projectId !== "string" || projectId.trim() === "") {
      throw new AiMusicFactoryInvalidResponseError();
    }

    return {
      ...project,
      project_id: projectId,
    };
  }
}
