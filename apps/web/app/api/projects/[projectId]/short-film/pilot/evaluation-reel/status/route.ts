import { callExecutorApi } from "../../../../../../../../lib/api-client";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  return callExecutorApi(`/v1/projects/${encodeURIComponent(projectId)}/short-film/pilot/evaluation-reel/status`);
}
