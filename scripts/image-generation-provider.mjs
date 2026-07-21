export const IMAGE_GENERATION_PROVIDER_IDS = Object.freeze(["openrouter", "google", "comfly"]);
export const IMAGE_GENERATION_RESOLUTIONS = Object.freeze(["1K", "2K", "4K"]);
export const IMAGE_GENERATION_ASPECT_RATIOS = Object.freeze([
  "Auto",
  "1:1",
  "9:16",
  "16:9",
  "3:4",
  "4:3",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
  "21:9",
]);

const MAX_REFERENCE_IMAGES = 12;
const DEFAULT_TIMEOUT_MS = 3 * 60_000;

const MODEL_CATALOGS = Object.freeze({
  openrouter: Object.freeze([
    Object.freeze({
      id: "openrouter-gpt-image-2",
      model: "openai/gpt-image-2",
      displayName: "GPT Image 2",
      description: "OpenRouter 图像 API · OpenAI GPT Image 2",
      supportedResolutions: IMAGE_GENERATION_RESOLUTIONS,
      maxReferences: MAX_REFERENCE_IMAGES,
    }),
    Object.freeze({
      id: "openrouter-nano-banana-2",
      model: "google/gemini-3.1-flash-image",
      displayName: "Nano Banana 2",
      description: "OpenRouter 图像 API · Google Gemini 3.1 Flash Image",
      supportedResolutions: IMAGE_GENERATION_RESOLUTIONS,
      maxReferences: MAX_REFERENCE_IMAGES,
    }),
  ]),
  google: Object.freeze([
    Object.freeze({
      id: "google-nano-banana-2",
      model: "gemini-3.1-flash-image",
      displayName: "Nano Banana 2",
      description: "Google Gemini 官方 Interactions API",
      supportedResolutions: IMAGE_GENERATION_RESOLUTIONS,
      maxReferences: MAX_REFERENCE_IMAGES,
    }),
  ]),
  comfly: Object.freeze([
    Object.freeze({
      id: "comfly-gpt-image-2",
      model: "gpt-image-2",
      displayName: "GPT Image 2",
      description: "Comfly OpenAI 兼容中转",
      supportedResolutions: IMAGE_GENERATION_RESOLUTIONS,
      maxReferences: MAX_REFERENCE_IMAGES,
    }),
    Object.freeze({
      id: "comfly-nano-banana-2",
      model: "gemini-3.1-flash-image",
      displayName: "Nano Banana 2",
      description: "Comfly Google 绘图通道",
      supportedResolutions: IMAGE_GENERATION_RESOLUTIONS,
      maxReferences: MAX_REFERENCE_IMAGES,
    }),
  ]),
});

const PROVIDER_LABELS = Object.freeze({
  openrouter: "OpenRouter",
  google: "Google 官方",
  comfly: "Comfly",
});

function normalizeProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (!IMAGE_GENERATION_PROVIDER_IDS.includes(provider)) {
    throw new Error(`不支持的图片生成供应商：${provider || "未选择"}`);
  }
  return provider;
}

const COMFLY_GPT_IMAGE_2_KEY_NAMES = Object.freeze({
  "1K": "COMFLY_GPT_IMAGE_2_1K_API_KEY",
  "2K": "COMFLY_GPT_IMAGE_2_2K_API_KEY",
  "4K": "COMFLY_GPT_IMAGE_2_4K_API_KEY",
});

const COMFLY_GPT_IMAGE_2_MODELS = Object.freeze({
  "1K": "gpt-image-2-all",
  "2K": "gpt-image-2",
  "4K": "gpt-image-2",
});

