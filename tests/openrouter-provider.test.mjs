import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  OPENROUTER_PROVIDER_ID,
  createOpenRouterSessionId,
  loadPromptSkillContext,
  loadSeedanceSkillContext,
  normalizeOpenRouterModel,
  validateStructuredResult,
} from "../scripts/openrouter-provider.mjs";
import { PROMPT_SKILL_DEFINITIONS } from "../scripts/skill-bundle.mjs";

const REFERENCE_FILES = [
  "aesthetic-constraints.md",
  "camera-codec.md",
  "creative-strategy.md",
  "editing-rhythm.md",
  "examples.md",
  "image-generation.md",
  "image-to-prompt.md",
  "long-video-strategy.md",
  "platform-specs.md",
  "production-pipeline.md",
  "storyboard-driven.md",
  "vocabulary.md",
];

function rawModel(overrides = {}) {
  return {
    id: "example/vision-reasoning",
    name: "Example Vision Reasoning",
    description: "Fixture model",
    context_length: 131_072,
    supported_parameters: ["tools", "response_format", "reasoning"],
    architecture: {
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
    },
    ...overrides,
  };
}

async function createSeedanceFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "prompt-flow-seedance-test-"));
  const references = join(root, "references");
  await mkdir(references, { recursive: true });
  await writeFile(join(root, "SKILL.md"), "# Seedance fixture\n\nUse Chinese timeline prompts.\n", "utf8");
  await Promise.all(REFERENCE_FILES.map((name) => writeFile(
    join(references, name),
    `# ${name}\nFixture guidance for ${name}.\n`,
    "utf8",
  )));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, skillPath: join(root, "SKILL.md"), references };
}

async function createImageFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "prompt-flow-image-test-"));
  await writeFile(join(root, "SKILL.md"), "# Image fixture\n\nRead models, model rules, then golden rules.\n", "utf8");
  await Promise.all(PROMPT_SKILL_DEFINITIONS.image.referenceFiles.map(async (name) => {
    const target = join(root, ...name.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `# ${name}\nImage guidance for ${name}.\n`, "utf8");
  }));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, skillPath: join(root, "SKILL.md") };
}

async function createPhotorealFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "prompt-flow-photoreal-test-"));
  await writeFile(join(root, "SKILL.md"), "# Photoreal fixture\n\nRead the reference library, then one scene category.\n", "utf8");
  await Promise.all(PROMPT_SKILL_DEFINITIONS.photoreal.referenceFiles.map(async (name) => {
    const target = join(root, ...name.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `# ${name}\nPhotoreal scene guidance for ${name}.\n`, "utf8");
  }));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, skillPath: join(root, "SKILL.md") };
}

test("OpenRouter model normalization keeps only task-compatible text models", () => {
  const accepted = normalizeOpenRouterModel(rawModel(), "example/vision-reasoning");
  assert.ok(accepted);
  assert.equal(accepted.provider, OPENROUTER_PROVIDER_ID);
  assert.equal(accepted.isDefault, true);
  assert.deepEqual(accepted.inputModalities, ["text", "image"]);
  assert.equal(accepted.contextLength, 131_072);

  assert.equal(normalizeOpenRouterModel(null), null);
  assert.equal(normalizeOpenRouterModel(rawModel({ id: "" })), null);
  assert.equal(normalizeOpenRouterModel(rawModel({
    supported_parameters: ["response_format", "reasoning"],
  })), null, "the Seedance reference loader requires tool support");
  assert.equal(normalizeOpenRouterModel(rawModel({
    supported_parameters: ["tools", "reasoning"],
  })), null, "the task protocol requires structured output support");
  assert.equal(normalizeOpenRouterModel(rawModel({
    architecture: { input_modalities: ["text"], output_modalities: ["image"] },
  })), null, "the final result must support text output");
  assert.ok(normalizeOpenRouterModel(rawModel({
    supported_parameters: ["tools", "structured_outputs"],
  })), "structured_outputs is accepted as the capability alias");
});

test("OpenRouter reasoning uses advertised tiers and a safe generic fallback", () => {
  const advertised = normalizeOpenRouterModel(rawModel({
    reasoning: { supported_efforts: ["low", "xhigh", "unknown"], default_effort: "xhigh" },
  }));
  assert.equal(advertised.defaultReasoningEffort, "xhigh");
  assert.deepEqual(
    advertised.supportedReasoningEfforts.map((option) => option.reasoningEffort),
    ["low", "xhigh"],
  );

  const genericReasoning = normalizeOpenRouterModel(rawModel({ reasoning: undefined }));
  assert.equal(genericReasoning.defaultReasoningEffort, "medium");
  assert.deepEqual(
    genericReasoning.supportedReasoningEfforts.map((option) => option.reasoningEffort),
    ["none", "minimal", "low", "medium", "high"],
  );

  const noReasoning = normalizeOpenRouterModel(rawModel({
    supported_parameters: ["tools", "response_format"],
    reasoning: undefined,
  }));
  assert.equal(noReasoning.defaultReasoningEffort, "none");
  assert.deepEqual(noReasoning.supportedReasoningEfforts, [{ reasoningEffort: "none" }]);
});

