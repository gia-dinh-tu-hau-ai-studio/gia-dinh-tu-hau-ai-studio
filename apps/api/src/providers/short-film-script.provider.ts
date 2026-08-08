import { Injectable } from "@nestjs/common";
import {
  ShortFilmScriptDraftSchema,
  type ShortFilmScriptDraft,
  type ShortFilmScriptGenerationRequest,
} from "@tu-hau/contracts";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export class ShortFilmScriptProviderNotConfiguredError extends Error {}
export class ShortFilmScriptProviderUnavailableError extends Error {}

type OpenAiResponse = {
  id?: string;
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
};

export function buildShortFilmScriptPrompt(input: ShortFilmScriptGenerationRequest) {
  const cast = input.characters.map((character) =>
    `- ${character.film_character_name}: vai ${character.film_role}; quan hệ ${character.relationships}; tính cách ${character.personality}; ngoại hình ${character.appearance}`,
  ).join("\n");
  return [
    `Viết kịch bản phim ngắn bằng ngôn ngữ ${input.language}, thời lượng mục tiêu ${input.target_duration_minutes} phút.`,
    "Bám đúng ý tưởng và dàn nhân vật. Không đổi danh tính diễn viên nguồn. Viết cảnh, bối cảnh, hành động và thoại đủ để lập Shot Plan.",
    "Không mô tả microphone hoặc background của footage nguồn như thuộc tính cố định của nhân vật.",
    `Ý tưởng:\n${input.idea}`,
    `Nhân vật:\n${cast}`,
  ].join("\n\n");
}

export function parseShortFilmScriptResponse(response: OpenAiResponse): ShortFilmScriptDraft {
  const text = response.output_text ?? response.output
    ?.flatMap((item) => item.content ?? [])
    .find((content) => content.type === "output_text")?.text;
  if (!text) throw new ShortFilmScriptProviderUnavailableError("Provider không trả nội dung kịch bản");
  try {
    return ShortFilmScriptDraftSchema.parse(JSON.parse(text));
  } catch {
    throw new ShortFilmScriptProviderUnavailableError("Provider trả kịch bản sai schema");
  }
}

@Injectable()
export class ShortFilmScriptProvider {
  async generate(input: ShortFilmScriptGenerationRequest) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new ShortFilmScriptProviderNotConfiguredError("OPENAI_API_KEY chưa được cấu hình trong secret runtime");
    const model = process.env.SHORT_FILM_SCRIPT_MODEL?.trim() || "gpt-5.6-terra";
    let response: Response;
    try {
      response = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          store: false,
          input: [
            { role: "developer", content: "Bạn là biên kịch phim ngắn. Chỉ trả JSON đúng schema được yêu cầu." },
            { role: "user", content: buildShortFilmScriptPrompt(input) },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "short_film_script_draft",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["title", "synopsis", "full_script"],
                properties: {
                  title: { type: "string" },
                  synopsis: { type: "string" },
                  full_script: { type: "string" },
                },
              },
            },
          },
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch {
      throw new ShortFilmScriptProviderUnavailableError("Không kết nối được provider kịch bản");
    }
    if (!response.ok) {
      throw new ShortFilmScriptProviderUnavailableError(`Provider kịch bản trả HTTP ${response.status}`);
    }
    const payload = await response.json() as OpenAiResponse;
    return {
      provider: "OPENAI_RESPONSES" as const,
      model,
      provider_request_id: payload.id ?? null,
      draft: parseShortFilmScriptResponse(payload),
      usage: payload.usage ?? null,
      approval_status: "PENDING" as const,
    };
  }
}
