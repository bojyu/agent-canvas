import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCanvasOperations,
  applyTaskResultToProject,
  buildNodeTaskRequest,
  canvasOutputs,
  compactCanvasProject,
  createCanvasNode,
  validateCanvasProject,
} from "../scripts/canvas-domain.mjs";

function project(nodes = [], edges = []) {
  return {
    id: "project-test-001",
    name: "Test canvas",
    revision: 1,
    schemaVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    nodes,
    edges,
  };
}

test("preset creates a valid connected workflow", () => {
  const result = applyCanvasOperations(project(), [{ op: "apply_preset", presetId: "image-generation", position: { x: 100, y: 200 } }]);
  assert.equal(result.project.nodes.length, 3);
  assert.equal(result.project.edges.length, 2);
  assert.equal(result.changes.createdNodeIds.length, 3);
  assert.equal(result.project.nodes.find((node) => node.type === "imagegenerator").position.x, 540);
  assert.doesNotThrow(() => validateCanvasProject(result.project));
});

test("operations are atomic and do not mutate the input project", () => {
  const input = project([createCanvasNode("text", { id: "brief", text: "hello" })]);
  const before = structuredClone(input);
  assert.throws(() => applyCanvasOperations(input, [
    { op: "add_node", id: "result", nodeType: "image" },
    { op: "connect", source: "brief", target: "result" },
  ]), /不支持从 text 连接到 reference/);
  assert.deepEqual(input, before);
});

test("group and ungroup preserve absolute member positions", () => {
  const input = project([
    createCanvasNode("text", { id: "a", position: { x: 100, y: 150 } }),
    createCanvasNode("image", { id: "b", position: { x: 600, y: 220 } }),
  ]);
  const grouped = applyCanvasOperations(input, [{ op: "group", id: "group-1", nodeIds: ["a", "b"], title: "Inputs" }]).project;
  const group = grouped.nodes.find((node) => node.id === "group-1");
  const member = grouped.nodes.find((node) => node.id === "a");
  assert.equal(group.position.x + member.position.x, 100);
  assert.equal(group.position.y + member.position.y, 150);
  const ungrouped = applyCanvasOperations(grouped, [{ op: "ungroup", groupId: "group-1" }]).project;
  assert.deepEqual(ungrouped.nodes.find((node) => node.id === "a").position, { x: 100, y: 150 });
  assert.deepEqual(ungrouped.nodes.find((node) => node.id === "b").position, { x: 600, y: 220 });
});

test("compact inspection never returns inline media", () => {
  const input = project([
    createCanvasNode("image", {
      id: "image",
      data: {
        imageData: "data:image/png;base64,SECRET_INLINE_DATA",
        generatedImages: [{ dataUrl: "data:image/png;base64,RESULT", mediaType: "image/png", savedPath: "D:/outputs/result.png" }],
      },
    }),
    createCanvasNode("video", {
      id: "video",
      data: { videoData: "data:video/mp4;base64,VIDEO", generatedVideos: [{ url: "data:video/mp4;base64,RESULT", mediaType: "video/mp4", savedPath: "D:/outputs/result.mp4" }] },
    }),
  ]);
  const compact = compactCanvasProject(input);
  const serialized = JSON.stringify(compact);
  assert.equal(serialized.includes("SECRET_INLINE_DATA"), false);
  assert.equal(serialized.includes("base64"), false);
  assert.equal(compact.nodes[0].data.imageAttached, true);
  assert.equal(compact.nodes[0].data.generatedImages[0].savedPath, "D:/outputs/result.png");
  assert.equal(compact.nodes[1].data.generatedVideos[0].hasInlineData, true);
});

test("automation node writes reject credential-shaped data fields", () => {
  assert.throws(() => createCanvasNode("text", { data: { apiKey: "must-not-be-stored" } }), /不允许保存密钥或凭据/);
  const input = project([createCanvasNode("text", { id: "safe" })]);
  assert.throws(() => applyCanvasOperations(input, [{ op: "update_node", nodeId: "safe", data: { password: "nope" } }]), /不允许保存密钥或凭据/);
});

