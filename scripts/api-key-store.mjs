import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

export const API_KEY_NAMES = Object.freeze([
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "COMFLY_API_KEY",
  "COMFLY_LLM_API_KEY",
  "COMFLY_GPT_IMAGE_2_1K_API_KEY",
  "COMFLY_GPT_IMAGE_2_2K_API_KEY",
  "COMFLY_GPT_IMAGE_2_4K_API_KEY",
]);

const API_KEY_NAME_SET = new Set(API_KEY_NAMES);
const MAX_API_KEY_LENGTH = 16_384;
const pendingSaves = new Map();

function normalizedApiKey(value) {
  if (value === null) return null;
  if (typeof value !== "string") throw new TypeError("API 密钥必须是字符串或 null");
  const normalized = value.trim();
  if (!normalized) throw new TypeError("API 密钥不能为空；如需删除请使用清除按钮");
  if (normalized.length > MAX_API_KEY_LENGTH) throw new TypeError("API 密钥长度超过限制");
  if (/\r|\n|\0/.test(normalized)) throw new TypeError("API 密钥不能包含换行或空字符");
  return normalized;
}

export function normalizeApiKeyChanges(changes) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new TypeError("缺少 API 密钥修改内容");
  }
  const normalized = {};
  for (const [name, value] of Object.entries(changes)) {
    if (!API_KEY_NAME_SET.has(name)) throw new TypeError(`不支持的 API 密钥：${name}`);
    normalized[name] = normalizedApiKey(value);
  }
  if (!Object.keys(normalized).length) throw new TypeError("没有需要保存的 API 密钥修改");
  return normalized;
}

export function apiKeyStatus(env = process.env) {
  return Object.fromEntries(API_KEY_NAMES.map((name) => [name, Boolean(String(env[name] || "").trim())]));
}

function envAssignmentName(line) {
  return line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1] || "";
}

export function updateEnvText(source, changes) {
  const normalized = normalizeApiKeyChanges(changes);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source ? source.split(/\r?\n/) : [];
  if (lines.at(-1) === "") lines.pop();
  const handled = new Set();
  const updated = [];

  for (const line of lines) {
    const name = envAssignmentName(line);
    if (!(name in normalized)) {
      updated.push(line);
      continue;
    }
    if (handled.has(name)) continue;
    handled.add(name);
    const value = normalized[name];
    if (value !== null) updated.push(`${name}=${JSON.stringify(value)}`);
  }

  for (const [name, value] of Object.entries(normalized)) {
    if (handled.has(name) || value === null) continue;
    updated.push(`${name}=${JSON.stringify(value)}`);
  }

  return updated.length ? `${updated.join(newline)}${newline}` : "";
}

export async function saveApiKeyChanges(envPath, changes, env = process.env) {
  const normalized = normalizeApiKeyChanges(changes);
  const path = resolve(envPath);
  const previous = pendingSaves.get(path) || Promise.resolve();
  const pending = previous.catch(() => {}).then(() => persistApiKeyChanges(path, normalized, env));
  pendingSaves.set(path, pending);
  try {
    return await pending;
  } finally {
    if (pendingSaves.get(path) === pending) pendingSaves.delete(path);
  }
}

async function persistApiKeyChanges(envPath, normalized, env) {
  let source = "";
  try {
    source = await readFile(envPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  // Replace the file atomically, including when an existing file is too public.
  const temporaryPath = `${envPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, updateEnvText(source, normalized), { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporaryPath, envPath);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
  for (const [name, value] of Object.entries(normalized)) {
    if (value === null) delete env[name];
    else env[name] = value;
  }
  return {
    configured: apiKeyStatus(env),
    envFile: basename(envPath),
  };
}

export function getApiKeySettings(envPath, env = process.env) {
  return {
    configured: apiKeyStatus(env),
    envFile: basename(envPath),
  };
}
