import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { AGENT_OUTPUT_SCHEMA, validateStructuredResult } from "./agent-protocol.mjs";
import {
  isPromptSkillDisabled,
  loadPromptSkillBundle,
  promptSkillInstructions,
} from "./skill-bundle.mjs";

export const ANTIGRAVITY_PROVIDER_ID = "antigravity";
export const ANTIGRAVITY_SESSION_PREFIX = "antigravity:";
/** Reasoning labels shown in UI; CLI may ignore unknown values. */
export const ANTIGRAVITY_REASONING_EFFORTS = Object.freeze(["low", "medium", "high"]);

const STATUS_CACHE_MS = 20_000;
const PROBE_TIMEOUT_MS = 12_000;
const MAX_CLI_OUTPUT_BYTES = 2_000_000;

/** Fallback catalog when `agy models` is unavailable. Names match Antigravity CLI display labels. */
export const ANTIGRAVITY_FALLBACK_MODELS = Object.freeze([
  modelFromAgyLabel("Gemini 3.5 Flash (Medium)", { isDefault: true, defaultReasoningEffort: "medium" }),
  modelFromAgyLabel("Gemini 3.5 Flash (High)", { defaultReasoningEffort: "high" }),
  modelFromAgyLabel("Gemini 3.5 Flash (Low)", { defaultReasoningEffort: "low" }),
  modelFromAgyLabel("Gemini 3.1 Pro (High)", { defaultReasoningEffort: "high" }),
  modelFromAgyLabel("Gemini 3.1 Pro (Low)", { defaultReasoningEffort: "low" }),
  modelFromAgyLabel("Claude Sonnet 4.6 (Thinking)", { defaultReasoningEffort: "high" }),
  modelFromAgyLabel("Claude Opus 4.6 (Thinking)", { defaultReasoningEffort: "high" }),
  modelFromAgyLabel("GPT-OSS 120B (Medium)", { defaultReasoningEffort: "medium" }),
]);

export function modelFromAgyLabel(label, extras = {}) {
  const name = String(label || "").trim();
  const effortMatch = name.match(/\((Low|Medium|High|Thinking)\)\s*$/i);
  const effortRaw = effortMatch?.[1]?.toLowerCase() || "medium";
  const defaultReasoningEffort = effortRaw === "thinking" ? "high" : effortRaw;
  return {
    id: name,
    model: name,
    displayName: name,
    description: "Antigravity CLI · Google 订阅额度",
    isDefault: false,
    defaultReasoningEffort,
    supportedReasoningEfforts: ANTIGRAVITY_REASONING_EFFORTS.map((reasoningEffort) => ({ reasoningEffort })),
    inputModalities: ["text", "image"],
    ...extras,
  };
}

export function parseAgyModelsOutput(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^usage of|^flags:|^list available|^available models/i.test(line));
  const models = [];
  const seen = new Set();
  for (const line of lines) {
    // Skip help noise / bullets
    const label = line.replace(/^\*\s*/, "").replace(/^[-•]\s*/, "").trim();
    if (!label || label.length > 120) continue;
    if (/^agy(\.exe)?/i.test(label)) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    models.push(modelFromAgyLabel(label));
  }
  if (models.length && !models.some((model) => model.isDefault)) {
    models[0] = { ...models[0], isDefault: true };
  }
  return models;
}

function isAgyCommand(command) {
  const base = basename(String(command || "")).toLowerCase();
  return base === "agy" || base === "agy.exe" || base === "agy.cmd";
}

function formatPrintTimeout(timeoutMs) {
  const ms = Math.max(30_000, Number(timeoutMs) || 600_000);
  const minutes = Math.ceil(ms / 60_000);
  return `${minutes}m`;
}

let statusCache = null;

function abortError(reason) {
  const error = new Error(typeof reason === "string" && reason ? reason : "Antigravity task cancelled");
  error.name = "AbortError";
  return error;
}

function redactDiagnostic(value) {
  return String(value || "")
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, "[redacted]")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

function runtimeSourceEnvironment(runtime = {}) {
  return runtime.env || process.env;
}

