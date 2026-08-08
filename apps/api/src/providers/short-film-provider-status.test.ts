import assert from "node:assert/strict";
import test from "node:test";
import { getShortFilmProviderStatus } from "./short-film-provider-status";

test("provider status chỉ lộ configured, không lộ secret", () => {
  const status = getShortFilmProviderStatus({
    OPENAI_API_KEY: "openai-secret",
    RUNWAYML_API_SECRET: "runway-secret",
    SYNC_API_KEY: "sync-secret",
  });
  assert.equal(status.secret_values_exposed, false);
  assert.equal(status.providers.script.configured, true);
  assert.equal(status.providers.image_to_video.configured, true);
  assert.equal(status.providers.lip_sync.configured, true);
  assert.doesNotMatch(JSON.stringify(status), /openai-secret|runway-secret|sync-secret/);
});
