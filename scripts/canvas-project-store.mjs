import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CANVAS_SCHEMA_VERSION, applyCanvasOperations, validateCanvasProject } from "./canvas-domain.mjs";

export class CanvasStoreError extends Error {
  constructor(status, message, code = "CANVAS_STORE_ERROR") {
    super(message);
    this.name = "CanvasStoreError";
    this.status = status;
    this.code = code;
  }
}

export class CanvasRevisionConflictError extends CanvasStoreError {
  constructor(expectedRevision, actualRevision) {
    super(409, `画布版本冲突：期望 revision ${expectedRevision}，当前为 ${actualRevision}`, "REVISION_CONFLICT");
    this.name = "CanvasRevisionConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export function validCanvasProjectId(id) {
  return /^[a-zA-Z0-9-]{8,80}$/.test(String(id || ""));
}

export function normalizeCanvasProjectName(value) {
  const name = String(value || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 60);
  return name || "未命名画布";
}

function normalizeRevision(value, fallback = 1) {
  const revision = Number(value);
  return Number.isInteger(revision) && revision > 0 ? revision : fallback;
}

function normalizeLoadedProject(record) {
  if (!record || typeof record !== "object") throw new Error("画布文件内容无效");
  const project = validateCanvasProject({
    ...record,
    schemaVersion: normalizeRevision(record.schemaVersion, CANVAS_SCHEMA_VERSION),
    revision: normalizeRevision(record.revision),
    name: normalizeCanvasProjectName(record.name),
  });
  return project;
}

export function canvasProjectSummary(record) {
  const referenceNodes = record.nodes.filter((node) => node?.type === "reference" || node?.type === "video");
  const hasImages = (node) => Boolean(node?.data?.imageData || node?.data?.generatedImages?.length);
  const hasVideos = (node) => Boolean(node?.data?.videoData || node?.data?.generatedVideos?.length);
  return {
    id: record.id,
    name: record.name,
    schemaVersion: record.schemaVersion || CANVAS_SCHEMA_VERSION,
    revision: normalizeRevision(record.revision),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    referenceCount: referenceNodes.length,
    imageCount: record.nodes.filter((node) => node?.type === "reference" && hasImages(node)).length,
    mediaCount: referenceNodes.filter((node) => hasImages(node) || hasVideos(node)).length,
  };
}

export class CanvasProjectStore {
  constructor({ directory, onChange } = {}) {
    if (!directory) throw new Error("CanvasProjectStore 需要 directory");
    this.directory = directory;
    this.onChange = typeof onChange === "function" ? onChange : null;
    this.locks = new Map();
  }

  paths(id) {
    if (!validCanvasProjectId(id)) throw new CanvasStoreError(400, "画布文件 ID 无效", "INVALID_PROJECT_ID");
    return {
      canvas: join(this.directory, `${id}.json`),
      meta: join(this.directory, `${id}.meta.json`),
    };
  }

  async atomicWrite(path, value) {
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(value), "utf8");
    try {
      await rename(temporaryPath, path);
    } catch (error) {
      try { await unlink(temporaryPath); } catch {}
      throw error;
    }
  }

  async withLock(id, callback) {
    const previous = this.locks.get(id) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const queued = previous.catch(() => {}).then(() => gate);
    this.locks.set(id, queued);
    await previous.catch(() => {});
    try {
      return await callback();
    } finally {
      release();
      if (this.locks.get(id) === queued) this.locks.delete(id);
    }
  }

