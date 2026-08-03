import { callExecutorApi } from "../../../../lib/api-client";

export const dynamic = "force-dynamic";

export function GET() {
  return callExecutorApi("/v1/characters/eligible");
}
