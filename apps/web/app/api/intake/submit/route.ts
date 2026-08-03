import { callExecutorApi } from "../../../../lib/api-client";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return callExecutorApi("/v1/intake/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
}
