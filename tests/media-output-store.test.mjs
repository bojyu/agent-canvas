import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { saveGeneratedMedia } from "../scripts/media-output-store.mjs";

test("generated images are decoded and saved to the configured directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prompt-canvas-media-"));
  try {
    const result = await saveGeneratedMedia("image", [{
      dataUrl: "data:image/png;base64,aGVsbG8=",
      mediaType: "image/png",
    }], { taskId: "image-task", directory });

    assert.equal(result.savedFiles.length, 1);
    assert.match(result.savedFiles[0], /image-.*-image-task-01\.png$/);
    assert.equal(await readFile(result.savedFiles[0], "utf8"), "hello");
    assert.equal(result.items[0].savedPath, result.savedFiles[0]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("generated videos are downloaded and saved to the configured directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prompt-canvas-media-"));
  try {
    const result = await saveGeneratedMedia("video", [{
      url: "https://cdn.example/video.mp4",
      mediaType: "video/mp4",
    }], {
      taskId: "video-task",
      directory,
      fetchImpl: async () => new Response("video-bytes", { status: 200, headers: { "content-type": "video/mp4" } }),
    });

    assert.equal(result.savedFiles.length, 1);
    assert.match(result.savedFiles[0], /video-.*-video-task-01\.mp4$/);
    assert.equal(await readFile(result.savedFiles[0], "utf8"), "video-bytes");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
