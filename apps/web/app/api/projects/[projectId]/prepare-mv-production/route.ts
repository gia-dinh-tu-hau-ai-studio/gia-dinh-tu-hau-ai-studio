import { callExecutorApi } from "../../../../../lib/api-client";

export const dynamic = "force-dynamic";

export function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  return context.params.then(({ projectId }) =>
    callExecutorApi(
      `/v1/projects/${encodeURIComponent(projectId)}/prepare-mv-production`,
      { method: "POST" },
    ),
  );
}