test("Nano Banana prompt adapter compiles as an image-only prompt task", () => {
  const nodes = [
    createCanvasNode("prompt", {
      id: "nano",
      data: {
        provider: "codex",
        model: "gpt-5.6",
        skillId: "nanobanana",
        instruction: "生成一张自然光产品场景图",
        ratio: "3:4",
      },
    }),
    createCanvasNode("text", { id: "output" }),
  ];
  const request = buildNodeTaskRequest(project(nodes, [
    { id: "output", source: "nano", target: "output", type: "disconnectable" },
  ]), "nano");
  assert.equal(request.payload.skillId, "nanobanana");
  assert.equal(request.payload.spec.skillId, "nanobanana");
  assert.match(request.payload.instruction, /Nano Banana/);
});

test("No Skill prompt mode compiles without model-specific guidance", () => {
  const nodes = [
    createCanvasNode("prompt", {
      id: "plain",
      data: {
        provider: "codex",
        model: "gpt-5.6",
        skillId: "none",
        instruction: "整理成一份完整提示词",
        ratio: "3:4",
      },
    }),
    createCanvasNode("text", { id: "output" }),
  ];
  const request = buildNodeTaskRequest(project(nodes, [
    { id: "output", source: "plain", target: "output", type: "disconnectable" },
  ]), "plain");
  assert.equal(request.payload.skillId, "none");
  assert.match(request.payload.instruction, /不要加载或调用任何 Skill/);
  assert.doesNotMatch(request.payload.instruction, /Seedance2|Nano Banana|GPT Image/);
});

test("image generator compiles graph connections into a task request", () => {
  const nodes = [
    createCanvasNode("text", { id: "brief", text: "A red chair" }),
    createCanvasNode("image", { id: "reference", data: { imageData: "data:image/png;base64,REF", fileName: "chair.png" } }),
    createCanvasNode("image_generator", { id: "generator", data: { imageProvider: "comfly", imageModel: "gpt-image-2", resolution: "2K", ratio: "1:1" } }),
    createCanvasNode("image", { id: "output" }),
  ];
  const edges = [
    { id: "prompt", source: "brief", target: "generator", targetHandle: "prompt", type: "disconnectable" },
    { id: "reference", source: "reference", target: "generator", targetHandle: "media-1", type: "disconnectable" },
    { id: "output", source: "generator", target: "output", type: "disconnectable" },
  ];
  const request = buildNodeTaskRequest(project(nodes, edges), "generator");
  assert.equal(request.payload.prompt, "A red chair");
  assert.equal(request.payload.model, "gpt-image-2");
  assert.equal(request.payload.images[0].marker, "@图片1");
  assert.deepEqual(request.taskMeta.outputNodeIds, ["output"]);
  assert.equal(request.taskMeta.persistResult, true);
});

test("completed task results are written to connected output nodes", () => {
  const input = project([
    createCanvasNode("image_generator", { id: "generator", data: { imageProvider: "comfly", imageModel: "gpt-image-2" } }),
    createCanvasNode("image", { id: "output" }),
  ], [{ id: "edge", source: "generator", target: "output", type: "disconnectable" }]);
  const updated = applyTaskResultToProject(input, {
    id: "task-123456",
    projectId: input.id,
    kind: "image-generation",
    status: "completed",
    provider: "comfly",
    model: "gpt-image-2",
    sourceNodeId: "generator",
    outputNodeIds: ["output"],
    result: {
      images: [{ dataUrl: "data:image/png;base64,RESULT", mediaType: "image/png", savedPath: "D:/outputs/final.png" }],
      resolution: "2K",
      aspectRatio: "1:1",
    },
  });
  assert.equal(updated.nodes.find((node) => node.id === "output").data.imageData, "data:image/png;base64,RESULT");
  const outputs = canvasOutputs(updated);
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].data.generatedImages[0].savedPath, "D:/outputs/final.png");
  assert.equal(JSON.stringify(outputs).includes("RESULT"), false);
});
