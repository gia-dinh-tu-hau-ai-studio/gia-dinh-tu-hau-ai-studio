import assert from "node:assert/strict";
import test from "node:test";
import {
  createDriveOAuthClient,
  GoogleDriveOAuthConfigurationError,
  parseDriveOAuthCredentials,
} from "../../google/google-auth";

const authorizedUser = JSON.stringify({
  type: "authorized_user",
  client_id: "client-id.apps.googleusercontent.com",
  client_secret: "client-secret",
  refresh_token: "refresh-token",
  quota_project_id: "tu-hau-ai-music",
});

test("đọc OAuth authorized_user cho Google Drive", () => {
  assert.deepEqual(parseDriveOAuthCredentials(authorizedUser), {
    type: "authorized_user",
    client_id: "client-id.apps.googleusercontent.com",
    client_secret: "client-secret",
    refresh_token: "refresh-token",
  });
});

test("tạo OAuth client chỉ giữ refresh token trong credentials", () => {
  const client = createDriveOAuthClient(authorizedUser);
  assert.equal(client.credentials.refresh_token, "refresh-token");
  assert.equal(client.credentials.access_token, undefined);
});

test("từ chối service account JSON cho luồng Drive", () => {
  assert.throws(
    () =>
      parseDriveOAuthCredentials(
        JSON.stringify({ type: "service_account", client_email: "executor@example.com" }),
      ),
    GoogleDriveOAuthConfigurationError,
  );
});

test("không cho phép thiếu refresh token", () => {
  assert.throws(
    () =>
      parseDriveOAuthCredentials(
        JSON.stringify({
          type: "authorized_user",
          client_id: "client-id",
          client_secret: "client-secret",
        }),
      ),
    /refresh_token/,
  );
});
