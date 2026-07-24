import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GROK_BUILD_PROVIDER_ID,
  createGrokBuildSessionId,
  getGrokBuildStatus,
  parseGrokModelsOutput,
  runGrokBuildRefine,
  sanitizeGrokEnvironment,
  scanGrokConfigText,
} from "../scripts/grok-build-provider.mjs";
import { SEEDANCE_REFERENCE_FILES } from "../scripts/seedance-bundle.mjs";

const FAKE_GROK = String.raw`
import readline from "node:readline";

const args = process.argv.slice(2);
if (args.includes("version")) {
  console.log("grok 0.2.102 (fake)");
  process.exit(0);
}
if (args.includes("inspect")) {
  console.log(JSON.stringify({ grokVersion: "0.2.102", configSources: { layers: [] }, skills: [] }));
  process.exit(0);
}
if (args.includes("models")) {
  console.log("You are logged in with grok.com.\n\nDefault model: grok-4.5\n\nAvailable models:\n  * grok-4.5 (default)");
  process.exit(0);
}
if (!args.includes("agent") || !args.includes("stdio")) process.exit(2);

const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {
      protocolVersion: 1,
      authMethods: [{ id: "cached_token" }],
      agentCapabilities: { promptCapabilities: {
        image: process.env.FAKE_IMAGE_CAPABILITY !== "false",
        embeddedContext: process.env.FAKE_EMBEDDED_CAPABILITY === "true",
      } },
    } });
    return;
  }
  if (message.method === "authenticate") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "session/new") {
    send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "fake-acp-session", configOptions: [] } });
    return;
  }
  if (message.method === "session/prompt") {
    send({ jsonrpc: "2.0", method: "session/update", params: {
      sessionId: "fake-acp-session",
      update: { sessionUpdate: "agent_message_chunk", content: {
        type: "text",
        text: JSON.stringify({ title: "镜头测试", changes: "已按要求改写", prompt: "4秒，稳定推进。" }),
      } },
    } });
    send({ jsonrpc: "2.0", id: message.id, result: {
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    } });
    return;
  }
});
`;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "prompt-flow-grok-test-"));
  const sourceHome = join(root, "source-home");
  const skillRoot = join(root, "seedance");
  await mkdir(join(skillRoot, "references"), { recursive: true });
  await mkdir(sourceHome, { recursive: true });
  await writeFile(join(sourceHome, "auth.json"), JSON.stringify({ fixture: { key: "not-a-real-token" } }), "utf8");
  await writeFile(join(skillRoot, "SKILL.md"), "# Seedance fixture\n\nAlways write a Chinese timeline prompt.\n", "utf8");
  await Promise.all(SEEDANCE_REFERENCE_FILES.map((name) => writeFile(
    join(skillRoot, ...name.split("/")),
    `# ${name}\nFixture guidance.\n`,
    "utf8",
  )));
  const fakeCli = join(root, "fake-grok.mjs");
  await writeFile(fakeCli, FAKE_GROK, "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    sourceHome,
    skillPath: join(skillRoot, "SKILL.md"),
    runtime: {
      command: process.execPath,
      commandArgs: [fakeCli],
      sourceHome,
      env: { ...process.env, USERPROFILE: root, HOME: root, XAI_API_KEY: "must-not-leak" },
      shell: false,
    },
  };
}

test("Grok model output only exposes actual model IDs", () => {
  const models = parseGrokModelsOutput(
    "You are logged in with grok.com.\n\nDefault model: grok-4.5\n\nAvailable models:\n  * grok-4.5 (default)",
  );
  assert.deepEqual(models.map((model) => model.model), ["grok-4.5"]);
  assert.equal(models[0].provider, GROK_BUILD_PROVIDER_ID);
  assert.equal(models[0].isDefault, true);
  assert.equal(models[0].defaultReasoningEffort, "high");
  assert.deepEqual(models[0].supportedReasoningEfforts.map((item) => item.reasoningEffort), ["low", "medium", "high"]);
});

test("subscription environment strips API credentials", () => {
  const clean = sanitizeGrokEnvironment({
    PATH: "fixture-path",
    XAI_API_KEY: "xai-secret",
    GROK_DEPLOYMENT_KEY: "deployment-secret",
    OPENROUTER_API_KEY: "openrouter-secret",
    SAFE_VALUE: "kept",
  });
  assert.equal(clean.PATH, "fixture-path");
  assert.equal(clean.SAFE_VALUE, "kept");
  assert.equal(clean.XAI_API_KEY, undefined);
  assert.equal(clean.GROK_DEPLOYMENT_KEY, undefined);
  assert.equal(clean.OPENROUTER_API_KEY, undefined);
});

