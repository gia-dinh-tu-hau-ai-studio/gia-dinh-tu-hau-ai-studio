import { callExecutorApi } from "../../../../../lib/api-client";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const body = await request.json();
  return callExecutorApi(
    `/v1/projects/${encodeURIComponent(projectId)}/create-rp015-final-proof`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
}
