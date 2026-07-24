import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { Codex } from "@openai/codex-sdk";
import {
  OPENROUTER_PROVIDER_ID,
  getOpenRouterModels,
  openRouterConfigured,
  runOpenRouterRefine,
  validateStructuredResult,
} from "./openrouter-provider.mjs";
import {
  GROK_BUILD_PROVIDER_ID,
  GROK_BUILD_SESSION_PREFIX,
  getGrokBuildModels,
  getGrokBuildStatus,
  runGrokBuildRefine,
} from "./grok-build-provider.mjs";
import {
  ANTIGRAVITY_PROVIDER_ID,
  ANTIGRAVITY_SESSION_PREFIX,
  getAntigravityModels,
  getAntigravityStatus,
  runAntigravityRefine,
} from "./antigravity-provider.mjs";
import {
  COMFLY_LLM_PROVIDER_ID,
  COMFLY_LLM_SESSION_PREFIX,
  comflyLlmConfigured,
  getComflyLlmModels,
  runComflyLlmRefine,
} from "./comfly-llm-provider.mjs";
import {
  LOADABLE_PROMPT_SKILL_IDS,
  PROMPT_SKILL_IDS,
  isImagePromptSkillId,
  isPromptSkillDisabled,
  normalizePromptSkillId,
  promptSkillDefinition,
} from "./skill-bundle.mjs";
import {
  IMAGE_GENERATION_PROVIDER_IDS,
  getImageGenerationProviderStatus,
  runImageGeneration,
} from "./image-generation-provider.mjs";
import {
  VIDEO_GENERATION_PROVIDER_IDS,
  getVideoGenerationProviderStatus,
  runVideoGeneration,
} from "./video-generation-provider.mjs";
import {
  getMediaOutputSettings,
  saveGeneratedMedia,
  setMediaOutputDirectory,
} from "./media-output-store.mjs";
import { getApiKeySettings, saveApiKeyChanges } from "./api-key-store.mjs";
import {
  applyCanvasOperations,
  applyTaskResultToProject,
  automationCapabilities,
  buildNodeTaskRequest,
  canvasOutputs,
  compactCanvasProject,
  compactTask,
} from "./canvas-domain.mjs";
import {
  CanvasProjectStore,
  CanvasStoreError,
  canvasProjectSummary,
  normalizeCanvasProjectName,
  validCanvasProjectId,
} from "./canvas-project-store.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const localEnvPath = process.env.PROMPT_CANVAS_ENV_FILE || join(projectRoot, ".env.local");
try {
  loadEnvFile(localEnvPath);
} catch (error) {
  if (error?.code !== "ENOENT") console.warn(`Unable to load local environment file: ${error?.message || error}`);
}

const PORT = Number(process.env.PROMPT_CANVAS_BRIDGE_PORT || 4317);
const CODEX_RUN_TIMEOUT_MS = 10 * 60_000;
const CODEX_TIMEOUT_MESSAGE = "Codex 处理超过 10 分钟，已停止；可降低思考强度后重试";
const dataDirectory = join(projectRoot, ".prompt-flow-data");
const canvasDirectory = join(projectRoot, ".prompt-flow-data", "projects");
const taskStorePath = join(dataDirectory, "tasks.json");
const moduleRequire = createRequire(import.meta.url);

const CODEX_TARGETS = {
  "linux-x64": ["@openai/codex-linux-x64", "x86_64-unknown-linux-musl"],
  "linux-arm64": ["@openai/codex-linux-arm64", "aarch64-unknown-linux-musl"],
  "darwin-x64": ["@openai/codex-darwin-x64", "x86_64-apple-darwin"],
  "darwin-arm64": ["@openai/codex-darwin-arm64", "aarch64-apple-darwin"],
  "win32-x64": ["@openai/codex-win32-x64", "x86_64-pc-windows-msvc"],
  "win32-arm64": ["@openai/codex-win32-arm64", "aarch64-pc-windows-msvc"],
};

function resolveCodexBinary() {
  const target = CODEX_TARGETS[`${process.platform}-${process.arch}`];
  if (!target) throw new Error(`不支持的平台：${process.platform}-${process.arch}`);
  const packageJson = moduleRequire.resolve(`${target[0]}/package.json`);
  return join(dirname(packageJson), "vendor", target[1], "bin", process.platform === "win32" ? "codex.exe" : "codex");
}

let modelCatalog = null;
let modelCatalogPromise = null;

function queryCodexModels() {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveCodexBinary(), ["app-server", "--listen", "stdio://"], {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let finished = false;

    const finish = (error, models) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(models);
    };
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const timer = setTimeout(() => finish(new Error("读取 Codex 模型列表超时")), 15_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      let lineBreak;
      while ((lineBreak = stdout.indexOf("\n")) >= 0) {
        const line = stdout.slice(0, lineBreak).trim();
        stdout = stdout.slice(lineBreak + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); }
        catch { continue; }
        if (message.id === 1) {
          send({ method: "initialized" });
          send({ id: 2, method: "model/list", params: { limit: 100, includeHidden: false } });
        } else if (message.id === 2) {
          if (message.error) finish(new Error(message.error.message || "Codex 模型列表读取失败"));
          else finish(null, Array.isArray(message.result?.data) ? message.result.data.filter((model) => !model.hidden) : []);
        }
      }
    });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-2000); });
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => { if (!finished) finish(new Error(stderr.trim() || `Codex 模型服务退出：${code}`)); });
    send({
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "agent-canvas", title: "Agent Canvas", version: "0.1.0" }, capabilities: { experimentalApi: true } },
    });
  });
}

async function getCodexModels() {
  if (modelCatalog) return modelCatalog;
  if (!modelCatalogPromise) modelCatalogPromise = queryCodexModels();
  try {
    modelCatalog = await modelCatalogPromise;
    return modelCatalog;
  } finally {
    modelCatalogPromise = null;
  }
}

function findSkillFiles(root) {
  const found = [];
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) found.push(...findSkillFiles(path));
      if (entry.isFile() && entry.name === "SKILL.md") found.push(path);
    }
  } catch {
    // Missing skill directories are handled by the health response.
  }
  return found;
}

function configuredPhotorealSkillPath() {
  const configured = String(process.env.PHOTOREAL_SKILL_PATH || "").trim();
  const root = configured || join(projectRoot, "..", "真实感skill");
  const candidates = root.toLowerCase().endsWith("skill.md")
    ? [root]
    : [join(root, "SKILL.md"), join(root, "photoreal_scene_model_skill", "SKILL.md")];
  return candidates.map((path) => resolve(path)).find((path) => existsSync(path));
}

const explicitlyConfiguredSkillPaths = {
  photoreal: configuredPhotorealSkillPath(),
};

function isPromptSkill(path, skillId) {
  if (skillId === "none") return false;
  const explicitPath = explicitlyConfiguredSkillPaths[skillId];
  if (explicitPath && resolve(path) === explicitPath) return true;
  const definition = promptSkillDefinition(skillId);
  const directoryNames = definition.directoryNames || [skillId];
  return directoryNames.some((directoryName) => new RegExp(`[\\\\/]${directoryName}[\\\\/]SKILL\\.md$`, "i").test(path));
}

const discoveredSkillFiles = findSkillFiles(join(process.env.CODEX_HOME || join(homedir(), ".codex"), "skills"));
const skillFiles = [...new Set([
  ...discoveredSkillFiles,
  ...Object.values(explicitlyConfiguredSkillPaths).filter(Boolean),
])];
const skillPaths = Object.fromEntries(PROMPT_SKILL_IDS.map((skillId) => [
  skillId,
  skillId === "none" ? null : explicitlyConfiguredSkillPaths[skillId] || skillFiles.find((path) => isPromptSkill(path, skillId)),
]));
const codexClients = Object.fromEntries(PROMPT_SKILL_IDS.map((skillId) => [
  skillId,
  new Codex({
    config: {
      features: {
        apps: false,
        plugins: false,
        multi_agent: false,
        tool_search: false,
        image_generation: false,
        shell_tool: true,
      },
      // Each client exposes only the skill selected by the canvas task.
      skills: {
        config: skillFiles.map((path) => ({ path, enabled: isPromptSkill(path, skillId) })),
      },
    },
  }),
]));

const taskRecords = new Map();
const taskPayloads = new Map();
const taskControllers = new Map();
const runningTaskIds = new Set();
const taskEventClients = new Set();
const projectEventClients = new Set();
const finishedTaskStatuses = new Set(["completed", "failed", "cancelled"]);
let taskConcurrency = 2;
let persistTasksPromise = Promise.resolve();
const projectStore = new CanvasProjectStore({
  directory: canvasDirectory,
  onChange: (event) => broadcastProjectEvent(event),
});

const outputSchema = {
  type: "object",
  properties: {
    prompt: { type: "string" },
    title: { type: "string" },
    changes: { type: "string" },
  },
  required: ["prompt", "title", "changes"],
  additionalProperties: false,
};

function isAllowedOrigin(origin) {
  return !origin || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
}

function setCors(request, response) {
  const origin = request.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

const mediaContentTypes = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

function pathInsideDirectory(filePath, directory) {
  const candidate = resolve(filePath);
  const root = resolve(directory);
  const offset = relative(root, candidate);
  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset));
}

function parseByteRange(value, size) {
  const match = String(value || "").match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || (!match[1] && !match[2])) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

