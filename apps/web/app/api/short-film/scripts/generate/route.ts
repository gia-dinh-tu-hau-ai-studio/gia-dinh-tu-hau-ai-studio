import { callExecutorApi } from "../../../../../lib/api-client";

export async function POST(request: Request) {
  return callExecutorApi("/v1/short-film/scripts/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
