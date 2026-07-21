import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { OpenRouter, stepCountIs, tool } from "@openrouter/agent";
import { z } from "zod";
import { validateStructuredResult } from "./agent-protocol.mjs";
import {
  loadPromptSkillBundle,
  promptSkillDefinition,
  promptSkillDocument,
  promptSkillInstructions,
} from "./skill-bundle.mjs";

export { validateStructuredResult } from "./agent-protocol.mjs";

export const OPENROUTER_PROVIDER_ID = "openrouter";
export const OPENROUTER_SESSION_PREFIX = "openrouter:";
export const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const OPENROUTER_FALLBACK_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high"];

const MODEL_CACHE_MS = 5 * 60_000;
const MODEL_REQUEST_TIMEOUT_MS = 15_000;
const REQUIRED_MODEL_PARAMETERS = new Set(["response_format", "structured_outputs"]);
const IMAGE_MIME_TYPES = {
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

let modelCache = null;
let modelCachePromise = null;
let openRouterClient = null;
let openRouterClientKey = "";

export function openRouterConfigured() {
  return Boolean(String(process.env.OPENROUTER_API_KEY || "").trim());
}

export function openRouterBaseUrl() {
  return String(process.env.OPENROUTER_BASE_URL || OPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function getOpenRouterClient() {
  const apiKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) return null;
  const cacheKey = `${apiKey}\n${openRouterBaseUrl()}`;
  if (!openRouterClient || openRouterClientKey !== cacheKey) {
    openRouterClient = new OpenRouter({
      apiKey,
      serverURL: openRouterBaseUrl(),
      httpReferer: process.env.OPENROUTER_HTTP_REFERER || "http://127.0.0.1:4173",
      appTitle: "Agent Canvas",
      timeoutMs: MODEL_REQUEST_TIMEOUT_MS,
    });
    openRouterClientKey = cacheKey;
  }
  return openRouterClient;
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function rawSupportedParameters(model) {
  return stringList(model?.supported_parameters || model?.supportedParameters);
}

function rawInputModalities(model) {
  return stringList(model?.architecture?.input_modalities || model?.architecture?.inputModalities);
}

function rawOutputModalities(model) {
  return stringList(model?.architecture?.output_modalities || model?.architecture?.outputModalities);
}

function modelSupportsStructuredOutput(model) {
  return rawSupportedParameters(model).some((parameter) => REQUIRED_MODEL_PARAMETERS.has(parameter));
}

function modelSupportsTools(model) {
  return rawSupportedParameters(model).includes("tools");
}

function modelProducesText(model) {
  const outputModalities = rawOutputModalities(model);
  if (outputModalities.length) return outputModalities.includes("text");
  return String(model?.architecture?.modality || "").endsWith("->text") || !model?.architecture;
}

function openRouterEfforts(model) {
  const supportedParameters = rawSupportedParameters(model);
  const reasoning = model?.reasoning || {};
  const advertised = stringList(reasoning.supported_efforts || reasoning.supportedEfforts)
    .filter((effort) => OPENROUTER_REASONING_EFFORTS.includes(effort));
  const supportsReasoning = advertised.length
    || supportedParameters.includes("reasoning")
    || supportedParameters.includes("reasoning_effort")
    || Object.keys(reasoning).length > 0;
  return supportsReasoning
    ? (advertised.length ? advertised : OPENROUTER_FALLBACK_REASONING_EFFORTS)
    : ["none"];
}

export function normalizeOpenRouterModel(model, defaultModel = "") {
  if (!model || typeof model.id !== "string" || !model.id.trim()) return null;
  if (!modelProducesText(model) || !modelSupportsStructuredOutput(model) || !modelSupportsTools(model)) return null;
  const efforts = openRouterEfforts(model);
  const advertisedDefault = model?.reasoning?.default_effort || model?.reasoning?.defaultEffort;
  const defaultReasoningEffort = efforts.includes(advertisedDefault)
    ? advertisedDefault
    : efforts.includes("medium") ? "medium" : efforts[0];
  const inputModalities = rawInputModalities(model);
  return {
    id: model.id,
    model: model.id,
    provider: OPENROUTER_PROVIDER_ID,
    displayName: String(model.name || model.id),
    description: String(model.description || "OpenRouter compatible model"),
    isDefault: model.id === defaultModel,
    defaultReasoningEffort,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort })),
    inputModalities: inputModalities.length ? inputModalities : ["text"],
    contextLength: Number(model.context_length || model.contextLength || 0) || null,
    supportedParameters: rawSupportedParameters(model),
    pricing: model.pricing || null,
  };
}

function openRouterModelsUrl() {
  const url = new URL(`${openRouterBaseUrl()}/models`);
  url.searchParams.set("output_modalities", "text");
  url.searchParams.set("sort", "most-popular");
  return url;
}