const COMFLY_GPT_IMAGE_2_SIZES = Object.freeze({
  "1K": Object.freeze({
    Auto: "1024x1024",
    "1:1": "1024x1024",
    "9:16": "864x1536",
    "16:9": "1536x864",
    "3:4": "1008x1344",
    "4:3": "1344x1008",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
    "5:4": "1280x1024",
    "4:5": "1024x1280",
    "21:9": "1456x624",
  }),
  "2K": Object.freeze({
    Auto: "2048x2048",
    "1:1": "2048x2048",
    "9:16": "1152x2048",
    "16:9": "2048x1152",
    "3:4": "1536x2048",
    "4:3": "2048x1536",
    "3:2": "2016x1344",
    "2:3": "1344x2016",
    "5:4": "2000x1600",
    "4:5": "1600x2000",
    "21:9": "2016x864",
  }),
  "4K": Object.freeze({
    Auto: "3840x2160",
    "1:1": "2880x2880",
    "9:16": "2160x3840",
    "16:9": "3840x2160",
    "3:4": "2448x3264",
    "4:3": "3264x2448",
    "3:2": "3504x2336",
    "2:3": "2336x3504",
    "5:4": "3200x2560",
    "4:5": "2560x3200",
    "21:9": "3808x1632",
  }),
});

function configuredComflyGptImageResolutions(env = process.env) {
  return IMAGE_GENERATION_RESOLUTIONS.filter((resolution) => String(env[COMFLY_GPT_IMAGE_2_KEY_NAMES[resolution]] || "").trim());
}

function providerApiKey(provider, env = process.env, model, resolution) {
  if (provider === "openrouter") return String(env.OPENROUTER_API_KEY || "").trim();
  if (provider === "google") return String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "").trim();
  if (model === "gpt-image-2") return String(env[COMFLY_GPT_IMAGE_2_KEY_NAMES[resolution]] || "").trim();
  return String(env.COMFLY_API_KEY || "").trim();
}

function providerMissingMessage(provider, model, resolution) {
  if (provider === "openrouter") return "请在 .env.local 中设置 OPENROUTER_API_KEY";
  if (provider === "google") return "请在 .env.local 中设置 GEMINI_API_KEY 或 GOOGLE_API_KEY";
  if (model === "gpt-image-2") return `请在 .env.local 中设置 ${COMFLY_GPT_IMAGE_2_KEY_NAMES[resolution]}`;
  return "请在 .env.local 中设置 COMFLY_API_KEY";
}

export function getImageGenerationModels(provider, env = process.env) {
  const normalized = normalizeProvider(provider);
  if (normalized !== "comfly") return MODEL_CATALOGS[normalized].map((model) => ({ ...model }));
  const resolutions = configuredComflyGptImageResolutions(env);
  return MODEL_CATALOGS.comfly.flatMap((model) => {
    if (model.model === "gpt-image-2") return resolutions.length ? [{ ...model, supportedResolutions: resolutions }] : [];
    return providerApiKey("comfly", env, model.model) ? [{ ...model }] : [];
  });
}

export function getImageGenerationProviderStatus(provider, env = process.env) {
  const normalized = normalizeProvider(provider);
  const providerConfigured = normalized === "comfly" || Boolean(providerApiKey(normalized, env));
  const models = providerConfigured ? getImageGenerationModels(normalized, env) : [];
  const configured = providerConfigured && models.length > 0;
  const message = normalized === "comfly" && configured
    ? `已配置：${models.map((model) => model.model === "gpt-image-2" ? `GPT Image 2 ${model.supportedResolutions.join("/")}` : "通用 Key").join(" · ")}`
    : configured
      ? "已配置，可生成图片"
      : providerMissingMessage(normalized);
  return {
    provider: normalized,
    label: PROVIDER_LABELS[normalized],
    configured,
    models,
    message,
  };
}

function normalizeResolution(value) {
  const resolution = String(value || "1K").trim().toUpperCase();
  if (!IMAGE_GENERATION_RESOLUTIONS.includes(resolution)) throw new Error(`不支持的图片分辨率：${resolution}`);
  return resolution;
}

function normalizeAspectRatio(value) {
  const ratio = String(value || "Auto").trim();
  const normalized = ratio.toLowerCase() === "auto" ? "Auto" : ratio;
  if (!IMAGE_GENERATION_ASPECT_RATIOS.includes(normalized)) throw new Error(`不支持的图片画幅：${ratio}`);
  return normalized;
}