async function readable(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve headless CLI for Google Antigravity coding agent.
 * Prefer explicit ANTIGRAVITY_CLI, then `agy` (official after 2026-06-18).
 * Gemini CLI is only a last-resort fallback: personal/Pro/Ultra subscriptions
 * no longer work there; use paid API key only if user still relies on it.
 * Note: Antigravity Desktop (VS Code fork) is NOT a headless agent CLI.
 */
export async function resolveAntigravityCommand(runtime = {}) {
  if (runtime.command) return String(runtime.command);
  const env = runtimeSourceEnvironment(runtime);
  if (env.ANTIGRAVITY_CLI) return String(env.ANTIGRAVITY_CLI);

  const userProfile = env.USERPROFILE || env.HOME || homedir();
  const candidates = [];
  if (process.platform === "win32") {
    candidates.push(join(userProfile, "AppData", "Local", "agy", "bin", "agy.exe"));
    candidates.push(join(userProfile, "AppData", "Local", "agy", "agy.exe"));
    candidates.push(join(userProfile, ".local", "bin", "agy.exe"));
    candidates.push(join(userProfile, ".local", "bin", "agy"));
    candidates.push(join(userProfile, "AppData", "Roaming", "npm", "agy.cmd"));
    // Optional: only if user still has API-key based Gemini CLI
    if (env.GEMINI_CLI) candidates.unshift(String(env.GEMINI_CLI));
    if (env.ALLOW_GEMINI_CLI_FALLBACK === "1") {
      candidates.push(join(userProfile, "AppData", "Roaming", "npm", "gemini.cmd"));
    }
  } else {
    candidates.push(join(userProfile, ".local", "bin", "agy"));
    candidates.push("/usr/local/bin/agy");
    if (env.GEMINI_CLI) candidates.unshift(String(env.GEMINI_CLI));
    if (env.ALLOW_GEMINI_CLI_FALLBACK === "1") {
      candidates.push(join(userProfile, ".npm-global", "bin", "gemini"));
      candidates.push("/usr/local/bin/gemini");
    }
  }
  for (const candidate of candidates) {
    if (await readable(candidate)) return candidate;
  }
  // Prefer failing as "agy missing" rather than silently using dead gemini subscription path.
  return "agy";
}

function commandUsesShell(command, runtime = {}) {
  if (runtime.shell !== undefined) return Boolean(runtime.shell);
  if (process.platform !== "win32") return false;
  if (isAbsolute(command) && !/\.(?:cmd|bat)$/i.test(command)) return false;
  return /\.(?:cmd|bat)$/i.test(command) || command === "gemini" || command === "gemini.cmd" || command === "agy" || command === "agy.cmd";
}

export function createAntigravitySessionId(threadId) {
  if (threadId) {
    if (!String(threadId).startsWith(ANTIGRAVITY_SESSION_PREFIX)) {
      throw new Error("该会话属于其他 Agent，不能交给 Antigravity 继续执行");
    }
    return String(threadId).slice(0, 256);
  }
  return `${ANTIGRAVITY_SESSION_PREFIX}${randomUUID()}`;
}

export function extractJsonPayload(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Antigravity 没有返回任何文本");

  // Prefer the last JSON object in the stream (models sometimes chatter then emit JSON).
  const candidates = [];
  const fencedAll = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)];
  for (const match of fencedAll) candidates.push(match[1].trim());
  candidates.push(raw);

  let depth = 0;
  let start = -1;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }

  let lastError;
  for (const candidate of candidates.reverse()) {
    try {
      return validateStructuredResult(candidate, { allowCodeFence: true });
    } catch (error) {
      lastError = error;
    }
  }
  const preview = redactDiagnostic(raw).slice(0, 240);
  throw new Error(
    `Antigravity 没有返回有效的 JSON 结果${lastError?.message ? `（${lastError.message}）` : ""}。输出预览：${preview || "(空)"}`,
  );
}

export function parseGeminiCliJsonOutput(stdout) {
  const text = String(stdout || "").trim();
  if (!text) throw new Error("Antigravity 没有返回任何文本");
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      if (typeof parsed.response === "string") return extractJsonPayload(parsed.response);
      if (typeof parsed.text === "string") return extractJsonPayload(parsed.text);
      if (typeof parsed.output === "string") return extractJsonPayload(parsed.output);
      if ("prompt" in parsed && "title" in parsed && "changes" in parsed) {
        return validateStructuredResult(parsed, { allowCodeFence: false });
      }
    }
  } catch {
    // treat as plain text
  }
  return extractJsonPayload(text);
}

