import { callExecutorApi } from "../../../../../../lib/api-client";

export const dynamic = "force-dynamic";

export function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  return context.params.then(({ projectId }) =>
    callExecutorApi(`/v1/projects/${encodeURIComponent(projectId)}/short-film/workflow`),
  );
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const body = await request.text();
  const { projectId } = await context.params;
  return callExecutorApi(`/v1/projects/${encodeURIComponent(projectId)}/short-film/workflow`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body,
  });
}
