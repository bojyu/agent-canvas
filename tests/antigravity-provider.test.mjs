import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  ANTIGRAVITY_PROVIDER_ID,
  ANTIGRAVITY_SESSION_PREFIX,
  createAntigravitySessionId,
  decodeCliBuffer,
  extractJsonPayload,
  parseAgyModelsOutput,
  parseGeminiCliJsonOutput,
  runAntigravityRefine,
} from "../scripts/antigravity-provider.mjs";
import { SEEDANCE_REFERENCE_FILES } from "../scripts/seedance-bundle.mjs";
import { PROMPT_SKILL_DEFINITIONS } from "../scripts/skill-bundle.mjs";

const FAKE_CLI = `const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("1.1.3");
  process.exit(0);
}
if (args.includes("models")) {
  console.log("Gemini 3.5 Flash (Medium)\\nGemini 3.5 Flash (Low)\\nGemini 3.1 Pro (High)");
  process.exit(0);
}
if (args.includes("-p") || args.includes("--print")) {
  if (process.env.FAKE_FAIL_AUTH === "1") {
    console.error("not signed in: please login");
    process.exit(41);
  }
  const prompt = args[args.indexOf("-p") + 1] || args[args.indexOf("--print") + 1] || "";
  if (String(prompt).includes("exactly OK") || String(prompt).includes("OK.")) {
    console.log("OK");
    process.exit(0);
  }
  // refine path: short instruction points at PROMPT.md
  console.log(JSON.stringify({
    title: "镜头测试",
    changes: "已按要求改写",
    prompt: "4秒，稳定推进。",
  }));
  process.exit(0);
}
console.error("unknown args " + args.join(" "));
process.exit(2);
`;

async function makeRuntime(t, skillId = "seedance") {
  const root = await mkdtemp(join(tmpdir(), "prompt-flow-antigravity-test-"));
  const skillRoot = join(root, skillId);
  const referenceFiles = skillId === "seedance" ? SEEDANCE_REFERENCE_FILES : PROMPT_SKILL_DEFINITIONS.image.referenceFiles;
  await mkdir(skillRoot, { recursive: true });
  await writeFile(join(skillRoot, "SKILL.md"), `# ${skillId} fixture\n\nAlways follow the selected prompt skill.\n`, "utf8");
  await Promise.all(referenceFiles.map(async (name) => {
    const target = join(skillRoot, ...name.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `# ${name}\nFixture guidance.\n`, "utf8");
  }));
  const fakeCli = join(root, "fake-agy.mjs");
  await writeFile(fakeCli, FAKE_CLI, "utf8");
  let command;
  let shell = false;
  if (process.platform === "win32") {
    // Name must look like agy for isAgyCommand()
    command = join(root, "agy.cmd");
    await writeFile(command, `@echo off\r\n"${process.execPath}" "${fakeCli}" %*\r\n`, "utf8");
    shell = true;
  } else {
    command = join(root, "agy");
    await writeFile(command, `#!/bin/sh\nexec "${process.execPath}" "${fakeCli}" "$@"\n`, "utf8");
    await chmod(command, 0o755);
  }
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    skillPath: join(skillRoot, "SKILL.md"),
    runtime: {
      command,
      shell,
      env: { ...process.env, CI: "true", NO_COLOR: "1" },
    },
  };
}

test("Antigravity sessions are scoped", () => {
  assert.match(createAntigravitySessionId(), new RegExp(`^${ANTIGRAVITY_SESSION_PREFIX}[0-9a-f-]{36}$`, "i"));
  assert.equal(createAntigravitySessionId("antigravity:known"), "antigravity:known");
  assert.throws(() => createAntigravitySessionId("openrouter:x"), /其他 Agent/);
});

test("parseAgyModelsOutput maps CLI labels", () => {
  const models = parseAgyModelsOutput("Gemini 3.5 Flash (Medium)\nGemini 3.1 Pro (High)\n");
  assert.equal(models.length, 2);
  assert.equal(models[0].model, "Gemini 3.5 Flash (Medium)");
  assert.equal(models[0].isDefault, true);
  assert.equal(models[1].defaultReasoningEffort, "high");
});

test("decodeCliBuffer keeps multi-byte UTF-8 Chinese intact", () => {
  const text = "4秒手机日常抓拍";
  assert.equal(decodeCliBuffer(Buffer.from(text, "utf8")), text);
  // Split across what would have been pipe chunks — full buffer still decodes cleanly.
  const a = Buffer.from(text.slice(0, 3), "utf8");
  const b = Buffer.from(text.slice(3), "utf8");
  assert.equal(decodeCliBuffer(Buffer.concat([a, b])), text);
});

test("JSON extraction accepts fences, chatter prefix, and wrapper objects", () => {
  assert.deepEqual(
    extractJsonPayload('{"title":"镜头测试","changes":"调整运镜","prompt":"4秒，稳定推进。"}'),
    { title: "镜头测试", changes: "调整运镜", prompt: "4秒，稳定推进。" },
  );
  assert.deepEqual(
    extractJsonPayload('I will return JSON now.\n{"title":"镜头测试","changes":"调整运镜","prompt":"4秒，稳定推进。"}\n'),
    { title: "镜头测试", changes: "调整运镜", prompt: "4秒，稳定推进。" },
  );
  assert.deepEqual(
    parseGeminiCliJsonOutput(JSON.stringify({
      response: '{"title":"镜头测试","changes":"调整运镜","prompt":"4秒，稳定推进。"}',
    })),
    { title: "镜头测试", changes: "调整运镜", prompt: "4秒，稳定推进。" },
  );
});

test("runAntigravityRefine succeeds with fake agy CLI", async (t) => {
  const fx = await makeRuntime(t);
  const ok = await runAntigravityRefine({
    model: "Gemini 3.5 Flash (Medium)",
    reasoningEffort: "medium",
    textPrompt: "生成一段测试提示词",
    attachments: [],
    seedanceSkillPath: fx.skillPath,
    runtime: fx.runtime,
  });
  assert.equal(ok.provider, ANTIGRAVITY_PROVIDER_ID);
  assert.equal(ok.title, "镜头测试");
  assert.equal(ok.prompt, "4秒，稳定推进。");
  assert.match(ok.threadId, new RegExp(`^${ANTIGRAVITY_SESSION_PREFIX}`));
  assert.equal(ok.seedanceSkill, true);
});

test("runAntigravityRefine loads the selected Image skill in isolation", async (t) => {
  const fx = await makeRuntime(t, "image");
  const ok = await runAntigravityRefine({
    model: "Gemini 3.5 Flash (Medium)",
    reasoningEffort: "medium",
    textPrompt: "生成一段图像提示词",
    attachments: [],
    skillId: "image",
    skillPath: fx.skillPath,
    runtime: fx.runtime,
  });
  assert.equal(ok.skill, true);
  assert.equal(ok.skillId, "image");
  assert.equal(ok.seedanceSkill, false);
});

test("runAntigravityRefine surfaces login errors", async (t) => {
  const fx = await makeRuntime(t);
  await assert.rejects(
    () => runAntigravityRefine({
      model: "Gemini 3.5 Flash (Medium)",
      reasoningEffort: "medium",
      textPrompt: "生成一段测试提示词",
      attachments: [],
      seedanceSkillPath: fx.skillPath,
      runtime: {
        ...fx.runtime,
        env: { ...fx.runtime.env, FAKE_FAIL_AUTH: "1" },
      },
    }),
    /登录|授权|Google|signed/i,
  );
});