async function handleMediaFileRequest(request, response, requestUrl) {
  if (requestUrl.pathname !== "/media-file") return false;
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "媒体预览只支持 GET 和 HEAD" });
    return true;
  }

  const requestedPath = String(requestUrl.searchParams.get("path") || "").trim();
  if (!requestedPath || requestedPath.includes("\0") || !isAbsolute(requestedPath)) {
    sendJson(response, 400, { error: "媒体文件路径无效" });
    return true;
  }
  const settings = await getMediaOutputSettings();
  if (![settings.directory, settings.defaultDirectory].some((directory) => pathInsideDirectory(requestedPath, directory))) {
    sendJson(response, 403, { error: "只能预览画板输出目录中的媒体文件" });
    return true;
  }

  let file;
  try {
    file = await stat(requestedPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      sendJson(response, 404, { error: "本地媒体文件不存在" });
      return true;
    }
    throw error;
  }
  if (!file.isFile()) {
    sendJson(response, 400, { error: "媒体路径不是文件" });
    return true;
  }

  const rangeHeader = request.headers.range;
  const range = rangeHeader ? parseByteRange(rangeHeader, file.size) : null;
  if (rangeHeader && !range) {
    response.writeHead(416, { "Content-Range": `bytes */${file.size}`, "Accept-Ranges": "bytes" });
    response.end();
    return true;
  }
  const contentType = mediaContentTypes[extname(requestedPath).toLowerCase()] || "application/octet-stream";
  const headers = {
    "Content-Type": contentType,
    "Content-Length": String(range ? range.end - range.start + 1 : file.size),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${file.size}`;
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === "HEAD") {
    response.end();
    return true;
  }
  const stream = createReadStream(requestedPath, range || undefined);
  stream.on("error", (error) => response.destroy(error));
  stream.pipe(response);
  return true;
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 220_000_000) throw new Error("画布或参考素材总大小过大");
  }
  return JSON.parse(body || "{}");
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

class CodexTimeoutError extends Error {
  constructor() {
    super(CODEX_TIMEOUT_MESSAGE);
    this.name = "CodexTimeoutError";
  }
}

function abortError(reason = "任务已取消") {
  const error = new Error(typeof reason === "string" ? reason : "任务已取消");
  error.name = "AbortError";
  return error;
}

function isAbortError(error) {
  return error?.name === "AbortError" || /aborted|abort|已取消/i.test(String(error?.message || ""));
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal.reason);
}

function validProjectId(id) {
  return validCanvasProjectId(id);
}

function projectSummary(record) {
  return canvasProjectSummary(record);
}

async function atomicWrite(path, value) {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value), "utf8");
  await rename(temporaryPath, path);
}

async function readProject(id) {
  return projectStore.readProject(id);
}

async function listProjects() {
  return projectStore.listProjects();
}

async function saveProject(id, payload, options = {}) {
  return projectStore.saveProject(id, payload, options);
}

async function renameProject(id, name) {
  return projectStore.renameProject(id, name);
}

async function handleProjectRequest(request, response, pathname) {
  if (request.method === "GET" && pathname === "/projects") {
    sendJson(response, 200, { projects: await listProjects() });
    return true;
  }
  const match = pathname.match(/^\/projects\/([a-zA-Z0-9-]+)$/);
  if (!match) return false;
  const id = match[1];
  if (!validProjectId(id)) {
    sendJson(response, 400, { error: "画布文件 ID 无效" });
    return true;
  }
  if (request.method === "GET") {
    const record = await readProject(id);
    sendJson(response, record ? 200 : 404, record || { error: "没有找到这个画布" });
    return true;
  }
  if (request.method === "PUT") {
    const payload = await readJson(request);
    const record = await saveProject(id, payload, {
      expectedRevision: payload.expectedRevision,
      actor: String(payload.actor || "ui"),
    });
    sendJson(response, 200, { project: projectSummary(record) });
    return true;
  }
  if (request.method === "PATCH") {
    const record = await renameProject(id, (await readJson(request)).name);
    sendJson(response, record ? 200 : 404, record ? { project: projectSummary(record) } : { error: "没有找到这个画布" });
    return true;
  }
  return false;
}

function buildInstruction(payload, attachments, provider = "codex") {
  const skillId = normalizePromptSkillId(payload.skillId);
  const skill = promptSkillDefinition(skillId);
  const spec = JSON.stringify(payload.spec || {}, null, 2);
  const isRevision = payload.taskMode === "revision";
  const attachmentMap = attachments.length
    ? attachments.map((attachment, index) => {
        if (attachment.kind === "video") {
          return `- 附件${index + 1} = ${attachment.marker} 的第 ${attachment.frameIndex}/${attachment.frameCount} 帧（按视频时间顺序；原文件：${attachment.fileName || "未命名视频"}）`;
        }
        return `- 附件${index + 1} = ${attachment.marker}（图片；原文件：${attachment.fileName || "未命名图片"}）`;
      }).join("\n")
    : "- 本次没有连接参考素材";

  const seedanceModeRules = isRevision
    ? `这是 Agent Canvas 的修改模式。下方“当前完整提示词”是已经可用的 Seedance2 提示词，“本次修改建议”是用户这一次唯一要求调整的内容。

修改规则：
1. 根据建议直接输出一段完整的替换版提示词，不要输出差异、批注、解释或修改前后对照。
2. 只改动建议涉及的部分；未提及的 @图片N / @视频N 编号、时长、画幅、主体、产品、时间线、镜头连续性、物理反馈、人物一致性、声音和禁止项全部保留。
3. 如果修改建议与旧提示词冲突，以明确的新建议为准，但不得违反安全要求，也不得虚构品牌或产品功能。
4. 修改结果仍须符合 Seedance2 提示词格式，并且可直接复制使用。`
    : `这是 Agent Canvas 的直接生成模式：用户已经给出最终创作要求，不要反问、不要输出候选方案、不要询问是否调用 dreamina CLI，也不要执行视频生成。只返回一段可直接用于 Seedance2 的中文提示词。`;

  const nanoBananaModeRules = isRevision
    ? `这是 Agent Canvas 的 Nano Banana 提示词修改模式。下方“当前完整提示词”是已经可用的 Nano Banana 提示词，“本次修改建议”是用户这一次唯一要求调整的内容。

修改规则：
1. 根据建议返回一份完整替换版，保留 Model、Size / Ratio、Prompt 和 Notes 结构；Nano Banana 不输出 Quality 字段。
2. 只改动建议涉及的部分；未提及的主体、构图、风格、材质、文字、参考图角色和保留项继续保留。
3. 如果建议与旧提示词冲突，以明确的新建议为准；不要虚构品牌、产品功能或参考图中不存在的事实。
4. 继续使用 Nano Banana 的自然语言提示词结构，不得改写成 GPT Image 的五段式模板。`
    : `这是 Agent Canvas 的 Nano Banana 提示词直接生成模式。必须在 Nano Banana 2 与 Nano Banana Pro 中按任务选择，读取 nano-banana.md，并在 prompt 字段中返回完整的 Model、Size / Ratio、Prompt 和 Notes。使用自然语言结构，不得输出 GPT Image 的五段式模板或 Quality 字段。不要调用图像生成工具，不要反问，不要输出多个候选方案。`;

  const gptImageModeRules = isRevision
    ? `这是 Agent Canvas 的 GPT Image 提示词修改模式。下方“当前完整提示词”是已经可用的 GPT Image 提示词，“本次修改建议”是用户这一次唯一要求调整的内容。

修改规则：
1. 根据建议返回一份完整替换版，保留 Model、Quality、Size / Ratio、Prompt 和 Notes 结构。
2. 只改动建议涉及的部分；未提及的主体、构图、风格、材质、文字、参考图角色和保留项继续保留。
3. 如果建议与旧提示词冲突，以明确的新建议为准；不要虚构品牌、产品功能或参考图中不存在的事实。
4. 继续使用 GPT Image 2 的 Scene / Subject / Important Details / Use Case / Constraints 五段式结构。`
    : `这是 Agent Canvas 的 GPT Image 提示词直接生成模式。目标模型固定为 GPT Image 2，读取 gpt-image.md，并在 prompt 字段中返回完整的 Model、Quality、Size / Ratio、Prompt 和 Notes。Prompt 必须使用 Scene / Subject / Important Details / Use Case / Constraints 五段式结构。不要切换到 Nano Banana，不要调用图像生成工具，不要反问，不要输出多个候选方案。`;

  const photorealModeRules = isRevision
    ? `这是 Agent Canvas 的真实感场景提示词修改模式。下方“当前完整提示词”是已有提示词，“本次修改建议”是用户这一次唯一要求调整的内容。

修改规则：
1. 先按 Skill 的反 AI 质检顺序判断建议涉及的结构、透视、动作、接触、光影或材质问题，再返回一份完整替换版。
2. 只改动建议涉及的部分；未提及的主体、产品保真、人物特征、机位、画幅和参考图角色继续保留。
3. 产品或人物保真与场景参考冲突时，以用户提供的主体参考和明确要求为准。
4. 修改结果必须可以直接复制给图像生成模型。`
    : `这是 Agent Canvas 的真实感场景提示词直接生成模式。先读取 reference-library.md，再按任务场景只读取一个最相关的分类文件。根据 Skill 的默认摄影策略建立摄影任务书，并把完整正向提示词、排除项、保真约束和必要的分层建议写入 prompt 字段。不要调用图像生成工具，不要反问，不要输出多个候选方案。`;

  const agentName = provider === OPENROUTER_PROVIDER_ID
    ? "OpenRouter Agent"
    : provider === GROK_BUILD_PROVIDER_ID
      ? "Grok Build"
      : provider === ANTIGRAVITY_PROVIDER_ID
        ? "Antigravity"
        : provider === COMFLY_LLM_PROVIDER_ID
          ? "Comfly"
        : "Codex";
  if (isPromptSkillDisabled(skillId)) {
    return `本任务明确选择“不加载 Skill”。不要读取、调用、搜索或注入任何 Skill，也不要套用 Seedance、Nano Banana、GPT Image 或真实感场景的专用模板。

${isRevision
  ? "这是修改模式。只按“本次修改建议”修改“当前完整提示词”，输出一份完整替换版本；未提及的主体、构图、动作、镜头、材质、文字、引用编号和约束应保持不变。"
  : "这是直接生成模式。根据用户原始需求和已连接参考素材，整理成一份完整、清晰、可直接复制使用的提示词；不反问，不输出候选方案。"}

硬性要求：
1. 不加载或调用任何 Skill，不声称使用了任何 Skill。
2. 严格使用用户已连接的 @图片N / @视频N 编号；没有连接的编号不得虚构。
3. 参考素材按下面的附件映射理解，不得把附件顺序误当成素材编号。
4. 不强制套用任何特定模型格式；保持用户原有语言和用途，除非修改建议明确要求改变。
5. 最终可复制内容完整放入 JSON 的 prompt 字段；title 用 12 字以内概括，changes 用一句中文概括本次生成或修改。

生成规格：
${spec}

参考素材附件映射：
${attachmentMap}

${isRevision ? "当前完整提示词" : "用户原始需求"}：
${String(payload.prompt || "")}

${isRevision ? "本次修改建议" : "执行要求"}：
${String(payload.instruction || "")}

请严格按 JSON Schema 返回。`;
  }
  if (isImagePromptSkillId(skillId)) {
    const isPhotoreal = skillId === "photoreal";
    const isNanoBanana = skillId === "nanobanana";
    const imageModeRules = isNanoBanana ? nanoBananaModeRules : gptImageModeRules;
    const imageReadingOrder = isNanoBanana
      ? "开始生成前，严格按 models.md → nano-banana.md → golden-rules.md → 任务相关参考文档的顺序读取。"
      : "开始生成前，严格按 models.md → gpt-image.md → golden-rules.md → 任务相关参考文档的顺序读取。";
    const skillBinding = isPhotoreal ? `${skill.label} skill` : `Image skill 的 ${skill.label} 适配规则`;
    return `本任务必须且只能使用已经加载到当前 Agent 上下文中的 ${skillBinding}。${isPhotoreal ? "开始生成前先读 reference-library.md，再按场景只读一个相关分类文件，并遵循结构与透视优先于风格修饰的原则。" : imageReadingOrder}不要调用其他 skill。

${isPhotoreal ? photorealModeRules : imageModeRules}

硬性要求：
1. ${skill.safetyInstruction}
2. 最终可复制内容完整放入 JSON 的 prompt 字段，不要在 JSON 外附加 Markdown 或解释。
3. 严格使用用户已连接的 @图片N；没有连接的编号不得虚构，也不得把附件顺序误当成素材编号。
4. ${isPhotoreal ? "参考图库只用于提取机位、空间、光线、接触和使用逻辑；不得复刻人物身份、品牌、文字或独特装饰组合。" : "按图像的目标用途、文字渲染、编辑、角色一致性、结构参考或行业类型读取对应 reference，不能只根据 SKILL.md 猜测规则。"}
5. 生成规格中的画幅是用户偏好；如所选模型存在尺寸限制，应给出最接近且有效的尺寸，并在 Notes 中说明。
6. title 用12字以内概括结果；changes 用一句中文概括本次生成或修改。

生成规格：
${spec}

参考素材附件映射：
${attachmentMap}

${isRevision ? "当前完整提示词" : "用户原始需求"}：
${String(payload.prompt || "")}

${isRevision ? "本次修改建议" : "执行要求"}：
${String(payload.instruction || "")}

请严格按 JSON Schema 返回。`;
  }

  return `本任务必须且只能使用已经加载到当前 Agent 上下文中的 Seedance skill。开始生成前，严格遵循其中与 Seedance2 视频提示词、参考图编号、镜头连续性、时间线和质量自检有关的规则。不要调用其他 skill。

${seedanceModeRules}

硬性要求：
1. 最终 prompt 不拆分正向/负向关键词，不附解释、标题或 Markdown。
2. 严格使用用户已连接的 @图片N / @视频N 编号；没有连接的编号不得虚构。
3. 参考素材按下面的附件映射读取，不得把附件顺序误当成素材编号。同一 @视频N 的多张附件是按时间顺序提取的视频帧，用于理解动作、镜头和节奏。
4. 时长、画幅和参考模式来自生成规格。
5. 保留用户的镜头、动作、物理、人物、面部、产品稳定性和声音要求，不虚构品牌、产品功能或画面文字。
6. 视频帧只是 ${agentName} 的视觉分析代理；最终 prompt 必须继续写 @视频N，不得改写成 @图片N 或“附件N”。
7. title 用12字以内概括结果；changes 用一句中文概括本次生成。

生成规格：
${spec}

参考素材附件映射：
${attachmentMap}

${isRevision ? "当前完整提示词" : "用户原始需求"}：
${String(payload.prompt || "")}

${isRevision ? "本次修改建议" : "执行要求"}：
${String(payload.instruction || "")}

请严格按 JSON Schema 返回。`;
}

async function decodeRemoteMedia(url, expectedKind, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`远程${expectedKind === "image" ? "图片" : "视频"}下载失败（HTTP ${response.status}）`);
  const mime = String(response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!mime.startsWith(`${expectedKind}/`)) throw new Error(`远程素材不是有效的${expectedKind === "image" ? "图片" : "视频"}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const limit = expectedKind === "image" ? 15 * 1024 * 1024 : 50 * 1024 * 1024;
  if (buffer.length > limit) throw new Error(`远程${expectedKind === "image" ? "图片" : "视频"}超过 ${expectedKind === "image" ? 15 : 50}MB`);
  const subtype = mime.split("/")[1]?.replace("quicktime", "mov").replace("jpeg", "jpg").split("+")[0];
  return { buffer, extension: `.${subtype || (expectedKind === "image" ? "png" : "mp4")}` };
}

