import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import readline from "node:readline";
import test from "node:test";

test("Agent Canvas MCP initializes and exposes semantic tools", async (t) => {
  const child = spawn(process.execPath, ["plugins/agent-canvas/mcp/server.mjs"], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill());
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const messages = [];
  lines.on("line", (line) => messages.push(JSON.parse(line)));
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  const deadline = Date.now() + 3_000;
  while (messages.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(messages.find((message) => message.id === 1)?.result?.serverInfo?.name, "Agent Canvas MCP");
  const tools = messages.find((message) => message.id === 2)?.result?.tools || [];
  assert.deepEqual(tools.map((tool) => tool.name), [
    "canvas_health",
    "canvas_list_projects",
    "canvas_list_skills",
    "canvas_register_skill",
    "canvas_refresh_skill",
    "canvas_unregister_skill",
    "canvas_inspect",
    "canvas_create",
    "canvas_apply_workflow",
    "canvas_attach_media",
    "canvas_list_models",
    "canvas_run",
    "canvas_get_task",
    "canvas_get_outputs",
  ]);
  assert.equal(tools.find((tool) => tool.name === "canvas_run").annotations.openWorldHint, true);
  const applyWorkflow = tools.find((tool) => tool.name === "canvas_apply_workflow");
  assert.equal(applyWorkflow.annotations.destructiveHint, true);
  const operations = applyWorkflow.inputSchema.properties.operations.items.properties.op.enum;
  assert.ok(operations.includes("add_to_group"));
  assert.ok(operations.includes("remove_from_group"));
  assert.ok(applyWorkflow.inputSchema.properties.operations.items.properties.nodeType.enum.includes("skill"));
});
