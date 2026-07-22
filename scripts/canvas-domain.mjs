import { randomUUID } from "node:crypto";

export const CANVAS_SCHEMA_VERSION = 1;
export const MAX_CANVAS_NODES = 500;
export const MAX_CANVAS_EDGES = 2_000;
export const PROCESSOR_NODE_WIDTH = 520;

const NODE_TYPE_ALIASES = new Map([
  ["image", "reference"],
  ["reference", "reference"],
  ["video", "video"],
  ["text", "text"],
  ["text_box", "text"],
  ["textbox", "text"],
  ["prompt", "codex"],
  ["prompt_rewrite", "codex"],
  ["rewrite", "codex"],
  ["codex", "codex"],
  ["prompt_editor", "prompteditor"],
  ["prompteditor", "prompteditor"],
  ["image_generator", "imagegenerator"],
  ["imagegenerator", "imagegenerator"],
  ["video_generator", "videogenerator"],
  ["videogenerator", "videogenerator"],
  ["group", "group"],
]);

const PERSISTED_NODE_TYPES = new Set([
  "group",
  "reference",
  "video",
  "codex",
  "prompteditor",
  "imagegenerator",
  "videogenerator",
  "imageoutput",
  "videooutput",
  "text",
  "textinput",
  "textoutput",
  "output",
  "finalprompt",
  "revision",
  "revisedprompt",
]);

const TEXT_NODE_TYPES = new Set(["text", "textinput", "textoutput", "output", "finalprompt", "revision", "revisedprompt"]);
const TEXT_OUTPUT_TYPES = new Set(["text", "textoutput", "finalprompt", "revisedprompt"]);
const IMAGE_OUTPUT_TYPES = new Set(["reference", "imageoutput"]);
const VIDEO_OUTPUT_TYPES = new Set(["video", "videooutput"]);
const PROCESSOR_TYPES = new Set(["codex", "prompteditor", "imagegenerator", "videogenerator"]);
const MAX_REWRITE_IMAGES = 9;
const MAX_REWRITE_VIDEOS = 3;
const MAX_MEDIA_REFERENCES = 12;

const RUNTIME_DATA_KEYS = new Set([
  "onUpdate",
  "onDelete",
  "onRun",
  "onCopy",
  "onPaste",
  "busy",
  "busyLabel",
  "inputSlots",
  "promptConnected",
  "promptInput",
  "assignedMarkers",
  "modelOptions",
  "providerOptions",
  "imageProviderOptions",
  "videoGenerationProviderOptions",
  "preview",
]);

const TRANSIENT_NODE_KEYS = new Set(["selected", "dragging", "resizing", "measured"]);

