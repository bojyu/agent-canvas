import { createWriteStream } from "node:fs";
import { access, copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
export const DEFAULT_MEDIA_OUTPUT_DIRECTORY = join(projectRoot, ".prompt-flow-data", "outputs");
export const MEDIA_OUTPUT_SETTINGS_PATH = join(projectRoot, ".prompt-flow-data", "media-settings.json");

function normalizeDirectory(value) {
  const directory = String(value || "").trim();
  if (!directory) throw new Error("保存目录不能为空");
  if (directory.includes("\0")) throw new Error("保存目录包含无效字符");
  if (!isAbsolute(directory)) throw new Error("请输入本机绝对路径");
  return directory;
}

async function ensureWritableDirectory(directory) {
  await mkdir(directory, { recursive: true });
  await access(directory, constants.W_OK);
  return directory;
}

export async function getMediaOutputSettings() {
  let directory = DEFAULT_MEDIA_OUTPUT_DIRECTORY;
  try {
    const stored = JSON.parse(await readFile(MEDIA_OUTPUT_SETTINGS_PATH, "utf8"));
    directory = normalizeDirectory(stored?.directory);
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  await ensureWritableDirectory(directory);
  return { directory, defaultDirectory: DEFAULT_MEDIA_OUTPUT_DIRECTORY };
}

export async function setMediaOutputDirectory(value) {
  const directory = await ensureWritableDirectory(normalizeDirectory(value));
  await mkdir(fileURLToPath(new URL("../.prompt-flow-data/", import.meta.url)), { recursive: true });
  const temporaryPath = `${MEDIA_OUTPUT_SETTINGS_PATH}.tmp`;
  await writeFile(temporaryPath, JSON.stringify({ directory }, null, 2), "utf8");
  await rename(temporaryPath, MEDIA_OUTPUT_SETTINGS_PATH);
  return { directory, defaultDirectory: DEFAULT_MEDIA_OUTPUT_DIRECTORY };
}

function safeToken(value, fallback) {
  const normalized = String(value || "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36);
  return normalized || fallback;
}

function extensionFor(mediaType, source, kind) {
  const normalized = String(mediaType || "").toLowerCase().split(";")[0];
  const known = {
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
    "image/png": ".png",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "video/mp4": ".mp4",
  }[normalized];
  if (known) return known;
  try {
    const suffix = extname(new URL(source).pathname).toLowerCase();
    if (/^\.[a-z0-9]{2,5}$/.test(suffix)) return suffix;
  } catch { /* Data URLs and local paths fall back to the media kind. */ }
  return kind === "image" ? ".png" : ".mp4";
}

function outputPath(directory, kind, taskId, index, mediaType, source) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const id = safeToken(taskId, "task").slice(0, 12);
  const suffix = String(index + 1).padStart(2, "0");
  return join(directory, `${kind}-${stamp}-${id}-${suffix}${extensionFor(mediaType, source, kind)}`);
}

async function writeDataUrl(source, destination) {
  const match = String(source).match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (!match) throw new Error("媒体 Data URL 格式无效");
  await writeFile(destination, Buffer.from(match[2].replace(/\s+/g, ""), "base64"));
}

async function downloadRemote(source, destination, fetchImpl, signal) {
  const response = await fetchImpl(source, { signal });
  if (!response.ok || !response.body) throw new Error(`下载生成媒体失败：HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, { flags: "wx" }));
}

async function saveOne(item, kind, taskId, index, directory, fetchImpl, signal) {
  const source = kind === "image" ? item?.dataUrl : item?.url;
  if (typeof source !== "string" || !source.trim()) throw new Error("生成结果缺少媒体地址");
  const destination = outputPath(directory, kind, taskId, index, item?.mediaType, source);
  try {
    if (source.startsWith("data:")) await writeDataUrl(source, destination);
    else if (/^https?:\/\//i.test(source)) await downloadRemote(source, destination, fetchImpl, signal);
    else if (/^file:/i.test(source)) await copyFile(fileURLToPath(source), destination);
    else throw new Error("生成结果使用了不支持的媒体地址");
    return { ...item, savedPath: destination };
  } catch (error) {
    await unlink(destination).catch(() => {});
    throw error;
  }
}

export async function saveGeneratedMedia(kind, items, {
  taskId,
  fetchImpl = fetch,
  signal,
  directory,
} = {}) {
  if (kind !== "image" && kind !== "video") throw new Error("不支持的媒体类型");
  const settings = directory
    ? { directory: await ensureWritableDirectory(normalizeDirectory(directory)), defaultDirectory: DEFAULT_MEDIA_OUTPUT_DIRECTORY }
    : await getMediaOutputSettings();
  const savedItems = [];
  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    savedItems.push(await saveOne(item, kind, taskId, index, settings.directory, fetchImpl, signal));
  }
  return {
    items: savedItems,
    savedFiles: savedItems.map((item) => item.savedPath),
    directory: settings.directory,
  };
}