test("unsafe per-model billing configuration is detected without exposing values", () => {
  assert.deepEqual(scanGrokConfigText(`
    [model."custom"]
    api_key = "super-secret"
    env_key = "CUSTOM_KEY"
    [auth]
    auth_provider_command = "token-helper"
  `), ["per-model-api-key", "per-model-env-key", "external-auth-provider"]);
  assert.deepEqual(scanGrokConfigText("[cli]\ninstaller = \"internal\"\n"), []);
});

test("Grok logical sessions are provider-scoped", () => {
  assert.match(createGrokBuildSessionId(), /^grok-build:[0-9a-f-]{36}$/i);
  assert.equal(createGrokBuildSessionId("grok-build:known"), "grok-build:known");
  assert.throws(() => createGrokBuildSessionId("openrouter:known"), /其他 Agent/);
});

test("local bridge routes models, tasks, stages, and health through Grok Build", async () => {
  const source = await readFile(new URL("../scripts/codex-bridge.mjs", import.meta.url), "utf8");
  assert.match(source, /GROK_BUILD_PROVIDER_ID/);
  assert.match(source, /getGrokBuildStatus/);
  assert.match(source, /getGrokBuildModels/);
  assert.match(source, /runGrokBuildRefine\(\{/);
  assert.match(source, /stage\(onStage, GROK_BUILD_PROVIDER_ID, signal\)/);
  assert.match(source, /\[GROK_BUILD_PROVIDER_ID\]: \{/);
});

test("status requires and verifies cached-token ACP authentication", async (t) => {
  const setup = await fixture(t);
  const status = await getGrokBuildStatus({ force: true, runtime: setup.runtime });
  assert.equal(status.installed, true);
  assert.equal(status.loggedIn, true);
  assert.equal(status.configured, true);
  assert.deepEqual(status.models.map((model) => model.model), ["grok-4.5"]);
});

test("per-model API configuration fails closed before subscription use", async (t) => {
  const setup = await fixture(t);
  await writeFile(join(setup.sourceHome, "config.toml"), "[model.\"grok-4.5\"]\napi_key = \"never-print-me\"\n", "utf8");
  const status = await getGrokBuildStatus({ force: true, runtime: setup.runtime });
  assert.equal(status.configured, false);
  assert.match(status.message, /API|api_key/);
  assert.doesNotMatch(status.message, /never-print-me/);
});

test("ACP refine injects Seedance and returns strict structured output", async (t) => {
  const setup = await fixture(t);
  const result = await runGrokBuildRefine({
    model: "grok-4.5",
    reasoningEffort: "medium",
    textPrompt: "把镜头推进写得更稳定。",
    seedanceSkillPath: setup.skillPath,
    runtime: setup.runtime,
    timeoutMs: 5_000,
  });
  assert.equal(result.provider, GROK_BUILD_PROVIDER_ID);
  assert.equal(result.prompt, "4秒，稳定推进。");
  assert.equal(result.seedanceSkill, true);
  assert.match(result.seedanceSkillHash, /^[0-9a-f]{16}$/);
  assert.match(result.threadId, /^grok-build:/);
  assert.equal(result.sessionMode, "stateless");
});

test("Grok No Skill mode runs without a skill path or bundle", async (t) => {
  const setup = await fixture(t);
  const result = await runGrokBuildRefine({
    model: "grok-4.5",
    reasoningEffort: "low",
    textPrompt: "整理成通用提示词。",
    skillId: "none",
    runtime: setup.runtime,
    timeoutMs: 5_000,
  });
  assert.equal(result.skill, false);
  assert.equal(result.skillId, "none");
  assert.equal(result.skillHash, null);
  assert.equal(result.seedanceSkill, false);
});

test("reference media fails clearly when ACP image input is unavailable", async (t) => {
  const setup = await fixture(t);
  const image = join(setup.root, "reference.png");
  await writeFile(image, Buffer.from("fixture-image"));
  setup.runtime.env.FAKE_IMAGE_CAPABILITY = "false";
  await assert.rejects(runGrokBuildRefine({
    model: "grok-4.5",
    reasoningEffort: "low",
    textPrompt: "参考图片改写。",
    attachments: [{ path: image }],
    seedanceSkillPath: setup.skillPath,
    runtime: setup.runtime,
    timeoutMs: 5_000,
  }), /未声明图片或内嵌资源能力/);
});

test("reference media uses ACP embedded resources when native image blocks are unavailable", async (t) => {
  const setup = await fixture(t);
  const image = join(setup.root, "reference.png");
  await writeFile(image, Buffer.from("fixture-image"));
  setup.runtime.env.FAKE_IMAGE_CAPABILITY = "false";
  setup.runtime.env.FAKE_EMBEDDED_CAPABILITY = "true";
  const result = await runGrokBuildRefine({
    model: "grok-4.5",
    reasoningEffort: "low",
    textPrompt: "参考图片改写。",
    attachments: [{ path: image }],
    seedanceSkillPath: setup.skillPath,
    runtime: setup.runtime,
    timeoutMs: 5_000,
  });
  assert.equal(result.prompt, "4秒，稳定推进。");
});
