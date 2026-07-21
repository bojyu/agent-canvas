import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { extname, isAbsolute, join, resolve } from "node:path";
import readline from "node:readline";
import { AGENT_OUTPUT_SCHEMA, validateStructuredResult } from "./agent-protocol.mjs";
import {
  loadPromptSkillBundle,
  materializeIsolatedPromptSkillBundle,
  promptSkillInstructions,
} from "./skill-bundle.mjs";

export const GROK_BUILD_PROVIDER_ID = "grok-build";
export const GROK_BUILD_SESSION_PREFIX = "grok-build:";
export const GROK_BUILD_REASONING_EFFORTS = Object.freeze(["low", "medium", "high"]);

const STATUS_CACHE_MS = 20_000;
const PROBE_TIMEOUT_MS = 15_000;
const MAX_CLI_OUTPUT_BYTES = 1_000_000;
const IMAGE_MIME_TYPES = Object.freeze({
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
});

let statusCache = null;

function abortError(reason) {
  const error = new Error(typeof reason === "string" && reason ? reason : "Grok Build task cancelled");
  error.name = "AbortError";
  return error;
}

function redactDiagnostic(value) {
  return String(value || "")
    .replace(/xai-[A-Za-z0-9._-]+/gi, "[redacted]")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]")
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token)["']?\s*[:=]\s*)[^\s,}\]]+/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function runtimeSourceEnvironment(runtime = {}) {
  return runtime.env || process.env;
}

export function sanitizeGrokEnvironment(source = process.env) {
  const clean = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (value === undefined) continue;
    if (/(?:api[_-]?key|access[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token|model_access_key)$/i.test(key)) continue;
    if (/^(?:XAI|GROK).*KEY$/i.test(key)) continue;
    clean[key] = value;
  }
  return clean;
}

function sourceGrokHome(runtime = {}) {
  if (runtime.sourceHome) return resolve(runtime.sourceHome);
  const env = runtimeSourceEnvironment(runtime);
  if (env.GROK_HOME) return resolve(env.GROK_HOME);
  const userHome = env.USERPROFILE || env.HOME || homedir();
  return resolve(userHome, ".grok");
}

async function readable(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveGrokCommand(runtime = {}) {
  if (runtime.command) return String(runtime.command);
  const env = runtimeSourceEnvironment(runtime);
  if (env.GROK_BUILD_CLI) return String(env.GROK_BUILD_CLI);
  const candidates = [];
  const userProfile = env.USERPROFILE || env.HOME || homedir();
  if (process.platform === "win32") candidates.push(join(userProfile, ".grok", "bin", "grok.exe"));
  candidates.push(join(userProfile, ".grok", "bin", process.platform === "win32" ? "grok.exe" : "grok"));
  for (const candidate of candidates) {
    if (await readable(candidate)) return candidate;
  }
  return "grok";
}

function commandUsesShell(command, runtime = {}) {
  if (runtime.shell !== undefined) return Boolean(runtime.shell);
  if (process.platform !== "win32") return false;
  if (isAbsolute(command) && !/\.(?:cmd|bat)$/i.test(command)) return false;
  return /\.(?:cmd|bat)$/i.test(command) || command === "grok";
}

async function runCliCommand(args, {
  runtime = {},
  cwd = process.cwd(),
  env = sanitizeGrokEnvironment(runtimeSourceEnvironment(runtime)),
  timeoutMs = PROBE_TIMEOUT_MS,
} = {}) {
  const command = await resolveGrokCommand(runtime);
  const commandArgs = [...(runtime.commandArgs || []), ...args];
  return new Promise((resolveResult) => {
    let child;
    try {
      child = spawn(command, commandArgs, {
        cwd,
        env,
        windowsHide: true,
        shell: commandUsesShell(command, runtime),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolveResult({ code: null, stdout: "", stderr: "", error });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult(result);
    };
    const append = (current, chunk) => `${current}${chunk}`.slice(-MAX_CLI_OUTPUT_BYTES);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.on("error", (error) => finish({ code: null, stdout, stderr, error }));
    child.on("close", (code) => finish({ code, stdout, stderr, error: null }));
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: null, stdout, stderr, error: new Error("Grok Build CLI probe timed out") });
    }, timeoutMs);
  });
}