function parseImageDataUrl(value) {
  const match = String(value || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) throw new Error("参考图必须是有效的 base64 图片 Data URL");
  return { dataUrl: String(value), mimeType: match[1], base64: match[2].replace(/\s+/g, "") };
}

function normalizeReferences(value) {
  const references = Array.isArray(value) ? value.filter((item) => item?.dataUrl) : [];
  if (references.length > MAX_REFERENCE_IMAGES) throw new Error(`图片生成最多接收 ${MAX_REFERENCE_IMAGES} 张参考图`);
  return references.map((reference, index) => {
    const parsed = parseImageDataUrl(reference.dataUrl);
    return {
      slot: Number(reference.slot || index + 1),
      marker: String(reference.marker || `@图片${index + 1}`),
      fileName: String(reference.fileName || `参考图 ${index + 1}`),
      ...parsed,
    };
  });
}

export function normalizeImageGenerationRequest(payload) {
  const provider = normalizeProvider(payload?.provider);
  const catalog = MODEL_CATALOGS[provider];
  const model = String(payload?.model || "").trim();
  if (!catalog.some((item) => item.model === model)) throw new Error("所选图片模型当前不属于该供应商");
  const prompt = String(payload?.prompt || "").trim();
  if (!prompt) throw new Error("请输入图片生成提示词");
  if (prompt.length > 100_000) throw new Error("图片生成提示词过长");
  return {
    provider,
    model,
    prompt,
    resolution: normalizeResolution(payload?.resolution),
    aspectRatio: normalizeAspectRatio(payload?.aspectRatio || payload?.ratio),
    references: normalizeReferences(payload?.images),
  };
}

function resolveComflyModel(model, resolution) {
  if (model !== "gemini-3.1-flash-image" || resolution === "1K") return model;
  return `${model}-${resolution.toLowerCase()}`;
}

export function buildImageGenerationHttpRequest(rawRequest, env = process.env) {
  const request = normalizeImageGenerationRequest(rawRequest);
  const apiKey = providerApiKey(request.provider, env, request.model, request.resolution);
  if (!apiKey) throw new Error(providerMissingMessage(request.provider, request.model, request.resolution));
  const ratio = request.aspectRatio === "Auto" ? "auto" : request.aspectRatio;

  if (request.provider === "openrouter") {
    return {
      request,
      url: "https://openrouter.ai/api/v1/images",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://127.0.0.1:4317",
        "X-Title": "Prompt Canvas",
      },
      body: {
        model: request.model,
        prompt: request.prompt,
        resolution: request.resolution,
        aspect_ratio: ratio,
        output_format: "png",
        ...(request.references.length
          ? {
              input_references: request.references.map((reference) => ({
                type: "image_url",
                image_url: { url: reference.dataUrl },
              })),
            }
          : {}),
      },
    };
  }

  if (request.provider === "google") {
    return {
      request,
      url: "https://generativelanguage.googleapis.com/v1beta/interactions",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: {
        model: request.model,
        input: [
          { type: "text", text: request.prompt },
          ...request.references.map((reference) => ({
            type: "image",
            mime_type: reference.mimeType,
            data: reference.base64,
          })),
        ],
        response_format: {
          type: "image",
          mime_type: "image/png",
          ...(ratio === "auto" ? {} : { aspect_ratio: ratio }),
          image_size: request.resolution,
        },
      },
    };
  }

  if (request.model === "gpt-image-2") {
    return {
      request,
      url: "https://ai.comfly.org/v1/images/generations",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: {
        model: COMFLY_GPT_IMAGE_2_MODELS[request.resolution],
        prompt: request.prompt,
        size: COMFLY_GPT_IMAGE_2_SIZES[request.resolution][request.aspectRatio],
        ...(request.references.length
          ? { image: request.references.map((reference) => reference.dataUrl) }
          : {}),
      },
    };
  }

  const content = request.references.length
    ? [
        { type: "text", text: request.prompt },
        ...request.references.map((reference) => ({
          type: "image_url",
          image_url: { url: reference.dataUrl },
        })),
      ]
    : request.prompt;
  return {
    request,
    url: "https://ai.comfly.org/v1/chat/completions",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: {
      model: resolveComflyModel(request.model, request.resolution),
      messages: [{ role: "user", content }],
      stream: false,
      modalities: ["image", "text"],
      image_config: {
        aspect_ratio: ratio,
        image_size: request.resolution,
      },
    },
  };
}

