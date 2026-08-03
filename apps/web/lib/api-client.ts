import { GoogleAuth } from "google-auth-library";

const LOCAL_API_URL = "http://localhost:3001";

function getApiUrl() {
  return (process.env.API_URL ?? LOCAL_API_URL).replace(/\/$/, "");
}

async function getAuthorizationHeader(apiUrl: string) {
  if (apiUrl.startsWith("http://localhost") || apiUrl.startsWith("http://127.0.0.1")) {
    return undefined;
  }

  const client = await new GoogleAuth().getIdTokenClient(apiUrl);
  const headers = await client.getRequestHeaders(apiUrl);
  return headers.get("authorization") ?? undefined;
}

export async function callExecutorApi(path: string, init?: RequestInit) {
  const apiUrl = getApiUrl();
  const authorization = await getAuthorizationHeader(apiUrl);
  const headers = new Headers(init?.headers);

  if (authorization) {
    headers.set("authorization", authorization);
  }

  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    cache: "no-store",
    headers,
  });

  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  });
}
