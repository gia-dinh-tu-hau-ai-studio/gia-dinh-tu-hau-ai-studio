import { callExecutorApi } from "../../../../../../../../../lib/api-client";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string; fileId: string }> }) {
  const { projectId, fileId } = await context.params;
  return callExecutorApi(`/v1/projects/${encodeURIComponent(projectId)}/short-film/pilot/performance-variant/outputs/${encodeURIComponent(fileId)}`);
}