function clone(value) {
  return structuredClone(value);
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空`);
  return value.trim();
}

function finitePosition(value, fallback = { x: 0, y: 0 }) {
  const x = Number(value?.x ?? fallback.x);
  const y = Number(value?.y ?? fallback.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("节点位置必须是有限数字");
  return { x, y };
}

function canonicalNodeType(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[ -]+/g, "_");
  const type = NODE_TYPE_ALIASES.get(normalized) || normalized;
  if (!PERSISTED_NODE_TYPES.has(type)) throw new Error(`不支持的节点类型：${value || "未指定"}`);
  return type;
}

function dataDefaults(type) {
  if (type === "reference" || type === "imageoutput") return { kind: "reference", title: "图片" };
  if (type === "video" || type === "videooutput") return { kind: "video", title: "视频" };
  if (TEXT_NODE_TYPES.has(type)) return { kind: "textBox", title: "文本框", text: "", prompt: "", source: "可编辑文本" };
  if (type === "codex") {
    return {
      kind: "codex",
      title: "编辑改写",
      provider: "codex",
      skillId: "seedance",
      mode: "全能参考",
      duration: "4s",
      ratio: "16:9",
      instruction: "",
    };
  }
  if (type === "prompteditor") {
    return { kind: "promptEditor", title: "编辑提示词", provider: "codex", skillId: "seedance", instruction: "", prompt: "" };
  }
  if (type === "imagegenerator") {
    return { kind: "imageGenerator", title: "图片生成", imageProvider: "openrouter", imageModel: "", ratio: "Auto", resolution: "1K", instruction: "" };
  }
  if (type === "videogenerator") {
    return {
      kind: "videoGenerator",
      title: "视频生成",
      videoGenerationProvider: "openrouter",
      videoGenerationModel: "",
      videoGenerationMode: "multimodal2video",
      duration: "5",
      ratio: "16:9",
      videoGenerationResolution: "720p",
      generateAudio: true,
      instruction: "",
    };
  }
  if (type === "group") return { kind: "group", title: "群组", memberCount: 0 };
  throw new Error(`无法创建节点类型：${type}`);
}

function cleanData(value) {
  const source = record(value) ? value : {};
  return Object.fromEntries(Object.entries(source).filter(([key, item]) => !RUNTIME_DATA_KEYS.has(key) && typeof item !== "function"));
}

function assertNoSensitiveFields(value, path = "data", depth = 0) {
  if (!record(value) || depth > 8) return;
  for (const [key, child] of Object.entries(value)) {
    if (/api.?key|secret|authorization|password/i.test(key)) throw new Error(`${path}.${key} 不允许保存密钥或凭据`);
    if (record(child)) assertNoSensitiveFields(child, `${path}.${key}`, depth + 1);
  }
}

export function serializeCanvasNode(node) {
  if (!record(node)) throw new Error("节点必须是对象");
  const type = canonicalNodeType(node.type || node.data?.kind);
  const serialized = {
    ...Object.fromEntries(Object.entries(node).filter(([key]) => !TRANSIENT_NODE_KEYS.has(key))),
    id: nonEmptyString(node.id, "节点 ID"),
    type,
    position: finitePosition(node.position),
    data: cleanData(node.data),
  };
  if (!serialized.data.kind) serialized.data.kind = dataDefaults(type).kind;
  return serialized;
}

export function createCanvasNode(nodeType, options = {}) {
  const type = canonicalNodeType(nodeType);
  assertNoSensitiveFields(options.data);
  const data = { ...dataDefaults(type), ...cleanData(options.data) };
  if (typeof options.title === "string" && options.title.trim()) data.title = options.title.trim().slice(0, 100);
  if (TEXT_NODE_TYPES.has(type) && typeof options.text === "string") {
    data.text = options.text;
    data.prompt = options.text;
  }
  const node = {
    id: String(options.id || `${type}-${randomUUID().slice(0, 8)}`).trim(),
    type,
    position: finitePosition(options.position),
    data,
  };
  if (PROCESSOR_TYPES.has(type)) {
    node.width = PROCESSOR_NODE_WIDTH;
    node.style = { ...(record(options.style) ? options.style : {}), width: PROCESSOR_NODE_WIDTH };
  } else if (type === "group") {
    node.style = {
      width: Math.max(240, Number(options.width || options.style?.width || 720)),
      height: Math.max(160, Number(options.height || options.style?.height || 480)),
    };
  } else if (record(options.style)) {
    node.style = { ...options.style };
  }
  if (options.parentId) {
    node.parentId = String(options.parentId);
    node.extent = "parent";
    node.expandParent = true;
  }
  return serializeCanvasNode(node);
}

function uniqueId(existing, prefix, requested) {
  if (requested) {
    const id = String(requested).trim();
    if (!id) throw new Error("ID 不能为空");
    if (existing.has(id)) throw new Error(`ID 已存在：${id}`);
    return id;
  }
  let id;
  do { id = `${prefix}-${randomUUID().slice(0, 8)}`; } while (existing.has(id));
  return id;
}

function presetGraph(presetId, position, existingNodeIds, existingEdgeIds) {
  const id = String(presetId || "").trim();
  if (!["prompt", "image-generation", "video-generation"].includes(id)) throw new Error(`不支持的预设：${presetId}`);
  const anchor = finitePosition(position, { x: 80, y: 120 });
  const token = randomUUID().slice(0, 8);
  const referenceId = uniqueId(existingNodeIds, "reference", `reference-${token}`);
  existingNodeIds.add(referenceId);
  const processorId = uniqueId(existingNodeIds, id, `${id}-${token}`);
  existingNodeIds.add(processorId);
  const outputId = uniqueId(existingNodeIds, `${id}-output`, `${id}-output-${token}`);
  existingNodeIds.add(outputId);

  const reference = createCanvasNode("reference", { id: referenceId, position: anchor, title: "参考图片" });
  let processor;
  let output;
  if (id === "prompt") {
    processor = createCanvasNode("codex", { id: processorId, position: { x: anchor.x + 440, y: anchor.y - 35 } });
    output = createCanvasNode("text", { id: outputId, position: { x: anchor.x + 1040, y: anchor.y + 70 }, title: "提示词结果" });
  } else if (id === "image-generation") {
    processor = createCanvasNode("imagegenerator", { id: processorId, position: { x: anchor.x + 440, y: anchor.y - 35 } });
    output = createCanvasNode("reference", { id: outputId, position: { x: anchor.x + 1040, y: anchor.y }, title: "生成图片" });
  } else {
    processor = createCanvasNode("videogenerator", { id: processorId, position: { x: anchor.x + 440, y: anchor.y - 35 } });
    output = createCanvasNode("video", { id: outputId, position: { x: anchor.x + 1040, y: anchor.y }, title: "生成视频" });
  }
  const mediaEdgeId = uniqueId(existingEdgeIds, "edge", `edge-${token}-reference`);
  existingEdgeIds.add(mediaEdgeId);
  const outputEdgeId = uniqueId(existingEdgeIds, "edge", `edge-${token}-output`);
  existingEdgeIds.add(outputEdgeId);
  return {
    nodes: [reference, processor, output],
    edges: [
      { id: mediaEdgeId, source: referenceId, target: processorId, targetHandle: "media-1", type: "disconnectable" },
      { id: outputEdgeId, source: processorId, target: outputId, type: "disconnectable" },
    ],
    ids: { referenceId, processorId, outputId },
  };
}

function slotNumber(edge) {
  const match = String(edge?.targetHandle || "").match(/^(?:image|media)-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function nodeTypeMap(nodes) {
  return new Map(nodes.map((node) => [node.id, node.type]));
}

export function validateCanvasConnection(nodes, edges, connection) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const source = byId.get(connection.source);
  const target = byId.get(connection.target);
  if (!source || !target) return { valid: false, reason: "连线引用了不存在的节点" };
  if (source.id === target.id) return { valid: false, reason: "节点不能连接到自身" };

  if ((source.type === "reference" || source.type === "video") && target.type === "codex") {
    if (!String(connection.targetHandle || "").startsWith("media-")) return { valid: false, reason: "改写参考必须连接到 media-* 端口" };
    const other = edges.filter((edge) => edge.target === target.id && edge.targetHandle !== connection.targetHandle && slotNumber(edge) !== null);
    const imageCount = other.filter((edge) => byId.get(edge.source)?.type === "reference").length;
    const videoCount = other.filter((edge) => byId.get(edge.source)?.type === "video").length;
    if (source.type === "reference" && imageCount >= MAX_REWRITE_IMAGES) return { valid: false, reason: "改写节点最多接入 9 张图片" };
    if (source.type === "video" && videoCount >= MAX_REWRITE_VIDEOS) return { valid: false, reason: "改写节点最多接入 3 个视频" };
    if (source.type === "video" && ["image", "photoreal"].includes(String(target.data?.skillId || ""))) return { valid: false, reason: "当前图片提示词 Skill 不支持视频参考" };
    return { valid: true };
  }
  if (source.type === "reference" && target.type === "imagegenerator") {
    if (!String(connection.targetHandle || "").startsWith("media-")) return { valid: false, reason: "参考图片必须连接到 media-* 端口" };
    const count = edges.filter((edge) => edge.target === target.id && edge.targetHandle !== connection.targetHandle && slotNumber(edge) !== null && byId.get(edge.source)?.type === "reference").length;
    return count < MAX_MEDIA_REFERENCES ? { valid: true } : { valid: false, reason: "图片生成节点最多接入 12 张参考图片" };
  }
  if ((source.type === "reference" || source.type === "video") && target.type === "videogenerator") {
    if (!String(connection.targetHandle || "").startsWith("media-")) return { valid: false, reason: "参考素材必须连接到 media-* 端口" };
    const count = edges.filter((edge) => edge.target === target.id && edge.targetHandle !== connection.targetHandle && slotNumber(edge) !== null && ["reference", "video"].includes(byId.get(edge.source)?.type)).length;
    return count < MAX_MEDIA_REFERENCES ? { valid: true } : { valid: false, reason: "视频生成节点最多接入 12 个参考素材" };
  }
  if (TEXT_NODE_TYPES.has(source.type) && (target.type === "imagegenerator" || target.type === "videogenerator")) {
    return connection.targetHandle === "prompt" ? { valid: true } : { valid: false, reason: "文本必须连接到 prompt 端口" };
  }
  if (TEXT_NODE_TYPES.has(source.type) && target.type === "prompteditor") {
    return connection.targetHandle === "original-prompt" ? { valid: true } : { valid: false, reason: "原提示词必须连接到 original-prompt 端口" };
  }
  if (source.type === "imagegenerator" && IMAGE_OUTPUT_TYPES.has(target.type)) return { valid: true };
  if (source.type === "videogenerator" && VIDEO_OUTPUT_TYPES.has(target.type)) return { valid: true };
  if (source.type === "text" && target.type === "text") return { valid: true };
  if ((source.type === "codex" || source.type === "prompteditor") && TEXT_OUTPUT_TYPES.has(target.type)) return { valid: true };
  return { valid: false, reason: `不支持从 ${source.type} 连接到 ${target.type}` };
}

function validateNode(node, ids) {
  const serialized = serializeCanvasNode(node);
  if (ids.has(serialized.id)) throw new Error(`节点 ID 重复：${serialized.id}`);
  ids.add(serialized.id);
  if (!record(serialized.data)) throw new Error(`节点 ${serialized.id} 缺少 data`);
  return serialized;
}

export function validateCanvasProject(project) {
  if (!record(project)) throw new Error("画布项目必须是对象");
  if (!Array.isArray(project.nodes) || !Array.isArray(project.edges)) throw new Error("画布必须包含 nodes 和 edges 数组");
  if (project.nodes.length > MAX_CANVAS_NODES) throw new Error(`画布最多支持 ${MAX_CANVAS_NODES} 个节点`);
  if (project.edges.length > MAX_CANVAS_EDGES) throw new Error(`画布最多支持 ${MAX_CANVAS_EDGES} 条连线`);

  const nodeIds = new Set();
  const nodes = project.nodes.map((node) => validateNode(node, nodeIds));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    if (!node.parentId) continue;
    const parent = byId.get(node.parentId);
    if (!parent || parent.type !== "group" || node.type === "group") throw new Error(`节点 ${node.id} 引用了无效群组`);
  }

  const edgeIds = new Set();
  const edges = project.edges.map((edge) => {
    if (!record(edge)) throw new Error("连线必须是对象");
    const id = nonEmptyString(edge.id, "连线 ID");
    if (edgeIds.has(id)) throw new Error(`连线 ID 重复：${id}`);
    edgeIds.add(id);
    const normalized = {
      ...edge,
      id,
      source: nonEmptyString(edge.source, "连线 source"),
      target: nonEmptyString(edge.target, "连线 target"),
      type: edge.type || "disconnectable",
    };
    if (!byId.has(normalized.source) || !byId.has(normalized.target)) throw new Error(`连线 ${id} 引用了不存在的节点`);
    return normalized;
  });

  for (const edge of edges) {
    const otherEdges = edges.filter((item) => item.id !== edge.id);
    const result = validateCanvasConnection(nodes, otherEdges, edge);
    if (!result.valid) throw new Error(`连线 ${edge.id} 无效：${result.reason}`);
  }
  return { ...project, nodes, edges };
}

function nodeVisualSize(node) {
  const width = Number(node.width || node.style?.width || (PROCESSOR_TYPES.has(node.type) ? PROCESSOR_NODE_WIDTH : 360));
  const defaultHeight = node.type === "videogenerator" ? 1080 : node.type === "imagegenerator" ? 820 : node.type === "video" ? 520 : node.type === "reference" ? 460 : node.type === "codex" ? 700 : node.type === "prompteditor" ? 520 : 300;
  const height = Number(node.height || node.style?.height || defaultHeight);
  return { width: Number.isFinite(width) ? width : 360, height: Number.isFinite(height) ? height : defaultHeight };
}

function groupNodes(project, operation, nodeIds, changes) {
  const ids = [...new Set((operation.nodeIds || []).map(String))];
  if (ids.length < 2) throw new Error("编组至少需要 2 个节点");
  const members = ids.map((id) => project.nodes.find((node) => node.id === id));
  if (members.some((node) => !node)) throw new Error("编组包含不存在的节点");
  if (members.some((node) => node.type === "group" || node.parentId)) throw new Error("暂不支持嵌套编组");
  const bounds = members.map((node) => ({ node, ...nodeVisualSize(node) }));
  const minX = Math.min(...bounds.map(({ node }) => node.position.x));
  const minY = Math.min(...bounds.map(({ node }) => node.position.y));
  const maxX = Math.max(...bounds.map(({ node, width }) => node.position.x + width));
  const maxY = Math.max(...bounds.map(({ node, height }) => node.position.y + height));
  const groupId = uniqueId(nodeIds, "group", operation.id);
  nodeIds.add(groupId);
  const groupPosition = { x: minX - 34, y: minY - 70 };
  const group = createCanvasNode("group", {
    id: groupId,
    position: groupPosition,
    title: operation.title || "群组",
    width: maxX - minX + 68,
    height: maxY - minY + 104,
    data: { memberCount: members.length },
  });
  const memberSet = new Set(ids);
  project.nodes = [group, ...project.nodes.map((node) => memberSet.has(node.id) ? {
    ...node,
    parentId: groupId,
    extent: "parent",
    expandParent: true,
    position: { x: node.position.x - groupPosition.x, y: node.position.y - groupPosition.y },
  } : node)];
  changes.createdNodeIds.push(groupId);
}

function ungroupNodes(project, operation, changes) {
  const groupId = nonEmptyString(operation.groupId || operation.id, "群组 ID");
  const group = project.nodes.find((node) => node.id === groupId && node.type === "group");
  if (!group) throw new Error(`没有找到群组：${groupId}`);
  project.nodes = project.nodes.flatMap((node) => {
    if (node.id === groupId) return [];
    if (node.parentId !== groupId) return [node];
    const detached = {
      ...node,
      position: { x: group.position.x + node.position.x, y: group.position.y + node.position.y },
    };
    delete detached.parentId;
    delete detached.extent;
    delete detached.expandParent;
    return [detached];
  });
  changes.deletedNodeIds.push(groupId);
}

function connectNodes(project, operation, edgeIds, changes) {
  const connection = {
    id: uniqueId(edgeIds, "edge", operation.id),
    source: nonEmptyString(operation.source, "连线 source"),
    target: nonEmptyString(operation.target, "连线 target"),
    type: operation.type || "disconnectable",
  };
  if (operation.sourceHandle) connection.sourceHandle = String(operation.sourceHandle);
  if (operation.targetHandle) connection.targetHandle = String(operation.targetHandle);
  const result = validateCanvasConnection(project.nodes, project.edges, connection);
  if (!result.valid) throw new Error(result.reason);
  const target = project.nodes.find((node) => node.id === connection.target);
  if (PROCESSOR_TYPES.has(target?.type)) {
    project.edges = project.edges.filter((edge) => !(edge.target === connection.target && edge.targetHandle === connection.targetHandle));
  } else {
    project.edges = project.edges.filter((edge) => edge.target !== connection.target);
  }
  project.edges.push(connection);
  edgeIds.add(connection.id);
  changes.createdEdgeIds.push(connection.id);
}

export function applyCanvasOperations(inputProject, operations, options = {}) {
  if (!Array.isArray(operations) || !operations.length) throw new Error("operations 至少需要一个操作");
  const project = validateCanvasProject(clone(inputProject));
  const nodeIds = new Set(project.nodes.map((node) => node.id));
  const edgeIds = new Set(project.edges.map((edge) => edge.id));
  const changes = { createdNodeIds: [], updatedNodeIds: [], deletedNodeIds: [], createdEdgeIds: [], deletedEdgeIds: [], presetIds: [] };

  for (const rawOperation of operations) {
    if (!record(rawOperation)) throw new Error("每个操作都必须是对象");
    const operation = rawOperation;
    const op = String(operation.op || "").trim().toLowerCase();
    if (op === "add_node") {
      const id = uniqueId(nodeIds, "node", operation.id);
      const node = createCanvasNode(operation.nodeType || operation.type, { ...operation, id });
      project.nodes.push(node);
      nodeIds.add(id);
      changes.createdNodeIds.push(id);
    } else if (op === "update_node") {
      const id = nonEmptyString(operation.nodeId || operation.id, "节点 ID");
      const index = project.nodes.findIndex((node) => node.id === id);
      if (index < 0) throw new Error(`没有找到节点：${id}`);
      const current = project.nodes[index];
      const patch = record(operation.patch) ? operation.patch : {};
      assertNoSensitiveFields(operation.data || operation.dataPatch || patch.data);
      if (patch.id && patch.id !== id) throw new Error("update_node 不能修改节点 ID");
      if (patch.type && canonicalNodeType(patch.type) !== current.type) throw new Error("update_node 不能修改节点类型");
      const next = {
        ...current,
        ...Object.fromEntries(Object.entries(patch).filter(([key]) => !["id", "type", "data", "position"].includes(key))),
        position: patch.position ? finitePosition(patch.position) : current.position,
        data: { ...current.data, ...cleanData(operation.data || operation.dataPatch || patch.data) },
      };
      if (typeof operation.title === "string") next.data.title = operation.title.trim().slice(0, 100);
      if (typeof operation.text === "string" && TEXT_NODE_TYPES.has(current.type)) {
        next.data.text = operation.text;
        next.data.prompt = operation.text;
      }
      project.nodes[index] = serializeCanvasNode(next);
      changes.updatedNodeIds.push(id);
    } else if (op === "delete_nodes" || op === "remove_nodes" || op === "delete_node") {
      const requested = operation.nodeIds || operation.ids || [operation.nodeId || operation.id];
      const ids = new Set(requested.filter(Boolean).map(String));
      for (const id of [...ids]) {
        const node = project.nodes.find((item) => item.id === id);
        if (!node) throw new Error(`没有找到节点：${id}`);
        if (node.type === "group") project.nodes.filter((item) => item.parentId === id).forEach((item) => ids.add(item.id));
      }
      project.nodes = project.nodes.filter((node) => !ids.has(node.id));
      const removedEdges = project.edges.filter((edge) => ids.has(edge.source) || ids.has(edge.target));
      project.edges = project.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target));
      ids.forEach((id) => { nodeIds.delete(id); changes.deletedNodeIds.push(id); });
      removedEdges.forEach((edge) => { edgeIds.delete(edge.id); changes.deletedEdgeIds.push(edge.id); });
    } else if (op === "connect" || op === "add_edge") {
      connectNodes(project, operation, edgeIds, changes);
    } else if (op === "disconnect" || op === "remove_edge" || op === "delete_edge") {
      const before = project.edges.length;
      const ids = new Set((operation.edgeIds || operation.ids || [operation.edgeId || operation.id]).filter(Boolean).map(String));
      project.edges = project.edges.filter((edge) => {
        const matchesId = ids.size && ids.has(edge.id);
        const matchesPair = !ids.size && (!operation.source || edge.source === operation.source) && (!operation.target || edge.target === operation.target);
        if (matchesId || matchesPair) {
          changes.deletedEdgeIds.push(edge.id);
          edgeIds.delete(edge.id);
          return false;
        }
        return true;
      });
      if (project.edges.length === before) throw new Error("没有找到要断开的连线");
    } else if (op === "apply_preset") {
      const graph = presetGraph(operation.presetId, operation.position, nodeIds, edgeIds);
      project.nodes.push(...graph.nodes);
      project.edges.push(...graph.edges);
      changes.createdNodeIds.push(...graph.nodes.map((node) => node.id));
      changes.createdEdgeIds.push(...graph.edges.map((edge) => edge.id));
      changes.presetIds.push(String(operation.presetId));
    } else if (op === "rename_project") {
      project.name = nonEmptyString(operation.name, "画布名称").replace(/[\u0000-\u001f]/g, " ").slice(0, 60);
    } else if (op === "group") {
      groupNodes(project, operation, nodeIds, changes);
    } else if (op === "ungroup") {
      ungroupNodes(project, operation, changes);
    } else if (op === "layout") {
      const ids = operation.nodeIds?.length ? operation.nodeIds.map(String) : project.nodes.filter((node) => node.type !== "group" && !node.parentId).map((node) => node.id);
      const columns = Math.max(1, Number(operation.columns || Math.ceil(Math.sqrt(ids.length))));
      const origin = finitePosition(operation.position, { x: 80, y: 100 });
      const gapX = Math.max(120, Number(operation.gapX || 620));
      const gapY = Math.max(100, Number(operation.gapY || 560));
      const idSet = new Set(ids);
      let index = 0;
      project.nodes = project.nodes.map((node) => {
        if (!idSet.has(node.id)) return node;
        const position = { x: origin.x + (index % columns) * gapX, y: origin.y + Math.floor(index / columns) * gapY };
        index += 1;
        changes.updatedNodeIds.push(node.id);
        return { ...node, position };
      });
    } else {
      throw new Error(`不支持的画布操作：${operation.op || "未指定"}`);
    }
  }

  const validated = validateCanvasProject(project);
  if (validated.nodes.length > MAX_CANVAS_NODES || validated.edges.length > MAX_CANVAS_EDGES) throw new Error("画布超过节点或连线上限");
  return { project: validated, changes, dryRun: Boolean(options.dryRun) };
}

function compactMediaUrl(value) {
  if (typeof value !== "string" || !value) return undefined;
  if (/^data:/i.test(value)) return undefined;
  return value;
}

function compactSafeValue(key, value, depth = 0) {
  if (/api.?key|secret|authorization|password/i.test(key)) return "[redacted]";
  if (typeof value === "string") {
    if (/^data:[^;,]+;base64,/i.test(value)) return "[inline media omitted]";
    return value.length > 20_000 ? `${value.slice(0, 20_000)}…[truncated]` : value;
  }
  if (depth >= 5) return "[nested data omitted]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => compactSafeValue(key, item, depth + 1));
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, compactSafeValue(childKey, child, depth + 1)]));
  return value;
}

function compactNodeData(data) {
  const result = {};
  for (const [key, value] of Object.entries(cleanData(data))) {
    if (key === "imageData") {
      result.imageAttached = Boolean(value);
      continue;
    }
    if (key === "videoData") {
      result.videoAttached = Boolean(value);
      continue;
    }
    if (key === "generatedImages" && Array.isArray(value)) {
      result.generatedImages = value.map((item) => ({ mediaType: item?.mediaType, savedPath: item?.savedPath, hasInlineData: Boolean(item?.dataUrl) }));
      continue;
    }
    if (key === "generatedVideos" && Array.isArray(value)) {
      result.generatedVideos = value.map((item) => ({ mediaType: item?.mediaType, savedPath: item?.savedPath, url: compactMediaUrl(item?.url), hasInlineData: /^data:/i.test(String(item?.url || "")) }));
      continue;
    }
    if (key === "preview") continue;
    result[key] = compactSafeValue(key, value);
  }
  return result;
}

export function compactCanvasProject(project) {
  const validated = validateCanvasProject(project);
  return {
    id: validated.id,
    name: validated.name,
    schemaVersion: validated.schemaVersion || CANVAS_SCHEMA_VERSION,
    revision: validated.revision || 1,
    createdAt: validated.createdAt,
    updatedAt: validated.updatedAt,
    nodes: validated.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      title: node.data?.title,
      position: node.position,
      ...(node.parentId ? { parentId: node.parentId } : {}),
      ...(node.style ? { style: node.style } : {}),
      data: compactNodeData(node.data),
    })),
    edges: validated.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
    })),
  };
}

function nodeText(node) {
  return String(node?.data?.text || node?.data?.prompt || "").trim();
}

function connectedMedia(project, targetId) {
  const byId = new Map(project.nodes.map((node) => [node.id, node]));
  return project.edges
    .filter((edge) => edge.target === targetId && slotNumber(edge) !== null)
    .map((edge) => ({ edge, slot: slotNumber(edge), source: byId.get(edge.source) }))
    .filter((item) => item.source?.type === "reference" || item.source?.type === "video")
    .sort((left, right) => left.slot - right.slot);
}

function sourceMedia(source) {
  if (source.type === "video") return source.data?.videoData || source.data?.generatedVideos?.[0]?.url;
  return source.data?.imageData || source.data?.generatedImages?.[0]?.dataUrl;
}

function outputIds(project, nodeId, allowedTypes) {
  const types = nodeTypeMap(project.nodes);
  return project.edges.filter((edge) => edge.source === nodeId && allowedTypes.has(types.get(edge.target))).map((edge) => edge.target);
}

function taskTitle(prefix, provider, prompt) {
  return `${prefix} · ${provider} · ${String(prompt).replace(/\s+/g, " ").slice(0, 18)}`;
}

export function buildNodeTaskRequest(inputProject, nodeId, overrides = {}) {
  const project = validateCanvasProject(clone(inputProject));
  const node = project.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error(`没有找到节点：${nodeId}`);
  const data = { ...node.data, ...(record(overrides) ? overrides : {}) };

  if (node.type === "imagegenerator") {
    const outputs = outputIds(project, nodeId, IMAGE_OUTPUT_TYPES);
    if (!outputs.length) throw new Error("图片生成节点必须连接到图片输出节点");
    const promptEdge = project.edges.find((edge) => edge.target === nodeId && edge.targetHandle === "prompt");
    const prompt = String(overrides.prompt || (promptEdge ? nodeText(project.nodes.find((item) => item.id === promptEdge.source)) : data.instruction) || "").trim();
    if (!prompt) throw new Error("图片生成提示词不能为空");
    let imageIndex = 0;
    const images = connectedMedia(project, nodeId).map(({ slot, source }) => {
      if (source.type !== "reference") throw new Error("图片生成节点只支持图片参考");
      const dataUrl = sourceMedia(source);
      if (!dataUrl) throw new Error(`参考节点 ${source.id} 还没有图片`);
      return { slot, marker: `@图片${++imageIndex}`, mediaKind: "image", fileName: source.data?.fileName, dataUrl };
    });
    const provider = String(data.imageProvider || "openrouter");
    return {
      payload: { provider, model: String(data.imageModel || data.model || ""), prompt, aspectRatio: data.ratio || "Auto", resolution: data.resolution || "1K", images },
      taskMeta: { kind: "image-generation", projectId: project.id, title: taskTitle("图片生成", provider, prompt), sourceNodeId: nodeId, outputNodeIds: outputs, persistResult: true, origin: "automation" },
    };
  }

  if (node.type === "videogenerator") {
    const outputs = outputIds(project, nodeId, VIDEO_OUTPUT_TYPES);
    if (!outputs.length) throw new Error("视频生成节点必须连接到视频输出节点");
    const promptEdge = project.edges.find((edge) => edge.target === nodeId && edge.targetHandle === "prompt");
    const prompt = String(overrides.prompt || (promptEdge ? nodeText(project.nodes.find((item) => item.id === promptEdge.source)) : data.instruction) || "").trim();
    if (!prompt) throw new Error("视频生成提示词不能为空");
    let imageIndex = 0;
    let videoIndex = 0;
    const references = connectedMedia(project, nodeId).map(({ slot, source }) => {
      const mediaKind = source.type === "video" ? "video" : "image";
      const dataUrl = sourceMedia(source);
      if (!dataUrl) throw new Error(`参考节点 ${source.id} 还没有素材`);
      return { slot, marker: mediaKind === "video" ? `@视频${++videoIndex}` : `@图片${++imageIndex}`, mediaKind, fileName: source.data?.fileName, dataUrl };
    });
    const mode = String(data.videoGenerationMode || "multimodal2video");
    const images = references.filter((item) => item.mediaKind === "image");
    const videos = references.filter((item) => item.mediaKind === "video");
    if (mode === "text2video" && references.length) throw new Error("文生视频模式不能连接参考素材");
    if (mode === "image2video" && (images.length !== 1 || videos.length)) throw new Error("单图生视频模式需要且只能连接 1 张图片");
    if (mode === "frames2video" && (images.length !== 2 || videos.length)) throw new Error("首尾帧模式需要且只能连接 2 张图片");
    if (mode === "multiframe2video" && (images.length < 2 || videos.length)) throw new Error("智能多帧模式需要至少 2 张图片且不能连接视频");
    if (mode === "multimodal2video" && (!references.length || images.length > 9 || videos.length > 3)) throw new Error("全能参考需要 1–12 个素材，最多 9 图 + 3 视频");
    const provider = String(data.videoGenerationProvider || "openrouter");
    return {
      payload: {
        provider,
        model: String(data.videoGenerationModel || data.model || ""),
        mode,
        prompt,
        aspectRatio: data.ratio || "16:9",
        resolution: data.videoGenerationResolution || "720p",
        duration: Number(data.duration || 5),
        generateAudio: data.generateAudio !== false,
        confirmLowCredit: data.confirmLowCredit === true,
        references,
      },
      taskMeta: { kind: "video-generation", projectId: project.id, title: taskTitle("视频生成", provider, prompt), sourceNodeId: nodeId, outputNodeIds: outputs, persistResult: true, origin: "automation" },
    };
  }

  if (node.type === "codex") {
    const outputs = outputIds(project, nodeId, TEXT_OUTPUT_TYPES);
    if (!outputs.length) throw new Error("编辑改写节点必须连接到文本框");
    const instruction = String(overrides.prompt || data.instruction || "").trim();
    if (!instruction) throw new Error("编辑改写需求不能为空");
    const skillId = String(data.skillId || "seedance");
    let imageIndex = 0;
    let videoIndex = 0;
    const media = connectedMedia(project, nodeId).map(({ source }) => {
      const mediaKind = source.type === "video" ? "video" : "image";
      const dataUrl = sourceMedia(source);
      if (!dataUrl) throw new Error(`参考节点 ${source.id} 还没有素材`);
      return { mediaKind, marker: mediaKind === "video" ? `@视频${++videoIndex}` : `@图片${++imageIndex}`, fileName: source.data?.fileName, dataUrl };
    });
    if (["image", "photoreal"].includes(skillId) && media.some((item) => item.mediaKind === "video")) throw new Error("当前图片提示词 Skill 不支持视频参考");
    const images = media.filter((item) => item.mediaKind === "image").map((item, index) => ({ ...item, slot: index + 1 }));
    const videos = media.filter((item) => item.mediaKind === "video").map((item, index) => ({ ...item, slot: index + 1 }));
    const provider = String(data.provider || "codex");
    const isImageSkill = ["image", "photoreal"].includes(skillId);
    return {
      payload: {
        prompt: instruction,
        instruction: isImageSkill
          ? skillId === "photoreal"
            ? "根据用户需求和已连接的参考图片，按真实感场景 Skill 路由参考分类，生成一份可直接复制使用的完整真实感图像提示词。"
            : "根据用户需求和已连接的参考图片，按 Image skill 选择合适的图像模型并生成一份可直接复制使用的完整图像提示词。"
          : "根据用户需求和已连接的图片、视频参考，直接生成一段可用于 Seedance2 的最终中文提示词。",
        skillId,
        provider,
        model: String(data.model || "default"),
        reasoningEffort: String(data.reasoningEffort || "default"),
        spec: { skillId, mode: data.mode, duration: data.duration, ratio: data.ratio, provider, model: data.model, reasoningEffort: data.reasoningEffort, imageMarkers: images.map((item) => item.marker), videoMarkers: videos.map((item) => item.marker) },
        images,
        videos,
        threadId: data.threadId,
      },
      taskMeta: { kind: "generation", projectId: project.id, title: taskTitle("编辑改写", provider, instruction), sourceNodeId: nodeId, outputNodeIds: outputs, persistResult: true, origin: "automation" },
    };
  }

  if (node.type === "prompteditor") {
    const inputEdge = project.edges.find((edge) => edge.target === nodeId && edge.targetHandle === "original-prompt");
    const prompt = String(overrides.originalPrompt || (inputEdge ? nodeText(project.nodes.find((item) => item.id === inputEdge.source)) : data.prompt) || "").trim();
    const instruction = String(overrides.instruction || data.instruction || "").trim();
    if (!prompt || !instruction) throw new Error("编辑提示词节点需要原提示词和修改意见");
    const outputs = outputIds(project, nodeId, TEXT_OUTPUT_TYPES);
    if (!outputs.length) throw new Error("编辑提示词节点必须连接到文本框");
    const provider = String(data.provider || "codex");
    const skillId = String(data.skillId || "seedance");
    return {
      payload: {
        taskMode: "revision",
        prompt,
        instruction,
        skillId,
        provider,
        model: String(data.model || "default"),
        reasoningEffort: String(data.reasoningEffort || "default"),
        threadId: data.threadId,
        spec: { skillId, mode: data.mode, duration: data.duration, ratio: data.ratio, provider, model: data.model, reasoningEffort: data.reasoningEffort },
      },
      taskMeta: { kind: "revision", projectId: project.id, title: taskTitle("编辑提示词", provider, prompt), sourceNodeId: nodeId, outputNodeIds: outputs, persistResult: true, origin: "automation" },
    };
  }
  throw new Error(`节点 ${nodeId} 不是可执行节点`);
}

function providerSource(provider) {
  const labels = { codex: "Codex", openrouter: "OpenRouter", comfly: "Comfly", "grok-build": "Grok Build", antigravity: "Antigravity" };
  return labels[provider] || String(provider || "Agent Canvas");
}

export function applyTaskResultToProject(inputProject, task) {
  const project = validateCanvasProject(clone(inputProject));
  if (!task || task.projectId !== project.id) throw new Error("任务不属于当前画布");
  const outputs = new Set(task.outputNodeIds || []);
  const result = task.result || {};
  let changed = false;
  project.nodes = project.nodes.map((node) => {
    if (task.status === "failed" && (node.id === task.sourceNodeId || outputs.has(node.id))) {
      changed = true;
      if (task.kind === "image-generation") return { ...node, data: { ...node.data, imageError: task.error } };
      if (task.kind === "video-generation") return { ...node, data: { ...node.data, videoGenerationError: task.error } };
      return node;
    }
    if (task.status !== "completed") return node;
    if (task.kind === "image-generation" && result.images?.length) {
      const meta = `${providerSource(task.provider)} · ${task.model || "图片模型"} · ${result.resolution || ""} · ${result.aspectRatio || ""}`.replace(/ · $/, "");
      if (outputs.has(node.id)) {
        changed = true;
        return { ...node, data: { ...node.data, generatedImages: result.images, imageData: result.images[0].dataUrl, fileName: `generated-${task.id.slice(0, 6)}.png`, generationMeta: meta, imageError: undefined } };
      }
      if (node.id === task.sourceNodeId) {
        changed = true;
        return { ...node, data: { ...node.data, generationMeta: meta, imageError: undefined } };
      }
    }
    if (task.kind === "video-generation" && result.videos?.length) {
      const meta = `${providerSource(task.provider)} · ${task.model || "视频模型"} · ${result.duration || ""}s · ${result.resolution || ""} · ${result.aspectRatio || ""}`.replace(/ · $/, "");
      if (outputs.has(node.id)) {
        changed = true;
        return { ...node, data: { ...node.data, generatedVideos: result.videos, fileName: `generated-${task.id.slice(0, 6)}.mp4`, generationMeta: meta, videoGenerationError: undefined } };
      }
      if (node.id === task.sourceNodeId) {
        changed = true;
        return { ...node, data: { ...node.data, generationMeta: meta, videoGenerationError: undefined, confirmLowCredit: false } };
      }
    }
    if ((task.kind === "generation" || task.kind === "revision") && result.prompt && outputs.has(node.id)) {
      changed = true;
      return { ...node, data: { ...node.data, text: result.prompt, prompt: result.prompt, source: providerSource(task.provider) } };
    }
    if (task.kind === "generation" && result.threadId && node.id === task.sourceNodeId) {
      changed = true;
      return { ...node, data: { ...node.data, threadId: result.threadId } };
    }
    return node;
  });
  if (!changed && task.status === "completed") throw new Error("任务完成，但没有可写入的输出节点");
  project.automation = { ...(record(project.automation) ? project.automation : {}), lastTaskId: task.id, lastTaskAt: task.finishedAt || new Date().toISOString() };
  return project;
}

export function compactTask(task) {
  if (!task) return null;
  const compact = clone(task);
  if (compact.result?.images) compact.result.images = compact.result.images.map((item) => ({ mediaType: item.mediaType, savedPath: item.savedPath, hasInlineData: Boolean(item.dataUrl) }));
  if (compact.result?.videos) compact.result.videos = compact.result.videos.map((item) => ({ mediaType: item.mediaType, savedPath: item.savedPath, url: compactMediaUrl(item.url), hasInlineData: /^data:/i.test(String(item.url || "")) }));
  return compact;
}

export function canvasOutputs(project) {
  const compact = compactCanvasProject(project);
  return compact.nodes.filter((node) => {
    if (TEXT_OUTPUT_TYPES.has(node.type)) return Boolean(node.data.text || node.data.prompt);
    if (IMAGE_OUTPUT_TYPES.has(node.type)) return Boolean(node.data.imageAttached || node.data.generatedImages?.length);
    if (VIDEO_OUTPUT_TYPES.has(node.type)) return Boolean(node.data.videoAttached || node.data.generatedVideos?.length);
    return false;
  }).map((node) => ({ id: node.id, type: node.type, title: node.title, data: node.data }));
}

export function automationCapabilities() {
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    presets: ["prompt", "image-generation", "video-generation"],
    nodeTypes: ["image", "video", "text", "prompt", "prompt_editor", "image_generator", "video_generator", "group"],
    operations: ["add_node", "update_node", "delete_nodes", "connect", "disconnect", "apply_preset", "rename_project", "group", "ungroup", "layout"],
    executableNodeTypes: ["codex", "prompteditor", "imagegenerator", "videogenerator"],
    limits: { nodes: MAX_CANVAS_NODES, edges: MAX_CANVAS_EDGES, referencesPerGenerator: MAX_MEDIA_REFERENCES },
  };
}
