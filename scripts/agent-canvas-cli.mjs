#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const BASE_URL = String(process.env.AGENT_CANVAS_BASE_URL || "http://127.0.0.1:4317").replace(/\/+$/, "");
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function usage() {
  return `Agent Canvas CLI

Usage:
  node scripts/agent-canvas-cli.mjs status
  node scripts/agent-canvas-cli.mjs projects
  node scripts/agent-canvas-cli.mjs inspect <projectId>
  node scripts/agent-canvas-cli.mjs create --name <name> [--preset prompt|image-generation|video-generation]
  node scripts/agent-canvas-cli.mjs models <prompt|image|video> <provider>
  node scripts/agent-canvas-cli.mjs apply <projectId> --file <transaction.json> [--dry-run]
  node scripts/agent-canvas-cli.mjs preset <projectId> <presetId> --expected-revision <n>
  node scripts/agent-canvas-cli.mjs attach <projectId> <nodeId> <absoluteFilePath> --expected-revision <n>
  node scripts/agent-canvas-cli.mjs run <projectId> <nodeId> --expected-revision <n> [--wait <seconds>]
  node scripts/agent-canvas-cli.mjs task <taskId> [--wait <seconds>]
  node scripts/agent-canvas-cli.mjs outputs <projectId>

Transactions use the same operation format as the Agent Canvas MCP canvas_apply_workflow tool.`;
}

function parseArguments(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) options[key] = true;
    else {
      options[key] = next;
      index += 1;
    }
  }
  return { positional, options };
}

async function request(path, { method = "GET", body, timeoutMs = 30_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
    return payload;
  } catch (error) {
    if (/fetch failed|ECONNREFUSED/i.test(String(error?.message || "")) || error?.cause?.code === "ECONNREFUSED") {
      throw new Error(`Agent Canvas 服务未运行：${BASE_URL}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function required(value, label) {
  if (!value) throw new Error(`${label}不能为空`);
  return value;
}

function expectedRevision(options) {
  const value = Number(options.expectedRevision);
  if (!Number.isInteger(value) || value < 1) throw new Error("--expected-revision 必须是正整数");
  return value;
}

async function waitForTask(taskId, seconds) {
  const deadline = Date.now() + Math.max(0, Number(seconds || 0)) * 1000;
  let result;
  do {
    result = await request(`/automation/tasks/${encodeURIComponent(taskId)}`);
    if (TERMINAL.has(result.task?.status) || Date.now() >= deadline) return result;
    await new Promise((resolve) => setTimeout(resolve, 750));
  } while (true);
}

async function main() {
  const { positional, options } = parseArguments(process.argv.slice(2));
  const [command, first, second, third] = positional;
  if (!command || command === "help" || options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  let result;
  if (command === "status") result = await request("/automation/status");
  else if (command === "projects") result = await request("/automation/projects");
  else if (command === "inspect") result = await request(`/automation/projects/${encodeURIComponent(required(first, "projectId"))}/inspect`);
  else if (command === "create") {
    result = await request("/automation/projects", { method: "POST", body: { name: required(options.name, "--name"), presetId: options.preset } });
  } else if (command === "models") {
    result = await request(`/automation/models?kind=${encodeURIComponent(required(first, "kind"))}&provider=${encodeURIComponent(required(second, "provider"))}`, { timeoutMs: 60_000 });
  } else if (command === "apply") {
    const projectId = required(first, "projectId");
    const source = JSON.parse(await readFile(required(options.file, "--file"), "utf8"));
    const body = Array.isArray(source) ? { operations: source } : { ...source };
    body.transactionId ||= `cli:${randomUUID()}`;
    body.expectedRevision ??= expectedRevision(options);
    if (options.dryRun) body.dryRun = true;
    result = await request(`/automation/projects/${encodeURIComponent(projectId)}/transactions`, { method: "POST", body });
  } else if (command === "preset") {
    const projectId = required(first, "projectId");
    result = await request(`/automation/projects/${encodeURIComponent(projectId)}/transactions`, {
      method: "POST",
      body: {
        transactionId: options.transactionId || `cli:preset:${randomUUID()}`,
        expectedRevision: expectedRevision(options),
        dryRun: Boolean(options.dryRun),
        operations: [{ op: "apply_preset", presetId: required(second, "presetId") }],
      },
    });
  } else if (command === "attach") {
    const projectId = required(first, "projectId");
    result = await request(`/automation/projects/${encodeURIComponent(projectId)}/media`, {
      method: "POST",
      timeoutMs: 120_000,
      body: {
        nodeId: required(second, "nodeId"),
        filePath: required(third, "filePath"),
        expectedRevision: expectedRevision(options),
        transactionId: options.transactionId || `cli:media:${randomUUID()}`,
      },
    });
  } else if (command === "run") {
    const projectId = required(first, "projectId");
    result = await request(`/automation/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(required(second, "nodeId"))}/run`, {
      method: "POST",
      timeoutMs: 60_000,
      body: { expectedRevision: expectedRevision(options) },
    });
    if (options.wait) result = await waitForTask(result.task.id, options.wait);
  } else if (command === "task") result = await waitForTask(required(first, "taskId"), options.wait || 0);
  else if (command === "outputs") result = await request(`/automation/projects/${encodeURIComponent(required(first, "projectId"))}/outputs`);
  else throw new Error(`未知命令：${command}\n\n${usage()}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
