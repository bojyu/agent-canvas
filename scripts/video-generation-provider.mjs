import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

export const VIDEO_GENERATION_PROVIDER_IDS = Object.freeze(["openrouter", "comfly", "seedance-cli"]);
export const VIDEO_GENERATION_MODES = Object.freeze([
  Object.freeze({ id: "text2video", label: "文生视频", minReferences: 0, maxReferences: 0 }),
  Object.freeze({ id: "image2video", label: "单图生视频", minReferences: 1, maxReferences: 1, imageOnly: true }),
  Object.freeze({ id: "frames2video", label: "首尾帧", minReferences: 2, maxReferences: 2, imageOnly: true }),
  Object.freeze({ id: "multiframe2video", label: "智能多帧", minReferences: 2, maxReferences: 12, imageOnly: true }),
  Object.freeze({ id: "multimodal2video", label: "全能参考", minReferences: 1, maxReferences: 12 }),
]);
export const VIDEO_GENERATION_RESOLUTIONS = Object.freeze(["720p", "1080p", "2K", "4K"]);
export const VIDEO_GENERATION_ASPECT_RATIOS = Object.freeze(["1:1", "3:4", "16:9", "4:3", "9:16", "21:9"]);

const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const POLL_INTERVAL_MS = 5_000;
const PROVIDER_LABELS = Object.freeze({
  openrouter: "OpenRouter",
  comfly: "Comfly",
  "seedance-cli": "Seedance CLI",
});

const FALLBACK_MODELS = Object.freeze({
  openrouter: Object.freeze([
    model("bytedance/seedance-2.0", "Seedance 2.0", ["720p", "1080p"], [4, 5, 6, 8, 10, 12, 15], true),
    model("bytedance/seedance-2.0-fast", "Seedance 2.0 Fast", ["720p"], [4, 5, 6, 8, 10, 12, 15], true),
    model("google/veo-3.1", "Veo 3.1", ["720p", "1080p"], [4, 5, 6, 8], false),
  ]),
  comfly: Object.freeze([
    model("doubao-seedance-2-0-260128", "Seedance 2.0", ["720p", "1080p", "2K"], range(4, 15), true),
    model("doubao-seedance-2-0-fast-260128", "Seedance 2.0 Fast", ["720p"], range(4, 15), true),
    model("doubao-seedance-2.0-mini", "Seedance 2.0 Mini", ["720p"], range(4, 15), true),
  ]),
  "seedance-cli": Object.freeze([
    model("seedance2.0_vip", "Seedance 2.0 VIP", ["720p", "1080p", "4K"], range(4, 15), true),
    model("seedance2.0fast_vip", "Seedance 2.0 Fast VIP", ["720p", "1080p", "4K"], range(4, 15), true),
    model("seedance2.0", "Seedance 2.0", ["720p"], range(4, 15), true),
    model("seedance2.0fast", "Seedance 2.0 Fast", ["720p"], range(4, 15), true),
    model("seedance2.0mini", "Seedance 2.0 Mini", ["720p"], range(4, 15), true),
  ]),
});

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function model(id, displayName, supportedResolutions, supportedDurations, supportsMixedReferences) {
  return Object.freeze({
    id,
    model: id,
    displayName,
    supportedResolutions: Object.freeze([...supportedResolutions]),
    supportedDurations: Object.freeze([...supportedDurations]),
    supportedAspectRatios: VIDEO_GENERATION_ASPECT_RATIOS,
    supportsMixedReferences,
    maxReferences: 12,
  });
}

function normalizeProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (!VIDEO_GENERATION_PROVIDER_IDS.includes(provider)) throw new Error(`不支持的视频生成供应商：${provider || "未选择"}`);
  return provider;
}

function normalizeMode(value) {
  const mode = String(value || "text2video").trim();
  if (!VIDEO_GENERATION_MODES.some((item) => item.id === mode)) throw new Error(`不支持的视频生成模式：${mode}`);
  return mode;
}