function authFailureMessage(detail) {
  const text = String(detail || "");
  if (/FatalAuthenticationError|Manual authorization|not signed in|login|oauth|non-interactive|stopped serving|no longer|migrate/i.test(text)) {
    return "Antigravity CLI（agy）尚未登录或 Gemini CLI 订阅通道已停用。请安装并交互运行 `agy` 完成 Google OAuth（Pro/Ultra 请走 Antigravity，不要再用 gemini 登录）。验证脚本：scripts/antigravity-verify.cmd";
  }
  if (/quota|rate limit|429|resource exhausted/i.test(text)) {
    return "Google AI 订阅额度不足或触发限流，请稍后再试或在 Antigravity / Gemini 产品中查看额度。";
  }
  if (/disabled|Terms of Service|violation/i.test(text)) {
    return "当前 Google 账号的 Antigravity / Gemini CLI 访问被禁用（可能与服务条款或账号状态有关），请在 Google 账号侧检查后重试。";
  }
  return redactDiagnostic(text) || "Antigravity CLI 调用失败";
}

/**
 * Decode CLI pipe bytes. Prefer UTF-8; if replacement chars appear, try GB18030/GBK
 * (Chinese Windows console defaults). Always decode from a complete buffer — never
 * chunk.toString("utf8") mid-stream, or multi-byte CJK chars become U+FFFD.
 */
export function decodeCliBuffer(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!buf.length) return "";
  const utf8 = buf.toString("utf8");
  if (!utf8.includes("\uFFFD")) return utf8;
  for (const label of ["gb18030", "gbk"]) {
    try {
      const decoded = new TextDecoder(label).decode(buf);
      if (decoded && !decoded.includes("\uFFFD")) return decoded;
      // Prefer fewer replacement chars than UTF-8 produced.
      if ((decoded.match(/\uFFFD/g) || []).length < (utf8.match(/\uFFFD/g) || []).length) {
        return decoded;
      }
    } catch {
      // encoding not available in this Node build
    }
  }
  return utf8;
}

function trimBuffer(buf, maxBytes) {
  if (!buf || buf.length <= maxBytes) return buf || Buffer.alloc(0);
  return buf.subarray(buf.length - maxBytes);
}

async function runCliProcess({
  command,
  args,
  cwd,
  env,
  shell,
  input,
  timeoutMs,
  signal,
}) {
  if (signal?.aborted) throw abortError(signal.reason);
  return new Promise((resolveResult, rejectResult) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        windowsHide: true,
        shell,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      rejectResult(error);
      return;
    }

    /** @type {Buffer[]} */
    const stdoutChunks = [];
    /** @type {Buffer[]} */
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timer = null;

    const killTree = () => {
      try {
        if (process.platform === "win32" && child.pid) {
          spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
            windowsHide: true,
            stdio: "ignore",
          });
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        try { child.kill(); } catch { /* ignore */ }
      }
    };

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) rejectResult(error);
      else resolveResult(result);
    };

    const snapshot = (timedOut, code) => {
      const stdoutBuf = trimBuffer(Buffer.concat(stdoutChunks), MAX_CLI_OUTPUT_BYTES);
      const stderrBuf = trimBuffer(Buffer.concat(stderrChunks), MAX_CLI_OUTPUT_BYTES);
      return {
        timedOut,
        code,
        stdout: decodeCliBuffer(stdoutBuf),
        stderr: decodeCliBuffer(stderrBuf),
      };
    };

    const onAbort = () => {
      killTree();
      finish(abortError(signal.reason));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    timer = setTimeout(() => {
      killTree();
      finish(null, snapshot(true, null));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutChunks.push(buf);
      stdoutBytes += buf.length;
      if (stdoutBytes > MAX_CLI_OUTPUT_BYTES * 2) {
        // keep memory bounded; final trim still applied in snapshot
        const merged = trimBuffer(Buffer.concat(stdoutChunks), MAX_CLI_OUTPUT_BYTES);
        stdoutChunks.length = 0;
        stdoutChunks.push(merged);
        stdoutBytes = merged.length;
      }
    });
    child.stderr.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrChunks.push(buf);
      stderrBytes += buf.length;
      if (stderrBytes > MAX_CLI_OUTPUT_BYTES * 2) {
        const merged = trimBuffer(Buffer.concat(stderrChunks), MAX_CLI_OUTPUT_BYTES);
        stderrChunks.length = 0;
        stderrChunks.push(merged);
        stderrBytes = merged.length;
      }
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      // Give Windows a beat to release cwd locks held by sandbox children.
      const delay = process.platform === "win32" ? 200 : 0;
      setTimeout(() => finish(null, snapshot(false, code)), delay);
    });

    if (input != null) {
      child.stdin.write(Buffer.from(String(input), "utf8"));
    }
    child.stdin.end();
  });
}