async function queryOpenRouterModels() {
  const apiKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("OpenRouter model list timed out"), MODEL_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(openRouterModelsUrl(), {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "http://127.0.0.1:4173",
        "X-Title": "Agent Canvas",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw new Error("OpenRouter API Key 无效或没有访问权限");
      }
      if (response.status === 429) throw new Error("OpenRouter 请求过于频繁，请稍后重试");
      throw new Error(`OpenRouter 模型列表读取失败（${response.status}）${detail ? `：${detail.slice(0, 240)}` : ""}`);
    }
    const payload = await response.json();
    const defaultModel = String(process.env.OPENROUTER_DEFAULT_MODEL || "").trim();
    const models = (Array.isArray(payload?.data) ? payload.data : [])
      .map((model) => normalizeOpenRouterModel(model, defaultModel))
      .filter(Boolean);
    if (models.length && !models.some((model) => model.isDefault)) {
      const mediaCapableDefault = models.find((model) => model.inputModalities.includes("image"));
      (mediaCapableDefault || models[0]).isDefault = true;
    }
    return models;
  } finally {
    clearTimeout(timer);
  }
}

export async function getOpenRouterModels({ force = false } = {}) {
  if (!openRouterConfigured()) return [];
  const now = Date.now();
  if (!force && modelCache && now - modelCache.loadedAt < MODEL_CACHE_MS) return modelCache.models;
  if (!modelCachePromise) modelCachePromise = queryOpenRouterModels();
  try {
    const models = await modelCachePromise;
    modelCache = { loadedAt: Date.now(), models };
    return models;
  } finally {
    modelCachePromise = null;
  }
}

export async function loadPromptSkillContext(skillId, skillPath) {
  const definition = promptSkillDefinition(skillId);
  const bundle = await loadPromptSkillBundle(definition.id, skillPath);
  const referenceSchema = z.enum(definition.referenceFiles);
  const referenceTool = tool({
    name: `read_${definition.id}_reference`,
    description: `读取已安装 ${definition.label} skill 的指定参考文档。只能读取列出的 references，不能访问其他文件。`,
    inputSchema: z.object({
      name: referenceSchema.describe(`需要读取的 ${definition.label} reference 相对路径`),
    }),
    execute: async ({ name }) => ({
      name,
      content: promptSkillDocument(bundle, name).content,
    }),
  });
  return {
    id: bundle.id,
    hash: bundle.hash,
    instructions: promptSkillInstructions(bundle),
    referenceTool,
  };
}

export async function loadSeedanceSkillContext(skillPath) {
  return loadPromptSkillContext("seedance", skillPath);
}

export async function attachmentToOpenRouterImage(attachment) {
  const mime = IMAGE_MIME_TYPES[extname(attachment.path).toLowerCase()];
  if (!mime) throw new Error("OpenRouter 不支持该参考图片格式");
  const data = await readFile(attachment.path);
  return {
    type: "input_image",
    detail: "high",
    imageUrl: `data:${mime};base64,${data.toString("base64")}`,
  };
}

export function createOpenRouterSessionId(threadId) {
  if (threadId) {
    if (!String(threadId).startsWith(OPENROUTER_SESSION_PREFIX)) {
      throw new Error("该会话属于其他 Agent，不能交给 OpenRouter 继续执行");
    }
    return String(threadId).slice(0, 256);
  }
  return `${OPENROUTER_SESSION_PREFIX}${randomUUID()}`;
}

export async function runOpenRouterRefine({
  model,
  reasoningEffort,
  textPrompt,
  attachments,
  outputSchema,
  skillId = "seedance",
  skillPath,
  seedanceSkillPath,
  threadId,
  signal,
  timeoutMs,
}) {
  const client = getOpenRouterClient();
  if (!client) throw new Error("OpenRouter 尚未配置，请先在 .env.local 中设置 OPENROUTER_API_KEY");
  const skill = await loadPromptSkillContext(skillId, skillPath || seedanceSkillPath);
  const sessionId = createOpenRouterSessionId(threadId);
  const content = [{ type: "input_text", text: textPrompt }];
  for (const attachment of attachments) content.push(await attachmentToOpenRouterImage(attachment));
  const request = {
    model,
    input: [{ role: "user", content }],
    instructions: skill.instructions,
    sessionId,
    store: false,
    maxOutputTokens: 4_000,
    // requireParameters:false — OpenRouter Agent routing often has no endpoints that
    // advertise simultaneous tools+json_schema support; keep allowFallbacks and rely on
    // local validateStructuredResult instead of hard routing rejection.
    provider: { allowFallbacks: true, requireParameters: false },
    text: {
      format: {
        type: "json_schema",
        name: `prompt_flow_${skill.id}_result`,
        description: `Agent Canvas ${skill.id} prompt rewrite result`,
        strict: true,
        schema: outputSchema,
      },
    },
    tools: [skill.referenceTool],
    stopWhen: stepCountIs(skill.id === "image" ? 8 : 4),
    allowFinalResponse: true,
  };
  if (reasoningEffort && reasoningEffort !== "none") request.reasoning = { effort: reasoningEffort };
  const result = client.callModel(request, { signal, timeout: timeoutMs });
  const cancel = () => { void result.cancel().catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const [text, response] = await Promise.all([result.getText(), result.getResponse()]);
    return {
      ...validateStructuredResult(text),
      threadId: sessionId,
      usage: response.usage,
      provider: OPENROUTER_PROVIDER_ID,
      skill: Boolean(skill.hash),
      skillId: skill.id,
      skillHash: skill.hash,
      seedanceSkill: skill.id === "seedance",
      seedanceSkillId: skill.id === "seedance" ? skill.id : undefined,
      seedanceSkillHash: skill.id === "seedance" ? skill.hash : undefined,
      sessionMode: "stateless",
    };
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