function normalizeDataReference(reference, index) {
  const dataUrl = String(reference?.dataUrl || "");
  const match = dataUrl.match(/^data:(image|video)\/([a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match && !/^https?:\/\//i.test(dataUrl)) throw new Error("视频参考必须是有效的图片、视频 Data URL 或远程地址");
  if (!match) {
    const mediaKind = String(reference?.mediaKind || (dataUrl.match(/\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/i) ? "video" : "image"));
    return {
      slot: Number(reference?.slot || index + 1),
      marker: String(reference?.marker || `@${mediaKind === "video" ? "视频" : "图片"}${index + 1}`),
      fileName: String(reference?.fileName || `远程${mediaKind === "video" ? "视频" : "图片"} ${index + 1}`),
      mediaKind,
      mimeType: mediaKind === "video" ? "video/mp4" : "image/png",
      base64: null,
      dataUrl,
    };
  }
  const mediaKind = match[1];
  return {
    slot: Number(reference?.slot || index + 1),
    marker: String(reference?.marker || `@${mediaKind === "image" ? "图片" : "视频"}${index + 1}`),
    fileName: String(reference?.fileName || `参考${mediaKind === "image" ? "图" : "视频"} ${index + 1}`),
    mediaKind,
    mimeType: `${match[1]}/${match[2]}`,
    base64: match[3].replace(/\s+/g, ""),
    dataUrl,
  };
}

export function normalizeVideoGenerationRequest(payload) {
  const provider = normalizeProvider(payload?.provider);
  const mode = normalizeMode(payload?.mode);
  const catalog = FALLBACK_MODELS[provider];
  const modelId = String(payload?.model || "").trim();
  const selectedModel = catalog.find((item) => item.model === modelId) || (provider === "openrouter" && modelId.includes("/")
    ? model(modelId, modelId, VIDEO_GENERATION_RESOLUTIONS, range(1, 60), modelId.includes("seedance-2.0"))
    : null);
  if (!selectedModel) throw new Error("所选视频模型当前不属于该供应商");
  const prompt = String(payload?.prompt || "").trim();
  if (!prompt) throw new Error("请输入视频生成提示词");
  if (prompt.length > 100_000) throw new Error("视频生成提示词过长");
  const aspectRatio = String(payload?.aspectRatio || payload?.ratio || "16:9").trim();
  if (!VIDEO_GENERATION_ASPECT_RATIOS.includes(aspectRatio)) throw new Error(`不支持的视频画幅：${aspectRatio}`);
  const resolution = String(payload?.resolution || "720p").trim();
  if (!selectedModel.supportedResolutions.includes(resolution)) throw new Error(`${selectedModel.displayName} 不支持 ${resolution}`);
  const duration = Number(payload?.duration || 5);
  if (!Number.isInteger(duration) || !selectedModel.supportedDurations.includes(duration)) throw new Error(`${selectedModel.displayName} 不支持 ${duration} 秒时长`);
  const references = (Array.isArray(payload?.references) ? payload.references : [])
    .filter((item) => item?.dataUrl)
    .map(normalizeDataReference)
    .sort((a, b) => a.slot - b.slot);
  if (references.length > 12) throw new Error("视频生成最多接收 12 个参考素材");
  const modeDefinition = VIDEO_GENERATION_MODES.find((item) => item.id === mode);
  if (references.length < modeDefinition.minReferences || references.length > modeDefinition.maxReferences) {
    throw new Error(`${modeDefinition.label}需要 ${modeDefinition.minReferences === modeDefinition.maxReferences ? modeDefinition.minReferences : `${modeDefinition.minReferences}-${modeDefinition.maxReferences}`} 个参考素材`);
  }
  if (modeDefinition.imageOnly && references.some((item) => item.mediaKind !== "image")) throw new Error(`${modeDefinition.label}只支持参考图片`);
  const imageCount = references.filter((item) => item.mediaKind === "image").length;
  const videoCount = references.filter((item) => item.mediaKind === "video").length;
  if (mode === "multimodal2video" && (imageCount > 9 || videoCount > 3)) throw new Error("全能参考最多支持 9 张图片和 3 个视频");
  if (provider !== "openrouter" && mode === "multimodal2video" && !selectedModel.supportsMixedReferences) throw new Error(`${selectedModel.displayName} 不支持混合参考`);
  return {
    provider,
    mode,
    model: modelId,
    prompt,
    aspectRatio,
    resolution,
    duration,
    generateAudio: payload?.generateAudio !== false,
    confirmLowCredit: payload?.confirmLowCredit === true,
    references,
  };
}

function keyFor(provider, env) {
  if (provider === "openrouter") return String(env.OPENROUTER_API_KEY || "").trim();
  if (provider === "comfly") return String(env.COMFLY_API_KEY || "").trim();
  return "";
}

function missingMessage(provider) {
  if (provider === "openrouter") return "请在 .env.local 中设置 OPENROUTER_API_KEY";
  if (provider === "comfly") return "请在 .env.local 中设置 COMFLY_API_KEY";
  return "未找到 dreamina 命令；请安装 Seedance CLI，或设置 DREAMINA_CLI_PATH";
}

function cliCommand(env = process.env) {
  return String(env.DREAMINA_CLI_PATH || "dreamina").trim();
}

function runProcess(command, args, { signal, timeoutMs = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", abort);
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => {
      child.kill();
      finish(new Error("视频生成已取消"));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`Seedance CLI 超过 ${Math.ceil(timeoutMs / 1000)} 秒未响应`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => finish(error?.code === "ENOENT" ? new Error(missingMessage("seedance-cli")) : error));
    child.once("close", (code) => finish(null, { code, stdout, stderr }));
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }
  });
}

function parseJsonOutput(result, label) {
  const source = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  try { return JSON.parse(source); } catch { /* Try extracting a JSON object from logs. */ }
  const starts = [...source.matchAll(/\{/g)].map((match) => match.index).filter(Number.isInteger).reverse();
  for (const start of starts) {
    try { return JSON.parse(source.slice(start)); } catch { /* Continue. */ }
  }
  throw new Error(`${label} 返回了无法识别的结果${source ? `：${source.slice(-600)}` : ""}`);
}

export async function getVideoGenerationProviderStatus(providerValue, { env = process.env, fetchImpl = fetch } = {}) {
  const provider = normalizeProvider(providerValue);
  if (provider === "seedance-cli") {
    try {
      await runProcess(cliCommand(env), ["-h"], { timeoutMs: 8_000 });
      return { provider, label: PROVIDER_LABELS[provider], configured: true, models: FALLBACK_MODELS[provider].map((item) => ({ ...item })), message: "CLI 已安装；生成前会检查登录和积分" };
    } catch (error) {
      return { provider, label: PROVIDER_LABELS[provider], configured: false, models: [], message: error instanceof Error ? error.message : missingMessage(provider) };
    }
  }
  const apiKey = keyFor(provider, env);
  if (!apiKey) return { provider, label: PROVIDER_LABELS[provider], configured: false, models: [], message: missingMessage(provider) };
  if (provider === "openrouter") {
    try {
      const base = String(env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
      const response = await fetchImpl(`${base}/videos/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      const models = (Array.isArray(result?.data) ? result.data : []).map((item) => ({
        id: item.id,
        model: item.id,
        displayName: item.name || item.id,
        description: item.description || "OpenRouter 视频模型",
        supportedResolutions: item.supported_resolutions?.length ? item.supported_resolutions : ["720p"],
        supportedDurations: item.supported_durations?.length ? item.supported_durations : range(4, 15),
        supportedAspectRatios: item.supported_aspect_ratios?.length ? item.supported_aspect_ratios : VIDEO_GENERATION_ASPECT_RATIOS,
        supportsMixedReferences: String(item.id).includes("seedance-2.0"),
        maxReferences: 12,
      }));
      if (models.length) return { provider, label: PROVIDER_LABELS[provider], configured: true, models, message: `${models.length} 个 OpenRouter 视频模型` };
    } catch { /* Fall back to the current known catalog. */ }
  }
  return { provider, label: PROVIDER_LABELS[provider], configured: true, models: FALLBACK_MODELS[provider].map((item) => ({ ...item })), message: provider === "comfly" ? "Comfly Seedance 视频接口" : "OpenRouter 视频接口" };
}

function httpHeaders(apiKey, provider) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(provider === "openrouter" ? { "HTTP-Referer": "http://127.0.0.1:4317", "X-Title": "Prompt Canvas" } : {}),
  };
}

export function buildVideoGenerationHttpRequest(rawRequest, env = process.env) {
  const request = normalizeVideoGenerationRequest(rawRequest);
  if (request.provider === "seedance-cli") throw new Error("Seedance CLI 不使用 HTTP 请求");
  const apiKey = keyFor(request.provider, env);
  if (!apiKey) throw new Error(missingMessage(request.provider));
  if (request.provider === "openrouter") {
    const body = {
      model: request.model,
      prompt: request.prompt,
      duration: request.duration,
      resolution: request.resolution,
      aspect_ratio: request.aspectRatio,
      generate_audio: request.generateAudio,
    };
    if (request.mode === "image2video" || request.mode === "frames2video") {
      body.frame_images = request.references.map((reference, index) => ({
        type: "image_url",
        image_url: { url: reference.dataUrl },
        frame_type: index === 0 ? "first_frame" : "last_frame",
      }));
    } else if (request.mode === "multiframe2video" || request.mode === "multimodal2video") {
      body.input_references = request.references.map((reference) => reference.mediaKind === "video"
        ? { type: "video_url", video_url: { url: reference.dataUrl } }
        : { type: "image_url", image_url: { url: reference.dataUrl } });
    }
    return {
      request,
      url: `${String(env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "")}/videos`,
      pollBaseUrl: String(env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
      headers: httpHeaders(apiKey, "openrouter"),
      body,
    };
  }

  const base = String(env.COMFLY_BASE_URL || "https://ai.comfly.org").replace(/\/+$/, "");
  const optionText = `${request.prompt} --ratio ${request.aspectRatio} --duration ${request.duration} --resolution ${request.resolution}`;
  const useOfficial = request.mode === "multimodal2video" || request.mode === "multiframe2video";
  return {
    request,
    url: useOfficial ? `${base}/seedance/v3/contents/generations/tasks` : `${base}/v2/videos/generations`,
    pollBaseUrl: useOfficial ? `${base}/seedance/v3/contents/generations/tasks` : `${base}/v2/videos/generations`,
    pollKind: useOfficial ? "official" : "unified",
    headers: httpHeaders(apiKey, "comfly"),
    body: useOfficial ? {
      model: request.model,
      content: [
        { type: "text", text: optionText },
        ...request.references.map((reference) => reference.mediaKind === "video"
          ? { type: "video_url", video_url: { url: reference.dataUrl } }
          : { type: "image_url", image_url: { url: reference.dataUrl } }),
      ],
    } : {
      prompt: optionText,
      model: request.model,
      ...(request.references.length ? { images: request.references.map((reference) => reference.dataUrl) } : {}),
    },
  };
}

function errorDetail(result, fallback) {
  return String(result?.error?.message || result?.error || result?.message || result?.fail_reason || fallback || "未知错误");
}

async function requestJson(url, options, fetchImpl) {
  const response = await fetchImpl(url, options);
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch { throw new Error(`视频供应商返回了无效 JSON：${text.slice(0, 600)}`); }
  if (!response.ok) throw new Error(`视频供应商请求失败（HTTP ${response.status}）：${errorDetail(result, text)}`);
  return result;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => { clearTimeout(timer); reject(new Error("视频生成已取消")); };
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }
  });
}

async function runHttpVideo(rawRequest, { env, fetchImpl, signal, timeoutMs, pollIntervalMs }) {
  const prepared = buildVideoGenerationHttpRequest(rawRequest, env);
  const submitted = await requestJson(prepared.url, {
    method: "POST",
    headers: prepared.headers,
    body: JSON.stringify(prepared.body),
    signal,
  }, fetchImpl);
  const jobId = String(submitted.id || submitted.task_id || "").trim();
  if (!jobId) throw new Error(`${PROVIDER_LABELS[prepared.request.provider]} 未返回视频任务 ID`);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await wait(pollIntervalMs, signal);
    const pollUrl = prepared.request.provider === "openrouter"
      ? `${prepared.pollBaseUrl}/videos/${encodeURIComponent(jobId)}`
      : `${prepared.pollBaseUrl}/${encodeURIComponent(jobId)}`;
    const result = await requestJson(pollUrl, { headers: prepared.headers, signal }, fetchImpl);
    const status = String(result.status || result.gen_status || "").toLowerCase();
    const success = ["completed", "success", "succeeded"].includes(status);
    const failed = ["failed", "failure", "cancelled", "expired", "fail"].includes(status);
    if (failed) throw new Error(`${PROVIDER_LABELS[prepared.request.provider]} 视频生成失败：${errorDetail(result)}`);
    if (!success) continue;
    const urls = [
      ...(Array.isArray(result.unsigned_urls) ? result.unsigned_urls : []),
      result?.content?.video_url,
      result?.data?.output,
      result?.result?.video_url,
    ].filter((value, index, all) => typeof value === "string" && /^https?:\/\//i.test(value) && all.indexOf(value) === index);
    if (!urls.length && prepared.request.provider === "openrouter") urls.push(`${prepared.pollBaseUrl}/videos/${encodeURIComponent(jobId)}/content`);
    if (!urls.length) throw new Error(`${PROVIDER_LABELS[prepared.request.provider]} 任务完成但没有返回视频地址`);
    return {
      provider: prepared.request.provider,
      model: prepared.request.model,
      mode: prepared.request.mode,
      duration: prepared.request.duration,
      resolution: prepared.request.resolution,
      aspectRatio: prepared.request.aspectRatio,
      jobId,
      videos: urls.map((url) => ({ url, mediaType: "video/mp4" })),
      usage: result.usage || result?.data?.usage || null,
    };
  }
  throw new Error(`视频任务 ${jobId} 已提交，但等待超过 ${Math.ceil(timeoutMs / 60_000)} 分钟；请稍后到供应商后台查询`);
}

function extensionFor(reference) {
  const fromName = extname(reference.fileName || "");
  if (/^\.[a-z0-9]{2,5}$/i.test(fromName)) return fromName;
  const subtype = reference.mimeType.split("/")[1].replace("quicktime", "mov").replace("jpeg", "jpg").split("+")[0];
  return `.${subtype || (reference.mediaKind === "video" ? "mp4" : "png")}`;
}

async function materializeReferences(references, fetchImpl, signal) {
  const directory = await mkdtemp(join(tmpdir(), "prompt-canvas-video-"));
  const files = [];
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index];
    const filePath = join(directory, `${String(index + 1).padStart(2, "0")}-${reference.mediaKind}${extensionFor(reference)}`);
    let buffer;
    if (reference.base64) buffer = Buffer.from(reference.base64, "base64");
    else {
      const response = await fetchImpl(reference.dataUrl, { signal });
      if (!response.ok) throw new Error(`无法下载远程参考素材（HTTP ${response.status}）`);
      buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > 50 * 1024 * 1024) throw new Error("远程参考素材超过 50MB");
    }
    await writeFile(filePath, buffer);
    files.push({ ...reference, filePath });
  }
  return { directory, files };
}

function cliArgs(request, files) {
  const common = [
    `--prompt=${request.prompt}`,
    `--duration=${request.duration}`,
    `--model_version=${request.model}`,
    `--video_resolution=${request.resolution}`,
    "--poll=120",
  ];
  if (request.mode === "text2video") return ["text2video", ...common, `--ratio=${request.aspectRatio}`];
  if (request.mode === "image2video") return ["image2video", `--image=${files[0].filePath}`, ...common];
  if (request.mode === "frames2video") return ["frames2video", `--first_frame=${files[0].filePath}`, `--last_frame=${files[1].filePath}`, ...common];
  if (request.mode === "multiframe2video") {
    const segmentDuration = Math.max(0.5, Math.min(8, request.duration / Math.max(1, files.length - 1)));
    return [
      "multiframe2video",
      ...files.flatMap((file) => [`--image=${file.filePath}`]),
      ...Array.from({ length: files.length - 1 }, () => [`--transition_prompt=${request.prompt}`, `--transition_duration=${segmentDuration.toFixed(1)}`]).flat(),
      "--poll=120",
    ];
  }
  return [
    "multimodal2video",
    ...files.flatMap((file) => [`--${file.mediaKind}=${file.filePath}`]),
    ...common,
    `--ratio=${request.aspectRatio}`,
  ];
}

function cliStatus(result) {
  return String(result?.gen_status || result?.status || "").toLowerCase();
}

export function extractCliUrls(result) {
  const values = [
    result?.result?.video_url,
    result?.result?.url,
    result?.video_url,
    result?.url,
    result?.result_json?.video_url,
    result?.result_json?.url,
    ...(Array.isArray(result?.result) ? result.result : []),
    ...(Array.isArray(result?.videos) ? result.videos : []),
    ...(Array.isArray(result?.result?.videos) ? result.result.videos : []),
    ...(Array.isArray(result?.result_json?.videos) ? result.result_json.videos : []),
  ];
  return values.map((value) => typeof value === "string" ? value : value?.url || value?.video_url).filter((value, index, all) => typeof value === "string" && (/^https?:\/\//i.test(value) || /^file:/i.test(value)) && all.indexOf(value) === index);
}

async function runCliVideo(rawRequest, { env, fetchImpl, signal, timeoutMs, pollIntervalMs }) {
  const request = normalizeVideoGenerationRequest(rawRequest);
  const command = cliCommand(env);
  const creditResult = parseJsonOutput(await runProcess(command, ["user_credit"], { signal, timeoutMs: 20_000 }), "Seedance CLI 积分检查");
  const credit = Number(creditResult.total_credit);
  if (!Number.isFinite(credit)) throw new Error("Seedance CLI 尚未登录；请先运行 dreamina login");
  if (credit < 100) throw new Error(`Seedance CLI 积分不足（当前 ${credit}），已停止提交`);
  if (credit < 500 && !request.confirmLowCredit) throw new Error(`LOW_CREDIT_CONFIRMATION_REQUIRED: 当前仅剩 ${credit} 积分；再次点击生成以确认继续`);
  const materialized = await materializeReferences(request.references, fetchImpl, signal);
  try {
    let result = parseJsonOutput(await runProcess(command, cliArgs(request, materialized.files), { signal, timeoutMs: 150_000 }), "Seedance CLI");
    const jobId = String(result.submit_id || result.id || "").trim();
    if (!jobId) throw new Error(`Seedance CLI 未返回 submit_id：${errorDetail(result)}`);
    const startedAt = Date.now();
    while (!["success", "succeeded", "completed"].includes(cliStatus(result))) {
      if (["fail", "failed", "failure", "cancelled"].includes(cliStatus(result))) throw new Error(`Seedance CLI 视频生成失败：${errorDetail(result)}`);
      if (Date.now() - startedAt >= timeoutMs) throw new Error(`Seedance 任务 ${jobId} 仍在生成，可运行 dreamina query_result --submit_id=${jobId} 查询`);
      await wait(pollIntervalMs, signal);
      result = parseJsonOutput(await runProcess(command, ["query_result", `--submit_id=${jobId}`], { signal, timeoutMs: 30_000 }), "Seedance CLI 查询");
    }
    const urls = extractCliUrls(result);
    if (!urls.length) throw new Error("Seedance CLI 任务完成但没有返回可访问的视频地址");
    return {
      provider: request.provider,
      model: request.model,
      mode: request.mode,
      duration: request.duration,
      resolution: request.resolution,
      aspectRatio: request.aspectRatio,
      jobId,
      credit,
      videos: urls.map((url) => ({ url, mediaType: "video/mp4" })),
      usage: result.usage || null,
    };
  } finally {
    await rm(materialized.directory, { recursive: true, force: true });
  }
}

export async function runVideoGeneration(rawRequest, {
  env = process.env,
  fetchImpl = fetch,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollIntervalMs = POLL_INTERVAL_MS,
} = {}) {
  const provider = normalizeProvider(rawRequest?.provider);
  if (provider === "seedance-cli") return runCliVideo(rawRequest, { env, fetchImpl, signal, timeoutMs, pollIntervalMs });
  return runHttpVideo(rawRequest, { env, fetchImpl, signal, timeoutMs, pollIntervalMs });
}