export function buildAntigravityPrompt(bundle, textPrompt, outputSchema, attachments = [], workspacePath = "") {
  const mediaLines = attachments.length
    ? attachments.map((item, index) => {
        const marker = item.marker || `@素材${index + 1}`;
        const file = item.workspaceName || basename(item.path || `file-${index + 1}`);
        // Absolute path preferred: agy may pin agent cwd to antigravity-cli/scratch.
        const abs = item.path
          ? String(item.path).replace(/\\/g, "/")
          : (workspacePath ? `${String(workspacePath).replace(/\\/g, "/")}/media/${file}` : `media/${file}`);
        if (item.kind === "video") {
          return `- 文件 ${abs}（相对 media/${file}）= ${marker} 的第 ${item.frameIndex}/${item.frameCount} 帧（仅供理解动作；最终提示词仍写 ${marker.replace(/第.*/, "") || marker}）`;
        }
        return `- 文件 ${abs}（相对 media/${file}）= ${marker}（图片参考；最终提示词必须使用 ${marker}）`;
      }).join("\n")
    : "- 本次没有可嵌入的参考图文件；仅使用任务正文中的 @图片N / @视频N 编号。";

  const workspaceHint = workspacePath
    ? `Workspace root (absolute): ${String(workspacePath).replace(/\\/g, "/")}`
    : "Workspace root: current working directory only.";

  const guidance = bundle
    ? [
        `The following locally bundled ${bundle.label} skill is mandatory.`,
        promptSkillInstructions(bundle, { includeAllReferences: true }),
      ]
    : [
        "The user explicitly selected No Skill. No skill bundle is mounted.",
        "Do not load, call, imitate, search for, or claim to use any skill. Follow only the Agent Canvas task.",
      ];

  return [
    "You are the isolated Antigravity provider for Agent Canvas.",
    "Hard rules:",
    "1) Only open files under the workspace root listed below (or the absolute media paths). Do not search the whole disk or antigravity-cli/scratch for task files.",
    "2) Do not run shell commands, install packages, browse the web, call MCP, or spawn subagents.",
    "3) Do not execute dreamina or generate videos.",
    "4) Your final message must be exactly one JSON object with keys prompt, title, changes.",
    "5) No markdown fences, no commentary before or after the JSON.",
    workspaceHint,
    ...guidance,
    "\n--- Local media files ---\n",
    mediaLines,
    "\n--- Agent Canvas task ---\n",
    textPrompt,
    "\nReturn exactly one JSON object matching this schema:",
    JSON.stringify(outputSchema),
  ].join("\n");
}

async function safeRemoveDir(path, { attempts = 6, delayMs = 120 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 80 });
      return;
    } catch (error) {
      lastError = error;
      const code = error?.code || "";
      // Windows: agy/sandbox often keeps the cwd open briefly after exit.
      if (!["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"].includes(code) && i === attempts - 1) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
    }
  }
  // Never fail the task because of temp cleanup; log for operators.
  console.warn(`[antigravity] temp cleanup skipped: ${redactDiagnostic(lastError?.message || lastError)} (${path})`);
}

async function materializeWorkspace(bundle, attachments = []) {
  const workspacePath = await mkdtemp(join(tmpdir(), "prompt-flow-antigravity-"));
  const mediaDir = join(workspacePath, "media");
  await mkdir(mediaDir, { recursive: true });
  if (bundle) {
    const skillRoot = join(workspacePath, ".agents", "skills", bundle.id);
    for (const document of bundle.documents) {
      const destination = join(skillRoot, ...document.name.split("/"));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, document.content, "utf8");
    }
  }
  const preparedAttachments = [];
  for (const [index, attachment] of attachments.entries()) {
    if (!attachment?.path) continue;
    const ext = extname(attachment.path) || ".png";
    const workspaceName = `ref-${index + 1}${ext}`;
    const destination = join(mediaDir, workspaceName);
    await copyFile(attachment.path, destination);
    preparedAttachments.push({ ...attachment, path: destination, workspaceName });
  }
  await writeFile(
    join(workspacePath, "AGENTS.md"),
    bundle
      ? `# Agent Canvas Antigravity workspace\n\nRead-only ${bundle.label} prompt rewrite task. Do not modify files.\n`
      : "# Agent Canvas Antigravity workspace\n\nNo Skill is loaded for this prompt rewrite task. Do not search for or use skills. Do not modify files.\n",
    "utf8",
  );
  return {
    workspacePath,
    attachments: preparedAttachments,
    cleanup: () => safeRemoveDir(workspacePath),
  };
}

