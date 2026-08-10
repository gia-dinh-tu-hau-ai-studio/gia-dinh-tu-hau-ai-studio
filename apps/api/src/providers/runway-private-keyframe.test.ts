import assert from "node:assert/strict";
import test from "node:test";
import type { DriveConnector } from "../connectors/google-drive/drive.connector";
import type { RunwayPilotProvider } from "./short-film-pilot.providers";
import { preparePrivateRunwayKeyframe, type RunwayAssetCache } from "./runway-private-keyframe";

const referenceUrl = "https://drive.google.com/file/d/1A173k-4ucI0zsuQKjOa-kxZtXQnqN-0j/view";

test("reuses an unexpired private Runway asset without downloading or uploading again", async () => {
  let downloads = 0;
  let uploads = 0;
  const cache: RunwayAssetCache = {
    "1A173k-4ucI0zsuQKjOa-kxZtXQnqN-0j": {
      uri: "runway://cached-private-keyframe",
      expires_at: "2026-08-11T12:00:00.000Z",
    },
  };
  const drive = { downloadPrivateRunwayImage: async () => { downloads += 1; throw new Error("unexpected download"); } } as unknown as DriveConnector;
  const runway = { uploadImage: async () => { uploads += 1; throw new Error("unexpected upload"); } } as unknown as RunwayPilotProvider;

  const uri = await preparePrivateRunwayKeyframe({ referenceUrl, cache, drive, runway, now: new Date("2026-08-11T10:00:00.000Z") });

  assert.equal(uri, "runway://cached-private-keyframe");
  assert.equal(downloads, 0);
  assert.equal(uploads, 0);
});

test("replaces an expired Runway asset through authenticated Drive download and ephemeral upload", async () => {
  let downloads = 0;
  let uploads = 0;
  const cache: RunwayAssetCache = {
    "1A173k-4ucI0zsuQKjOa-kxZtXQnqN-0j": {
      uri: "runway://expired-private-keyframe",
      expires_at: "2026-08-11T09:00:00.000Z",
    },
  };
  const drive = {
    downloadPrivateRunwayImage: async () => {
      downloads += 1;
      return { fileId: "1A173k-4ucI0zsuQKjOa-kxZtXQnqN-0j", fileName: "master.jpg", mimeType: "image/jpeg", content: Buffer.alloc(512), md5Checksum: "abc" };
    },
  } as unknown as DriveConnector;
  const runway = {
    uploadImage: async () => {
      uploads += 1;
      return { uri: "runway://new-private-keyframe" };
    },
  } as unknown as RunwayPilotProvider;

  const uri = await preparePrivateRunwayKeyframe({ referenceUrl, cache, drive, runway, now: new Date("2026-08-11T10:00:00.000Z") });

  assert.equal(uri, "runway://new-private-keyframe");
  assert.equal(downloads, 1);
  assert.equal(uploads, 1);
  assert.equal(cache["1A173k-4ucI0zsuQKjOa-kxZtXQnqN-0j"]?.md5_checksum, "abc");
  assert.equal(cache["1A173k-4ucI0zsuQKjOa-kxZtXQnqN-0j"]?.expires_at, "2026-08-12T09:00:00.000Z");
});
