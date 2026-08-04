import { callExecutorApi } from "../../../../../lib/api-client";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const body = await request.text();
  const { projectId } = await context.params;
  return callExecutorApi(
    `/v1/projects/${encodeURIComponent(projectId)}/prepare-mv-assets`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    },
  );
}