async function listAgyModels(command, runtime = {}) {
  const shell = commandUsesShell(command, runtime);
  const env = { ...runtimeSourceEnvironment(runtime), CI: "true", NO_COLOR: "1" };
  const result = await runCliProcess({
    command,
    args: ["models"],
    cwd: process.cwd(),
    env,
    shell,
    input: null,
    timeoutMs: 15_000,
    signal: runtime.signal,
  });
  if (result.timedOut || (result.code && result.code !== 0)) return [];
  return parseAgyModelsOutput(result.stdout || result.stderr);
}

async function probeAuth(runtime = {}) {
  const command = await resolveAntigravityCommand(runtime);
  const shell = commandUsesShell(command, runtime);
  const env = { ...runtimeSourceEnvironment(runtime) };
  env.CI = env.CI || "true";
  env.NO_COLOR = "1";
  const agy = isAgyCommand(command);
  const args = agy
    ? ["-p", "Reply with exactly OK.", "--mode", "plan", "--print-timeout", "1m"]
    : ["-p", "Reply with exactly OK.", "-o", "text", "--approval-mode", "plan"];
  const result = await runCliProcess({
    command,
    args,
    cwd: runtime.cwd || process.cwd(),
    env,
    shell,
    input: null,
    timeoutMs: Math.max(PROBE_TIMEOUT_MS, 60_000),
    signal: runtime.signal,
  });
  const detail = `${result.stderr}\n${result.stdout}`;
  if (result.timedOut) {
    return { ready: false, installed: true, loggedIn: false, message: "探测 Antigravity CLI 超时" };
  }
  if (/ENOENT|not found|不是内部或外部命令|Cannot find/i.test(detail) || result.code === 127) {
    return {
      ready: false,
      installed: false,
      loggedIn: false,
      message: "未找到 Antigravity CLI（agy）。个人/Pro/Ultra 订阅请安装官方 agy（不要再用 gemini CLI）。Windows: irm https://antigravity.google/cli/install.ps1 | iex ，然后运行 scripts/antigravity-verify.cmd",
    };
  }
  if (result.code && result.code !== 0) {
    if (/FatalAuthenticationError|Manual authorization|non-interactive|not signed in|login/i.test(detail)) {
      return {
        ready: false,
        installed: true,
        loggedIn: false,
        message: authFailureMessage(detail),
      };
    }
    return {
      ready: false,
      installed: true,
      loggedIn: false,
      message: authFailureMessage(detail),
    };
  }
  const listed = agy ? await listAgyModels(command, runtime) : [];
  return {
    ready: true,
    installed: true,
    loggedIn: true,
    message: null,
    models: listed.length ? listed : ANTIGRAVITY_FALLBACK_MODELS.map((model) => ({ ...model })),
  };
}