  async readUnlocked(id) {
    try {
      return normalizeLoadedProject(JSON.parse(await readFile(this.paths(id).canvas, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      if (error instanceof CanvasStoreError) throw error;
      throw new CanvasStoreError(500, `无法读取画布：${error?.message || error}`, "PROJECT_READ_FAILED");
    }
  }

  async readProject(id) {
    if (!validCanvasProjectId(id)) return null;
    return this.withLock(id, () => this.readUnlocked(id));
  }

  async listProjects() {
    await mkdir(this.directory, { recursive: true });
    const files = await readdir(this.directory, { withFileTypes: true });
    const summaries = await Promise.all(files
      .filter((entry) => entry.isFile() && entry.name.endsWith(".meta.json"))
      .map(async (entry) => {
        try {
          const value = JSON.parse(await readFile(join(this.directory, entry.name), "utf8"));
          return { ...value, schemaVersion: normalizeRevision(value.schemaVersion, CANVAS_SCHEMA_VERSION), revision: normalizeRevision(value.revision) };
        } catch {
          return null;
        }
      }));
    return summaries.filter(Boolean).sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  }

  async writeUnlocked(id, payload, { current, expectedRevision, actor = "ui", transactionId, broadcast = true } = {}) {
    if (!Array.isArray(payload?.nodes) || !Array.isArray(payload?.edges)) throw new CanvasStoreError(400, "画布数据不完整", "INVALID_PROJECT");
    const actualRevision = current ? normalizeRevision(current.revision) : 0;
    if (expectedRevision !== undefined && expectedRevision !== null && Number(expectedRevision) !== actualRevision) {
      throw new CanvasRevisionConflictError(Number(expectedRevision), actualRevision);
    }
    const now = new Date().toISOString();
    const automation = {
      ...(current?.automation && typeof current.automation === "object" ? current.automation : {}),
      ...(payload.automation && typeof payload.automation === "object" ? payload.automation : {}),
    };
    const record = normalizeLoadedProject({
      id,
      name: normalizeCanvasProjectName(payload.name || current?.name),
      schemaVersion: CANVAS_SCHEMA_VERSION,
      revision: actualRevision + 1,
      createdAt: current?.createdAt || now,
      updatedAt: now,
      nodes: payload.nodes,
      edges: payload.edges,
      ...(Object.keys(automation).length ? { automation } : {}),
    });
    await mkdir(this.directory, { recursive: true });
    const paths = this.paths(id);
    await this.atomicWrite(paths.canvas, record);
    await this.atomicWrite(paths.meta, canvasProjectSummary(record));
    const event = {
      type: "project",
      projectId: id,
      revision: record.revision,
      updatedAt: record.updatedAt,
      actor,
      transactionId: transactionId || null,
      project: canvasProjectSummary(record),
    };
    if (broadcast) this.onChange?.(event);
    return record;
  }

  async saveProject(id, payload, options = {}) {
    if (!validCanvasProjectId(id)) throw new CanvasStoreError(400, "画布文件 ID 无效", "INVALID_PROJECT_ID");
    return this.withLock(id, async () => {
      const current = await this.readUnlocked(id);
      return this.writeUnlocked(id, payload, { ...options, current });
    });
  }

  async createProject({ id = randomUUID(), name = "未命名画布", nodes = [], edges = [], actor = "automation" } = {}) {
    if (!validCanvasProjectId(id)) throw new CanvasStoreError(400, "画布文件 ID 无效", "INVALID_PROJECT_ID");
    return this.withLock(id, async () => {
      if (await this.readUnlocked(id)) throw new CanvasStoreError(409, "画布 ID 已存在", "PROJECT_EXISTS");
      return this.writeUnlocked(id, { name, nodes, edges }, { current: null, expectedRevision: 0, actor });
    });
  }

  async renameProject(id, name, options = {}) {
    return this.withLock(id, async () => {
      const current = await this.readUnlocked(id);
      if (!current) return null;
      return this.writeUnlocked(id, { ...current, name: normalizeCanvasProjectName(name) }, { ...options, current });
    });
  }

  async applyTransaction(id, { transactionId, expectedRevision, dryRun = false, operations } = {}) {
    const requestId = nonEmptyTransactionId(transactionId);
    return this.withLock(id, async () => {
      const current = await this.readUnlocked(id);
      if (!current) throw new CanvasStoreError(404, "没有找到这个画布", "PROJECT_NOT_FOUND");
      const actualRevision = normalizeRevision(current.revision);
      if (expectedRevision !== undefined && expectedRevision !== null && Number(expectedRevision) !== actualRevision) {
        throw new CanvasRevisionConflictError(Number(expectedRevision), actualRevision);
      }
      const priorTransactions = Array.isArray(current.automation?.transactions) ? current.automation.transactions : [];
      const duplicate = priorTransactions.find((entry) => entry?.id === requestId);
      if (duplicate) {
        return { project: current, summary: canvasProjectSummary(current), changes: duplicate.changes || {}, duplicate: true, dryRun: false };
      }
      const applied = applyCanvasOperations(current, operations, { dryRun });
      if (dryRun) {
        return {
          project: { ...applied.project, revision: actualRevision + 1 },
          summary: { ...canvasProjectSummary(applied.project), revision: actualRevision + 1 },
          changes: applied.changes,
          duplicate: false,
          dryRun: true,
        };
      }
      const transaction = { id: requestId, at: new Date().toISOString(), baseRevision: actualRevision, changes: applied.changes };
      applied.project.automation = {
        ...(current.automation || {}),
        transactions: [...priorTransactions, transaction].slice(-50),
      };
      const saved = await this.writeUnlocked(id, applied.project, { current, expectedRevision: actualRevision, actor: "automation", transactionId: requestId });
      return { project: saved, summary: canvasProjectSummary(saved), changes: applied.changes, duplicate: false, dryRun: false };
    });
  }

  async mutateProject(id, mutator, { expectedRevision, actor = "automation", transactionId } = {}) {
    return this.withLock(id, async () => {
      const current = await this.readUnlocked(id);
      if (!current) throw new CanvasStoreError(404, "没有找到这个画布", "PROJECT_NOT_FOUND");
      const next = await mutator(structuredClone(current));
      return this.writeUnlocked(id, next, { current, expectedRevision, actor, transactionId });
    });
  }
}

function nonEmptyTransactionId(value) {
  const id = String(value || "").trim();
  if (!id) throw new CanvasStoreError(400, "transactionId 不能为空", "INVALID_TRANSACTION_ID");
  if (id.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(id)) throw new CanvasStoreError(400, "transactionId 格式无效", "INVALID_TRANSACTION_ID");
  return id;
}