export function scanGrokConfigText(input) {
  const findings = [];
  let section = "";
  for (const rawLine of String(input || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sectionMatch = line.match(/^\[([^\]]+)]/);
    if (sectionMatch) {
      section = sectionMatch[1].trim().toLowerCase();
      continue;
    }
    const keyMatch = line.match(/^(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))\s*=/);
    if (!keyMatch) continue;
    const key = String(keyMatch[1] || keyMatch[2] || keyMatch[3] || "").toLowerCase();
    if (section.startsWith("model.") && key === "api_key") findings.push("per-model-api-key");
    if (section.startsWith("model.") && key === "env_key") findings.push("per-model-env-key");
    if (section === "auth" && key === "auth_provider_command") findings.push("external-auth-provider");
    if (section.startsWith("model.") && key === "extra_headers" && /api[_-]?key/i.test(line)) {
      findings.push("per-model-api-header");
    }
  }
  return [...new Set(findings)];
}

async function unsafeConfigFindings(runtime = {}) {
  const env = runtimeSourceEnvironment(runtime);
  const home = sourceGrokHome(runtime);
  const roots = [home];
  if (process.platform === "win32" && env.ProgramData) roots.push(join(env.ProgramData, "grok"));
  else roots.push("/etc/grok");
  const paths = roots.flatMap((root) => [
    join(root, "config.toml"),
    join(root, "managed_config.toml"),
    join(root, "requirements.toml"),
  ]);
  const findings = [];
  for (const path of paths) {
    try {
      findings.push(...scanGrokConfigText(await readFile(path, "utf8")));
    } catch (error) {
      if (error?.code === "EACCES" || error?.code === "EPERM") findings.push("config-unreadable");
      else if (error?.code !== "ENOENT") throw error;
    }
  }
  return [...new Set(findings)];
}

function inspectContainsKeyCredential(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[-.]/g, "_");
    if (["api_key", "env_key", "auth_provider_command"].includes(normalized)) return true;
    if (inspectContainsKeyCredential(child, seen)) return true;
  }
  return false;
}

function parseInspectJson(output) {
  const text = String(output || "").replace(/\u001b\[[0-9;]*m/g, "").trim();
  try { return JSON.parse(text); }
  catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("grok inspect --json did not return valid JSON");
  }
}

