import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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


test("repeated saves of the same task never overwrite or delete earlier media", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "prompt-canvas-media-collision-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });
  const options = { taskId: "repeat-task", directory };
  const first = await saveGeneratedMedia("image", [{ dataUrl: "data:image/png;base64,b25l" }], options);
  const second = await saveGeneratedMedia("image", [{ dataUrl: "data:image/png;base64,dHdv" }], options);
  assert.notEqual(first.savedFiles[0], second.savedFiles[0]);
  assert.equal(await readFile(first.savedFiles[0], "utf8"), "one");
  assert.equal(await readFile(second.savedFiles[0], "utf8"), "two");
  const before = await readdir(directory);
  await assert.rejects(saveGeneratedMedia("image", [{ dataUrl: "https://example.invalid/image.png" }], {
    ...options,
    fetchImpl: async () => new Response(null, { status: 500 }),
  }), /HTTP 500/);
  assert.deepEqual(await readdir(directory), before);
});

test("cancelling a media download stops streaming and removes its partial file", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "prompt-canvas-media-abort-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const controller = new AbortController();
  const body = new ReadableStream({
    start(stream) { stream.enqueue(new TextEncoder().encode("partial")); },
    pull() { controller.abort(); },
  });
  await assert.rejects(saveGeneratedMedia("video", [{ url: "https://example.invalid/video.mp4" }], {
    taskId: "cancel-task",
    directory,
    signal: controller.signal,
    fetchImpl: async () => new Response(body),
  }), { name: "AbortError" });
  assert.deepEqual(await readdir(directory), []);
});