async function freshStatus(runtime = {}) {
  try {
    const command = await resolveAntigravityCommand(runtime);
    // Quick existence check via version-like invocation
    const shell = commandUsesShell(command, runtime);
    const version = await runCliProcess({
      command,
      args: ["--version"],
      cwd: process.cwd(),
      env: { ...runtimeSourceEnvironment(runtime), CI: "true", NO_COLOR: "1" },
      shell,
      input: null,
      timeoutMs: 10_000,
      signal: runtime.signal,
    });
    if (version.timedOut) {
      return {
        ready: false,
        installed: false,
        loggedIn: false,
        models: [],
        message: "无法启动 Antigravity / Gemini CLI（version 超时）",
      };
    }
    if (version.code && version.code !== 0 && /ENOENT|not found|不是内部或外部命令/i.test(`${version.stderr}${version.stdout}`)) {
      return {
        ready: false,
        installed: false,
        loggedIn: false,
        models: [],
        message: "未找到 Antigravity CLI（agy）。请安装官方 CLI：irm https://antigravity.google/cli/install.ps1 | iex ，再运行 scripts/antigravity-verify.cmd 完成登录验证。",
      };
    }

    const auth = await probeAuth(runtime);
    return {
      ready: Boolean(auth.ready),
      installed: Boolean(auth.installed),
      loggedIn: Boolean(auth.loggedIn),
      models: auth.ready ? (auth.models || ANTIGRAVITY_FALLBACK_MODELS.map((model) => ({ ...model }))) : [],
      message: auth.message,
      cliVersion: String(version.stdout || version.stderr || "").trim().split(/\r?\n/)[0] || undefined,
      command,
    };
  } catch (error) {
    return {
      ready: false,
      installed: false,
      loggedIn: false,
      models: [],
      message: authFailureMessage(error?.message || error),
    };
  }
}

export async function getAntigravityStatus({ force = false, runtime = {} } = {}) {
  const cacheable = !Object.keys(runtime).length;
  if (!force && cacheable && statusCache && Date.now() - statusCache.loadedAt < STATUS_CACHE_MS) {
    return statusCache.value;
  }
  const value = await freshStatus(runtime);
  if (cacheable) statusCache = { loadedAt: Date.now(), value };
  return value;
}

export async function getAntigravityModels(options = {}) {
  const status = await getAntigravityStatus(options);
  return status.ready ? status.models : [];
}