async function decodeImageData(dataUrl, signal) {
  if (/^https?:\/\//i.test(String(dataUrl || ""))) return decodeRemoteMedia(dataUrl, "image", signal);
  const match = String(dataUrl || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!match) throw new Error("参考图片数据无效");
  const mime = match[1].toLowerCase();
  const extensions = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
  };
  return { buffer: Buffer.from(match[2], "base64"), extension: extensions[mime] || ".png" };
}

async function decodeVideoData(dataUrl, signal) {
  if (/^https?:\/\//i.test(String(dataUrl || ""))) return decodeRemoteMedia(dataUrl, "video", signal);
  const match = String(dataUrl || "").match(/^data:(video\/(?:mp4|webm|quicktime|x-m4v));base64,([\s\S]+)$/i);
  if (!match) throw new Error("参考视频数据无效，请使用 MP4、WebM、MOV 或 M4V");
  const mime = match[1].toLowerCase();
  const extensions = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "video/x-m4v": ".m4v",
  };
  return { buffer: Buffer.from(match[2], "base64"), extension: extensions[mime] };
}

function runProcess(command, args, timeout = 60_000, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal.reason));
      return;
    }
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let aborted = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", handleAbort);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    };
    const handleAbort = () => {
      aborted = true;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout);
    signal?.addEventListener("abort", handleAbort, { once: true });

    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-20_000); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-20_000); });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (aborted) {
        finish(abortError(signal?.reason));
        return;
      }
      if (timedOut) finish(new Error(`${command} 处理超时`));
      else if (code !== 0) finish(new Error(stderr.trim() || `${command} 退出码：${code}`));
      else finish(null);
    });
  });
}

