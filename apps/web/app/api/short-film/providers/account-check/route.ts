import { callExecutorApi } from "../../../../../lib/api-client";

export async function POST(request: Request) {
  return callExecutorApi("/v1/short-film/providers/account-check", {
    method: "POST",
    body: JSON.stringify(await request.json()),
  });
}
