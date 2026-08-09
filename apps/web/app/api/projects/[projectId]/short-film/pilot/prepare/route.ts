import { callExecutorApi } from "../../../../../../../lib/api-client";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const body = await request.text();
  const { projectId } = await context.params;
  return callExecutorApi(`/v1/projects/${encodeURIComponent(projectId)}/short-film/pilot/prepare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}
