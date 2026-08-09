import { z } from "zod";

export const ProviderAccountPreflightRequestSchema = z.object({
  project_type: z.enum(["SHORT_FILM", "MUSIC_VIDEO", "SHORT_MUSIC_CLIP"]),
  duration_seconds: z.number().int().positive().max(3600),
  providers: z.object({
    script: z.enum(["OPENAI_RESPONSES", "PROJECT_OWNER"]),
    video: z.enum(["RUNWAY", "NONE"]),
    voice: z.enum(["ELEVENLABS", "APPROVED_VOICE_MASTER", "NONE"]),
    lip_sync: z.enum(["SYNC", "NONE"]),
  }),
});

type ProviderCheck = {
  provider: "OPENAI" | "RUNWAY" | "ELEVENLABS" | "SYNC";
  status: "SUFFICIENT" | "INSUFFICIENT" | "NOT_CONFIGURED" | "AUTH_ERROR" | "UNVERIFIED";
  required_units?: number;
  available_units?: number;
  unit?: "credits" | "characters";
  message: string;
};

function dialogueRatio(projectType: string) {
  return projectType === "MUSIC_VIDEO" ? 0.15 : projectType === "SHORT_MUSIC_CLIP" ? 0.1 : 0.35;
}

async function runwayCheck(secret: string | undefined, requiredCredits: number, fetcher: typeof fetch): Promise<ProviderCheck> {
  if (!secret?.trim()) return { provider: "RUNWAY", status: "NOT_CONFIGURED", message: "Chưa cấu hình Runway API secret." };
  try {
    const response = await fetcher("https://api.dev.runwayml.com/v1/organization", {
      headers: { Authorization: `Bearer ${secret}`, "X-Runway-Version": "2024-11-06" },
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 401 || response.status === 403) return { provider: "RUNWAY", status: "AUTH_ERROR", message: "Runway từ chối API key." };
    if (!response.ok) return { provider: "RUNWAY", status: "UNVERIFIED", message: `Runway không trả số dư (HTTP ${response.status}).` };
    const body = await response.json() as { creditBalance?: number };
    if (typeof body.creditBalance !== "number") return { provider: "RUNWAY", status: "UNVERIFIED", message: "Runway không trả trường creditBalance." };
    return { provider: "RUNWAY", status: body.creditBalance >= requiredCredits ? "SUFFICIENT" : "INSUFFICIENT", required_units: requiredCredits, available_units: body.creditBalance, unit: "credits", message: body.creditBalance >= requiredCredits ? "Credit Runway đủ cho dự toán." : "Credit Runway không đủ cho dự toán." };
  } catch {
    return { provider: "RUNWAY", status: "UNVERIFIED", message: "Không kết nối được endpoint số dư Runway." };
  }
}

async function elevenLabsCheck(secret: string | undefined, requiredCharacters: number, fetcher: typeof fetch): Promise<ProviderCheck> {
  if (!secret?.trim()) return { provider: "ELEVENLABS", status: "NOT_CONFIGURED", message: "Chưa cấu hình ElevenLabs API key." };
  try {
    const response = await fetcher("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": secret }, signal: AbortSignal.timeout(8_000) });
    if (response.status === 401 || response.status === 403) return { provider: "ELEVENLABS", status: "AUTH_ERROR", message: "ElevenLabs từ chối API key." };
    if (!response.ok) return { provider: "ELEVENLABS", status: "UNVERIFIED", message: `ElevenLabs không trả hạn mức (HTTP ${response.status}).` };
    const body = await response.json() as { character_count?: number; character_limit?: number; max_credit_limit_extension?: number | "unlimited"; status?: string };
    if (typeof body.character_count !== "number" || typeof body.character_limit !== "number") return { provider: "ELEVENLABS", status: "UNVERIFIED", message: "ElevenLabs không trả hạn mức ký tự." };
    const extension = body.max_credit_limit_extension === "unlimited" ? Number.POSITIVE_INFINITY : Math.max(0, Number(body.max_credit_limit_extension ?? 0));
    const remaining = Math.max(0, body.character_limit - body.character_count) + extension;
    const sufficient = body.status !== "past_due" && remaining >= requiredCharacters;
    return { provider: "ELEVENLABS", status: sufficient ? "SUFFICIENT" : "INSUFFICIENT", required_units: requiredCharacters, available_units: Number.isFinite(remaining) ? remaining : undefined, unit: "characters", message: sufficient ? "Hạn mức ElevenLabs đủ cho phần thoại dự kiến." : "Hạn mức ElevenLabs không đủ hoặc tài khoản đang quá hạn." };
  } catch {
    return { provider: "ELEVENLABS", status: "UNVERIFIED", message: "Không kết nối được endpoint subscription ElevenLabs." };
  }
}

export async function checkProviderAccounts(input: unknown, environment: NodeJS.ProcessEnv, fetcher: typeof fetch = fetch) {
  const request = ProviderAccountPreflightRequestSchema.parse(input);
  const selected: ProviderCheck[] = [];
  if (request.providers.script === "OPENAI_RESPONSES") selected.push({ provider: "OPENAI", status: environment.OPENAI_API_KEY?.trim() ? "UNVERIFIED" : "NOT_CONFIGURED", message: environment.OPENAI_API_KEY?.trim() ? "OpenAI không cung cấp API số dư khả dụng cho project key; cần xác nhận thủ công trên Billing." : "Chưa cấu hình OpenAI API key." });
  if (request.providers.video === "RUNWAY") selected.push(await runwayCheck(environment.RUNWAYML_API_SECRET, Math.ceil(request.duration_seconds * 12 * 1.5), fetcher));
  if (request.providers.voice === "ELEVENLABS") selected.push(await elevenLabsCheck(environment.ELEVENLABS_API_KEY, Math.ceil(request.duration_seconds * dialogueRatio(request.project_type) * 15), fetcher));
  if (request.providers.lip_sync === "SYNC") selected.push({ provider: "SYNC", status: environment.SYNC_API_KEY?.trim() ? "UNVERIFIED" : "NOT_CONFIGURED", message: environment.SYNC_API_KEY?.trim() ? "Sync chưa công bố endpoint số dư ổn định; cần xác nhận thủ công trên Billing." : "Chưa cấu hình Sync API key." });
  const blocked = selected.some((item) => ["INSUFFICIENT", "NOT_CONFIGURED", "AUTH_ERROR"].includes(item.status));
  const unverified = selected.some((item) => item.status === "UNVERIFIED");
  return { checked_at: new Date().toISOString(), execution_gate: blocked ? "BLOCKED" : unverified ? "MANUAL_CONFIRMATION_REQUIRED" : "READY", secret_values_exposed: false as const, providers: selected };
}
