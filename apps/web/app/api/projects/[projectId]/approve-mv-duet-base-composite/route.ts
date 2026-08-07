import { callExecutorApi } from "../../../../../lib/api-client";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  return callExecutorApi(
    `/v1/projects/${encodeURIComponent(projectId)}/approve-mv-duet-base-composite`,
    { method: "POST" },
  );
}
