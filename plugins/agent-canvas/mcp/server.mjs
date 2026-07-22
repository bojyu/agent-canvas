import readline from "node:readline";

const SERVER_NAME = "Agent Canvas MCP";
const SERVER_VERSION = "0.1.0";
const BASE_URL = String(process.env.AGENT_CANVAS_BASE_URL || "http://127.0.0.1:4317").replace(/\/+$/, "");
const TERMINAL_TASK_STATES = new Set(["completed", "failed", "cancelled"]);

const RpcError = {
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function toolResult(text, structuredContent) {
  return { content: [{ type: "text", text }], structuredContent };
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 30_000));
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: options.method || "GET",
      headers: options.body === undefined ? undefined : { "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; }
    catch { payload = { error: text.slice(0, 500) }; }
    if (!response.ok) {
      const error = new Error(payload.error || `${response.status} ${response.statusText}`);
      error.status = response.status;
      error.code = payload.code;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Agent Canvas 请求超时：${path}`);
    if (/fetch failed|ECONNREFUSED/i.test(String(error?.message || "")) || error?.cause?.code === "ECONNREFUSED") {
      throw new Error(`Agent Canvas 服务未运行（${BASE_URL}）。请先在画板项目中运行 npm run dev。`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function requiredString(args, key) {
  const value = typeof args?.[key] === "string" ? args[key].trim() : "";
  if (!value) throw new Error(`${key} 不能为空`);
  return value;
}

function encode(value) {
  return encodeURIComponent(String(value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getTask(taskId, waitSeconds = 0) {
  const deadline = Date.now() + Math.max(0, Math.min(55, Number(waitSeconds || 0))) * 1000;
  let result;
  do {
    result = await request(`/automation/tasks/${encode(taskId)}`);
    if (TERMINAL_TASK_STATES.has(result.task?.status) || Date.now() >= deadline) return result;
    await sleep(750);
  } while (true);
}

function toolDefinitions() {
  return [
    {
      name: "canvas_health",
      title: "Check Agent Canvas",
      description: "Check whether the local Agent Canvas bridge is available and return its URL and automation capabilities.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "canvas_list_projects",
      title: "List Agent Canvas Projects",
      description: "List saved Agent Canvas projects with IDs, revisions, timestamps, and media counts. Does not return inline media.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "canvas_inspect",
      title: "Inspect Agent Canvas",
      description: "Inspect one canvas as a compact semantic graph. Base64 media and API keys are never returned.",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string", description: "Saved Agent Canvas project ID." } },
        required: ["projectId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "canvas_create",
      title: "Create Agent Canvas",
      description: "Create a blank canvas or a canvas containing one built-in prompt, image-generation, or video-generation preset.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Canvas name." },
          presetId: { type: "string", enum: ["prompt", "image-generation", "video-generation"], description: "Optional connected three-node preset." },
          position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"], additionalProperties: false },
        },
        required: ["name"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "canvas_apply_workflow",
      title: "Apply Agent Canvas Workflow",
      description: "Atomically add, update, delete, connect, group, lay out, or preset canvas nodes. Use dryRun first and pass the inspected expectedRevision to prevent overwrites.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          transactionId: { type: "string", description: "Unique retry-safe ID, for example codex:product-video:v1." },
          expectedRevision: { type: "integer", minimum: 1 },
          dryRun: { type: "boolean", default: false },
          operations: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                op: { type: "string", enum: ["add_node", "update_node", "delete_nodes", "connect", "disconnect", "apply_preset", "rename_project", "group", "ungroup", "layout"] },
                id: { type: "string" },
                nodeId: { type: "string" },
                nodeIds: { type: "array", items: { type: "string" } },
                edgeId: { type: "string" },
                edgeIds: { type: "array", items: { type: "string" } },
                nodeType: { type: "string", enum: ["image", "video", "text", "prompt", "prompt_editor", "image_generator", "video_generator", "group"] },
                source: { type: "string" },
                target: { type: "string" },
                sourceHandle: { type: "string" },
                targetHandle: { type: "string" },
                title: { type: "string" },
                text: { type: "string" },
                data: { type: "object" },
                patch: { type: "object" },
                presetId: { type: "string", enum: ["prompt", "image-generation", "video-generation"] },
                name: { type: "string" },
                groupId: { type: "string" },
                position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"], additionalProperties: false },
                columns: { type: "integer", minimum: 1 },
                gapX: { type: "number" },
                gapY: { type: "number" },
              },
              required: ["op"],
              additionalProperties: true,
            },
          },
        },
        required: ["projectId", "transactionId", "expectedRevision", "operations"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "canvas_attach_media",
      title: "Attach Local Media",
      description: "Attach an absolute local image or video file to an existing matching media node, guarded by canvas revision.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          nodeId: { type: "string" },
          filePath: { type: "string", description: "Absolute path to a local image or video." },
          expectedRevision: { type: "integer", minimum: 1 },
          transactionId: { type: "string" },
        },
        required: ["projectId", "nodeId", "filePath", "expectedRevision", "transactionId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "canvas_list_models",
      title: "List Agent Canvas Models",
      description: "List configured prompt, image, or video models for a provider before configuring or running a generator node.",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["prompt", "image", "video"] },
          provider: { type: "string", description: "Prompt: codex/openrouter/comfly/grok-build/antigravity; image: openrouter/google/comfly; video: openrouter/comfly/seedance-cli." },
        },
        required: ["kind", "provider"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    {
      name: "canvas_run",
      title: "Run Agent Canvas Node",
      description: "Run one configured prompt, prompt-editor, image-generator, or video-generator node through the task center. This may call a paid external provider. The result is saved to connected output nodes even when the browser is closed.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          nodeId: { type: "string" },
          expectedRevision: { type: "integer", minimum: 1 },
          overrides: { type: "object", description: "Optional one-run overrides such as prompt, model, resolution, duration, or provider fields." },
        },
        required: ["projectId", "nodeId", "expectedRevision"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    {
      name: "canvas_get_task",
      title: "Get Agent Canvas Task",
      description: "Get a compact task status, optionally waiting up to 55 seconds for a terminal state. Inline image/video data is omitted.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          waitSeconds: { type: "number", minimum: 0, maximum: 55, default: 0 },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "canvas_get_outputs",
      title: "Get Agent Canvas Outputs",
      description: "Return compact text and media output metadata for a canvas, including saved local file paths but never base64 payloads.",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

async function callTool(name, args) {
  if (name === "canvas_health") {
    const result = await request("/automation/status");
    return toolResult(`Agent Canvas is ready at ${result.canvasUrl}. ${result.projects} saved project(s).`, result);
  }
  if (name === "canvas_list_projects") {
    const result = await request("/automation/projects");
    const summary = result.projects?.length
      ? result.projects.map((item) => `${item.id} r${item.revision || 1} — ${item.name}`).join("\n")
      : "No saved Agent Canvas projects.";
    return toolResult(summary, result);
  }
  if (name === "canvas_inspect") {
    const projectId = requiredString(args, "projectId");
    const result = await request(`/automation/projects/${encode(projectId)}/inspect`);
    return toolResult(`${result.project.name} r${result.project.revision}: ${result.project.nodes.length} nodes, ${result.project.edges.length} edges.`, result);
  }
  if (name === "canvas_create") {
    const result = await request("/automation/projects", { method: "POST", body: args });
    return toolResult(`Created ${result.project.name} (${result.project.id}) at revision ${result.project.revision}.`, result);
  }
  if (name === "canvas_apply_workflow") {
    const projectId = requiredString(args, "projectId");
    const body = { ...args };
    delete body.projectId;
    const result = await request(`/automation/projects/${encode(projectId)}/transactions`, { method: "POST", body });
    return toolResult(`${result.dryRun ? "Validated" : result.duplicate ? "Reused" : "Applied"} transaction at revision ${result.project.revision}.`, result);
  }
  if (name === "canvas_attach_media") {
    const projectId = requiredString(args, "projectId");
    const body = { ...args };
    delete body.projectId;
    const result = await request(`/automation/projects/${encode(projectId)}/media`, { method: "POST", body, timeoutMs: 120_000 });
    return toolResult(`Attached ${result.node?.data?.fileName || "media"} to ${result.node?.id}. Canvas revision is ${result.project.revision}.`, result);
  }
  if (name === "canvas_list_models") {
    const kind = requiredString(args, "kind");
    const provider = requiredString(args, "provider");
    const result = await request(`/automation/models?kind=${encode(kind)}&provider=${encode(provider)}`, { timeoutMs: 60_000 });
    return toolResult(`${result.models?.length || 0} ${kind} model(s) available for ${provider}.`, result);
  }
  if (name === "canvas_run") {
    const projectId = requiredString(args, "projectId");
    const nodeId = requiredString(args, "nodeId");
    const body = { expectedRevision: args.expectedRevision, overrides: args.overrides };
    const result = await request(`/automation/projects/${encode(projectId)}/nodes/${encode(nodeId)}/run`, { method: "POST", body, timeoutMs: 60_000 });
    return toolResult(`Task ${result.task.id} is ${result.task.status} (${result.task.stage}).`, result);
  }
  if (name === "canvas_get_task") {
    const taskId = requiredString(args, "taskId");
    const result = await getTask(taskId, args.waitSeconds);
    return toolResult(`Task ${taskId} is ${result.task.status} (${result.task.stage}).`, result);
  }
  if (name === "canvas_get_outputs") {
    const projectId = requiredString(args, "projectId");
    const result = await request(`/automation/projects/${encode(projectId)}/outputs`);
    return toolResult(`${result.outputs?.length || 0} populated output node(s) at revision ${result.revision}.`, result);
  }
  throw new Error(`Unknown tool: ${name || ""}`);
}

async function handleRequest(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    sendResult(id, {
      protocolVersion: params?.protocolVersion || "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: "Build and run Agent Canvas workflows through compact, revision-safe semantic tools. Inspect before editing, dry-run transactions, and only call canvas_run when the user requested generation because it may incur provider cost.",
    });
    return;
  }
  if (method === "ping") {
    sendResult(id, {});
    return;
  }
  if (method === "tools/list") {
    sendResult(id, { tools: toolDefinitions() });
    return;
  }
  if (method === "tools/call") {
    try {
      sendResult(id, await callTool(params?.name, params?.arguments || {}));
    } catch (error) {
      sendError(id, error?.status && error.status < 500 ? RpcError.INVALID_PARAMS : RpcError.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
    }
    return;
  }
  if (id !== undefined) sendError(id, RpcError.METHOD_NOT_FOUND, `Method not found: ${method}`);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); }
  catch { return; }
  handleRequest(message).catch((error) => {
    if (message.id !== undefined) sendError(message.id, RpcError.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
  });
});