export async function runAntigravityRefine({
  model,
  reasoningEffort = "medium",
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
  // Antigravity model labels look like "Gemini 3.5 Flash (Low)".
  if (!/^[A-Za-z0-9._:()/\- ]{1,160}$/.test(String(model || ""))) {
    throw new Error("Antigravity 模型 ID 无效");
  }
  if (signal?.aborted) throw abortError(signal.reason);

  const status = await getAntigravityStatus({ force: true, runtime: { ...runtime, signal } });
  if (!status.ready) {
    throw new Error(status.message || "Antigravity 尚未就绪");
  }

  const noSkill = isPromptSkillDisabled(skillId);
  const bundle = noSkill ? null : await loadPromptSkillBundle(skillId, skillPath || seedanceSkillPath);
  const logicalSessionId = createAntigravitySessionId(threadId);
  const prepared = await materializeWorkspace(bundle, attachments);
  const command = await resolveAntigravityCommand(runtime);
  const shell = commandUsesShell(command, runtime);
  const env = { ...runtimeSourceEnvironment(runtime), CI: "true", NO_COLOR: "1" };
  const fullPrompt = buildAntigravityPrompt(
    bundle,
    textPrompt,
    outputSchema,
    prepared.attachments,
    prepared.workspacePath,
  );
  const agy = isAgyCommand(command);

  // Skill bundles can exceed Windows argv limits. Keep full instructions in PROMPT.md.
  // Headless agy denies tool permission by default ("command" permission), which yields empty output
  // if we only say "read PROMPT.md" without --dangerously-skip-permissions.
  //
  // Critical: some models (notably Claude Opus via agy) report cwd as
  // ~/.gemini/antigravity-cli/scratch and ignore spawn cwd. Always pass an absolute PROMPT path
  // and --add-dir so the agent can open the file outside that scratch root.
  const promptFile = join(prepared.workspacePath, "PROMPT.md");
  // UTF-8 with BOM helps some Windows tools detect encoding when reading the file.
  await writeFile(promptFile, `\uFEFF${fullPrompt}`, "utf8");

  // Prefer forward slashes in the instruction text — more robust across agent tool resolvers.
  const promptFileForAgent = promptFile.replace(/\\/g, "/");
  const workspaceForAgent = prepared.workspacePath.replace(/\\/g, "/");

  const shortInstruction = [
    `Open ONLY this absolute file path (read it fully; do not invent a relative PROMPT.md): ${promptFileForAgent}`,
    `If tools need a workspace root, use: ${workspaceForAgent}`,
    "Do not look under antigravity-cli/scratch, the user home folder, or other projects for PROMPT.md.",
    "Follow that PROMPT.md exactly.",
    "Your entire final answer must be one JSON object with keys prompt, title, changes.",
    "No markdown fences, no tool chatter, no extra text.",
  ].join(" ");

  const args = agy
    ? [
        "-p", shortInstruction,
        "--mode", "plan",
        // Required so headless mode can read PROMPT.md (and optional media/*) without interactive prompts.
        "--dangerously-skip-permissions",
        // Bind our temp workspace into agy's allowed dirs (spawn cwd alone is not enough for Claude).
        "--add-dir", prepared.workspacePath,
        "--new-project",
        "--model", String(model),
        "--print-timeout", formatPrintTimeout(timeoutMs),
      ]
    : [
        "-p", shortInstruction,
        "-m", String(model),
        "-o", "text",
        "--approval-mode", "plan",
      ];

  try {
    const result = await runCliProcess({
      command,
      args,
      cwd: prepared.workspacePath,
      env,
      shell,
      input: null,
      timeoutMs: Math.max(timeoutMs + 15_000, 60_000),
      signal,
    });
    if (signal?.aborted) throw abortError(signal.reason);
    if (result.timedOut) {
      throw new Error("Antigravity 处理超过时限，已停止；可降低思考强度或缩短需求后重试");
    }
    const combined = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    if (result.code && result.code !== 0) {
      // Some builds print the model answer on stdout even with non-zero; try parse first.
      try {
        const recovered = parseGeminiCliJsonOutput(combined);
        return {
          ...recovered,
          threadId: logicalSessionId,
          usage: null,
          provider: ANTIGRAVITY_PROVIDER_ID,
          skill: !noSkill,
          skillId: noSkill ? "none" : bundle.id,
          skillHash: noSkill ? null : bundle.hash,
          seedanceSkill: !noSkill && bundle.id === "seedance",
          seedanceSkillId: !noSkill && bundle.id === "seedance" ? bundle.id : undefined,
          seedanceSkillHash: !noSkill && bundle.id === "seedance" ? bundle.hash : undefined,
          sessionMode: "stateless",
          model,
          reasoningEffort,
        };
      } catch {
        if (/no output produced|permission that headless mode cannot prompt/i.test(combined)) {
          throw new Error(
            "Antigravity headless 无法读取任务文件（权限被拒绝）。请升级 agy，或确认画板使用 --dangerously-skip-permissions 的隔离工作区调用。",
          );
        }
        if (/PROMPT\.md was not found|not found in the current working directory|antigravity-cli[/\\]scratch/i.test(combined)) {
          throw new Error(
            "Antigravity 仍在默认 scratch 目录找 PROMPT.md，未读到隔离工作区任务文件。请确认已用带 --add-dir 的最新画板桥接，并重试 Claude 模型。",
          );
        }
        throw new Error(authFailureMessage(combined));
      }
    }
    if (!String(result.stdout || "").trim() && /no output produced/i.test(result.stderr || "")) {
      throw new Error(
        "Antigravity 未产生输出：headless 下读取 PROMPT.md 的权限被拒绝。请重试；若持续失败，把 agy 版本发我。",
      );
    }
    // Model returned prose about missing PROMPT.md instead of JSON — treat as structured failure.
    if (/PROMPT\.md was not found|not found in the current working directory/i.test(combined)
      && !/"prompt"\s*:/.test(combined)) {
      throw new Error(
        "Antigravity 模型没有打开任务文件（仍在 antigravity-cli/scratch 找相对路径 PROMPT.md）。已改为绝对路径 + --add-dir；请刷新后重试。",
      );
    }
    const parsed = parseGeminiCliJsonOutput(combined);
    return {
      ...parsed,
      threadId: logicalSessionId,
      usage: null,
      provider: ANTIGRAVITY_PROVIDER_ID,
      skill: !noSkill,
      skillId: noSkill ? "none" : bundle.id,
      skillHash: noSkill ? null : bundle.hash,
      seedanceSkill: !noSkill && bundle.id === "seedance",
      seedanceSkillId: !noSkill && bundle.id === "seedance" ? bundle.id : undefined,
      seedanceSkillHash: !noSkill && bundle.id === "seedance" ? bundle.hash : undefined,
      sessionMode: "stateless",
      model,
      reasoningEffort,
    };
  } finally {
    // Cleanup must never mask a successful model result (Windows EBUSY on temp dirs).
    try {
      await prepared.cleanup();
    } catch (error) {
      console.warn(`[antigravity] cleanup error ignored: ${redactDiagnostic(error?.message || error)}`);
    }
  }
}
