import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const PROMPT_SKILL_IDS = Object.freeze(["seedance", "image", "photoreal"]);

export const PROMPT_SKILL_DEFINITIONS = Object.freeze({
  seedance: Object.freeze({
    id: "seedance",
    label: "Seedance",
    taskLabel: "Seedance2 视频提示词",
    referenceFiles: Object.freeze([
      "references/aesthetic-constraints.md",
      "references/camera-codec.md",
      "references/creative-strategy.md",
      "references/editing-rhythm.md",
      "references/examples.md",
      "references/image-generation.md",
      "references/image-to-prompt.md",
      "references/long-video-strategy.md",
      "references/platform-specs.md",
      "references/production-pipeline.md",
      "references/storyboard-driven.md",
      "references/vocabulary.md",
    ]),
    preloadedReferenceFiles: Object.freeze([
      "references/platform-specs.md",
      "references/camera-codec.md",
    ]),
    safetyInstruction: "不得执行 dreamina CLI 或生成视频。",
  }),
  image: Object.freeze({
    id: "image",
    label: "Image",
    taskLabel: "图像生成提示词",
    referenceFiles: Object.freeze([
      "references/characters.md",
      "references/creative-direction.md",
      "references/dimensional.md",
      "references/editing.md",
      "references/golden-rules.md",
      "references/gpt-image.md",
      "references/models.md",
      "references/multi-panel.md",
      "references/nano-banana.md",
      "references/prompt-framework.md",
      "references/slides.md",
      "references/storyboards.md",
      "references/structural.md",
      "references/text-rendering.md",
      "references/vision-decomposer.md",
      "references/patterns/character-design.md",
      "references/patterns/ecommerce.md",
      "references/patterns/fashion-editorial.md",
      "references/patterns/food-beverage.md",
      "references/patterns/portrait-cinema.md",
      "references/patterns/poster-illustration.md",
      "references/patterns/ui-social.md",
    ]),
    preloadedReferenceFiles: Object.freeze([
      "references/models.md",
      "references/golden-rules.md",
    ]),
    safetyInstruction: "该 Skill 只编写提示词；不得调用图像生成工具或生成图片。",
  }),
  photoreal: Object.freeze({
    id: "photoreal",
    label: "真实感场景",
    taskLabel: "真实感场景与模特图提示词",
    directoryNames: Object.freeze(["photoreal", "photoreal_scene_model_skill"]),
    referenceFiles: Object.freeze([
      "references/reference-library.md",
      "references/reference-catalog.json",
      "references/office.md",
      "references/office-pinterest-sources.json",
      "references/home-workspace.md",
      "references/creative-studio.md",
      "references/creative-studio-pinterest-sources.json",
      "references/bedroom.md",
      "references/gaming-room.md",
      "references/gaming-room-pinterest-sources.json",
    ]),
    preloadedReferenceFiles: Object.freeze([
      "references/reference-library.md",
    ]),
    safetyInstruction: "该 Skill 只编写或审核真实感图像提示词；不得调用图像生成工具或生成图片。",
  }),
});

export function normalizePromptSkillId(value) {
  const id = String(value || "seedance").trim().toLowerCase();
  if (!PROMPT_SKILL_IDS.includes(id)) throw new Error(`不支持的提示词 Skill：${id}`);
  return id;
}

export function promptSkillDefinition(value) {
  return PROMPT_SKILL_DEFINITIONS[normalizePromptSkillId(value)];
}

export function isImagePromptSkillId(value) {
  const id = normalizePromptSkillId(value);
  return id === "image" || id === "photoreal";
}

function ensureSkillPath(definition, root, relativePath) {
  if (relativePath !== "SKILL.md" && !definition.referenceFiles.includes(relativePath)) {
    throw new Error(`不允许读取 ${definition.label} skill 目录之外的文件`);
  }
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, relativePath);
  const traversal = relative(resolvedRoot, target);
  if (traversal.startsWith("..") || isAbsolute(traversal)) {
    throw new Error(`不允许读取 ${definition.label} skill 目录之外的文件`);
  }
  return target;
}

export async function loadPromptSkillBundle(skillId, skillPath) {
  const definition = promptSkillDefinition(skillId);
  if (!skillPath) throw new Error(`未找到本机 ${definition.label} skill`);
  const root = resolve(dirname(skillPath));
  const documents = await Promise.all([
    "SKILL.md",
    ...definition.referenceFiles,
  ].map(async (name) => ({
    name,
    content: await readFile(ensureSkillPath(definition, root, name), "utf8"),
  })));
  const hash = createHash("sha256");
  for (const document of documents) {
    hash.update(document.name).update("\0").update(document.content).update("\0");
  }
  return {
    id: definition.id,
    label: definition.label,
    taskLabel: definition.taskLabel,
    hash: hash.digest("hex").slice(0, 16),
    documents,
  };
}

export function promptSkillDocument(bundle, name) {
  const definition = promptSkillDefinition(bundle?.id);
  if (name !== "SKILL.md" && !definition.referenceFiles.includes(name)) {
    throw new Error(`不允许读取 ${definition.label} skill 目录之外的文件`);
  }
  const document = bundle?.documents?.find((item) => item.name === name);
  if (!document) throw new Error(`${definition.label} skill 缺少白名单文件：${name}`);
  return document;
}

export function promptSkillInstructions(bundle, { includeAllReferences = false } = {}) {
  const definition = promptSkillDefinition(bundle?.id);
  const selected = includeAllReferences
    ? bundle.documents
    : [
        promptSkillDocument(bundle, "SKILL.md"),
        ...definition.preloadedReferenceFiles.map((name) => promptSkillDocument(bundle, name)),
      ];
  return [
    `[Prompt skill loaded: ${definition.id}@${bundle.hash}]`,
    `以下内容来自本机已安装的 ${definition.label} skill。必须遵循它完成本次${definition.taskLabel}任务；${definition.safetyInstruction}`,
    ...selected.map((document) => `\n--- ${document.name} ---\n${document.content}`),
    includeAllReferences
      ? `\n以上是本任务允许使用的完整 ${definition.label} skill bundle。`
      : `\n可按需读取：${definition.referenceFiles.join("、")}`,
  ].join("\n");
}

export async function materializeIsolatedPromptSkillBundle(bundle) {
  const definition = promptSkillDefinition(bundle?.id);
  const workspacePath = await mkdtemp(join(tmpdir(), "prompt-flow-grok-build-"));
  const skillsPath = join(workspacePath, ".grok", "skills");
  const isolatedRoot = join(skillsPath, definition.id);
  try {
    for (const document of bundle.documents) {
      const destination = join(isolatedRoot, ...document.name.split("/"));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, document.content, "utf8");
    }
    return {
      workspacePath,
      skillsPath,
      skillPath: join(isolatedRoot, "SKILL.md"),
      cleanup: () => rm(workspacePath, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(workspacePath, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
