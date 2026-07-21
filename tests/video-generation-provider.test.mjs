import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVideoGenerationHttpRequest,
  extractCliUrls,
  getVideoGenerationProviderStatus,
  normalizeVideoGenerationRequest,
  runVideoGeneration,
} from "../scripts/video-generation-provider.mjs";

const image = "data:image/png;base64,aGVsbG8=";
const video = "data:video/mp4;base64,dmlkZW8=";

test("Seedance CLI extracts video URLs nested in result_json", () => {
  assert.deepEqual(extractCliUrls({
    submit_id: "task-1",
    gen_status: "success",
    result_json: {
      videos: [
        { video_url: "https://cdn.example/seedance.mp4", format: "mp4" },
      ],
    },
  }), ["https://cdn.example/seedance.mp4"]);
});

function baseRequest(overrides = {}) {
  return {
    provider: "openrouter",
    model: "bytedance/seedance-2.0",
    mode: "multimodal2video",
    prompt: "@图片1 作为主体，参考 @视频1 的运镜",
    aspectRatio: "16:9",
    resolution: "720p",
    duration: 5,
    references: [
      { slot: 1, marker: "@图片1", dataUrl: image },
      { slot: 2, marker: "@视频1", dataUrl: video },
    ],
    ...overrides,
  };
}

test("video request keeps stable mixed-reference markers and enforces Seedance limits", () => {
  const normalized = normalizeVideoGenerationRequest(baseRequest());
  assert.deepEqual(normalized.references.map((item) => [item.slot, item.marker, item.mediaKind]), [
    [1, "@图片1", "image"],
    [2, "@视频1", "video"],
  ]);
  assert.throws(() => normalizeVideoGenerationRequest(baseRequest({
    references: Array.from({ length: 4 }, (_, index) => ({ slot: index + 1, marker: `@视频${index + 1}`, dataUrl: video })),
  })), /最多支持 9 张图片和 3 个视频/);
});

test("OpenRouter maps frame and all-around reference modes to its dedicated video API", () => {
  const allAround = buildVideoGenerationHttpRequest(baseRequest(), { OPENROUTER_API_KEY: "key" });
  assert.equal(allAround.url, "https://openrouter.ai/api/v1/videos");
  assert.equal(allAround.body.input_references[0].type, "image_url");
  assert.equal(allAround.body.input_references[1].type, "video_url");

  const frames = buildVideoGenerationHttpRequest(baseRequest({
    mode: "frames2video",
    references: [
      { slot: 1, marker: "@图片1", dataUrl: image },
      { slot: 2, marker: "@图片2", dataUrl: image },
    ],
  }), { OPENROUTER_API_KEY: "key" });
  assert.deepEqual(frames.body.frame_images.map((item) => item.frame_type), ["first_frame", "last_frame"]);
  assert.equal(frames.body.input_references, undefined);
});

test("Comfly uses the current Seedance official-format endpoint for mixed references", () => {
  const prepared = buildVideoGenerationHttpRequest(baseRequest({
    provider: "comfly",
    model: "doubao-seedance-2-0-260128",
    resolution: "2K",
  }), { COMFLY_API_KEY: "key" });
  assert.equal(prepared.url, "https://ai.comfly.org/seedance/v3/contents/generations/tasks");
  assert.equal(prepared.body.content[0].type, "text");
  assert.match(prepared.body.content[0].text, /--ratio 16:9 --duration 5 --resolution 2K/);
  assert.deepEqual(prepared.body.content.slice(1).map((item) => item.type), ["image_url", "video_url"]);
});

test("HTTP video generation submits, polls, and returns a browser-ready URL", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === "POST") return new Response(JSON.stringify({ id: "job-1", status: "pending" }), { status: 202 });
    return new Response(JSON.stringify({
      id: "job-1",
      status: "completed",
      unsigned_urls: ["https://cdn.example/video.mp4"],
      usage: { cost: 0.5 },
    }), { status: 200 });
  };
  const result = await runVideoGeneration(baseRequest({ mode: "text2video", references: [] }), {
    env: { OPENROUTER_API_KEY: "key" },
    fetchImpl,
    pollIntervalMs: 1,
    timeoutMs: 1000,
  });
  assert.equal(result.jobId, "job-1");
  assert.equal(result.videos[0].url, "https://cdn.example/video.mp4");
  assert.equal(calls[1].url, "https://openrouter.ai/api/v1/videos/job-1");
});

test("video provider catalogs are gated by credentials and CLI availability", async () => {
  const openrouter = await getVideoGenerationProviderStatus("openrouter", { env: {} });
  const comfly = await getVideoGenerationProviderStatus("comfly", { env: {} });
  assert.equal(openrouter.configured, false);
  assert.equal(comfly.configured, false);
  assert.match(openrouter.message, /OPENROUTER_API_KEY/);
  assert.match(comfly.message, /COMFLY_API_KEY/);
});