async function probeVideoDuration(path, signal) {
  try {
    const { stdout } = await runProcess(process.env.FFPROBE_PATH || "ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      path,
    ], 15_000, signal);
    const duration = Number.parseFloat(stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch (error) {
    if (isAbortError(error)) throw error;
    return 0;
  }
}

async function extractVideoFrames(video, directory, videoPath, signal) {
  throwIfAborted(signal);
  const duration = await probeVideoDuration(videoPath, signal);
  const interval = duration ? Math.max(duration / 4, 0.2) : 2;
  const prefix = `video-${video.slot}-frame-`;
  const pattern = join(directory, `${prefix}%02d.jpg`);
  try {
    await runProcess(process.env.FFMPEG_PATH || "ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", videoPath,
      "-an",
      "-vf", `fps=1/${interval.toFixed(6)},scale=min(1280\\,iw):-2`,
      "-frames:v", "4",
      "-q:v", "2",
      pattern,
    ], 60_000, signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    if (/ENOENT|not found|cannot find/i.test(detail)) {
      throw new Error("未找到 ffmpeg，请先安装 ffmpeg 并加入 PATH");
    }
    throw new Error(`${video.marker} 无法读取或提取关键帧，请换用标准 MP4、WebM、MOV 或 M4V 文件：${detail}`);
  }

  const framePaths = (await readdir(directory))
    .filter((name) => name.startsWith(prefix) && name.endsWith(".jpg"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .slice(0, 4)
    .map((name) => join(directory, name));
  if (!framePaths.length) {
    throw new Error(`${video.marker} 未能提取可用画面，请检查视频编码后重试`);
  }
  return framePaths;
}

async function cleanupMedia(directory, paths = []) {
  const files = new Set(paths);
  if (directory) {
    try {
      for (const name of await readdir(directory)) files.add(join(directory, name));
    } catch {
      // The directory may already be gone.
    }
  }
  for (const path of files) await unlink(path).catch(() => {});
  if (directory) await rmdir(directory).catch(() => {});
}

async function materializeMedia(images, videos, signal) {
  if (!images.length && !videos.length) return { directory: null, paths: [], attachments: [] };
  throwIfAborted(signal);
  const directory = await mkdtemp(join(tmpdir(), "prompt-flow-"));
  const paths = [];
  const attachments = [];
  try {
    for (const image of images) {
      throwIfAborted(signal);
      const { buffer, extension } = await decodeImageData(image.dataUrl, signal);
      if (buffer.length > 15 * 1024 * 1024) throw new Error(`${image.marker} 超过 15MB`);
      if (!buffer.length) throw new Error(`${image.marker} 没有可读取的图片数据`);
      const path = join(directory, `image-${image.slot}${extension}`);
      await writeFile(path, buffer);
      paths.push(path);
      attachments.push({ path, marker: image.marker, fileName: image.fileName, kind: "image" });
    }

    for (const video of videos) {
      throwIfAborted(signal);
      const { buffer, extension } = await decodeVideoData(video.dataUrl, signal);
      if (buffer.length > 50 * 1024 * 1024) throw new Error(`${video.marker} 超过 50MB`);
      if (!buffer.length) throw new Error(`${video.marker} 没有可读取的视频数据`);
      const videoPath = join(directory, `video-${video.slot}${extension}`);
      await writeFile(videoPath, buffer);
      paths.push(videoPath);
      const framePaths = await extractVideoFrames(video, directory, videoPath, signal);
      paths.push(...framePaths);
      for (const [index, path] of framePaths.entries()) {
        attachments.push({
          path,
          marker: video.marker,
          fileName: video.fileName,
          kind: "video",
          frameIndex: index + 1,
          frameCount: framePaths.length,
        });
      }
    }
    return { directory, paths, attachments };
  } catch (error) {
    await cleanupMedia(directory, paths);
    throw error;
  }
}

function normalizeReference(media, markerName, maxSlot) {
  const markerMatch = String(media?.marker || "").match(new RegExp(`^@${markerName}(\\d+)$`));
  const markerSlot = markerMatch ? Number(markerMatch[1]) : null;
  const slot = markerSlot && markerSlot <= maxSlot
    ? markerSlot
    : Number.isInteger(media?.slot) && media.slot >= 1 && media.slot <= maxSlot
      ? media.slot
      : null;
  return slot ? { ...media, slot, marker: `@${markerName}${slot}` } : null;
}

function stage(onStage, value, signal) {
  throwIfAborted(signal);
  onStage?.(value);
}

function normalizeProvider(value) {
  const provider = String(value || "codex").trim().toLowerCase();
  if (
    provider !== "codex"
    && provider !== OPENROUTER_PROVIDER_ID
    && provider !== GROK_BUILD_PROVIDER_ID
    && provider !== ANTIGRAVITY_PROVIDER_ID
    && provider !== COMFLY_LLM_PROVIDER_ID
  ) {
    throw new HttpError(400, `不支持的 Agent 服务：${provider}`);
  }
  return provider;
}

function providerLabel(provider) {
  if (provider === OPENROUTER_PROVIDER_ID) return "OpenRouter";
  if (provider === GROK_BUILD_PROVIDER_ID) return "Grok Build";
  if (provider === ANTIGRAVITY_PROVIDER_ID) return "Antigravity";
  if (provider === COMFLY_LLM_PROVIDER_ID) return "Comfly";
  return "Codex";
}

async function providerModels(provider) {
  if (provider === OPENROUTER_PROVIDER_ID) return getOpenRouterModels();
  if (provider === GROK_BUILD_PROVIDER_ID) return getGrokBuildModels();
  if (provider === ANTIGRAVITY_PROVIDER_ID) return getAntigravityModels();
  if (provider === COMFLY_LLM_PROVIDER_ID) return getComflyLlmModels();
  return getCodexModels();
}

function assertProviderThread(provider, threadId) {
  if (!threadId) return;
  const value = String(threadId);
  const isOpenRouterSession = value.startsWith("openrouter:");
  const isGrokBuildSession = value.startsWith(GROK_BUILD_SESSION_PREFIX);
  const isAntigravitySession = value.startsWith(ANTIGRAVITY_SESSION_PREFIX);
  const isComflySession = value.startsWith(COMFLY_LLM_SESSION_PREFIX);
  if (provider === OPENROUTER_PROVIDER_ID && !isOpenRouterSession) {
    throw new HttpError(400, "该会话属于其他 Agent，不能交给 OpenRouter 继续执行");
  }
  if (provider === GROK_BUILD_PROVIDER_ID && !isGrokBuildSession) {
    throw new HttpError(400, "该会话属于其他 Agent，不能交给 Grok Build 继续执行");
  }
  if (provider === ANTIGRAVITY_PROVIDER_ID && !isAntigravitySession) {
    throw new HttpError(400, "该会话属于其他 Agent，不能交给 Antigravity 继续执行");
  }
  if (provider === COMFLY_LLM_PROVIDER_ID && !isComflySession) {
    throw new HttpError(400, "该会话属于其他 Agent，不能交给 Comfly 继续执行");
  }
  if (provider === "codex" && (isOpenRouterSession || isGrokBuildSession || isAntigravitySession || isComflySession)) {
    throw new HttpError(400, "该会话属于其他 Agent，不能交给 Codex 继续执行");
  }
}

async function executeRefine(payload, { signal, onStage } = {}) {
  let temporary = { directory: null, paths: [], attachments: [] };
  const provider = normalizeProvider(payload?.provider);
  const skillId = normalizePromptSkillId(payload?.skillId);
  const skill = promptSkillDefinition(skillId);
  const skillPath = skillPaths[skillId];
  assertProviderThread(provider, payload?.threadId);
  stage(onStage, "validating", signal);
  if (!isPromptSkillDisabled(skillId) && !skillPath) {
    throw new HttpError(503, `未找到本机 ${skill.label} skill，已阻止普通改写`);
  }
  if (typeof payload?.prompt !== "string" || !payload.prompt.trim()) {
    throw new HttpError(400, "请先输入创作需求或待修改的提示词");
  }
  if (payload.prompt.length > 20_000) {
    throw new HttpError(400, "提示词过长，最多允许 20000 个字符");
  }
  if (payload.taskMode === "revision" && (typeof payload.instruction !== "string" || !payload.instruction.trim())) {
    throw new HttpError(400, "请先输入修改建议");
  }

  const rawImages = Array.isArray(payload.images) ? payload.images.filter((image) => image?.dataUrl) : [];
  const rawVideos = Array.isArray(payload.videos) ? payload.videos.filter((video) => video?.dataUrl) : [];
  if (rawImages.length > 9) throw new HttpError(400, `${skill.label} 最多连接 9 张参考图片`);
  if (isImagePromptSkillId(skillId) && rawVideos.length) throw new HttpError(400, `${skill.label} skill 只支持参考图片，请断开参考视频`);
  if (rawVideos.length > 3) throw new HttpError(400, "Seedance 最多连接 3 个参考视频");
  if (rawImages.length + rawVideos.length > 12) throw new HttpError(400, "图片和视频参考素材合计最多 12 个");

  const images = rawImages.map((image) => normalizeReference(image, "图片", 9));
  const videos = rawVideos.map((video) => normalizeReference(video, "视频", 3));
  if (images.some((image) => !image)) throw new HttpError(400, "参考图片编号必须是 @图片1 至 @图片9");
  if (videos.some((video) => !video)) throw new HttpError(400, "参考视频编号必须是 @视频1 至 @视频3");
  if (new Set(images.map((image) => image.slot)).size !== images.length
    || new Set(videos.map((video) => video.slot)).size !== videos.length) {
    throw new HttpError(400, "参考素材编号不能重复");
  }
  images.sort((a, b) => a.slot - b.slot);
  videos.sort((a, b) => a.slot - b.slot);

  if (provider === OPENROUTER_PROVIDER_ID && !openRouterConfigured()) {
    throw new HttpError(503, "OpenRouter 尚未配置，请先在 .env.local 中设置 OPENROUTER_API_KEY 并重启画板");
  }
  if (provider === COMFLY_LLM_PROVIDER_ID && !comflyLlmConfigured()) {
    throw new HttpError(503, "Comfly 尚未配置，请先在 .env.local 中设置 COMFLY_LLM_API_KEY 或 COMFLY_API_KEY 并重启画板");
  }
  if (provider === GROK_BUILD_PROVIDER_ID) {
    const status = await getGrokBuildStatus();
    if (!status.ready) throw new HttpError(503, status.message || "Grok Build 尚未登录");
  }
  if (provider === ANTIGRAVITY_PROVIDER_ID) {
    const status = await getAntigravityStatus();
    if (!status.ready) throw new HttpError(503, status.message || "Antigravity 尚未登录");
  }
  const models = await providerModels(provider);
  throwIfAborted(signal);
  const selectedModel = payload.model
    ? models.find((model) => model.model === payload.model || model.id === payload.model)
    : models.find((model) => model.isDefault) || models[0];
  if (!selectedModel) {
    throw new HttpError(400, `所选 ${providerLabel(provider)} 模型当前不可用，请刷新模型列表`);
  }
  const supportedEfforts = (selectedModel.supportedReasoningEfforts || []).map((option) => option.reasoningEffort);
  const reasoningEffort = String(payload.reasoningEffort || selectedModel.defaultReasoningEffort || "medium");
  if (supportedEfforts.length && !supportedEfforts.includes(reasoningEffort)) {
    throw new HttpError(400, `${selectedModel.displayName || selectedModel.model} 不支持 ${reasoningEffort} 思考强度`);
  }
  if ((images.length || videos.length) && !selectedModel.inputModalities?.includes("image")) {
    throw new HttpError(400, `${selectedModel.displayName || selectedModel.model} 不能读取参考图片或视频帧`);
  }

  stage(onStage, "preparing_media", signal);
  try {
    temporary = await materializeMedia(images, videos, signal);
    if (provider === OPENROUTER_PROVIDER_ID) {
      stage(onStage, "openrouter", signal);
      const runController = new AbortController();
      let runTimedOut = false;
      const relayAbort = () => runController.abort(signal?.reason);
      if (signal?.aborted) relayAbort();
      else signal?.addEventListener("abort", relayAbort, { once: true });
      const timer = setTimeout(() => {
        runTimedOut = true;
        runController.abort("OpenRouter 处理超过 10 分钟，已停止");
      }, CODEX_RUN_TIMEOUT_MS);
      try {
        let result;
        try {
          result = await runOpenRouterRefine({
            model: selectedModel.model,
            reasoningEffort,
            textPrompt: buildInstruction(payload, temporary.attachments, provider),
            attachments: temporary.attachments,
            outputSchema,
            skillId,
            skillPath,
            threadId: payload.threadId,
            signal: runController.signal,
            timeoutMs: CODEX_RUN_TIMEOUT_MS,
          });
        } catch (error) {
          if (signal?.aborted) throw abortError(signal.reason);
          if (runTimedOut) throw new Error("OpenRouter 处理超过 10 分钟，已停止；可降低思考强度后重试");
          throw error;
        }
        throwIfAborted(signal);
        stage(onStage, "writing", signal);
        return {
          ...result,
          model: selectedModel.model,
          reasoningEffort,
          provider,
        };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", relayAbort);
      }
    }
    if (provider === COMFLY_LLM_PROVIDER_ID) {
      stage(onStage, COMFLY_LLM_PROVIDER_ID, signal);
      const runController = new AbortController();
      let runTimedOut = false;
      const relayAbort = () => runController.abort(signal?.reason);
      if (signal?.aborted) relayAbort();
      else signal?.addEventListener("abort", relayAbort, { once: true });
      const timer = setTimeout(() => {
        runTimedOut = true;
        runController.abort("Comfly 处理超过 10 分钟，已停止");
      }, CODEX_RUN_TIMEOUT_MS);
      try {
        let result;
        try {
          result = await runComflyLlmRefine({
            model: selectedModel.model,
            reasoningEffort,
            textPrompt: buildInstruction(payload, temporary.attachments, provider),
            attachments: temporary.attachments,
            outputSchema,
            skillId,
            skillPath,
            threadId: payload.threadId,
            signal: runController.signal,
            timeoutMs: CODEX_RUN_TIMEOUT_MS,
          });
        } catch (error) {
          if (signal?.aborted) throw abortError(signal.reason);
          if (runTimedOut) throw new Error("Comfly 处理超过 10 分钟，已停止；可更换模型后重试");
          throw error;
        }
        throwIfAborted(signal);
        stage(onStage, "writing", signal);
        return {
          ...result,
          model: selectedModel.model,
          reasoningEffort,
          provider,
        };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", relayAbort);
      }
    }
    if (provider === ANTIGRAVITY_PROVIDER_ID) {
      stage(onStage, ANTIGRAVITY_PROVIDER_ID, signal);
      const runController = new AbortController();
      let runTimedOut = false;
      const relayAbort = () => runController.abort(signal?.reason);
      if (signal?.aborted) relayAbort();
      else signal?.addEventListener("abort", relayAbort, { once: true });
      const timer = setTimeout(() => {
        runTimedOut = true;
        runController.abort("Antigravity 处理超过 10 分钟，已停止");
      }, CODEX_RUN_TIMEOUT_MS);
      try {
        let result;
        try {
          result = await runAntigravityRefine({
            model: selectedModel.model,
            reasoningEffort,
            textPrompt: buildInstruction(payload, temporary.attachments, provider),
            attachments: temporary.attachments,
            outputSchema,
            skillId,
            skillPath,
            threadId: payload.threadId,
            signal: runController.signal,
            timeoutMs: CODEX_RUN_TIMEOUT_MS,
          });
        } catch (error) {
          if (signal?.aborted) throw abortError(signal.reason);
          if (runTimedOut) throw new Error("Antigravity 处理超过 10 分钟，已停止；可降低思考强度后重试");
          throw error;
        }
        throwIfAborted(signal);
        stage(onStage, "writing", signal);
        return {
          ...result,
          model: selectedModel.model,
          reasoningEffort,
          provider,
        };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", relayAbort);
      }
    }
    if (provider === GROK_BUILD_PROVIDER_ID) {
      stage(onStage, GROK_BUILD_PROVIDER_ID, signal);
      const runController = new AbortController();
      let runTimedOut = false;
      const relayAbort = () => runController.abort(signal?.reason);
      if (signal?.aborted) relayAbort();
      else signal?.addEventListener("abort", relayAbort, { once: true });
      const timer = setTimeout(() => {
        runTimedOut = true;
        runController.abort("Grok Build 处理超过 10 分钟，已停止");
      }, CODEX_RUN_TIMEOUT_MS);
      try {
        let result;
        try {
          result = await runGrokBuildRefine({
            model: selectedModel.model,
            reasoningEffort,
            textPrompt: buildInstruction(payload, temporary.attachments, provider),
            attachments: temporary.attachments,
            outputSchema,
            skillId,
            skillPath,
            threadId: payload.threadId,
            signal: runController.signal,
            timeoutMs: CODEX_RUN_TIMEOUT_MS,
          });
        } catch (error) {
          if (signal?.aborted) throw abortError(signal.reason);
          if (runTimedOut) throw new Error("Grok Build 处理超过 10 分钟，已停止；可降低思考强度后重试");
          throw error;
        }
        throwIfAborted(signal);
        stage(onStage, "writing", signal);
        return {
          ...result,
          model: selectedModel.model,
          reasoningEffort,
          provider,
        };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", relayAbort);
      }
    }
    stage(onStage, "codex", signal);
    const options = {
      model: selectedModel.model,
      workingDirectory: projectRoot,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      modelReasoningEffort: reasoningEffort,
    };
    const codex = codexClients[skillId];
    const thread = payload.threadId ? codex.resumeThread(payload.threadId, options) : codex.startThread(options);
    const runController = new AbortController();
    let runTimedOut = false;
    const relayAbort = () => runController.abort(signal?.reason);
    if (signal?.aborted) relayAbort();
    else signal?.addEventListener("abort", relayAbort, { once: true });
    const timer = setTimeout(() => {
      runTimedOut = true;
      runController.abort(CODEX_TIMEOUT_MESSAGE);
    }, CODEX_RUN_TIMEOUT_MS);
    try {
      const textPrompt = buildInstruction(payload, temporary.attachments, provider);
      const input = temporary.attachments.length
        ? [{ type: "text", text: textPrompt }, ...temporary.attachments.map(({ path }) => ({ type: "local_image", path }))]
        : textPrompt;
      let result;
      try {
        result = await thread.run(input, { outputSchema, signal: runController.signal });
      } catch (error) {
        if (signal?.aborted) throw abortError(signal.reason);
        if (runTimedOut) throw new CodexTimeoutError();
        throw error;
      }
      throwIfAborted(signal);
      stage(onStage, "writing", signal);
      const parsed = validateStructuredResult(result.finalResponse);
      return {
        ...parsed,
        threadId: thread.id,
        usage: result.usage,
        skill: !isPromptSkillDisabled(skillId),
        skillId,
        skillHash: null,
        seedanceSkill: skillId === "seedance",
        seedanceSkillId: skillId === "seedance" ? skillId : undefined,
        model: selectedModel.model,
        reasoningEffort,
        provider,
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", relayAbort);
    }
  } finally {
    await cleanupMedia(temporary.directory, temporary.paths);
  }
}

function taskSummary(task) {
  const summary = {
    id: task.id,
    projectId: task.projectId ?? null,
    kind: task.kind,
    title: task.title,
    status: task.status,
    stage: task.stage,
    createdAt: task.createdAt,
    provider: task.provider || "codex",
    skillId: task.skillId,
    model: task.model,
    reasoningEffort: task.reasoningEffort,
    sourceNodeId: task.sourceNodeId,
    outputNodeIds: [...task.outputNodeIds],
    origin: task.origin || "ui",
  };
  if (task.canvasRevision) summary.canvasRevision = task.canvasRevision;
  if (task.startedAt) summary.startedAt = task.startedAt;
  if (task.finishedAt) summary.finishedAt = task.finishedAt;
  if (task.result) summary.result = task.result;
  if (task.error) summary.error = task.error;
  return summary;
}

function sortedTaskSummaries() {
  return [...taskRecords.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(taskSummary);
}

function writeTaskEvent(response, event) {
  if (!response.destroyed && !response.writableEnded) response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function broadcastTaskEvent(event) {
  for (const response of taskEventClients) {
    try { writeTaskEvent(response, event); }
    catch { taskEventClients.delete(response); }
  }
}

function broadcastProjectEvent(event) {
  for (const response of projectEventClients) {
    try { writeTaskEvent(response, event); }
    catch { projectEventClients.delete(response); }
  }
}

function persistedTaskSnapshot() {
  return {
    version: 1,
    concurrency: taskConcurrency,
    tasks: sortedTaskSummaries().slice(0, 20),
  };
}

function persistTasks() {
  const snapshot = persistedTaskSnapshot();
  persistTasksPromise = persistTasksPromise
    .catch(() => {})
    .then(async () => {
      await mkdir(dataDirectory, { recursive: true });
      await atomicWrite(taskStorePath, snapshot);
    })
    .catch((error) => console.error("Persist task history failed:", error));
  return persistTasksPromise;
}

function updateTask(task, updates, { broadcast = true } = {}) {
  Object.assign(task, updates);
  const summary = taskSummary(task);
  if (broadcast) broadcastTaskEvent({ type: "task", task: summary });
  void persistTasks();
  return summary;
}

function pruneTaskHistory() {
  const finished = [...taskRecords.values()]
    .filter((task) => finishedTaskStatuses.has(task.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const task of finished.slice(20)) taskRecords.delete(task.id);
}

function taskErrorMessage(error) {
  const message = error instanceof Error ? error.message : "Codex 调用失败";
  if (message.includes("login")) return "本机 Codex 尚未登录，请先运行 codex login";
  return message;
}

async function attachSavedMedia(result, kind, taskId, signal) {
  const field = kind === "image" ? "images" : "videos";
  try {
    const saved = await saveGeneratedMedia(kind, result?.[field], { taskId, signal });
    return {
      ...result,
      [field]: saved.items,
      savedFiles: saved.savedFiles,
      outputDirectory: saved.directory,
    };
  } catch (error) {
    return {
      ...result,
      savedFiles: [],
      saveError: error instanceof Error ? error.message : "自动保存生成媒体失败",
    };
  }
}

async function backfillCompletedMediaOutputs() {
  for (const task of taskRecords.values()) {
    if (task.status !== "completed" || (task.kind !== "image-generation" && task.kind !== "video-generation")) continue;
    if (task.result?.savedFiles?.length) continue;
    const kind = task.kind === "image-generation" ? "image" : "video";
    const field = kind === "image" ? "images" : "videos";
    if (!Array.isArray(task.result?.[field]) || !task.result[field].length) continue;
    const result = await attachSavedMedia(task.result, kind, task.id);
    updateTask(task, { result });
  }
  await persistTasks();
}

async function persistAutomationTaskOutcome(task) {
  if (!task.persistResult || !task.projectId || (task.status !== "completed" && task.status !== "failed")) return;
  try {
    const saved = await projectStore.mutateProject(
      task.projectId,
      (project) => applyTaskResultToProject(project, task),
      { actor: "automation-task", transactionId: `task:${task.id}` },
    );
    updateTask(task, { canvasRevision: saved.revision });
  } catch (error) {
    updateTask(task, {
      result: {
        ...(task.result || {}),
        canvasSaveError: error instanceof Error ? error.message : "任务结果无法写回画布",
      },
    });
  }
}

function startTask(task) {
  const payload = taskPayloads.get(task.id);
  if (task.status !== "queued") return false;
  if (!payload) {
    updateTask(task, {
      status: "failed",
      stage: "failed",
      finishedAt: new Date().toISOString(),
      error: "任务数据缺失，无法开始；请重试",
    });
    pruneTaskHistory();
    return false;
  }
  const controller = new AbortController();
  taskControllers.set(task.id, controller);
  runningTaskIds.add(task.id);
  updateTask(task, { status: "running", stage: "validating", startedAt: new Date().toISOString() });

  void (async () => {
    try {
      const onStage = (nextStage) => {
        if (task.status === "running" && task.stage !== nextStage) updateTask(task, { stage: nextStage });
      };
      let result;
      if (task.kind === "image-generation") {
        onStage("image-generation");
        result = await runImageGeneration(payload, { signal: controller.signal });
        onStage("writing");
        result = await attachSavedMedia(result, "image", task.id, controller.signal);
      } else if (task.kind === "video-generation") {
        onStage("video-generation");
        result = await runVideoGeneration(payload, { signal: controller.signal });
        onStage("writing");
        result = await attachSavedMedia(result, "video", task.id, controller.signal);
      } else {
        result = await executeRefine(payload, { signal: controller.signal, onStage });
      }
      if (controller.signal.aborted || task.status === "cancelled") throw abortError(controller.signal.reason);
      const mediaResult = task.kind === "image-generation"
        ? {
            images: result.images,
            resolution: result.resolution,
            aspectRatio: result.aspectRatio,
            usage: result.usage,
            savedFiles: result.savedFiles,
            outputDirectory: result.outputDirectory,
            saveError: result.saveError,
          }
        : task.kind === "video-generation"
          ? {
              videos: result.videos,
              mode: result.mode,
              duration: result.duration,
              resolution: result.resolution,
              aspectRatio: result.aspectRatio,
              jobId: result.jobId,
              credit: result.credit,
              usage: result.usage,
              savedFiles: result.savedFiles,
              outputDirectory: result.outputDirectory,
              saveError: result.saveError,
            }
          : null;
      updateTask(task, {
        status: "completed",
        stage: "completed",
        finishedAt: new Date().toISOString(),
        provider: result.provider || task.provider || "codex",
        model: result.model || task.model,
        reasoningEffort: result.reasoningEffort || task.reasoningEffort,
        result: mediaResult || {
          prompt: result.prompt,
          changes: result.changes,
          title: result.title,
          threadId: result.threadId,
          usage: result.usage,
          provider: result.provider || task.provider || "codex",
          skill: result.skill,
          skillId: result.skillId || task.skillId || "seedance",
          skillHash: result.skillHash,
          seedanceSkill: result.seedanceSkill,
          seedanceSkillId: result.seedanceSkillId,
          seedanceSkillHash: result.seedanceSkillHash,
          sessionMode: result.sessionMode,
          model: result.model,
          reasoningEffort: result.reasoningEffort,
        },
      });
      await persistAutomationTaskOutcome(task);
    } catch (error) {
      if (controller.signal.aborted || task.status === "cancelled") {
        if (task.status !== "cancelled") {
          updateTask(task, { status: "cancelled", stage: "cancelled", finishedAt: new Date().toISOString() });
        }
      } else {
        updateTask(task, {
          status: "failed",
          stage: "failed",
          finishedAt: new Date().toISOString(),
          error: taskErrorMessage(error),
        });
        await persistAutomationTaskOutcome(task);
      }
    } finally {
      runningTaskIds.delete(task.id);
      taskControllers.delete(task.id);
      taskPayloads.delete(task.id);
      pruneTaskHistory();
      void persistTasks();
      pumpTasks();
    }
  })();
  return true;
}

function pumpTasks() {
  while (runningTaskIds.size < taskConcurrency) {
    const next = [...taskRecords.values()]
      .filter((task) => task.status === "queued")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!next) break;
    startTask(next);
  }
}

function normalizeTaskMeta(value) {
  const allowedKinds = new Set(["generation", "revision", "image-generation", "video-generation"]);
  if (!value || !allowedKinds.has(value.kind)) {
    throw new HttpError(400, "taskMeta.kind 不受支持");
  }
  if (typeof value.sourceNodeId !== "string" || !value.sourceNodeId.trim()) {
    throw new HttpError(400, "taskMeta.sourceNodeId 不能为空");
  }
  if (!Array.isArray(value.outputNodeIds) || value.outputNodeIds.some((id) => typeof id !== "string")) {
    throw new HttpError(400, "taskMeta.outputNodeIds 必须是字符串数组");
  }
  const rawProjectId = value.projectId;
  if (rawProjectId !== undefined && rawProjectId !== null && typeof rawProjectId !== "string") {
    throw new HttpError(400, "taskMeta.projectId 必须是画布文件 ID 或留空");
  }
  const projectId = typeof rawProjectId === "string" ? rawProjectId.trim() : "";
  if (projectId && !validProjectId(projectId)) {
    throw new HttpError(400, "taskMeta.projectId 不是有效的本地画布文件 ID");
  }
  return {
    projectId: projectId || null,
    kind: value.kind,
    title: String(value.title || (value.kind === "revision" ? "编辑提示词" : value.kind === "image-generation" ? "图片生成" : value.kind === "video-generation" ? "视频生成" : "编辑改写")).trim().slice(0, 80),
    sourceNodeId: value.sourceNodeId.trim(),
    outputNodeIds: [...new Set(value.outputNodeIds.map((id) => id.trim()).filter(Boolean))],
    persistResult: value.persistResult === true,
    origin: value.origin === "automation" ? "automation" : "ui",
  };
}

function enqueueTask(payload) {
  const meta = normalizeTaskMeta(payload.taskMeta);
  const provider = meta.kind === "image-generation"
    ? String(payload.provider || "openrouter").trim().toLowerCase()
    : meta.kind === "video-generation"
      ? String(payload.provider || "openrouter").trim().toLowerCase()
      : normalizeProvider(payload.provider);
  if (meta.kind === "image-generation" && !IMAGE_GENERATION_PROVIDER_IDS.includes(provider)) {
    throw new HttpError(400, `不支持的图片生成供应商：${provider}`);
  }
  if (meta.kind === "video-generation" && !VIDEO_GENERATION_PROVIDER_IDS.includes(provider)) {
    throw new HttpError(400, `不支持的视频生成供应商：${provider}`);
  }
  const skillId = meta.kind === "generation" || meta.kind === "revision" ? normalizePromptSkillId(payload.skillId) : undefined;
  const outputIds = new Set(meta.outputNodeIds);
  const conflict = [...taskRecords.values()].find((task) => (task.status === "queued" || task.status === "running")
    && (task.projectId ?? null) === meta.projectId
    && task.outputNodeIds.some((id) => outputIds.has(id)));
  if (conflict) throw new HttpError(409, `输出节点已有任务：${conflict.title}`);

  const now = new Date().toISOString();
  const task = {
    id: randomUUID(),
    projectId: meta.projectId,
    kind: meta.kind,
    title: meta.title,
    status: "queued",
    stage: "queued",
    createdAt: now,
    provider,
    skillId,
    model: String(payload.model || "default"),
    reasoningEffort: String(payload.reasoningEffort || "default"),
    sourceNodeId: meta.sourceNodeId,
    outputNodeIds: meta.outputNodeIds,
    persistResult: meta.persistResult,
    origin: meta.origin,
  };
  taskRecords.set(task.id, task);
  taskPayloads.set(task.id, { ...payload, provider, ...(skillId ? { skillId } : {}), taskMeta: undefined });
  const summary = updateTask(task, {}, { broadcast: true });
  queueMicrotask(pumpTasks);
  return summary;
}

async function initializeTaskHistory() {
  let stored;
  try { stored = JSON.parse(await readFile(taskStorePath, "utf8")); }
  catch { return; }
  if ([1, 2, 3].includes(stored?.concurrency)) taskConcurrency = stored.concurrency;
  const now = new Date().toISOString();
  for (const item of Array.isArray(stored?.tasks) ? stored.tasks.slice(0, 20) : []) {
    if (!item?.id || taskRecords.has(item.id)) continue;
    const interrupted = item.status === "queued" || item.status === "running";
    const mediaTask = item.kind === "image-generation" || item.kind === "video-generation";
    taskRecords.set(item.id, {
      ...item,
      provider: mediaTask
        ? String(item.provider || "openrouter")
        : item.provider === OPENROUTER_PROVIDER_ID
        ? OPENROUTER_PROVIDER_ID
        : item.provider === GROK_BUILD_PROVIDER_ID
          ? GROK_BUILD_PROVIDER_ID
        : item.provider === ANTIGRAVITY_PROVIDER_ID
          ? ANTIGRAVITY_PROVIDER_ID
          : item.provider === COMFLY_LLM_PROVIDER_ID
            ? COMFLY_LLM_PROVIDER_ID
            : "codex",
      skillId: mediaTask ? undefined : PROMPT_SKILL_IDS.includes(item.skillId) ? item.skillId : "seedance",
      projectId: typeof item.projectId === "string" && validProjectId(item.projectId) ? item.projectId : null,
      status: interrupted ? "failed" : item.status,
      stage: interrupted ? "failed" : item.stage,
      finishedAt: interrupted ? now : item.finishedAt,
      error: interrupted ? "服务重启，任务已中断" : item.error,
      outputNodeIds: Array.isArray(item.outputNodeIds) ? item.outputNodeIds.filter((id) => typeof id === "string") : [],
    });
  }
  void persistTasks();
}

async function handleTaskRequest(request, response, pathname) {
  if (request.method === "GET" && pathname === "/tasks") {
    sendJson(response, 200, { tasks: sortedTaskSummaries(), concurrency: taskConcurrency });
    return true;
  }
  if (request.method === "GET" && pathname === "/tasks/events") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders?.();
    taskEventClients.add(response);
    writeTaskEvent(response, { type: "snapshot", tasks: sortedTaskSummaries(), concurrency: taskConcurrency });
    const heartbeat = setInterval(() => {
      if (response.destroyed || response.writableEnded) return;
      response.write(": heartbeat\n\n");
    }, 15_000);
    const cleanup = () => {
      clearInterval(heartbeat);
      taskEventClients.delete(response);
    };
    request.once("close", cleanup);
    response.once("close", cleanup);
    return true;
  }
  if (request.method === "POST" && pathname === "/tasks") {
    const task = enqueueTask(await readJson(request));
    sendJson(response, 202, { task });
    return true;
  }
  if (request.method === "PATCH" && pathname === "/tasks/config") {
    const value = Number((await readJson(request)).concurrency);
    if (![1, 2, 3].includes(value)) throw new HttpError(400, "concurrency 只能是 1、2 或 3");
    taskConcurrency = value;
    broadcastTaskEvent({ type: "config", concurrency: taskConcurrency });
    void persistTasks();
    pumpTasks();
    sendJson(response, 200, { concurrency: taskConcurrency });
    return true;
  }
  if (request.method === "DELETE" && pathname === "/tasks/completed") {
    let deleted = 0;
    for (const [id, task] of taskRecords) {
      if (!finishedTaskStatuses.has(task.status)) continue;
      taskRecords.delete(id);
      deleted += 1;
    }
    void persistTasks();
    sendJson(response, 200, { deleted, tasks: sortedTaskSummaries() });
    return true;
  }
  const match = pathname.match(/^\/tasks\/([a-f0-9-]+)$/i);
  if (request.method === "GET" && match) {
    const task = taskRecords.get(match[1]);
    if (!task) throw new HttpError(404, "没有找到这个任务");
    sendJson(response, 200, { task: taskSummary(task) });
    return true;
  }
  if (request.method === "DELETE" && match) {
    const task = taskRecords.get(match[1]);
    if (!task) throw new HttpError(404, "没有找到这个任务");
    if (task.status !== "queued" && task.status !== "running") {
      throw new HttpError(409, "任务已经结束，无法取消");
    }
    if (task.status === "queued") taskPayloads.delete(task.id);
    const controller = taskControllers.get(task.id);
    updateTask(task, { status: "cancelled", stage: "cancelled", finishedAt: new Date().toISOString() });
    controller?.abort("用户取消任务");
    if (!controller) pumpTasks();
    sendJson(response, 200, { task: taskSummary(task) });
    return true;
  }
  return false;
}

async function handleDirectRefine(request, response) {
  const controller = new AbortController();
  response.once("close", () => {
    if (!response.writableEnded) controller.abort("客户端已断开");
  });
  try {
    const result = await executeRefine(await readJson(request), { signal: controller.signal });
    if (!response.writableEnded) sendJson(response, 200, result);
  } catch (error) {
    if (response.writableEnded) return;
    const status = error instanceof HttpError ? error.status : isAbortError(error) ? 499 : 500;
    sendJson(response, status, { error: taskErrorMessage(error) });
  }
}

function automationErrorStatus(error) {
  if (error instanceof CanvasStoreError || error instanceof HttpError) return error.status;
  return /不能为空|不支持|无效|必须|最多|需要|没有找到|尚未配置|未配置/.test(String(error?.message || "")) ? 400 : 500;
}

async function hydrateAutomationModel(request) {
  const { payload, taskMeta } = request;
  if (taskMeta.kind === "image-generation") {
    const status = getImageGenerationProviderStatus(payload.provider);
    if (!status.configured) throw new HttpError(400, status.message || `${payload.provider} 尚未配置`);
    const selected = status.models.find((item) => item.model === payload.model) || status.models[0];
    if (!selected) throw new HttpError(400, `${payload.provider} 暂无可用图片模型`);
    payload.model = selected.model;
    const resolutions = selected.supportedResolutions?.length ? selected.supportedResolutions : ["1K", "2K", "4K"];
    if (!resolutions.includes(payload.resolution)) payload.resolution = resolutions[0];
    return request;
  }
  if (taskMeta.kind === "video-generation") {
    const status = await getVideoGenerationProviderStatus(payload.provider);
    if (!status.configured) throw new HttpError(400, status.message || `${payload.provider} 尚未配置`);
    const selected = status.models.find((item) => item.model === payload.model) || status.models[0];
    if (!selected) throw new HttpError(400, `${payload.provider} 暂无可用视频模型`);
    payload.model = selected.model;
    if (selected.supportedResolutions?.length && !selected.supportedResolutions.includes(payload.resolution)) payload.resolution = selected.supportedResolutions[0];
    if (selected.supportedDurations?.length && !selected.supportedDurations.includes(Number(payload.duration))) payload.duration = selected.supportedDurations[0];
    return request;
  }
  const provider = normalizeProvider(payload.provider);
  payload.provider = provider;
  const catalog = await automationPromptCatalog(provider);
  if (!catalog.configured) throw new HttpError(400, catalog.message || `${provider} 尚未配置`);
  const models = catalog.models;
  const selected = models.find((item) => item.model === payload.model || item.id === payload.model)
    || models.find((item) => item.isDefault)
    || models[0];
  if (!selected) throw new HttpError(400, `${provider} 暂无可用文本模型`);
  payload.model = selected.model;
  const efforts = selected.supportedReasoningEfforts || [];
  if (efforts.length && !efforts.some((item) => item.reasoningEffort === payload.reasoningEffort)) {
    payload.reasoningEffort = selected.defaultReasoningEffort || efforts[0].reasoningEffort;
  }
  return request;
}

async function automationPromptCatalog(provider) {
  const id = normalizeProvider(provider);
  if (id === OPENROUTER_PROVIDER_ID && !openRouterConfigured()) {
    return { provider: id, configured: false, models: [], message: "OpenRouter 尚未配置" };
  }
  if (id === COMFLY_LLM_PROVIDER_ID && !comflyLlmConfigured()) {
    return { provider: id, configured: false, models: [], message: "Comfly 提示词通道尚未配置" };
  }
  if (id === GROK_BUILD_PROVIDER_ID) {
    const status = await getGrokBuildStatus();
    return { provider: id, configured: status.ready, models: status.ready ? status.models : [], message: status.message };
  }
  if (id === ANTIGRAVITY_PROVIDER_ID) {
    const status = await getAntigravityStatus();
    return { provider: id, configured: status.ready, models: status.ready ? status.models : [], message: status.message };
  }
  return { provider: id, configured: true, models: await providerModels(id) };
}

async function automationModelCatalog(kind, provider) {
  const normalizedKind = String(kind || "prompt").trim().toLowerCase();
  if (normalizedKind === "image") {
    const id = String(provider || "openrouter").trim().toLowerCase();
    if (!IMAGE_GENERATION_PROVIDER_IDS.includes(id)) throw new HttpError(400, `不支持的图片生成供应商：${id}`);
    return getImageGenerationProviderStatus(id);
  }
  if (normalizedKind === "video") {
    const id = String(provider || "openrouter").trim().toLowerCase();
    if (!VIDEO_GENERATION_PROVIDER_IDS.includes(id)) throw new HttpError(400, `不支持的视频生成供应商：${id}`);
    return getVideoGenerationProviderStatus(id);
  }
  return automationPromptCatalog(provider);
}

const automationMediaTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
};

async function attachAutomationMedia(projectId, payload) {
  const filePath = resolve(String(payload.filePath || ""));
  if (!isAbsolute(filePath) || !String(payload.filePath || "").trim()) throw new HttpError(400, "filePath 必须是绝对路径");
  const mediaType = automationMediaTypes[extname(filePath).toLowerCase()];
  if (!mediaType) throw new HttpError(400, "只支持常见图片或视频文件");
  const info = await stat(filePath);
  if (!info.isFile()) throw new HttpError(400, "filePath 不是文件");
  const maxBytes = mediaType.startsWith("image/") ? 20 * 1024 * 1024 : 200 * 1024 * 1024;
  if (info.size > maxBytes) throw new HttpError(400, `${mediaType.startsWith("image/") ? "图片" : "视频"}文件过大`);
  const dataUrl = `data:${mediaType};base64,${(await readFile(filePath)).toString("base64")}`;
  const saved = await projectStore.mutateProject(projectId, (project) => {
    const index = project.nodes.findIndex((node) => node.id === payload.nodeId);
    if (index < 0) throw new CanvasStoreError(404, "没有找到目标节点", "NODE_NOT_FOUND");
    const node = project.nodes[index];
    const expectedType = mediaType.startsWith("image/") ? "reference" : "video";
    if (node.type !== expectedType) throw new HttpError(400, `${expectedType === "reference" ? "图片" : "视频"}文件必须写入对应媒体节点`);
    const data = { ...node.data, fileName: basename(filePath) };
    if (expectedType === "reference") {
      data.imageData = dataUrl;
      delete data.generatedImages;
      delete data.imageError;
    } else {
      data.videoData = dataUrl;
      delete data.generatedVideos;
      delete data.videoGenerationError;
    }
    project.nodes[index] = { ...node, data };
    return project;
  }, {
    expectedRevision: payload.expectedRevision,
    actor: "automation",
    transactionId: payload.transactionId || `media:${randomUUID()}`,
  });
  return { project: compactCanvasProject(saved), node: compactCanvasProject(saved).nodes.find((node) => node.id === payload.nodeId) };
}

async function handleProjectEvents(request, response, pathname) {
  if (request.method !== "GET" || pathname !== "/projects/events") return false;
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders?.();
  projectEventClients.add(response);
  writeTaskEvent(response, { type: "ready", at: new Date().toISOString() });
  const heartbeat = setInterval(() => {
    if (!response.destroyed && !response.writableEnded) response.write(": heartbeat\n\n");
  }, 15_000);
  const cleanup = () => {
    clearInterval(heartbeat);
    projectEventClients.delete(response);
  };
  request.once("close", cleanup);
  response.once("close", cleanup);
  return true;
}

async function handleAutomationRequest(request, response, requestUrl) {
  const { pathname } = requestUrl;
  if (!pathname.startsWith("/automation")) return false;

  if (request.method === "GET" && pathname === "/automation/status") {
    sendJson(response, 200, {
      ready: true,
      name: "Agent Canvas",
      version: "0.1.0",
      canvasUrl: "http://127.0.0.1:4173",
      bridgeUrl: `http://127.0.0.1:${PORT}`,
      projects: (await listProjects()).length,
      capabilities: automationCapabilities(),
    });
    return true;
  }
  if (request.method === "GET" && pathname === "/automation/capabilities") {
    sendJson(response, 200, automationCapabilities());
    return true;
  }
  if (request.method === "GET" && pathname === "/automation/projects") {
    sendJson(response, 200, { projects: await listProjects() });
    return true;
  }
  if (request.method === "POST" && pathname === "/automation/projects") {
    const payload = await readJson(request);
    const id = String(payload.id || randomUUID());
    const base = { id, name: normalizeCanvasProjectName(payload.name), nodes: [], edges: [] };
    const prepared = payload.presetId
      ? applyCanvasOperations(base, [{ op: "apply_preset", presetId: payload.presetId, position: payload.position }]).project
      : base;
    const created = await projectStore.createProject({ id, name: prepared.name, nodes: prepared.nodes, edges: prepared.edges, actor: "automation" });
    sendJson(response, 201, { project: compactCanvasProject(created) });
    return true;
  }
  if (request.method === "GET" && pathname === "/automation/models") {
    sendJson(response, 200, await automationModelCatalog(requestUrl.searchParams.get("kind"), requestUrl.searchParams.get("provider")));
    return true;
  }
  const taskMatch = pathname.match(/^\/automation\/tasks\/([a-f0-9-]+)$/i);
  if (request.method === "GET" && taskMatch) {
    const task = taskRecords.get(taskMatch[1]);
    if (!task) throw new HttpError(404, "没有找到这个任务");
    sendJson(response, 200, { task: compactTask(taskSummary(task)) });
    return true;
  }
  const inspectMatch = pathname.match(/^\/automation\/projects\/([a-zA-Z0-9-]+)\/inspect$/);
  if (request.method === "GET" && inspectMatch) {
    const project = await readProject(inspectMatch[1]);
    if (!project) throw new CanvasStoreError(404, "没有找到这个画布", "PROJECT_NOT_FOUND");
    sendJson(response, 200, { project: compactCanvasProject(project) });
    return true;
  }
  const outputsMatch = pathname.match(/^\/automation\/projects\/([a-zA-Z0-9-]+)\/outputs$/);
  if (request.method === "GET" && outputsMatch) {
    const project = await readProject(outputsMatch[1]);
    if (!project) throw new CanvasStoreError(404, "没有找到这个画布", "PROJECT_NOT_FOUND");
    sendJson(response, 200, { projectId: project.id, revision: project.revision, outputs: canvasOutputs(project) });
    return true;
  }
  const transactionMatch = pathname.match(/^\/automation\/projects\/([a-zA-Z0-9-]+)\/transactions$/);
  if (request.method === "POST" && transactionMatch) {
    const payload = await readJson(request);
    const result = await projectStore.applyTransaction(transactionMatch[1], payload);
    sendJson(response, 200, {
      project: result.summary,
      changes: result.changes,
      duplicate: result.duplicate,
      dryRun: result.dryRun,
      ...(result.dryRun ? { preview: compactCanvasProject(result.project) } : {}),
    });
    return true;
  }
  const mediaMatch = pathname.match(/^\/automation\/projects\/([a-zA-Z0-9-]+)\/media$/);
  if (request.method === "POST" && mediaMatch) {
    sendJson(response, 200, await attachAutomationMedia(mediaMatch[1], await readJson(request)));
    return true;
  }
  const runMatch = pathname.match(/^\/automation\/projects\/([a-zA-Z0-9-]+)\/nodes\/([^/]+)\/run$/);
  if (request.method === "POST" && runMatch) {
    const payload = await readJson(request);
    const project = await readProject(runMatch[1]);
    if (!project) throw new CanvasStoreError(404, "没有找到这个画布", "PROJECT_NOT_FOUND");
    if (payload.expectedRevision !== undefined && Number(payload.expectedRevision) !== Number(project.revision)) {
      throw new CanvasStoreError(409, `画布版本冲突：当前 revision 为 ${project.revision}`, "REVISION_CONFLICT");
    }
    const compiled = await hydrateAutomationModel(buildNodeTaskRequest(project, decodeURIComponent(runMatch[2]), payload.overrides));
    const task = enqueueTask({ ...compiled.payload, taskMeta: compiled.taskMeta });
    sendJson(response, 202, { task: compactTask(task) });
    return true;
  }
  sendJson(response, 404, { error: "未找到 Agent Canvas 自动化接口" });
  return true;
}

const server = createServer(async (request, response) => {
  setCors(request, response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (!isAllowedOrigin(request.headers.origin)) {
    sendJson(response, 403, { error: "只允许本机画板访问 Codex" });
    return;
  }
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  const pathname = requestUrl.pathname;
  try {
    if (await handleMediaFileRequest(request, response, requestUrl)) return;
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "无法读取本地媒体文件" });
    return;
  }
  if (pathname === "/api-key-settings") {
    try {
      if (request.method === "GET") {
        sendJson(response, 200, getApiKeySettings(localEnvPath));
        return;
      }
      if (request.method === "PUT") {
        const payload = await readJson(request);
        sendJson(response, 200, await saveApiKeyChanges(localEnvPath, payload.changes));
        return;
      }
      sendJson(response, 405, { error: "API 密钥设置只支持 GET 和 PUT" });
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 400, {
        error: error instanceof Error ? error.message : "无法保存 API 密钥设置",
      });
    }
    return;
  }
  if (pathname === "/media-settings") {
    try {
      if (request.method === "GET") {
        sendJson(response, 200, await getMediaOutputSettings());
        return;
      }
      if (request.method === "PUT") {
        const payload = await readJson(request);
        sendJson(response, 200, await setMediaOutputDirectory(payload.directory));
        return;
      }
      sendJson(response, 405, { error: "媒体目录设置只支持 GET 和 PUT" });
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 400, { error: error instanceof Error ? error.message : "无法保存媒体目录设置" });
    }
    return;
  }
  try {
    if (await handleProjectEvents(request, response, pathname)) return;
    if (await handleAutomationRequest(request, response, requestUrl)) return;
  } catch (error) {
    sendJson(response, automationErrorStatus(error), {
      error: error instanceof Error ? error.message : "Agent Canvas 自动化操作失败",
      ...(error?.code ? { code: error.code } : {}),
    });
    return;
  }
  try {
    if (await handleProjectRequest(request, response, pathname)) return;
  } catch (error) {
    sendJson(response, automationErrorStatus(error), { error: error instanceof Error ? error.message : "画布文件操作失败" });
    return;
  }
  try {
    if (await handleTaskRequest(request, response, pathname)) return;
  } catch (error) {
    sendJson(response, error instanceof HttpError ? error.status : 500, {
      error: error instanceof Error ? error.message : "任务操作失败",
    });
    return;
  }
  if (request.method === "GET" && pathname === "/image-models") {
    try {
      const provider = String(requestUrl.searchParams.get("provider") || "").trim().toLowerCase();
      if (!IMAGE_GENERATION_PROVIDER_IDS.includes(provider)) {
        throw new HttpError(400, `不支持的图片生成供应商：${provider || "未选择"}`);
      }
      const status = getImageGenerationProviderStatus(provider);
      sendJson(response, 200, status);
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 503, {
        error: error instanceof Error ? error.message : "无法读取图片模型列表",
      });
    }
    return;
  }
  if (request.method === "GET" && pathname === "/video-models") {
    try {
      const provider = String(requestUrl.searchParams.get("provider") || "").trim().toLowerCase();
      if (!VIDEO_GENERATION_PROVIDER_IDS.includes(provider)) {
        throw new HttpError(400, `不支持的视频生成供应商：${provider || "未选择"}`);
      }
      const status = await getVideoGenerationProviderStatus(provider);
      sendJson(response, 200, status);
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 503, {
        error: error instanceof Error ? error.message : "无法读取视频模型列表",
      });
    }
    return;
  }
  if (request.method === "POST" && pathname === "/image-generations") {
    const controller = new AbortController();
    request.once("aborted", () => controller.abort("客户端已断开"));
    response.once("close", () => {
      if (!response.writableEnded) controller.abort("客户端已断开");
    });
    try {
      const payload = await readJson(request);
      const generated = await runImageGeneration(payload, { signal: controller.signal });
      const result = await attachSavedMedia(generated, "image", randomUUID(), controller.signal);
      if (!response.writableEnded) sendJson(response, 200, result);
    } catch (error) {
      if (response.writableEnded) return;
      const message = error instanceof Error ? error.message : "图片生成失败";
      const validationError = /不支持|不属于|请输入|提示词过长|最多接收|必须是有效/.test(message);
      sendJson(response, error instanceof HttpError ? error.status : validationError ? 400 : isAbortError(error) ? 499 : 502, { error: message });
    }
    return;
  }
  if (request.method === "POST" && pathname === "/video-generations") {
    const controller = new AbortController();
    request.once("aborted", () => controller.abort("客户端已断开"));
    response.once("close", () => {
      if (!response.writableEnded) controller.abort("客户端已断开");
    });
    try {
      const payload = await readJson(request);
      const generated = await runVideoGeneration(payload, { signal: controller.signal });
      const result = await attachSavedMedia(generated, "video", randomUUID(), controller.signal);
      if (!response.writableEnded) sendJson(response, 200, result);
    } catch (error) {
      if (response.writableEnded) return;
      const message = error instanceof Error ? error.message : "视频生成失败";
      const validationError = /不支持|不属于|请输入|提示词过长|最多接收|必须是有效|需要 \d|只支持|积分不足|尚未登录|未找到 dreamina|LOW_CREDIT/.test(message);
      sendJson(response, error instanceof HttpError ? error.status : validationError ? 400 : isAbortError(error) ? 499 : 502, { error: message });
    }
    return;
  }
  if (request.method === "GET" && pathname === "/models") {
    let provider;
    try {
      provider = normalizeProvider(requestUrl.searchParams.get("provider"));
      if (provider === OPENROUTER_PROVIDER_ID && !openRouterConfigured()) {
        sendJson(response, 200, {
          provider,
          configured: false,
          models: [],
          message: "OpenRouter 尚未配置。请在 .env.local 中设置 OPENROUTER_API_KEY 并重启画板。",
        });
        return;
      }
      if (provider === COMFLY_LLM_PROVIDER_ID && !comflyLlmConfigured()) {
        sendJson(response, 200, {
          provider,
          configured: false,
          models: [],
          message: "Comfly 尚未配置。请在 .env.local 中设置 COMFLY_LLM_API_KEY 或 COMFLY_API_KEY 并重启画板。",
        });
        return;
      }
      if (provider === GROK_BUILD_PROVIDER_ID) {
        const status = await getGrokBuildStatus();
        sendJson(response, 200, {
          provider,
          configured: status.ready,
          models: status.ready ? status.models : [],
          message: status.message,
          installed: status.installed,
          loggedIn: status.loggedIn,
        });
        return;
      }
      if (provider === ANTIGRAVITY_PROVIDER_ID) {
        const status = await getAntigravityStatus();
        sendJson(response, 200, {
          provider,
          configured: status.ready,
          models: status.ready ? status.models : [],
          message: status.message,
          installed: status.installed,
          loggedIn: status.loggedIn,
        });
        return;
      }
      const models = await providerModels(provider);
      sendJson(response, 200, { provider, configured: true, models });
    } catch (error) {
      if (provider) {
        sendJson(response, error instanceof HttpError ? error.status : 503, {
          provider,
          configured: provider === OPENROUTER_PROVIDER_ID
            ? openRouterConfigured()
            : provider === COMFLY_LLM_PROVIDER_ID
              ? comflyLlmConfigured()
            : provider === GROK_BUILD_PROVIDER_ID || provider === ANTIGRAVITY_PROVIDER_ID
              ? false
              : true,
          models: [],
          message: error instanceof Error ? error.message : "无法读取模型列表",
          error: error instanceof Error ? error.message : "无法读取模型列表",
        });
        return;
      }
      sendJson(response, 503, { error: error instanceof Error ? error.message : "无法读取 Codex 模型列表" });
    }
    return;
  }
  if (request.method === "GET" && pathname === "/health") {
    const availableSkills = Object.fromEntries(PROMPT_SKILL_IDS.map((skillId) => [skillId, {
      id: skillId,
      label: promptSkillDefinition(skillId).taskLabel,
      ready: skillId === "none" || Boolean(skillPaths[skillId]),
    }]));
    const loadableSkillReady = LOADABLE_PROMPT_SKILL_IDS.some((skillId) => Boolean(skillPaths[skillId]));
    const skillReady = true;
    const openRouterReady = skillReady && openRouterConfigured();
    const comflyReady = skillReady && comflyLlmConfigured();
    const grokBuildStatus = await getGrokBuildStatus();
    const antigravityStatus = await getAntigravityStatus();
    sendJson(response, 200, {
      ready: skillReady,
      provider: "Codex SDK",
      localOnly: true,
      seedanceSkill: Boolean(skillPaths.seedance),
      imageSkill: Boolean(skillPaths.image),
      loadableSkillReady,
      skills: availableSkills,
      providers: {
        codex: {
          configured: true,
          ready: skillReady,
          label: "Codex SDK",
          message: skillReady ? null : "未找到本机 Seedance 或 Image skill",
        },
        openrouter: {
          configured: openRouterConfigured(),
          ready: openRouterReady,
          label: "OpenRouter Agent SDK",
          message: !openRouterConfigured()
            ? "请在 .env.local 中设置 OPENROUTER_API_KEY"
            : skillReady ? null : "未找到本机 Seedance 或 Image skill",
        },
        [COMFLY_LLM_PROVIDER_ID]: {
          configured: comflyLlmConfigured(),
          ready: comflyReady,
          label: "Comfly 文本模型",
          message: !comflyLlmConfigured()
            ? "请在 .env.local 中设置 COMFLY_LLM_API_KEY 或 COMFLY_API_KEY"
            : skillReady ? null : "未找到本机 Seedance、Image 或真实感 Skill",
        },
        [GROK_BUILD_PROVIDER_ID]: {
          configured: grokBuildStatus.ready,
          ready: skillReady && grokBuildStatus.ready,
          label: "Grok Build · 订阅登录",
          message: !grokBuildStatus.ready
            ? grokBuildStatus.message
            : skillReady ? null : "未找到本机 Seedance 或 Image skill",
        },
        [ANTIGRAVITY_PROVIDER_ID]: {
          configured: antigravityStatus.ready,
          ready: skillReady && antigravityStatus.ready,
          label: "Antigravity · Google 订阅",
          message: !antigravityStatus.ready
            ? antigravityStatus.message
            : skillReady ? null : "未找到本机 Seedance 或 Image skill",
        },
      },
    });
    return;
  }
  if (request.method === "POST" && pathname === "/refine") {
    await handleDirectRefine(request, response);
    return;
  }
  sendJson(response, 404, { error: "未找到接口" });
});

await initializeTaskHistory();
await backfillCompletedMediaOutputs();

server.listen(PORT, "127.0.0.1", () => {
  const skillStatus = PROMPT_SKILL_IDS.map((skillId) => `${skillId}: ${skillPaths[skillId] ? "ready" : "missing"}`).join(", ");
  console.log(`Codex bridge ready: http://127.0.0.1:${PORT} (${skillStatus})`);
});