test("OpenRouter sessions are scoped and reject Codex thread IDs", () => {
  assert.match(createOpenRouterSessionId(), /^openrouter:[0-9a-f-]{36}$/i);
  assert.equal(createOpenRouterSessionId("openrouter:known-session"), "openrouter:known-session");
  assert.throws(() => createOpenRouterSessionId("codex:019f-session"), /其他 Agent/);
  assert.throws(() => createOpenRouterSessionId("019f-unqualified-codex-thread"), /其他 Agent/);
});

test("structured results require exactly three non-empty string fields", () => {
  assert.deepEqual(
    validateStructuredResult('{"title":"镜头测试","changes":"调整运镜","prompt":"4秒，稳定推进。"}'),
    { title: "镜头测试", changes: "调整运镜", prompt: "4秒，稳定推进。" },
  );

  for (const invalid of [
    "not json",
    "[]",
    '{"title":"镜头测试","changes":"调整运镜"}',
    '{"title":"镜头测试","changes":"调整运镜","prompt":"ok","extra":true}',
    '{"title":"镜头测试","changes":1,"prompt":"ok"}',
    '{"title":"镜头测试","changes":"调整运镜","prompt":"   "}',
    '{"title":" ","changes":"调整运镜","prompt":"ok"}',
    '{"title":"镜头测试","changes":" ","prompt":"ok"}',
  ]) assert.throws(() => validateStructuredResult(invalid));
});

test("Seedance loader fingerprints all approved content deterministically", async (t) => {
  const fixture = await createSeedanceFixture(t);
  const first = await loadSeedanceSkillContext(fixture.skillPath);
  const second = await loadSeedanceSkillContext(fixture.skillPath);

  assert.equal(first.id, "seedance");
  assert.match(first.hash, /^[0-9a-f]{16}$/);
  assert.equal(first.hash, second.hash);
  assert.match(first.instructions, new RegExp(`seedance@${first.hash}`));
  assert.match(first.instructions, /Use Chinese timeline prompts/);
  assert.match(first.instructions, /platform-specs\.md/);
  assert.match(first.instructions, /camera-codec\.md/);

  await writeFile(
    join(fixture.references, "creative-strategy.md"),
    "# creative-strategy.md\nChanged non-preloaded guidance.\n",
    "utf8",
  );
  const changed = await loadSeedanceSkillContext(fixture.skillPath);
  assert.notEqual(changed.hash, first.hash, "on-demand reference changes must alter the skill fingerprint");
});

test("Seedance reference tool exposes only the explicit whitelist", async (t) => {
  const fixture = await createSeedanceFixture(t);
  const skill = await loadSeedanceSkillContext(fixture.skillPath);
  const execute = skill.referenceTool.function.execute;
  const schema = skill.referenceTool.function.inputSchema;

  assert.equal(schema.safeParse({ name: "references/creative-strategy.md" }).success, true);
  assert.equal(schema.safeParse({ name: "../outside.txt" }).success, false);
  assert.equal(schema.safeParse({ name: "references/cli-integration.md" }).success, false);

  const vocabulary = await execute({ name: "references/vocabulary.md" });
  assert.equal(vocabulary.name, "references/vocabulary.md");
  assert.match(vocabulary.content, /Fixture guidance/);
  await assert.rejects(execute({ name: "../outside.txt" }), /不允许读取/);
  await assert.rejects(execute({ name: "references/cli-integration.md" }), /不允许读取/);
});

test("Image loader preloads mandatory routing docs and exposes nested references", async (t) => {
  const fixture = await createImageFixture(t);
  const skill = await loadPromptSkillContext("image", fixture.skillPath);

  assert.equal(skill.id, "image");
  assert.match(skill.instructions, new RegExp(`image@${skill.hash}`));
  assert.match(skill.instructions, /references\/models\.md/);
  assert.match(skill.instructions, /references\/golden-rules\.md/);
  const schema = skill.referenceTool.function.inputSchema;
  assert.equal(schema.safeParse({ name: "references/gpt-image.md" }).success, true);
  assert.equal(schema.safeParse({ name: "references/patterns/ecommerce.md" }).success, true);
  assert.equal(schema.safeParse({ name: "references/unknown.md" }).success, false);
});

test("Photoreal loader preloads its library index and whitelists scene categories", async (t) => {
  const fixture = await createPhotorealFixture(t);
  const skill = await loadPromptSkillContext("photoreal", fixture.skillPath);

  assert.equal(skill.id, "photoreal");
  assert.match(skill.instructions, new RegExp(`photoreal@${skill.hash}`));
  assert.match(skill.instructions, /references\/reference-library\.md/);
  const schema = skill.referenceTool.function.inputSchema;
  assert.equal(schema.safeParse({ name: "references/office.md" }).success, true);
  assert.equal(schema.safeParse({ name: "references/gaming-room.md" }).success, true);
  assert.equal(schema.safeParse({ name: "assets/reference-scenes/office/office-01.jpg" }).success, false);
});
