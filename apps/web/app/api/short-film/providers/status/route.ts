import { callExecutorApi } from "../../../../../lib/api-client";

export async function GET() {
  return callExecutorApi("/v1/short-film/providers/status");
}