function collectModelIds(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectModelIds(item, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  const candidate = value.id || value.model || value.value;
  if (typeof candidate === "string" && /^(?:grok|xai[/-])[A-Za-z0-9._/-]*$/i.test(candidate)) output.push(candidate);
  for (const child of Object.values(value)) collectModelIds(child, output);
  return output;
}

export function parseGrokModelsOutput(output) {
  const text = String(output || "").replace(/\u001b\[[0-9;]*m/g, "");
  const found = [];
  try { collectModelIds(JSON.parse(text), found); }
  catch {
    for (const line of text.split(/\r?\n/)) {
      const matches = line.match(/\b(?:grok-[A-Za-z0-9._/-]+|xai[/-][A-Za-z0-9._/-]+)\b/gi) || [];
      found.push(...matches);
    }
  }
  const ids = [...new Set(found
    .map((id) => id.replace(/[),;:]+$/, ""))
    .filter((id) => /^(?:grok-|xai[/-])/i.test(id)))];
  if (!ids.length) ids.push("grok-4.5");
  const explicitDefault = text.match(/default model\s*:\s*([A-Za-z0-9._/-]+)/i)?.[1]
    || text.match(/^\s*[*-]\s*([A-Za-z0-9._/-]+)\s*\(default\)/im)?.[1];
  const defaultId = ids.includes(explicitDefault) ? explicitDefault : ids[0];
  return ids.map((id) => ({
    id,
    model: id,
    provider: GROK_BUILD_PROVIDER_ID,
    displayName: id,
    description: "Grok Build subscription model (local CLI OAuth)",
    isDefault: id === defaultId,
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: GROK_BUILD_REASONING_EFFORTS.map((reasoningEffort) => ({ reasoningEffort })),
    inputModalities: ["text", "image"],
    supportsStructuredOutputs: true,
  }));
}

async function copyCachedLogin(sourceHome, destinationHome) {
  const source = join(sourceHome, "auth.json");
  const destination = join(destinationHome, "auth.json");
  try {
    await copyFile(source, destination);
    await chmod(destination, 0o600).catch(() => {});
    return true;
  } catch (error) {
    if (["ENOENT", "EACCES", "EPERM"].includes(error?.code)) return false;
    throw error;
  }
}

async function prepareRuntime(runtime = {}, bundle = null) {
  const runtimeHome = await mkdtemp(join(tmpdir(), "prompt-flow-grok-home-"));
  let workspace;
  try {
    workspace = bundle
      ? await materializeIsolatedPromptSkillBundle(bundle)
      : {
          workspacePath: await mkdtemp(join(tmpdir(), "prompt-flow-grok-probe-")),
          cleanup: null,
        };
    if (!workspace.cleanup) workspace.cleanup = () => rm(workspace.workspacePath, { recursive: true, force: true });
    const authCopied = await copyCachedLogin(sourceGrokHome(runtime), runtimeHome);
    const env = {
      ...sanitizeGrokEnvironment(runtimeSourceEnvironment(runtime)),
      GROK_HOME: runtimeHome,
      HOME: runtimeHome,
      USERPROFILE: runtimeHome,
    };
    return {
      authCopied,
      env,
      runtimeHome,
      workspacePath: workspace.workspacePath,
      async cleanup() {
        await Promise.allSettled([
          workspace.cleanup(),
          rm(runtimeHome, { recursive: true, force: true }),
        ]);
      },
    };
  } catch (error) {
    await workspace?.cleanup?.().catch(() => {});
    await rm(runtimeHome, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function unsafeConfigMessage(findings) {
  if (findings.includes("config-unreadable")) {
    return "无法安全检查 Grok 配置。为避免 API Key 抢占订阅认证，Grok Build 已拒绝启动；请用当前 Windows 用户启动画板。";
  }
  if (findings.includes("per-model-api-key")) {
    return "检测到 Grok 的 per-model api_key 配置。为避免误走按量 API 计费，Grok Build 已拒绝启动；请移除该配置并使用 `grok login`。";
  }
  return "检测到可能绕过 `grok login` 的 Grok 密钥或外部认证配置。为避免误计费，Grok Build 已拒绝启动。";
}

async function probePreparedRuntime(prepared, runtime = {}) {
  const inspect = await runCliCommand(["--no-auto-update", "inspect", "--json"], {
    runtime,
    cwd: prepared.workspacePath,
    env: prepared.env,
  });
  if (inspect.error || inspect.code !== 0) {
    return {
      ready: false,
      loggedIn: false,
      message: `Grok Build 配置检查失败：${redactDiagnostic(inspect.error?.message || inspect.stderr || "unknown error")}`,
      models: [],
    };
  }
  let inspection;
  try { inspection = parseInspectJson(inspect.stdout); }
  catch (error) {
    return { ready: false, loggedIn: false, message: error.message, models: [] };
  }
  if (inspectContainsKeyCredential(inspection)) {
    return { ready: false, loggedIn: false, message: unsafeConfigMessage(["per-model-api-key"]), models: [] };
  }
  if (!prepared.authCopied) {
    return {
      ready: false,
      loggedIn: false,
      message: "Grok Build 尚未登录，请先在终端运行 `grok login`",
      models: [],
    };
  }
  let initialized;
  try {
    initialized = await verifyCachedToken(prepared, runtime);
  } catch (error) {
    return {
      ready: false,
      loggedIn: false,
      message: `Grok Build 订阅登录无效，请重新运行 \`grok login\`。${redactDiagnostic(error?.message)}`,
      models: [],
    };
  }
  const models = await runCliCommand(["--no-auto-update", "models"], {
    runtime,
    cwd: prepared.workspacePath,
    env: prepared.env,
  });
  if (models.error || models.code !== 0) {
    const detail = redactDiagnostic(models.error?.message || models.stderr || models.stdout);
    return {
      ready: false,
      loggedIn: false,
      message: `Grok Build 尚未登录，请先在终端运行 \`grok login\`${detail ? `。${detail}` : ""}`,
      models: [],
    };
  }
  return {
    ready: true,
    loggedIn: true,
    message: null,
    promptCapabilities: initialized.agentCapabilities?.promptCapabilities || {},
    models: parseGrokModelsOutput(models.stdout).map((model) => ({
      ...model,
      inputModalities: initialized.agentCapabilities?.promptCapabilities?.image === true
        || initialized.agentCapabilities?.promptCapabilities?.embeddedContext === true
        ? ["text", "image"]
        : ["text"],
    })),
  };
}

async function freshStatus(runtime = {}) {
  const version = await runCliCommand(["--no-auto-update", "version"], { runtime });
  if (version.error || version.code !== 0) {
    const detail = redactDiagnostic(version.error?.message || version.stderr);
    return {
      provider: GROK_BUILD_PROVIDER_ID,
      installed: false,
      loggedIn: false,
      configured: false,
      ready: false,
      message: `未找到 Grok Build CLI。请先安装官方 CLI${detail ? `：${detail}` : ""}`,
      models: [],
    };
  }
  const findings = await unsafeConfigFindings(runtime);
  if (findings.length) {
    return {
      provider: GROK_BUILD_PROVIDER_ID,
      installed: true,
      loggedIn: false,
      configured: false,
      ready: false,
      message: unsafeConfigMessage(findings),
      models: [],
    };
  }
  const prepared = await prepareRuntime(runtime);
  try {
    const probe = await probePreparedRuntime(prepared, runtime);
    return {
      provider: GROK_BUILD_PROVIDER_ID,
      installed: true,
      configured: probe.ready,
      ...probe,
      version: redactDiagnostic(version.stdout),
    };
  } finally {
    await prepared.cleanup();
  }
}

export async function getGrokBuildStatus({ force = false, runtime = {} } = {}) {
  const cacheable = !Object.keys(runtime).length;
  if (!force && cacheable && statusCache && Date.now() - statusCache.loadedAt < STATUS_CACHE_MS) {
    return statusCache.value;
  }
  const value = await freshStatus(runtime);
  if (cacheable) statusCache = { loadedAt: Date.now(), value };
  return value;
}

export async function getGrokBuildModels(options = {}) {
  const status = await getGrokBuildStatus(options);
  return status.ready ? status.models : [];
}

export function createGrokBuildSessionId(threadId) {
  if (threadId) {
    if (!String(threadId).startsWith(GROK_BUILD_SESSION_PREFIX)) {
      throw new Error("该会话属于其他 Agent，不能交给 Grok Build 继续执行");
    }
    return String(threadId).slice(0, 256);
  }
  return `${GROK_BUILD_SESSION_PREFIX}${randomUUID()}`;
}

function flattenOptionValues(options, output = []) {
  for (const option of Array.isArray(options) ? options : []) {
    if (Array.isArray(option?.options)) flattenOptionValues(option.options, output);
    else if (typeof option?.value === "string") output.push(option.value);
  }
  return output;
}

function configOption(configOptions, category, fallbackPattern) {
  return (Array.isArray(configOptions) ? configOptions : []).find((option) => (
    option?.category === category || fallbackPattern.test(String(option?.id || ""))
  ));
}

class AcpConnection {
  constructor({ command, args, cwd, env, shell, timeoutMs, signal }) {
    this.pending = new Map();
    this.nextId = 1;
    this.text = "";
    this.usage = null;
    this.stderr = "";
    this.closed = false;
    this.child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      shell,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.lines = readline.createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-20_000);
    });
    this.child.on("error", (error) => this.fail(error));
    this.child.on("close", (code) => {
      if (!this.closed && this.pending.size) {
        const detail = redactDiagnostic(this.stderr);
        this.fail(new Error(detail || `Grok Build ACP exited with code ${code}`));
      }
    });
    this.timeoutMs = timeoutMs;
    this.signal = signal;
  }

  write(message) {
    if (this.closed || !this.child.stdin.writable) throw new Error("Grok Build ACP connection is closed");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  handleLine(line) {
    if (!String(line).trim()) return;
    let message;
    try { message = JSON.parse(line); }
    catch {
      this.fail(new Error("Grok Build ACP returned invalid JSON-RPC output"));
      return;
    }
    if (message.method === "session/update") {
      const update = message.params?.update;
      if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
        this.text += String(update.content.text || "");
      }
      if (update?.sessionUpdate === "usage_update") this.usage = update.usage || update;
      return;
    }
    if (message.method && message.id !== undefined) {
      if (message.method === "session/request_permission" || message.method === "request_permission") {
        this.write({ jsonrpc: "2.0", id: message.id, result: { outcome: { outcome: "cancelled" } } });
      } else {
        this.write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Client tool access is disabled" } });
      }
      return;
    }
    if (message.id === undefined) return;
    const pending = this.pending.get(String(message.id));
    if (!pending) return;
    this.pending.delete(String(message.id));
    pending.cleanup();
    if (message.error) pending.reject(new Error(message.error.message || "Grok Build ACP request failed"));
    else pending.resolve(message.result ?? {});
  }

  request(method, params, { signal = this.signal, timeoutMs = this.timeoutMs } = {}) {
    if (signal?.aborted) return Promise.reject(abortError(signal.reason));
    const id = this.nextId++;
    return new Promise((resolveRequest, rejectRequest) => {
      const onAbort = () => {
        this.pending.delete(String(id));
        cleanup();
        rejectRequest(abortError(signal.reason));
      };
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        cleanup();
        rejectRequest(new Error(`${method} timed out`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(String(id), { resolve: resolveRequest, reject: rejectRequest, cleanup });
      try { this.write({ jsonrpc: "2.0", id, method, params }); }
      catch (error) {
        this.pending.delete(String(id));
        cleanup();
        rejectRequest(error);
      }
    });
  }

  notify(method, params) {
    try { this.write({ jsonrpc: "2.0", method, params }); }
    catch { /* The process may already be gone during cancellation. */ }
  }

  fail(error) {
    if (this.closed) return;
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.lines.close();
    this.child.stdin.end();
    this.child.kill();
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(new Error("Grok Build ACP connection closed"));
    }
    this.pending.clear();
  }
}

async function verifyCachedToken(prepared, runtime = {}) {
  const command = await resolveGrokCommand(runtime);
  const client = new AcpConnection({
    command,
    args: [
      ...(runtime.commandArgs || []),
      "--no-auto-update",
      "--tools", "",
      "--sandbox", "strict",
      "--permission-mode", "dontAsk",
      "--no-plan",
      "--no-subagents",
      "--no-memory",
      "--disable-web-search",
      "agent", "stdio",
    ],
    cwd: prepared.workspacePath,
    env: prepared.env,
    shell: commandUsesShell(command, runtime),
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  try {
    const initialized = await client.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "agent-canvas-probe", title: "Agent Canvas", version: "0.1.0" },
    });
    if (initialized.protocolVersion !== 1) throw new Error("ACP v1 不兼容");
    const authMethods = new Set((initialized.authMethods || []).map((method) => method?.id));
    if (!authMethods.has("cached_token")) throw new Error("未提供 cached_token 认证");
    await client.request("authenticate", { methodId: "cached_token", _meta: { headless: true } });
    return initialized;
  } finally {
    client.close();
  }
}

async function attachmentToContentBlock(attachment, promptCapabilities) {
  const mimeType = IMAGE_MIME_TYPES[extname(attachment.path).toLowerCase()];
  if (!mimeType) throw new Error("Grok Build ACP 不支持该参考图片格式");
  const data = await readFile(attachment.path);
  const encoded = data.toString("base64");
  if (promptCapabilities?.image === true) return { type: "image", mimeType, data: encoded };
  if (promptCapabilities?.embeddedContext === true) {
    return {
      type: "resource",
      resource: {
        uri: `prompt-flow://reference/${randomUUID()}${extname(attachment.path).toLowerCase()}`,
        mimeType,
        blob: encoded,
      },
    };
  }
  throw new Error("当前 Grok Build CLI 的 ACP 未声明图片或内嵌资源能力，无法安全发送参考图或视频帧");
}

async function applySessionOption(client, sessionId, configOptions, category, pattern, value) {
  const option = configOption(configOptions, category, pattern);
  if (!option || option.currentValue === value) return configOptions;
  const values = flattenOptionValues(option.options);
  if (values.length && !values.includes(value)) {
    throw new Error(`当前 Grok Build CLI 不支持配置值：${value}`);
  }
  const response = await client.request("session/set_config_option", {
    sessionId,
    configId: option.id,
    value,
  });
  return Array.isArray(response.configOptions) ? response.configOptions : configOptions;
}

function buildGrokPrompt(bundle, textPrompt, outputSchema) {
  return [
    "You are the isolated Grok Build provider for Agent Canvas. Do not use tools, shell commands, web search, plugins, MCP servers, subagents, or external skills.",
    `The following locally bundled ${bundle.label} skill is mandatory and is the only creative-production guidance allowed for this task.`,
    promptSkillInstructions(bundle, { includeAllReferences: true }),
    "\n--- Agent Canvas task ---\n",
    textPrompt,
    "\nReturn exactly one JSON object and no Markdown or commentary. It must match this schema:",
    JSON.stringify(outputSchema),
  ].join("\n");
}

async function createAcpConnection({ runtime, prepared, model, reasoningEffort, outputSchema, timeoutMs, signal }) {
  const command = await resolveGrokCommand(runtime);
  const args = [
    ...(runtime.commandArgs || []),
    "--no-auto-update",
    "--model", model,
    "--reasoning-effort", reasoningEffort,
    "--json-schema", JSON.stringify(outputSchema),
    "--tools", "",
    "--sandbox", "strict",
    "--permission-mode", "dontAsk",
    "--no-plan",
    "--no-subagents",
    "--no-memory",
    "--disable-web-search",
    "--max-turns", "1",
    "agent", "stdio",
  ];
  return new AcpConnection({
    command,
    args,
    cwd: prepared.workspacePath,
    env: prepared.env,
    shell: commandUsesShell(command, runtime),
    timeoutMs,
    signal,
  });
}

export async function runGrokBuildRefine({
  model,
  reasoningEffort,
  textPrompt,
  attachments = [],
  outputSchema = AGENT_OUTPUT_SCHEMA,
  skillId = "seedance",
  skillPath,
  seedanceSkillPath,
  threadId,
  signal,
  timeoutMs = 10 * 60_000,
  runtime = {},
}) {
  if (!/^[A-Za-z0-9._/-]{1,128}$/.test(String(model || ""))) throw new Error("Grok Build 模型 ID 无效");
  if (!GROK_BUILD_REASONING_EFFORTS.includes(reasoningEffort)) throw new Error("Grok Build 思考强度无效");
  if (signal?.aborted) throw abortError(signal.reason);
  const findings = await unsafeConfigFindings(runtime);
  if (findings.length) throw new Error(unsafeConfigMessage(findings));
  const bundle = await loadPromptSkillBundle(skillId, skillPath || seedanceSkillPath);
  const logicalSessionId = createGrokBuildSessionId(threadId);
  const prepared = await prepareRuntime(runtime, bundle);
  let client;
  let acpSessionId = null;
  let cancellationTimer = null;
  const cancel = () => {
    if (acpSessionId) client?.notify("session/cancel", { sessionId: acpSessionId });
    cancellationTimer = setTimeout(() => client?.close(), 250);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const version = await runCliCommand(["--no-auto-update", "version"], { runtime });
    if (version.error || version.code !== 0) throw new Error("未找到 Grok Build CLI，请先安装官方 CLI");
    const probe = await probePreparedRuntime(prepared, runtime);
    if (!probe.ready) throw new Error(probe.message);
    if (!probe.models.some((item) => item.model === model || item.id === model)) {
      throw new Error(`所选 Grok Build 模型当前不可用：${model}`);
    }
    client = await createAcpConnection({ runtime, prepared, model, reasoningEffort, outputSchema, timeoutMs, signal });
    const initialized = await client.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "agent-canvas", title: "Agent Canvas", version: "0.1.0" },
    });
    if (initialized.protocolVersion !== 1) throw new Error("Grok Build CLI 与 ACP v1 不兼容");
    const authMethods = new Set((initialized.authMethods || []).map((method) => method?.id));
    if (!authMethods.has("cached_token")) {
      throw new Error("Grok Build 没有提供 cached_token 登录方式；请运行 `grok login`，本画板不会使用 API Key");
    }
    await client.request("authenticate", { methodId: "cached_token", _meta: { headless: true } });
    const session = await client.request("session/new", { cwd: prepared.workspacePath, mcpServers: [] });
    acpSessionId = session.sessionId;
    if (!acpSessionId) throw new Error("Grok Build ACP 没有返回 sessionId");
    let configOptions = session.configOptions || [];
    configOptions = await applySessionOption(client, acpSessionId, configOptions, "model", /model/i, model);
    await applySessionOption(client, acpSessionId, configOptions, "thought_level", /effort|reason|thought/i, reasoningEffort);
    const content = [{ type: "text", text: buildGrokPrompt(bundle, textPrompt, outputSchema) }];
    if (attachments.length) {
      const promptCapabilities = initialized.agentCapabilities?.promptCapabilities || {};
      for (const attachment of attachments) {
        content.push(await attachmentToContentBlock(attachment, promptCapabilities));
      }
    }
    const promptResult = await client.request("session/prompt", {
      sessionId: acpSessionId,
      prompt: content,
    });
    if (promptResult.stopReason === "cancelled") throw abortError(signal?.reason);
    if (promptResult.stopReason && promptResult.stopReason !== "end_turn") {
      throw new Error(`Grok Build 未正常完成：${promptResult.stopReason}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 40));
    const parsed = validateStructuredResult(client.text, { allowCodeFence: true });
    return {
      ...parsed,
      threadId: logicalSessionId,
      usage: promptResult.usage || client.usage,
      provider: GROK_BUILD_PROVIDER_ID,
      skill: true,
      skillId: bundle.id,
      skillHash: bundle.hash,
      seedanceSkill: bundle.id === "seedance",
      seedanceSkillId: bundle.id === "seedance" ? bundle.id : undefined,
      seedanceSkillHash: bundle.id === "seedance" ? bundle.hash : undefined,
      sessionMode: "stateless",
    };
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (cancellationTimer) clearTimeout(cancellationTimer);
    client?.close();
    await prepared.cleanup();
  }
}
