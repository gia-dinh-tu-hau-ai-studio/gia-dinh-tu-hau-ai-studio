import { google } from "googleapis";

export class GoogleDriveOAuthConfigurationError extends Error {}

type DriveOAuthCredentials = {
  type: "authorized_user";
  client_id: string;
  client_secret: string;
  refresh_token: string;
};

export function createServiceAuth(
  scopes: string[],
): InstanceType<typeof google.auth.GoogleAuth> {
  const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  return rawCredentials
    ? new google.auth.GoogleAuth({
        credentials: JSON.parse(rawCredentials) as Record<string, unknown>,
        scopes,
      })
    : new google.auth.GoogleAuth({ scopes });
}

export function parseDriveOAuthCredentials(
  rawCredentials: string | undefined,
): DriveOAuthCredentials {
  if (!rawCredentials?.trim()) {
    throw new GoogleDriveOAuthConfigurationError(
      "Thiếu cấu hình GOOGLE_DRIVE_OAUTH_CREDENTIALS_JSON",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawCredentials);
  } catch {
    throw new GoogleDriveOAuthConfigurationError(
      "GOOGLE_DRIVE_OAUTH_CREDENTIALS_JSON không phải JSON hợp lệ",
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new GoogleDriveOAuthConfigurationError(
      "GOOGLE_DRIVE_OAUTH_CREDENTIALS_JSON phải là JSON object",
    );
  }

  const credentials = parsed as Record<string, unknown>;
  if (credentials.type !== "authorized_user") {
    throw new GoogleDriveOAuthConfigurationError(
      "GOOGLE_DRIVE_OAUTH_CREDENTIALS_JSON phải có type authorized_user",
    );
  }

  for (const field of ["client_id", "client_secret", "refresh_token"] as const) {
    if (!String(credentials[field] ?? "").trim()) {
      throw new GoogleDriveOAuthConfigurationError(
        `GOOGLE_DRIVE_OAUTH_CREDENTIALS_JSON thiếu ${field}`,
      );
    }
  }

  return {
    type: "authorized_user",
    client_id: String(credentials.client_id).trim(),
    client_secret: String(credentials.client_secret).trim(),
    refresh_token: String(credentials.refresh_token).trim(),
  };
}

export function createDriveOAuthClient(
  rawCredentials = process.env.GOOGLE_DRIVE_OAUTH_CREDENTIALS_JSON,
): InstanceType<typeof google.auth.OAuth2> {
  const credentials = parseDriveOAuthCredentials(rawCredentials);
  const auth = new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret,
  );
  auth.setCredentials({ refresh_token: credentials.refresh_token });
  return auth;
}
