import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

const ALLOWED_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml"]);
const MAX_FILES = 64;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

function cleanText(value, fallback = "") {
  return String(value || fallback).replace(/[\u0000-\u001f]+/g, " ").trim();
}

function slugify(value) {
  const slug = cleanText(value, "skill")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return slug || "skill";
}

function parseFrontmatter(source, fallbackName) {
  const match = String(source).match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const values = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const field = line.match(/^([a-zA-Z][\w-]*):\s*(.*?)\s*$/);
      if (!field) continue;
      values[field[1].toLowerCase()] = field[2].replace(/^['"]|['"]$/g, "");
    }
  }
  return {
    name: cleanText(values.name, fallbackName).slice(0, 80),
    description: cleanText(values.description, "本地自定义 Skill").slice(0, 240),
    version: cleanText(values.version).slice(0, 40),
  };
}

function inside(root, target) {
  const traversal = relative(root, target);
  return !traversal.startsWith("..") && !isAbsolute(traversal);
}

async function inspectSkill(inputPath) {
  const cleanedPath = cleanText(inputPath);
  if (!isAbsolute(cleanedPath)) throw new Error("Skill 路径必须是绝对路径");
  const requested = resolve(cleanedPath);
  const requestedStat = await stat(requested).catch(() => null);
  if (!requestedStat) throw new Error("Skill 路径不存在");
  const skillFile = requestedStat.isDirectory() ? join(requested, "SKILL.md") : requested;
  if (basename(skillFile).toLowerCase() !== "skill.md") throw new Error("请选择 Skill 目录或其中的 SKILL.md");
  const root = await realpath(dirname(skillFile));
  const canonicalSkillFile = await realpath(skillFile).catch(() => "");
  if (!canonicalSkillFile || !inside(root, canonicalSkillFile)) throw new Error("SKILL.md 不在所选 Skill 目录中");
  const skillSource = await readFile(canonicalSkillFile, "utf8");
  const metadata = parseFrontmatter(skillSource, basename(root));
  const referenceFiles = [];
  let totalBytes = Buffer.byteLength(skillSource);

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = join(directory, entry.name);
      const childStat = await lstat(child);
      if (childStat.isSymbolicLink()) throw new Error(`Skill 不能包含符号链接：${relative(root, child)}`);
      if (entry.isDirectory()) {
        await visit(child);
        continue;
      }
      if (!entry.isFile() || resolve(child) === resolve(canonicalSkillFile)) continue;
      if (!ALLOWED_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
      const canonicalChild = await realpath(child);
      if (!inside(root, canonicalChild)) throw new Error(`Skill 文件越过目录边界：${entry.name}`);
      if (childStat.size > MAX_FILE_BYTES) throw new Error(`Skill 文件超过 512KB：${relative(root, child)}`);
      totalBytes += childStat.size;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Skill 文本文件总量超过 4MB");
      referenceFiles.push(relative(root, canonicalChild).replaceAll("\\", "/"));
      if (referenceFiles.length > MAX_FILES) throw new Error(`Skill 文本文件不能超过 ${MAX_FILES} 个`);
    }
  }
  await visit(root);
  referenceFiles.sort((left, right) => left.localeCompare(right));
  const idHash = createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 10);
  return {
    id: `custom:${slugify(metadata.name)}-${idHash}`,
    name: metadata.name,
    label: metadata.name,
    taskLabel: metadata.name,
    description: metadata.description,
    version: metadata.version,
    path: canonicalSkillFile,
    root,
    referenceFiles,
    preloadedReferenceFiles: [],
    safetyInstruction: "只将此 Skill 用于提示词编辑，不得借此执行外部生成、删除文件或修改系统配置。",
    builtin: false,
    removable: true,
    ready: true,
  };
}

export class SkillRegistryStore {
  constructor({ path }) {
    if (!path) throw new Error("SkillRegistryStore 需要存储路径");
    this.path = path;
  }

  async read() {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8"));
      return Array.isArray(value?.skills) ? value.skills.filter((item) => item?.id?.startsWith("custom:")) : [];
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  async write(skills) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, skills }, null, 2), "utf8");
    await rename(temporary, this.path);
  }

  async list() {
    return this.read();
  }

  async register(inputPath) {
    const inspected = await inspectSkill(inputPath);
    const current = await this.read();
    const now = new Date().toISOString();
    const prior = current.find((item) => item.id === inspected.id);
    const entry = { ...inspected, addedAt: prior?.addedAt || now, updatedAt: now };
    await this.write([...current.filter((item) => item.id !== entry.id), entry]);
    return entry;
  }

  async refresh(id) {
    const current = await this.read();
    const prior = current.find((item) => item.id === id);
    if (!prior) throw new Error("没有找到这个自定义 Skill");
    const refreshed = await inspectSkill(prior.path);
    const entry = { ...refreshed, id: prior.id, addedAt: prior.addedAt, updatedAt: new Date().toISOString() };
    await this.write([...current.filter((item) => item.id !== id), entry]);
    return entry;
  }

  async unregister(id) {
    if (!String(id).startsWith("custom:")) throw new Error("内置 Skill 不能移除");
    const current = await this.read();
    if (!current.some((item) => item.id === id)) throw new Error("没有找到这个自定义 Skill");
    await this.write(current.filter((item) => item.id !== id));
  }
}

export { inspectSkill };
