import assert from "node:assert/strict";
import test from "node:test";

import {
  buildImageGenerationHttpRequest,
  extractImageCandidates,
  getImageGenerationProviderStatus,
  runImageGeneration,
} from "../scripts/image-generation-provider.mjs";

const tinyPng = "data:image/png;base64,aGVsbG8=";

test("image provider catalogs are gated by their own API keys", () => {
  assert.equal(getImageGenerationProviderStatus("openrouter", {}).configured, false);
  assert.equal(getImageGenerationProviderStatus("google", { GEMINI_API_KEY: "google-key" }).models[0].model, "gemini-3.1-flash-image");
  assert.deepEqual(
    getImageGenerationProviderStatus("comfly", { COMFLY_API_KEY: "comfly-key" }).models.map((model) => model.model),
    ["gemini-3.1-flash-image"],
  );
  const tiered = getImageGenerationProviderStatus("comfly", {
    COMFLY_GPT_IMAGE_2_1K_API_KEY: "one-k-key",
    COMFLY_GPT_IMAGE_2_4K_API_KEY: "four-k-key",
  });
  assert.deepEqual(tiered.models.map((model) => model.model), ["gpt-image-2"]);
  assert.deepEqual(tiered.models[0].supportedResolutions, ["1K", "4K"]);
});

test("OpenRouter uses the dedicated image API and normalized controls", () => {
  const prepared = buildImageGenerationHttpRequest({
    provider: "openrouter",
    model: "openai/gpt-image-2",
    prompt: "A clean product photo",
    resolution: "4K",
    aspectRatio: "16:9",
    images: [{ dataUrl: tinyPng }],
  }, { OPENROUTER_API_KEY: "openrouter-key" });

  assert.equal(prepared.url, "https://openrouter.ai/api/v1/images");
  assert.equal(prepared.body.resolution, "4K");
  assert.equal(prepared.body.aspect_ratio, "16:9");
  assert.equal(prepared.body.input_references[0].image_url.url, tinyPng);
});