function pushCandidate(candidates, value, mediaType = "image/png") {
  if (typeof value !== "string" || !value.trim()) return;
  candidates.push({ value: value.trim(), mediaType: String(mediaType || "image/png") });
}

function pushTextImageCandidates(candidates, content) {
  if (typeof content !== "string") return;
  const dataUrls = content.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\r\n]+/g) || [];
  dataUrls.forEach((url) => pushCandidate(candidates, url));
  const markdownImages = content.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)(?:\s+["'][^"']*["'])?\)/gi);
  for (const match of markdownImages) pushCandidate(candidates, match[1]);
  const htmlImages = content.matchAll(/<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>/gi);
  for (const match of htmlImages) pushCandidate(candidates, match[1]);
  if (/^https?:\/\/\S+$/i.test(content.trim())) pushCandidate(candidates, content.trim());
}

export function extractImageCandidates(result) {
  const candidates = [];
  for (const item of Array.isArray(result?.data) ? result.data : []) {
    pushCandidate(candidates, item?.b64_json, item?.media_type || "image/png");
    pushCandidate(candidates, item?.url, item?.media_type || "image/png");
  }
  for (const item of Array.isArray(result?.images) ? result.images : []) {
    const imageUrl = item?.image_url || item?.imageUrl;
    pushCandidate(candidates, item?.b64_json || item?.data, item?.mime_type || item?.media_type || "image/png");
    pushCandidate(candidates, typeof imageUrl === "string" ? imageUrl : imageUrl?.url, item?.mime_type || item?.media_type);
    pushCandidate(candidates, item?.url, item?.mime_type || item?.media_type);
  }

  const outputImage = result?.output_image;
  if (outputImage && typeof outputImage === "object") {
    pushCandidate(candidates, outputImage.data, outputImage.mime_type || outputImage.media_type || "image/png");
  }
  for (const step of Array.isArray(result?.steps) ? result.steps : []) {
    for (const block of Array.isArray(step?.content) ? step.content : []) {
      if (block?.type === "image" || block?.type === "output_image") {
        pushCandidate(candidates, block.data || block.url, block.mime_type || block.media_type || "image/png");
      }
    }
  }

  for (const candidate of Array.isArray(result?.candidates) ? result.candidates : []) {
    for (const part of Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []) {
      const inlineData = part?.inlineData || part?.inline_data;
      pushCandidate(candidates, inlineData?.data, inlineData?.mimeType || inlineData?.mime_type || "image/png");
      pushCandidate(candidates, part?.fileData?.fileUri || part?.file_data?.file_uri, part?.fileData?.mimeType || part?.file_data?.mime_type);
    }
  }

  for (const choice of Array.isArray(result?.choices) ? result.choices : []) {
    const message = choice?.message || {};
    for (const item of Array.isArray(message.images) ? message.images : []) {
      const imageUrl = item?.image_url || item?.imageUrl;
      pushCandidate(candidates, typeof imageUrl === "string" ? imageUrl : imageUrl?.url);
    }
    const content = message.content;
    if (typeof content === "string") {
      pushTextImageCandidates(candidates, content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        const imageUrl = block?.image_url || block?.imageUrl;
        if (typeof imageUrl === "string") pushCandidate(candidates, imageUrl, block?.mime_type);
        else pushCandidate(candidates, imageUrl?.url, block?.mime_type);
        if (block?.type === "image" || block?.type === "output_image") {
          pushCandidate(candidates, block.data || block.url, block?.mime_type || block?.media_type);
        }
        pushTextImageCandidates(candidates, block?.text);
      }
    }
  }
  return candidates.filter((candidate, index, all) => all.findIndex((item) => item.value === candidate.value) === index);
}

