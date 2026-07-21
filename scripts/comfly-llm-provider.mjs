import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { validateStructuredResult } from "./agent-protocol.mjs";
import {
  loadPromptSkillBundle,
  promptSkillDocument,
  promptSkillInstructions,
} from "./skill-bundle.mjs";

export const COMFLY_LLM_PROVIDER_ID = "comfly";
export const COMFLY_LLM_SESSION_PREFIX = "comfly:";
export const COMFLY_LLM_DEFAULT_BASE_URL = "https://ai.comfly.org";

const MODEL_CACHE_MS = 5 * 60_000;
const MODEL_REQUEST_TIMEOUT_MS = 15_000;
const IMAGE_MIME_TYPES = Object.freeze({
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
});
const PREFERRED_MODELS = Object.freeze([
  "gpt-5.6-terra",
  "gpt-5.4-mini",
  "gpt-5.4",
  "claude-sonnet-5",
  "gemini-2.5-pro",
  "deepseek-chat",
]);
const TEXT_MODEL_PATTERN = /^(?:gpt-|chatgpt-|claude-|gemini-|deepseek-|qwen-|glm-|grok-|kimi-|moonshot-|minimax-)/i;
const NON_TEXT_MODEL_PATTERN = /(?:image|banana|seedream|dall-e|flux|video|veo|sora|kling|runway|wan\d|embedding|rerank|tts|whisper|audio|speech|moderation|recraft|midjourney|suno|luma)/i;
const VISION_MODEL_PATTERN = /^(?:gpt-(?:4o|4\.1|5)|chatgpt-|claude-|gemini-|grok-|qwen.*(?:vl|omni)|glm-4v)/i;

let modelCache = null;
let modelCachePromise = null;

function envValue(env, name) {
  return String(env?.[name] || "").trim();
}

export function comflyLlmApiKey(env = process.env) {
  return envValue(env, "COMFLY_LLM_API_KEY") || envValue(env, "COMFLY_API_KEY");
}

export function comflyLlmConfigured(env = process.env) {
  return Boolean(comflyLlmApiKey(env));
}

export function comflyLlmBaseUrl(env = process.env) {
  return envValue(env, "COMFLY_BASE_URL") || COMFLY_LLM_DEFAULT_BASE_URL;
}

function comflyApiUrl(pathname, env = process.env) {
  const base = comflyLlmBaseUrl(env).replace(/\/+$/, "");
  const versionedBase = /\/v1$/i.test(base) ? base : `${base}/v1`;
  return `${versionedBase}/${String(pathname).replace(/^\/+/, "")}`;
}

function isOpenAiCompatibleModel(model) {
  const endpointTypes = Array.isArray(model?.supported_endpoint_types) ? model.supported_endpoint_types : [];
  return !endpointTypes.length || endpointTypes.includes("openai");
}

export function normalizeComflyLlmModel(model, defaultModel = "") {
  const id = String(model?.id || "").trim();
  if (!id || !TEXT_MODEL_PATTERN.test(id) || NON_TEXT_MODEL_PATTERN.test(id) || !isOpenAiCompatibleModel(model)) return null;
  return {
    id: `comfly-${id}`,
    model: id,
    provider: COMFLY_LLM_PROVIDER_ID,
    providerName: String(model?.owned_by || "Comfly"),
    displayName: String(model?.name || id),
    description: "Comfly OpenAI 兼容文本模型",
    isDefault: id === defaultModel,
    defaultReasoningEffort: "auto",
    supportedReasoningEfforts: [{ reasoningEffort: "auto", description: "由模型自身决定" }],
    inputModalities: VISION_MODEL_PATTERN.test(id) ? ["text", "image"] : ["text"],
    supportsStructuredOutputs: true,
    recommended: PREFERRED_MODELS.includes(id),
  };
}