test("Google Interactions request sends reference image bytes without the Data URL prefix", () => {
  const prepared = buildImageGenerationHttpRequest({
    provider: "google",
    model: "gemini-3.1-flash-image",
    prompt: "Edit this image",
    resolution: "2K",
    aspectRatio: "Auto",
    images: [{ marker: "@图片1", dataUrl: tinyPng }],
  }, { GOOGLE_API_KEY: "google-key" });

  assert.equal(prepared.url, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(prepared.body.input[1].data, "aGVsbG8=");
  assert.equal(prepared.body.response_format.image_size, "2K");
  assert.equal("aspect_ratio" in prepared.body.response_format, false);
});

test("Comfly maps Nano Banana 2 resolution tiers to its available model slugs", () => {
  const prepared = buildImageGenerationHttpRequest({
    provider: "comfly",
    model: "gemini-3.1-flash-image",
    prompt: "A cinematic landscape",
    resolution: "4K",
    aspectRatio: "21:9",
  }, { COMFLY_API_KEY: "comfly-key" });

  assert.equal(prepared.url, "https://ai.comfly.org/v1/chat/completions");
  assert.equal(prepared.body.model, "gemini-3.1-flash-image-4k");
  assert.deepEqual(prepared.body.modalities, ["image", "text"]);
  assert.deepEqual(prepared.body.image_config, { aspect_ratio: "21:9", image_size: "4K" });
});

test("Comfly GPT Image 2 routes each resolution to its dedicated key and Generations model", () => {
  const env = {
    COMFLY_API_KEY: "general-key",
    COMFLY_GPT_IMAGE_2_1K_API_KEY: "one-k-key",
    COMFLY_GPT_IMAGE_2_2K_API_KEY: "two-k-key",
    COMFLY_GPT_IMAGE_2_4K_API_KEY: "four-k-key",
  };
  for (const [resolution, expectedKey, expectedModel] of [
    ["1K", "one-k-key", "gpt-image-2-all"],
    ["2K", "two-k-key", "gpt-image-2"],
    ["4K", "four-k-key", "gpt-image-2"],
  ]) {
    const prepared = buildImageGenerationHttpRequest({
      provider: "comfly",
      model: "gpt-image-2",
      prompt: "A clean product photo",
      resolution,
      aspectRatio: "1:1",
      images: [{ dataUrl: tinyPng }],
    }, env);
    assert.equal(prepared.url, "https://ai.comfly.org/v1/images/generations");
    assert.equal(prepared.headers.Authorization, `Bearer ${expectedKey}`);
    assert.notEqual(prepared.headers.Authorization, "Bearer general-key");
    assert.equal(prepared.body.model, expectedModel);
    assert.equal(prepared.body.size, { "1K": "1024x1024", "2K": "2048x2048", "4K": "2880x2880" }[resolution]);
    assert.deepEqual(prepared.body.image, [tinyPng]);
    assert.equal("messages" in prepared.body, false);
    assert.equal("image_config" in prepared.body, false);
    assert.equal("aspect_ratio" in prepared.body, false);
  }
  assert.throws(() => buildImageGenerationHttpRequest({
    provider: "comfly",
    model: "gpt-image-2",
    prompt: "A clean product photo",
    resolution: "2K",
    aspectRatio: "1:1",
  }, { COMFLY_API_KEY: "general-key" }), /COMFLY_GPT_IMAGE_2_2K_API_KEY/);
});

test("Comfly GPT Image 2 converts canvas ratios to valid concrete 4K sizes", () => {
  const env = { COMFLY_GPT_IMAGE_2_4K_API_KEY: "four-k-key" };
  const cases = [
    ["Auto", "3840x2160"],
    ["16:9", "3840x2160"],
    ["9:16", "2160x3840"],
    ["1:1", "2880x2880"],
    ["4:3", "3264x2448"],
    ["21:9", "3808x1632"],
  ];
  for (const [aspectRatio, expectedSize] of cases) {
    const prepared = buildImageGenerationHttpRequest({
      provider: "comfly",
      model: "gpt-image-2",
      prompt: "A high-resolution product photo",
      resolution: "4K",
      aspectRatio,
    }, env);
    assert.equal(prepared.body.model, "gpt-image-2");
    assert.equal(prepared.body.size, expectedSize);
  }
});

test("image extraction accepts OpenRouter, Google and Comfly response shapes", () => {
  assert.equal(extractImageCandidates({ data: [{ b64_json: "YWJj", media_type: "image/webp" }] })[0].mediaType, "image/webp");
  assert.equal(extractImageCandidates({ output_image: { data: "ZGVm", mime_type: "image/png" } })[0].value, "ZGVm");
  assert.equal(extractImageCandidates({ choices: [{ message: { images: [{ image_url: { url: tinyPng } }] } }] })[0].value, tinyPng);
  assert.equal(extractImageCandidates({ choices: [{ message: { content: "Generated image: ![result](https://cdn.example/result.png)" } }] })[0].value, "https://cdn.example/result.png");
  assert.equal(extractImageCandidates({ candidates: [{ content: { parts: [{ inlineData: { data: "aW1hZ2U=", mimeType: "image/webp" } }] } }] })[0].mediaType, "image/webp");
});

test("runImageGeneration returns browser-ready Data URLs", async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, "https://openrouter.ai/api/v1/images");
    return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=", media_type: "image/png" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const result = await runImageGeneration({
    provider: "openrouter",
    model: "openai/gpt-image-2",
    prompt: "A studio portrait",
    resolution: "1K",
    aspectRatio: "1:1",
  }, { env: { OPENROUTER_API_KEY: "openrouter-key" }, fetchImpl });

  assert.equal(result.images[0].dataUrl, "data:image/png;base64,aGVsbG8=");
  assert.equal(result.provider, "openrouter");
});