async function candidateToImage(candidate, fetchImpl, signal) {
  if (candidate.value.startsWith("data:image/")) {
    return { dataUrl: candidate.value, mediaType: candidate.value.slice(5, candidate.value.indexOf(";")) };
  }
  if (/^https?:\/\//i.test(candidate.value)) {
    const response = await fetchImpl(candidate.value, { signal });
    if (!response.ok) throw new Error(`下载生成图片失败：HTTP ${response.status}`);
    const mediaType = response.headers.get("content-type")?.split(";")[0] || candidate.mediaType;
    const buffer = Buffer.from(await response.arrayBuffer());
    return { dataUrl: `data:${mediaType};base64,${buffer.toString("base64")}`, mediaType };
  }
  if (/^[a-zA-Z0-9+/=\r\n]+$/.test(candidate.value)) {
    return { dataUrl: `data:${candidate.mediaType};base64,${candidate.value.replace(/\s+/g, "")}`, mediaType: candidate.mediaType };
  }
  throw new Error("图片供应商返回了无法识别的图片格式");
}

function responseErrorMessage(provider, status, text) {
  let detail = text;
  try {
    const parsed = JSON.parse(text);
    detail = parsed?.error?.message || parsed?.error || parsed?.message || text;
  } catch { /* Keep plain text. */ }
  const label = PROVIDER_LABELS[provider];
  return `${label} 图片生成失败（HTTP ${status}）：${String(detail || "未知错误").slice(0, 800)}`;
}

export async function runImageGeneration(rawRequest, {
  env = process.env,
  fetchImpl = fetch,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const prepared = buildImageGenerationHttpRequest(rawRequest, env);
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort("图片生成超时"), timeoutMs);
  const forwardAbort = () => timeoutController.abort(signal?.reason || "图片生成已取消");
  if (signal) {
    if (signal.aborted) forwardAbort();
    else signal.addEventListener("abort", forwardAbort, { once: true });
  }
  try {
    const response = await fetchImpl(prepared.url, {
      method: "POST",
      headers: prepared.headers,
      body: JSON.stringify(prepared.body),
      signal: timeoutController.signal,
    });
    const responseText = await response.text();
    if (!response.ok) throw new Error(responseErrorMessage(prepared.request.provider, response.status, responseText));
    let result;
    try { result = JSON.parse(responseText); }
    catch { throw new Error(`${PROVIDER_LABELS[prepared.request.provider]} 返回了无效 JSON`); }
    const candidates = extractImageCandidates(result);
    if (!candidates.length) {
      const choices = Array.isArray(result?.choices) ? result.choices : [];
      const shape = [
        ...Object.keys(result || {}).slice(0, 8),
        ...(choices.length ? Object.keys(choices[0]?.message || {}).slice(0, 8).map((key) => `choices.message.${key}`) : []),
      ].join(", ");
      throw new Error(`${PROVIDER_LABELS[prepared.request.provider]} 未返回可识别的图片${shape ? `（响应字段：${shape}）` : ""}`);
    }
    const images = await Promise.all(candidates.map((candidate) => candidateToImage(candidate, fetchImpl, timeoutController.signal)));
    return {
      provider: prepared.request.provider,
      model: prepared.request.model,
      resolution: prepared.request.resolution,
      aspectRatio: prepared.request.aspectRatio,
      images,
      usage: result?.usage || null,
    };
  } catch (error) {
    if (timeoutController.signal.aborted && !signal?.aborted) throw new Error("图片生成超过 3 分钟，已停止等待");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", forwardAbort);
  }
}