function sortModels(models) {
  return models.sort((left, right) => {
    const leftRank = PREFERRED_MODELS.indexOf(left.model);
    const rightRank = PREFERRED_MODELS.indexOf(right.model);
    if (leftRank >= 0 || rightRank >= 0) {
      if (leftRank < 0) return 1;
      if (rightRank < 0) return -1;
      return leftRank - rightRank;
    }
    return left.displayName.localeCompare(right.displayName, "zh-CN");
  });
}

async function queryComflyLlmModels({ env = process.env, fetchImpl = fetch } = {}) {
  const apiKey = comflyLlmApiKey(env);
  if (!apiKey) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("Comfly model list timed out"), MODEL_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(comflyApiUrl("models", env), {
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) throw new Error("Comfly API Key 无效或没有访问权限");
      if (response.status === 429) throw new Error("Comfly 请求过于频繁，请稍后重试");
      throw new Error(`Comfly 模型列表读取失败（${response.status}）${detail ? `：${detail.slice(0, 240)}` : ""}`);
    }
    const payload = await response.json();
    const defaultModel = envValue(env, "COMFLY_LLM_DEFAULT_MODEL");
    const seen = new Set();
    const models = sortModels((Array.isArray(payload?.data) ? payload.data : [])
      .map((model) => normalizeComflyLlmModel(model, defaultModel))
      .filter((model) => model && !seen.has(model.model) && seen.add(model.model)))
      .slice(0, 120);
    if (models.length && !models.some((model) => model.isDefault)) models[0].isDefault = true;
    return models;
  } finally {
    clearTimeout(timer);
  }
}

export async function getComflyLlmModels({ force = false, env = process.env, fetchImpl = fetch } = {}) {
  if (!comflyLlmConfigured(env)) return [];
  const useSharedCache = env === process.env && fetchImpl === fetch;
  const now = Date.now();
  if (useSharedCache && !force && modelCache && now - modelCache.loadedAt < MODEL_CACHE_MS) return modelCache.models;
  if (!useSharedCache) return queryComflyLlmModels({ env, fetchImpl });
  if (!modelCachePromise) modelCachePromise = queryComflyLlmModels({ env, fetchImpl });
  try {
    const models = await modelCachePromise;
    modelCache = { loadedAt: Date.now(), models };
    return models;
  } finally {
    modelCachePromise = null;
  }
}

const REFERENCE_ROUTES = Object.freeze({
  seedance: Object.freeze([
    [/分镜|故事板|storyboard/i, ["references/storyboard-driven.md"]],
    [/长视频|续写|延长|long.?video/i, ["references/long-video-strategy.md"]],
    [/剪辑|节奏|转场|editing/i, ["references/editing-rhythm.md"]],
    [/参考图|图片|图生视频|image/i, ["references/image-to-prompt.md"]],
    [/.*/, ["references/creative-strategy.md", "references/vocabulary.md"]],
  ]),
  image: Object.freeze([
    [/编辑|替换|局部|蒙版|参考图|保留|edit|mask/i, ["references/editing.md", "references/structural.md"]],
    [/文字|海报|排版|字体|logo|UI|社交/i, ["references/text-rendering.md", "references/patterns/poster-illustration.md", "references/patterns/ui-social.md"]],
    [/商品|电商|产品|家具|椅子|ecommerce/i, ["references/patterns/ecommerce.md"]],
    [/人像|人物|模特|时尚|portrait|fashion/i, ["references/patterns/portrait-cinema.md", "references/patterns/fashion-editorial.md"]],
    [/食物|饮料|餐饮|food|beverage/i, ["references/patterns/food-beverage.md"]],
    [/分镜|故事板|storyboard/i, ["references/storyboards.md"]],
    [/.*/, ["references/prompt-framework.md", "references/creative-direction.md"]],
  ]),
  photoreal: Object.freeze([
    [/办公室|办公空间|office/i, ["references/office.md"]],
    [/居家办公|家庭工作|home.?workspace/i, ["references/home-workspace.md"]],
    [/工作室|创意空间|studio/i, ["references/creative-studio.md"]],
    [/卧室|bedroom/i, ["references/bedroom.md"]],
    [/电竞|游戏房|gaming/i, ["references/gaming-room.md"]],
    [/.*/, ["references/home-workspace.md"]],
  ]),
});

