import { callExecutorApi } from "../../../../../../../../lib/api-client";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) { const { projectId } = await context.params; return callExecutorApi(`/v1/projects/${encodeURIComponent(projectId)}/short-film/golden-scene/character-keyframes/review`, { method: "POST", headers: { "content-type": "application/json" }, body: await request.text() }); }
