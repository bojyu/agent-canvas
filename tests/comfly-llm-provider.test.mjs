import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  COMFLY_LLM_SESSION_PREFIX,
  comflyLlmApiKey,
  comflyLlmConfigured,
  getComflyLlmModels,
  normalizeComflyLlmModel,
  runComflyLlmRefine,
} from "../scripts/comfly-llm-provider.mjs";
import { PROMPT_SKILL_DEFINITIONS } from "../scripts/skill-bundle.mjs";

async function createImageSkillFixture() {
  const root = await mkdtemp(join(tmpdir(), "agent-canvas-comfly-skill-"));
  const skillPath = join(root, "SKILL.md");
  await writeFile(skillPath, "# Image Skill\n必须遵循本技能。", "utf8");
  for (const name of PROMPT_SKILL_DEFINITIONS.image.referenceFiles) {
    const target = join(root, ...name.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `# ${name}\nRULE:${name}`, "utf8");
  }
  return { root, skillPath };
}

test("Comfly LLM key can override the general Comfly key", () => {
  const env = { COMFLY_API_KEY: "general", COMFLY_LLM_API_KEY: "text-only" };
  assert.equal(comflyLlmApiKey(env), "text-only");
  assert.equal(comflyLlmConfigured(env), true);
  assert.equal(comflyLlmApiKey({ COMFLY_API_KEY: "general" }), "general");
});

test("Comfly model catalog keeps chat models and filters generation models", async () => {
  const env = { COMFLY_LLM_API_KEY: "secret", COMFLY_LLM_DEFAULT_MODEL: "gpt-5.4" };
  const models = await getComflyLlmModels({
    force: true,
    env,
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://ai.comfly.org/v1/models");
      assert.equal(options.headers.Authorization, "Bearer secret");
      return new Response(JSON.stringify({ data: [
        { id: "gpt-image-2", supported_endpoint_types: ["openai"] },
        { id: "gpt-5.4", owned_by: "OpenAI", supported_endpoint_types: ["openai"] },
        { id: "claude-sonnet-5", owned_by: "Anthropic", supported_endpoint_types: ["openai"] },
        { id: "unknown-model", supported_endpoint_types: ["openai"] },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.deepEqual(models.map((model) => model.model), ["gpt-5.4", "claude-sonnet-5"]);
  assert.equal(models[0].isDefault, true);
  assert.deepEqual(models[0].inputModalities, ["text", "image"]);
  assert.equal(normalizeComflyLlmModel({ id: "gemini-2.5-pro", supported_endpoint_types: ["google"] }), null);
});

test("Comfly prompt rewrite injects the selected skill and routed references", async () => {
  const fixture = await createImageSkillFixture();
  try {
    let requestBody;
    const result = await runComflyLlmRefine({
      model: "gpt-5.4",
      textPrompt: "把这张商品椅子图改写成电商摄影提示词",
      skillId: "image",
      skillPath: fixture.skillPath,
      attachments: [],
    }, {
      env: { COMFLY_LLM_API_KEY: "secret" },
      fetchImpl: async (url, options) => {
        assert.equal(url, "https://ai.comfly.org/v1/chat/completions");
        requestBody = JSON.parse(options.body);
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            prompt: "完整电商摄影提示词",
            title: "电商图",
            changes: "按 Image Skill 完成电商场景改写。",
          }) } }],
          usage: { total_tokens: 123 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    assert.equal(requestBody.model, "gpt-5.4");
    assert.match(requestBody.messages[0].content, /\[Prompt skill loaded: image@/);
    assert.match(requestBody.messages[0].content, /references\/models\.md/);
    assert.match(requestBody.messages[0].content, /references\/patterns\/ecommerce\.md/);
    assert.equal(requestBody.messages[1].content, "把这张商品椅子图改写成电商摄影提示词");
    assert.equal(result.prompt, "完整电商摄影提示词");
    assert.equal(result.skillId, "image");
    assert.match(result.threadId, new RegExp(`^${COMFLY_LLM_SESSION_PREFIX}`));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