export function buildComflySkillInstructions(bundle, textPrompt = "") {
  const routedNames = [];
  for (const [pattern, names] of REFERENCE_ROUTES[bundle.id] || []) {
    if (!pattern.test(textPrompt)) continue;
    for (const name of names) if (!routedNames.includes(name)) routedNames.push(name);
    if (pattern.source === ".*") break;
  }
  const routed = routedNames.slice(0, 3).map((name) => promptSkillDocument(bundle, name));
  return [
    promptSkillInstructions(bundle),
    ...routed.map((document) => `\n--- 本任务已路由参考：${document.name} ---\n${document.content}`),
    "\n只返回一个 JSON 对象，不要使用 Markdown 代码块，也不要输出 JSON 之外的任何内容。对象必须且只能包含 prompt、title、changes 三个非空字符串字段。",
  ].join("\n");
}

async function attachmentToComflyImage(attachment) {
  const mime = IMAGE_MIME_TYPES[extname(attachment.path).toLowerCase()];
  if (!mime) throw new Error("Comfly 不支持该参考图片格式");
  const data = await readFile(attachment.path);
  return { type: "image_url", image_url: { url: `data:${mime};base64,${data.toString("base64")}` } };
}

function comflyResponseText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => typeof item === "string" ? item : item?.text || "").join("");
  return "";
}

export async function runComflyLlmRefine({
  model,
  textPrompt,
  attachments = [],
  skillId = "seedance",
  skillPath,
  threadId,
  signal,
  timeoutMs = 10 * 60_000,
}, { env = process.env, fetchImpl = fetch } = {}) {
  const apiKey = comflyLlmApiKey(env);
  if (!apiKey) throw new Error("Comfly 尚未配置，请先在 .env.local 中设置 COMFLY_LLM_API_KEY 或 COMFLY_API_KEY");
  if (threadId && !String(threadId).startsWith(COMFLY_LLM_SESSION_PREFIX)) {
    throw new Error("该会话属于其他 Agent，不能交给 Comfly 继续执行");
  }
  const bundle = await loadPromptSkillBundle(skillId, skillPath);
  const content = [{ type: "text", text: textPrompt }];
  for (const attachment of attachments) content.push(await attachmentToComflyImage(attachment));
  const response = await fetchImpl(comflyApiUrl("chat/completions", env), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: buildComflySkillInstructions(bundle, textPrompt) },
        { role: "user", content: attachments.length ? content : textPrompt },
      ],
      stream: false,
      temperature: 0.2,
      max_tokens: 4_000,
    }),
    signal: signal || AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) throw new Error("Comfly API Key 无效或没有访问权限");
    if (response.status === 429) throw new Error("Comfly 请求过于频繁或额度不足，请稍后重试");
    throw new Error(`Comfly 提示词处理失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 500)}` : ""}`);
  }
  const payload = await response.json();
  const result = validateStructuredResult(comflyResponseText(payload), { allowCodeFence: true });
  const sessionId = threadId || `${COMFLY_LLM_SESSION_PREFIX}${randomUUID()}`;
  return {
    ...result,
    threadId: sessionId,
    usage: payload?.usage,
    provider: COMFLY_LLM_PROVIDER_ID,
    skill: true,
    skillId: bundle.id,
    skillHash: bundle.hash,
    seedanceSkill: bundle.id === "seedance",
    seedanceSkillId: bundle.id === "seedance" ? bundle.id : undefined,
    seedanceSkillHash: bundle.id === "seedance" ? bundle.hash : undefined,
    sessionMode: "stateless",
  };
}
