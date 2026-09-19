"use client";

import { ChangeEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  BaseEdge,
  Connection,
  ConnectionLineType,
  Controls,
  Edge,
  EdgeChange,
  EdgeLabelRenderer,
  EdgeProps,
  EdgeTypes,
  getBezierPath,
  Handle,
  Node,
  NodeChange,
  NodeProps,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  backgroundProjectEventDecision,
  createCanvasDraft,
  mergeCanvasDraft,
  parseCanvasDraft,
  shouldApplyTaskOutcome,
} from "./canvas-sync-policy.mjs";

gsap.registerPlugin(useGSAP);

type NodeKind = "reference" | "video" | "textBox" | "skill" | "codex" | "promptEditor" | "imageGenerator" | "videoGenerator" | "imageOutput" | "videoOutput" | "output" | "revision" | "revisedOutput" | "textInput" | "textOutput" | "group";
type PaletteNodeKind = "reference" | "video" | "text" | "skill" | "codex" | "prompteditor" | "imagegenerator" | "videogenerator";
type FlowPresetId = "prompt" | "image-generation" | "video-generation";
type ThemePreference = "light" | "dark" | "system";
type ApiKeyName = "OPENROUTER_API_KEY" | "GEMINI_API_KEY" | "COMFLY_API_KEY" | "COMFLY_LLM_API_KEY" | "COMFLY_GPT_IMAGE_2_1K_API_KEY" | "COMFLY_GPT_IMAGE_2_2K_API_KEY" | "COMFLY_GPT_IMAGE_2_4K_API_KEY";
type MediaSlot = {
  slot: number;
  marker: string;
  sourceId?: string;
  fileName?: string;
  mediaKind?: "image" | "video";
  hasMedia: boolean;
};
type AgentProvider = "codex" | "openrouter" | "comfly" | "grok-build" | "antigravity";
type PromptSkillId = "none" | "seedance" | "nanobanana" | "image" | "photoreal" | `custom:${string}`;
type SkillRegistryItem = {
  id: PromptSkillId;
  name: string;
  label: string;
  description?: string;
  path?: string;
  version?: string;
  builtin: boolean;
  removable: boolean;
  ready: boolean;
  adapter?: string;
};
type ImageGenerationProvider = "openrouter" | "google" | "comfly";
type ImageGenerationResolution = "1K" | "2K" | "4K";
type ImageGenerationModelOption = {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  supportedResolutions?: ImageGenerationResolution[];
  maxReferences?: number;
};
type ImageGenerationProviderOption = {
  provider: ImageGenerationProvider;
  label: string;
  configured: boolean;
  loading: boolean;
  models: ImageGenerationModelOption[];
  message?: string;
};
type ImageGenerationProviderCatalogs = Record<ImageGenerationProvider, Omit<ImageGenerationProviderOption, "provider" | "label">>;
type ImageGenerationModelCatalogResponse = {
  provider: ImageGenerationProvider;
  label?: string;
  configured: boolean;
  models: ImageGenerationModelOption[];
  message?: string;
};
type GeneratedImage = { dataUrl: string; mediaType: string; savedPath?: string };
type VideoGenerationProvider = "openrouter" | "comfly" | "seedance-cli";
type VideoGenerationMode = "text2video" | "image2video" | "frames2video" | "multiframe2video" | "multimodal2video";
type VideoGenerationResolution = "720p" | "1080p" | "2K" | "4K";
type VideoGenerationModelOption = {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  supportedResolutions?: VideoGenerationResolution[];
  supportedDurations?: number[];
  supportedAspectRatios?: string[];
  supportsMixedReferences?: boolean;
  maxReferences?: number;
};
type VideoGenerationProviderOption = {
  provider: VideoGenerationProvider;
  label: string;
  configured: boolean;
  loading: boolean;
  models: VideoGenerationModelOption[];
  message?: string;
};
type VideoGenerationProviderCatalogs = Record<VideoGenerationProvider, Omit<VideoGenerationProviderOption, "provider" | "label">>;
type VideoGenerationModelCatalogResponse = {
  provider: VideoGenerationProvider;
  label?: string;
  configured: boolean;
  models: VideoGenerationModelOption[];
  message?: string;
};
type GeneratedVideo = { url: string; mediaType: string; savedPath?: string };
type MediaOutputSettings = { directory: string; defaultDirectory: string };
type ApiKeySettings = { configured: Record<ApiKeyName, boolean>; envFile: string };
type AgentReasoningOption = { reasoningEffort: string; description: string };
type AgentModelOption = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: AgentReasoningOption[];
  inputModalities?: string[];
  supportsStructuredOutputs?: boolean;
  recommended?: boolean;
  providerName?: string;
};
type ProviderRuntimeOption = {
  provider: AgentProvider;
  label: string;
  configured: boolean;
  loading: boolean;
  models: AgentModelOption[];
  message?: string;
};
type ProviderCatalogs = Record<AgentProvider, Omit<ProviderRuntimeOption, "provider" | "label">>;
type ModelCatalogResponse = {
  provider?: AgentProvider;
  configured?: boolean;
  models: AgentModelOption[];
  message?: string;
};
type GraphData = Record<string, unknown> & {
  kind: NodeKind;
  title: string;
  fileName?: string;
  preview?: string;
  imageData?: string;
  videoData?: string;
  mode?: string;
  duration?: string;
  ratio?: string;
  provider?: AgentProvider;
  skillId?: PromptSkillId;
  imageProvider?: ImageGenerationProvider;
  imageModel?: string;
  imageProviderOptions?: ImageGenerationProviderOption[];
  resolution?: ImageGenerationResolution;
  videoGenerationProvider?: VideoGenerationProvider;
  videoGenerationModel?: string;
  videoGenerationMode?: VideoGenerationMode;
  videoGenerationResolution?: VideoGenerationResolution;
  videoGenerationProviderOptions?: VideoGenerationProviderOption[];
  generateAudio?: boolean;
  confirmLowCredit?: boolean;
  model?: string;
  reasoningEffort?: string;
  modelOptions?: AgentModelOption[];
  providerOptions?: ProviderRuntimeOption[];
  instruction?: string;
  suggestion?: string;
  text?: string;
  prompt?: string;
  source?: "Codex" | "OpenRouter" | "Comfly" | "Grok Build" | "Antigravity" | "等待生成" | "可编辑文本" | "手动编辑" | "剪贴板";
  threadId?: string;
  busy?: boolean;
  busyLabel?: string;
  inputSlots?: MediaSlot[];
  promptConnected?: boolean;
  promptInput?: string;
  skillConnected?: boolean;
  skillInputId?: PromptSkillId;
  skillInputLabel?: string;
  skillRegistry?: SkillRegistryItem[];
  generatedImages?: GeneratedImage[];
  generatedVideos?: GeneratedVideo[];
  imageError?: string;
  videoGenerationError?: string;
  generationMeta?: string;
  assignedMarkers?: string[];
  memberCount?: number;
  groupDropTarget?: boolean;
  onUpdate?: (patch: Partial<GraphData>) => void;
  onDelete?: () => void;
  onRun?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onRegisterSkill?: (path: string) => Promise<void>;
  onRefreshSkill?: (skillId: PromptSkillId) => Promise<void>;
  onUnregisterSkill?: (skillId: PromptSkillId) => Promise<void>;
};

type GraphNode = Node<GraphData>;
type CanvasProjectSummary = {
  id: string;
  name: string;
  schemaVersion?: number;
  revision?: number;
  createdAt: string;
  updatedAt: string;
  referenceCount: number;
  imageCount: number;
  mediaCount?: number;
};
type CanvasProject = { id: string; name: string; schemaVersion?: number; revision?: number; createdAt: string; updatedAt: string; nodes: GraphNode[]; edges: Edge[] };
type CanvasClipboardPayload = { projectId: string; nodes: GraphNode[]; edges?: Edge[] };
type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
type TaskStage = "queued" | "validating" | "preparing_media" | "codex" | "openrouter" | "comfly" | "grok-build" | "antigravity" | "agent" | "image-generation" | "video-generation" | "writing" | "completed" | "failed" | "cancelled";
type CanvasTaskKind = "generation" | "revision" | "image-generation" | "video-generation";
type CanvasTaskProvider = AgentProvider | ImageGenerationProvider | VideoGenerationProvider;
type CanvasTask = {
  id: string;
  projectId?: string;
  kind: CanvasTaskKind;
  title: string;
  status: TaskStatus;
  stage: TaskStage;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  provider?: CanvasTaskProvider;
  skillId?: PromptSkillId;
  model?: string;
  reasoningEffort?: string;
  sourceNodeId: string;
  outputNodeIds: string[];
  origin?: "ui" | "automation" | string;
  canvasRevision?: number;
  result?: { prompt?: string; changes?: string; title?: string; threadId?: string; skillId?: PromptSkillId; images?: GeneratedImage[]; videos?: GeneratedVideo[]; resolution?: string; aspectRatio?: string; duration?: number; mode?: VideoGenerationMode; jobId?: string; savedFiles?: string[]; outputDirectory?: string; saveError?: string };
  error?: string;
};
type TaskEvent =
  | { type: "snapshot"; tasks: CanvasTask[]; concurrency: number }
  | { type: "task"; task: CanvasTask }
  | { type: "config"; concurrency: number };
type ProjectEvent = {
  type: "project";
  projectId: string;
  revision: number;
  updatedAt: string;
  actor: "ui" | "automation" | "automation-task" | string;
  transactionId?: string | null;
  project?: CanvasProjectSummary;
};
const STORAGE_KEY = "prompt-flow-core-v3";
const ACTIVE_PROJECT_KEY = "prompt-flow-active-project";
const OPEN_PROJECTS_KEY = "prompt-flow-open-projects";
const LIBRARY_STATE_KEY = "prompt-flow-library-open";
const THEME_STORAGE_KEY = "agent-canvas-theme";
const API_KEY_FIELDS: { name: ApiKeyName; label: string; description: string; group: "通用渠道" | "Comfly GPT Image 2 专用" }[] = [
  { name: "OPENROUTER_API_KEY", label: "OpenRouter", description: "提示词、图片和视频模型", group: "通用渠道" },
  { name: "GEMINI_API_KEY", label: "Google Gemini", description: "Google 官方图片生成", group: "通用渠道" },
  { name: "COMFLY_API_KEY", label: "Comfly 通用", description: "Nano Banana、视频及其他模型", group: "通用渠道" },
  { name: "COMFLY_LLM_API_KEY", label: "Comfly 提示词", description: "可选；提示词模型专用", group: "通用渠道" },
  { name: "COMFLY_GPT_IMAGE_2_1K_API_KEY", label: "GPT Image 2 · 1K", description: "Comfly 1K 分辨率专用", group: "Comfly GPT Image 2 专用" },
  { name: "COMFLY_GPT_IMAGE_2_2K_API_KEY", label: "GPT Image 2 · 2K", description: "Comfly 2K 分辨率专用", group: "Comfly GPT Image 2 专用" },
  { name: "COMFLY_GPT_IMAGE_2_4K_API_KEY", label: "GPT Image 2 · 4K", description: "Comfly 4K 分辨率专用", group: "Comfly GPT Image 2 专用" },
];
const TASK_PANEL_STATE_KEY = "prompt-flow-task-panel-open";
const SAVED_TASK_IDS_KEY = "prompt-flow-saved-task-ids";
const BRIDGE_URL = "http://127.0.0.1:4317";
const FLOW_PRESET_DRAG_TYPE = "application/x-agent-canvas-preset";
const FLOW_PRESETS: { id: FlowPresetId; label: string; description: string; glyph: string }[] = [
  { id: "prompt", label: "常规提示词", description: "参考图 → 编辑改写 → 文本框", glyph: "词" },
  { id: "image-generation", label: "图片生成", description: "参考图 → 图片生成 → 图片", glyph: "图" },
  { id: "video-generation", label: "视频生成", description: "参考图 → 视频生成 → 视频", glyph: "视" },
];
const PROVIDERS: AgentProvider[] = ["codex", "openrouter", "comfly", "grok-build", "antigravity"];
const PROVIDER_LABELS: Record<AgentProvider, string> = {
  codex: "Codex",
  openrouter: "OpenRouter",
  comfly: "Comfly",
  "grok-build": "Grok Build",
  antigravity: "Antigravity",
};
const PROMPT_SKILLS: PromptSkillId[] = ["none", "seedance", "nanobanana", "image", "photoreal"];
const PROMPT_SKILL_LABELS: Record<string, string> = {
  none: "不加载 Skill",
  seedance: "Seedance 视频提示词",
  nanobanana: "Nano Banana 图像提示词",
  image: "GPT Image 图像提示词",
  photoreal: "真实感场景与模特图",
};
function promptSkillLabel(skillId: PromptSkillId, registry: SkillRegistryItem[] = []) {
  return registry.find((item) => item.id === skillId)?.label || PROMPT_SKILL_LABELS[skillId] || skillId.replace(/^custom:/, "");
}
const DEFAULT_SKILL_REGISTRY: SkillRegistryItem[] = PROMPT_SKILLS.map((id) => ({
  id,
  name: PROMPT_SKILL_LABELS[id],
  label: PROMPT_SKILL_LABELS[id],
  builtin: true,
  removable: false,
  ready: true,
}));
const ASPECT_RATIOS = ["Auto", "1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9"] as const;
const IMAGE_GENERATION_RESOLUTIONS: ImageGenerationResolution[] = ["1K", "2K", "4K"];
const IMAGE_GENERATION_PROVIDER_IDS: ImageGenerationProvider[] = ["openrouter", "google", "comfly"];
const IMAGE_GENERATION_PROVIDER_LABELS: Record<ImageGenerationProvider, string> = {
  openrouter: "OpenRouter",
  google: "Google 官方",
  comfly: "Comfly",
};
const IMAGE_GENERATION_PROVIDERS: ImageGenerationProviderOption[] = IMAGE_GENERATION_PROVIDER_IDS.map((provider) => ({
  provider,
  label: IMAGE_GENERATION_PROVIDER_LABELS[provider],
  configured: false,
  loading: true,
  models: [],
  message: "正在读取图片模型…",
}));
const VIDEO_GENERATION_PROVIDER_IDS: VideoGenerationProvider[] = ["openrouter", "comfly", "seedance-cli"];
const VIDEO_GENERATION_PROVIDER_LABELS: Record<VideoGenerationProvider, string> = {
  openrouter: "OpenRouter",
  comfly: "Comfly",
  "seedance-cli": "Seedance CLI",
};
const VIDEO_GENERATION_PROVIDERS: VideoGenerationProviderOption[] = VIDEO_GENERATION_PROVIDER_IDS.map((provider) => ({
  provider,
  label: VIDEO_GENERATION_PROVIDER_LABELS[provider],
  configured: false,
  loading: true,
  models: [],
  message: "正在读取视频模型…",
}));
const VIDEO_GENERATION_MODES: { id: VideoGenerationMode; label: string; helper: string }[] = [
  { id: "text2video", label: "文生视频", helper: "仅使用提示词" },
  { id: "image2video", label: "单图生视频", helper: "1 张图片，画幅由首帧决定" },
  { id: "frames2video", label: "首尾帧", helper: "第 1、2 张图对应首帧和尾帧" },
  { id: "multiframe2video", label: "智能多帧", helper: "2–12 张图按槽位顺序衔接" },
  { id: "multimodal2video", label: "全能参考", helper: "最多 9 图 + 3 视频，使用 @ 引用" },
];
const VIDEO_GENERATION_RESOLUTIONS: VideoGenerationResolution[] = ["720p", "1080p", "2K", "4K"];
const VIDEO_ASPECT_RATIOS = ["1:1", "3:4", "16:9", "4:3", "9:16", "21:9"];
/** Display title for rewrite nodes — provider-agnostic (internal type remains `codex` for compatibility). */
const REWRITE_NODE_TITLE = "编辑改写";
/** Fixed canvas width for rewrite nodes. Wider than the legacy 420 so model/slot rows fit. */
const REWRITE_NODE_WIDTH = 520;
const LEGACY_REWRITE_NODE_WIDTH = 420;
const LEGACY_REWRITE_TITLES = new Set([
  "Seedance 改写",
  "Seedance · Codex 改写",
  "Seedance · Agent 改写",
  "Seedance · Codex改写",
  "Codex 改写",
  "Codex改写",
  "Agent 改写",
]);
const MAX_REWRITE_IMAGES = 9;
const MAX_REWRITE_VIDEOS = 3;
const MAX_IMAGE_GENERATION_IMAGES = 12;
const MAX_IMAGE_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_GENERATION_REFERENCES = 12;
const MAX_REWRITE_REFERENCES = MAX_REWRITE_IMAGES + MAX_REWRITE_VIDEOS;
const ACTIVE_TASK_STATUSES = new Set<TaskStatus>(["queued", "running"]);
const TERMINAL_TASK_STATUSES = new Set<TaskStatus>(["completed", "failed", "cancelled"]);
const TASK_POLL_FALLBACK_MS = 3_000;
const TASK_POLL_CONNECTED_MS = 15_000;
const TASK_SUBMIT_TIMEOUT_MS = 30_000;
const MAX_PORTABLE_NODES = 500;
const MAX_PORTABLE_EDGES = 2_000;
const MAX_PORTABLE_FILE_BYTES = 200_000_000;
const CANVAS_MIN_ZOOM = 0.06;
const CANVAS_MAX_ZOOM = 1.5;

function storedThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY) || document.documentElement.dataset.themePreference;
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function applyThemePreference(preference: ThemePreference, systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches) {
  const dark = preference === "dark" || (preference === "system" && systemDark);
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}
const TASK_STAGE_LABELS: Record<TaskStage, string> = {
  queued: "排队中",
  validating: "检查输入",
  preparing_media: "处理参考素材",
  codex: "Codex 处理中",
  openrouter: "OpenRouter 处理中",
  comfly: "Comfly 处理中",
  "grok-build": "Grok Build 处理中",
  antigravity: "Antigravity 处理中",
  agent: "Agent 处理中",
  "image-generation": "图片模型生成中",
  "video-generation": "视频模型生成中",
  writing: "写入输出",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
const REASONING_LABELS: Record<string, string> = {
  none: "无思考",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  extra_high: "超高",
  xhigh: "极高",
  max: "最大",
  ultra: "Ultra",
  auto: "自动",
};

function isAgentProvider(provider: unknown): provider is AgentProvider {
  return provider === "codex" || provider === "openrouter" || provider === "comfly" || provider === "grok-build" || provider === "antigravity";
}

function normalizeProvider(provider: unknown): AgentProvider {
  if (provider === undefined || provider === null || provider === "") return "codex";
  if (isAgentProvider(provider)) return provider;
  throw new Error(`不支持的模型供应商：${String(provider)}`);
}

function normalizeTaskProvider(provider: unknown): AgentProvider {
  return normalizeProvider(provider);
}

function isImageGenerationProvider(provider: unknown): provider is ImageGenerationProvider {
  return provider === "openrouter" || provider === "google" || provider === "comfly";
}

function normalizeImageGenerationProvider(provider: unknown): ImageGenerationProvider {
  if (provider === undefined || provider === null || provider === "" || provider === "pending") return "openrouter";
  if (isImageGenerationProvider(provider)) return provider;
  throw new Error(`不支持的图片生成供应商：${String(provider)}`);
}

function isVideoGenerationProvider(provider: unknown): provider is VideoGenerationProvider {
  return provider === "openrouter" || provider === "comfly" || provider === "seedance-cli";
}

function normalizeVideoGenerationProvider(provider: unknown): VideoGenerationProvider {
  if (provider === undefined || provider === null || provider === "" || provider === "pending") return "openrouter";
  if (isVideoGenerationProvider(provider)) return provider;
  throw new Error(`不支持的视频生成供应商：${String(provider)}`);
}

function normalizePromptSkill(skillId: unknown): PromptSkillId {
  if (skillId === undefined || skillId === null || skillId === "") return "seedance";
  if (skillId === "none" || skillId === "seedance" || skillId === "nanobanana" || skillId === "image" || skillId === "photoreal" || (typeof skillId === "string" && skillId.startsWith("custom:"))) return skillId as PromptSkillId;
  throw new Error(`不支持的提示词 Skill：${String(skillId)}`);
}

function isImagePromptSkill(skillId: unknown): skillId is "nanobanana" | "image" | "photoreal" {
  const normalized = normalizePromptSkill(skillId);
  return normalized === "nanobanana" || normalized === "image" || normalized === "photoreal";
}

function providerSource(provider: unknown): "Codex" | "OpenRouter" | "Comfly" | "Grok Build" | "Antigravity" {
  const normalized = normalizeProvider(provider);
  if (normalized === "openrouter") return "OpenRouter";
  if (normalized === "comfly") return "Comfly";
  if (normalized === "grok-build") return "Grok Build";
  if (normalized === "antigravity") return "Antigravity";
  return "Codex";
}

function runtimeSelection(data: GraphData, catalogs: ProviderCatalogs) {
  const provider = normalizeProvider(data.provider);
  const catalog = catalogs[provider];
  const model = catalog.models.find((option) => option.model === data.model) || catalog.models.find((option) => option.isDefault) || catalog.models[0];
  const efforts = model?.supportedReasoningEfforts || [];
  const reasoningEffort = efforts.some((option) => option.reasoningEffort === data.reasoningEffort)
    ? String(data.reasoningEffort)
    : model?.defaultReasoningEffort;
  return { provider, catalog, model, reasoningEffort };
}

const defaultNodes: GraphNode[] = [
  {
    id: "reference-1",
    type: "reference",
    position: { x: 70, y: 150 },
    data: { kind: "reference", title: "图片" },
  },
  {
    id: "reference-2",
    type: "reference",
    position: { x: 70, y: 430 },
    data: { kind: "reference", title: "图片" },
  },
  {
    id: "codex",
    type: "codex",
    position: { x: 520, y: 115 },
    width: REWRITE_NODE_WIDTH,
    style: { width: REWRITE_NODE_WIDTH },
    data: {
      kind: "codex",
      title: REWRITE_NODE_TITLE,
      provider: "codex",
      skillId: "seedance",
      mode: "全能参考",
      duration: "4s",
      ratio: "16:9",
      instruction: "制作一个全能参考的 AI 视频。@图片1 是椅子腰枕的场景参考，@图片2 是模特手部参考。画面开始时不要出现手，随后双手从画面下方进入，自然按压腰枕一次，腰枕产生符合现实物理的阻尼回弹；全程不要出现亚洲面孔，镜头稳定自然。",
    },
  },
  {
    id: "output",
    type: "text",
    position: { x: 1080, y: 225 },
    data: { kind: "textBox", title: "文本框", text: "在改写节点中输入需求并点击生成。", source: "等待生成" },
  },
];

const defaultEdges: Edge[] = [
  { id: "reference-1-codex-1", source: "reference-1", target: "codex", targetHandle: "media-1", type: "disconnectable" },
  { id: "reference-2-codex-2", source: "reference-2", target: "codex", targetHandle: "media-2", type: "disconnectable" },
  { id: "codex-output", source: "codex", target: "output", type: "disconnectable" },
];

function NodeFrame({ data, tone, children, input = false, inputHandleId, output = true, className = "", onDoubleClick, onDragEnter, onDragOver, onDragLeave, onDrop }: { data: GraphData; tone: string; children: ReactNode; input?: boolean; inputHandleId?: string; output?: boolean; className?: string; onDoubleClick?: (event: ReactMouseEvent<HTMLElement>) => void; onDragEnter?: (event: ReactDragEvent<HTMLElement>) => void; onDragOver?: (event: ReactDragEvent<HTMLElement>) => void; onDragLeave?: (event: ReactDragEvent<HTMLElement>) => void; onDrop?: (event: ReactDragEvent<HTMLElement>) => void }) {
  return (
    <article className={`core-node tone-${tone}${className ? ` ${className}` : ""}`} onDoubleClick={onDoubleClick} onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {input && <Handle id={inputHandleId} type="target" position={Position.Left} className="main-handle" />}
      <header className="core-node-head">
        <div><span>{data.kind === "reference" || data.kind === "imageOutput" ? "图片" : data.kind === "video" || data.kind === "videoOutput" ? "视频" : data.kind === "textBox" || data.kind === "textInput" || data.kind === "textOutput" ? "文本框" : data.kind === "codex" ? "编辑改写" : data.kind === "promptEditor" ? "编辑提示词" : data.kind === "imageGenerator" ? "图片生成" : data.kind === "videoGenerator" ? "视频生成" : "文本框"}</span><strong>{data.title}</strong></div>
        {data.onDelete && <button className="nodrag node-delete" aria-label={`删除${data.title}`} onClick={data.onDelete}>×</button>}
      </header>
      <div className="core-node-body">{children}</div>
      {output && <Handle type="source" position={Position.Right} className="main-handle" />}
    </article>
  );
}

function ReferenceNode({ data, selected }: NodeProps<GraphNode>) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageDropActive, setImageDropActive] = useState(false);
  const loadImageFile = (file: File) => {
    const isImage = file.type.startsWith("image/") || /\.(?:avif|bmp|gif|jpe?g|png|webp)$/i.test(file.name);
    if (!isImage) {
      data.onUpdate?.({ imageError: "仅支持拖入图片文件" });
      return;
    }
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      data.onUpdate?.({ imageError: "图片超过 15MB，无法载入" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => data.onUpdate?.({ fileName: file.name, preview: String(reader.result), imageData: String(reader.result), generatedImages: undefined, imageError: undefined, generationMeta: undefined });
    reader.onerror = () => data.onUpdate?.({ imageError: "图片读取失败，请重新拖入或上传" });
    reader.readAsDataURL(file);
  };
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    loadImageFile(file);
    event.target.value = "";
  };
  const handleImageFileDragEnter = (event: ReactDragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setImageDropActive(true);
  };
  const handleImageFileDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  };
  const handleImageFileDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) return;
    setImageDropActive(false);
  };
  const handleImageFileDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    setImageDropActive(false);
    const imageFile = Array.from(event.dataTransfer.files).find((file) => file.type.startsWith("image/") || /\.(?:avif|bmp|gif|jpe?g|png|webp)$/i.test(file.name));
    if (!imageFile) {
      data.onUpdate?.({ imageError: "拖入内容中没有可用的图片文件" });
      return;
    }
    loadImageFile(imageFile);
  };
  const handleDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (data.busy || (event.target as HTMLElement).closest("button, a, input, label, [role='button']")) return;
    event.preventDefault();
    event.stopPropagation();
    fileInputRef.current?.click();
  };
  const markers = data.assignedMarkers || [];
  const displayImages = data.generatedImages?.length
    ? data.generatedImages
    : data.preview
      ? [{ dataUrl: String(data.preview), mediaType: "image/png" }]
      : [];

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={280}
        minHeight={320}
        maxWidth={960}
        maxHeight={900}
        color="#8f6e5e"
        handleClassName="reference-resize-handle"
        lineClassName="reference-resize-line"
      />
      <NodeFrame
        data={data}
        tone="image"
        input
        output
        className={imageDropActive ? "is-image-drop-active" : ""}
        onDoubleClick={handleDoubleClick}
        onDragEnter={handleImageFileDragEnter}
        onDragOver={handleImageFileDragOver}
        onDragLeave={handleImageFileDragLeave}
        onDrop={handleImageFileDrop}
      >
        {displayImages.length ? (
          <div className={`image-generation-result-grid media-output-grid nodrag ${displayImages.length === 1 ? "is-single" : "is-multiple"}`}>
            {displayImages.map((image, index) => (
              <div className="image-preview-card" key={`${image.dataUrl.slice(0, 48)}-${index}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.dataUrl} alt={`图片 ${index + 1}`} />
                <a className="image-download-float nodrag nopan" href={image.dataUrl} download={`image-${index + 1}.${image.mediaType.includes("jpeg") ? "jpg" : image.mediaType.includes("webp") ? "webp" : "png"}`} aria-label={`下载图片 ${index + 1}`} onClick={(event) => event.stopPropagation()} onMouseDown={blockMiddleMouseDownload} onAuxClick={blockMiddleMouseDownload}>下载图片 {index + 1}</a>
              </div>
            ))}
          </div>
        ) : <div className="media-output-empty">{data.busy ? "图片任务执行中，结果会自动写入这里。" : "拖入本地图片，双击节点上传图片，或选中节点后按 Ctrl+V 粘贴。"}</div>}
        <div className="media-input-actions nodrag">
          <label className="media-replace-button">上传 / 替换图片<input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFile} /></label>
          <button type="button" className="media-replace-button" onClick={data.onPaste}>粘贴剪贴板图片</button>
        </div>
        <div className="image-node-status">
          <span>{data.busy ? data.busyLabel || "图片生成中…" : data.fileName || data.generationMeta || "尚未选择图片"}</span>
          <div>{markers.length ? markers.map((marker, index) => <b key={`${marker}-${index}`}>{marker}</b>) : <em>拖线到参考端口</em>}</div>
        </div>
        {data.generatedImages?.[0]?.savedPath && <div className="media-saved-path" title={data.generatedImages[0].savedPath}>已保存：{data.generatedImages[0].savedPath}</div>}
        {data.imageError && <div className="image-generation-error">{data.imageError}</div>}
      </NodeFrame>
    </>
  );
}

function VideoNode({ data, selected }: NodeProps<GraphNode>) {
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => data.onUpdate?.({ fileName: file.name, preview: String(reader.result), videoData: String(reader.result), generatedVideos: undefined, videoGenerationError: undefined, generationMeta: undefined });
    reader.readAsDataURL(file);
  };
  const markers = data.assignedMarkers || [];
  const displayVideos = data.generatedVideos?.length
    ? data.generatedVideos
    : data.preview
      ? [{ url: String(data.preview), mediaType: "video/mp4" }]
      : [];

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={320}
        minHeight={320}
        maxWidth={1100}
        maxHeight={960}
        color="#4f7f8f"
        handleClassName="video-resize-handle"
        lineClassName="video-resize-line"
      />
      <NodeFrame data={data} tone="video" input output>
        {displayVideos.length ? <div className="video-output-results nodrag">
          {displayVideos.map((video, index) => {
            const playbackUrl = videoPlaybackUrl(video);
            return <div className="video-generation-result" key={`${video.url}-${index}`}>
              <video src={playbackUrl} controls playsInline preload="metadata" />
              <a href={playbackUrl} download={`video-${index + 1}.mp4`} onMouseDown={blockMiddleMouseDownload} onAuxClick={blockMiddleMouseDownload}>下载视频 {index + 1}</a>
            </div>;
          })}
        </div> : <div className="media-output-empty">{data.busy ? "视频任务执行中，结果会自动写入这里。" : "上传视频，或从视频生成节点连接到左侧端口。"}</div>}
        <label className="media-replace-button nodrag">上传 / 替换视频<input type="file" accept="video/mp4,video/webm,video/quicktime,video/x-m4v" hidden onChange={handleFile} /></label>
        <div className="image-node-status">
          <span>{data.busy ? data.busyLabel || "视频生成中…" : data.fileName || data.generationMeta || "尚未选择视频"}</span>
          <div>{markers.length ? markers.map((marker, index) => <b key={`${marker}-${index}`}>{marker}</b>) : <em>拖线到参考端口</em>}</div>
        </div>
        {data.generatedVideos?.[0]?.savedPath && <div className="media-saved-path" title={data.generatedVideos[0].savedPath}>已保存：{data.generatedVideos[0].savedPath}</div>}
        {data.videoGenerationError && <div className="video-generation-error">{data.videoGenerationError.replace(/^LOW_CREDIT_CONFIRMATION_REQUIRED:\s*/, "")}</div>}
      </NodeFrame>
    </>
  );
}

function ModelControls({ data, helper, mediaAware = false }: { data: GraphData; helper: string; mediaAware?: boolean }) {
  const provider = normalizeProvider(data.provider);
  const providerOptions = data.providerOptions || [];
  const runtime = providerOptions.find((option) => option.provider === provider);
  const models = [...(runtime?.models || data.modelOptions || [])].sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)));
  const selectedModel = models.find((model) => model.model === data.model) || models.find((model) => model.isDefault) || models[0];
  const efforts = selectedModel?.supportedReasoningEfforts || [];
  const selectedEffort = efforts.some((option) => option.reasoningEffort === data.reasoningEffort)
    ? data.reasoningEffort
    : selectedModel?.defaultReasoningEffort || "medium";
  const capabilitySummary = selectedModel
    ? `${selectedModel.inputModalities?.includes("image") ? "支持图片" : "仅文本"} / ${selectedModel.supportsStructuredOutputs === true ? "支持结构化输出" : selectedModel.supportsStructuredOutputs === false ? "不支持结构化输出" : "结构化输出未知"}`
    : "";
  const helperMessage = mediaAware && selectedModel && !selectedModel.inputModalities?.includes("image") ? "该模型不能接收参考素材" : helper;
  const runtimeMessage = runtime?.loading
    ? `正在读取 ${PROVIDER_LABELS[provider]} 模型…`
    : runtime?.configured === false
      ? runtime.message || `${PROVIDER_LABELS[provider]} 尚未配置`
      : selectedModel
        ? `${selectedModel.description} · ${capabilitySummary} · ${helperMessage}`
        : runtime?.message || `${PROVIDER_LABELS[provider]} 暂无可用模型`;
  return (
    <div className="codex-runtime nodrag">
      <label className="runtime-provider"><span>模型供应商</span><select value={provider} onChange={(event) => { const nextProvider = normalizeProvider(event.target.value); const nextRuntime = providerOptions.find((option) => option.provider === nextProvider); const nextModel = nextRuntime?.models.find((model) => model.isDefault) || nextRuntime?.models[0]; data.onUpdate?.({ provider: nextProvider, model: nextModel?.model, reasoningEffort: nextModel?.defaultReasoningEffort, threadId: undefined }); }}>{PROVIDERS.map((id) => { const option = providerOptions.find((item) => item.provider === id); const suffix = option?.loading ? " · 读取中" : option?.configured === false ? " · 未配置" : ""; return <option value={id} key={id}>{PROVIDER_LABELS[id]}{suffix}</option>; })}</select></label>
      <label className="runtime-model"><span>{PROVIDER_LABELS[provider]} 模型</span><select disabled={!runtime?.configured || !models.length} value={selectedModel?.model || data.model || ""} onChange={(event) => { const model = models.find((item) => item.model === event.target.value); if (model) data.onUpdate?.({ model: model.model, reasoningEffort: model.defaultReasoningEffort, threadId: undefined }); }}>{models.length ? models.map((model) => <option value={model.model} key={model.id}>{model.recommended ? "★ " : ""}{model.providerName ? `${model.providerName} · ` : ""}{model.displayName}{model.isDefault ? " · 默认" : ""}</option>) : <option value={data.model || ""}>{runtime?.loading ? "正在读取模型…" : runtime?.configured === false ? data.model ? `${data.model} · 等待供应商配置` : "供应商尚未配置" : "暂无可用模型"}</option>}</select></label>
      <label><span>思考强度</span><select disabled={!efforts.length} value={selectedEffort} onChange={(event) => data.onUpdate?.({ reasoningEffort: event.target.value, threadId: undefined })}>{efforts.map((option) => <option value={option.reasoningEffort} key={option.reasoningEffort}>{REASONING_LABELS[option.reasoningEffort] || option.reasoningEffort}</option>)}</select></label>
      <small className={runtime?.configured === false ? "runtime-warning" : ""}>{runtimeMessage}</small>
    </div>
  );
}

function SkillNode({ data }: NodeProps<GraphNode>) {
  const registry = data.skillRegistry || [];
  const skillId = normalizePromptSkill(data.skillId || "none");
  const selected = registry.find((item) => item.id === skillId);
  const options = selected ? registry : [{ id: skillId, name: promptSkillLabel(skillId), label: `${promptSkillLabel(skillId)} · 未注册`, builtin: false, removable: false, ready: false }, ...registry] as SkillRegistryItem[];
  const [query, setQuery] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const visible = registry.filter((item) => !query.trim() || [item.label, item.description, item.path].some((value) => String(value || "").toLowerCase().includes(query.trim().toLowerCase())));
  const runAction = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); }
    finally { setBusy(false); }
  };
  return (
    <NodeFrame data={data} tone="skill" output>
      <div className="skill-node-summary">
        <label className="skill-selector nodrag">
          <span>当前 Skill</span>
          <select value={skillId} onChange={(event) => data.onUpdate?.({ skillId: normalizePromptSkill(event.target.value), threadId: undefined })}>
            {options.map((item) => <option value={item.id} disabled={!item.ready} key={item.id}>{item.label}{item.ready ? "" : " · 未就绪"}</option>)}
          </select>
        </label>
        <div className={`skill-status ${selected?.ready ? "ready" : "missing"}`}>
          <i />
          <span>{selected?.ready ? selected.builtin ? "内置 Skill 已就绪" : "自定义 Skill 已注册" : "Skill 未就绪"}</span>
        </div>
        {selected?.description && <p>{selected.description}</p>}
        {selected?.adapter && <small>适配器：{selected.adapter}</small>}
      </div>
      <details className="skill-manager nodrag">
        <summary>管理 Skill <span>添加 · 检索 · 移除</span></summary>
        <label className="skill-search"><span>检索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名称、说明或路径" /></label>
        <div className="skill-manager-list">
          {visible.map((item) => (
            <button type="button" className={item.id === skillId ? "selected" : ""} disabled={!item.ready} onClick={() => data.onUpdate?.({ skillId: item.id, threadId: undefined })} key={item.id}>
              <span><b>{item.label}</b><small>{item.builtin ? "内置" : item.path || "自定义"}</small></span>
              <i>{item.ready ? "可用" : "缺失"}</i>
            </button>
          ))}
          {!visible.length && <div className="skill-manager-empty">没有匹配的 Skill</div>}
        </div>
        <label className="skill-path-input"><span>本地 Skill 路径</span><input value={path} onChange={(event) => setPath(event.target.value)} placeholder="D:\...\Skill 或 SKILL.md" /></label>
        <div className="skill-manager-actions">
          <button type="button" disabled={busy || !path.trim()} onClick={() => void runAction(async () => { await data.onRegisterSkill?.(path.trim()); setPath(""); })}>添加</button>
          <button type="button" disabled={busy || !selected || selected.builtin} onClick={() => void runAction(() => data.onRefreshSkill?.(skillId) || Promise.resolve())}>刷新</button>
          <button type="button" className="danger" disabled={busy || !selected?.removable} title="只取消 Agent Canvas 注册，不删除磁盘文件" onClick={() => void runAction(() => data.onUnregisterSkill?.(skillId) || Promise.resolve())}>移除注册</button>
        </div>
        <small className="skill-manager-note">移除只影响 Agent Canvas，不会删除本地文件；内置 Skill 不可移除。</small>
      </details>
    </NodeFrame>
  );
}

function CodexNode({ data }: NodeProps<GraphNode>) {
  const skillId = normalizePromptSkill(data.skillId);
  const imagePromptSkill = isImagePromptSkill(skillId);
  const slots: MediaSlot[] = data.inputSlots || Array.from({ length: MAX_REWRITE_REFERENCES }, (_, index) => ({ slot: index + 1, marker: `参考位 ${index + 1}`, hasMedia: false }));
  return (
    <NodeFrame data={data} tone="codex" input={false}>
      <label className="skill-selector nodrag"><span>提示词 Skill</span><select value={skillId} onChange={(event) => data.onUpdate?.({ skillId: normalizePromptSkill(event.target.value), threadId: undefined })}>{PROMPT_SKILLS.map((id) => <option value={id} key={id}>{PROMPT_SKILL_LABELS[id]}</option>)}</select></label>

      <ModelControls data={data} helper={skillId === "none" ? "不注入 Skill，支持图片与视频参考" : imagePromptSkill ? "支持参考图片" : "支持图片与视频取帧"} mediaAware />

      <div className={`core-specs nodrag skill-${skillId}`}>
        {skillId === "seedance" && <label><span>参考模式</span><select value={data.mode} onChange={(event) => data.onUpdate?.({ mode: event.target.value })}><option>全能参考</option><option>单帧参考</option><option>首尾帧参考</option><option>多帧参考</option></select></label>}
        {skillId === "seedance" && <label><span>时长</span><select value={data.duration} onChange={(event) => data.onUpdate?.({ duration: event.target.value })}><option>4s</option><option>6s</option><option>8s</option><option>10s</option></select></label>}
        <label><span>画幅</span><select value={data.ratio || "Auto"} onChange={(event) => data.onUpdate?.({ ratio: event.target.value })}>{ASPECT_RATIOS.map((ratio) => <option value={ratio} key={ratio}>{ratio}</option>)}</select></label>
      </div>

      <div className="image-input-list">
        <span className="input-list-title">{imagePromptSkill ? `参考输入 · ${PROMPT_SKILL_LABELS[skillId]}仅支持图片` : "参考输入 · 图片最多 9 张 / 视频最多 3 个"}</span>
        {slots.map((slot) => (
          <div className={`image-input-slot ${slot.sourceId ? "connected" : ""}`} key={slot.slot}>
            <Handle type="target" position={Position.Left} id={`media-${slot.slot}`} className="slot-handle" />
            <b>{slot.marker}</b>
            <span>{slot.sourceId ? (slot.fileName || `已连接，等待选择${slot.mediaKind === "video" ? "视频" : "图片"}`) : "未连接"}</span>
            <i className={slot.hasMedia ? "ready" : ""} />
          </div>
        ))}
      </div>

      <label className="prompt-input-label nodrag">
        <span>提示词需求</span>
        <textarea value={data.instruction} onChange={(event) => data.onUpdate?.({ instruction: event.target.value })} placeholder={skillId === "none" ? "输入需要整理或改写的提示词需求；可使用上方显示的 @图片N / @视频N。" : imagePromptSkill ? "输入图像创作或改图需求；引用素材时使用上方显示的 @图片N。" : "输入视频创作需求；引用素材时使用上方显示的 @图片N / @视频N。"} />
      </label>

      <button className="nodrag core-run" disabled={data.busy} onClick={data.onRun}>
        {data.busy ? data.busyLabel || "任务处理中…" : skillId === "none" ? "直接生成提示词" : skillId === "photoreal" ? "生成真实感提示词" : skillId === "nanobanana" ? "生成 Nano Banana 提示词" : skillId === "image" ? "生成 GPT Image 提示词" : "生成视频提示词"}<b>{data.busy ? "···" : "↗"}</b>
      </button>
    </NodeFrame>
  );
}

function PromptEditorNode({ data }: NodeProps<GraphNode>) {
  const originalPrompt = String(data.promptConnected ? data.promptInput || "" : data.prompt || "");
  const promptCount = originalPrompt.replace(/\s/g, "").length;
  const instruction = String(data.instruction || "");
  const instructionCount = instruction.replace(/\s/g, "").length;
  const skillId = normalizePromptSkill(data.skillConnected ? data.skillInputId : data.skillId);
  const registry = data.skillRegistry || [];
  return (
    <NodeFrame data={data} tone="prompt-editor" output>
      <div className="editor-mode"><i />只修改现有提示词，不重新生成创意</div>
      <label className={`skill-selector nodrag ${data.skillConnected ? "is-linked" : ""}`}>
        <Handle id="skill" type="target" position={Position.Left} className="prompt-editor-skill-handle" />
        <span>{data.skillConnected ? "已接入 Skill" : "提示词 Skill"}</span>
        {data.skillConnected
          ? <strong>{data.skillInputLabel || promptSkillLabel(skillId, registry)}</strong>
          : <select value={skillId} onChange={(event) => data.onUpdate?.({ skillId: normalizePromptSkill(event.target.value), threadId: undefined })}>{registry.map((item) => <option value={item.id} disabled={!item.ready} key={item.id}>{item.label}</option>)}</select>}
      </label>
      <ModelControls data={data} helper="用于提示词修改" />
      <div className="prompt-editor-fields">
        <label className="prompt-editor-field nodrag">
          <span><b>修改意见</b><small>{instructionCount} 字</small></span>
          <textarea
            value={instruction}
            onChange={(event) => data.onUpdate?.({ instruction: event.target.value })}
            placeholder="说明本次需要修改什么；未提及的内容会尽量保持不变。"
          />
        </label>
        <label className={`prompt-editor-field original-prompt-field nodrag ${data.promptConnected ? "is-linked" : ""}`}>
          <Handle id="original-prompt" type="target" position={Position.Left} className="prompt-editor-input-handle" />
          <span><b>原提示词</b><small>{data.promptConnected ? "已接入文本框" : `${promptCount} 字`}</small></span>
          <textarea
            value={originalPrompt}
            readOnly={Boolean(data.promptConnected)}
            onChange={(event) => data.onUpdate?.({ prompt: event.target.value })}
            placeholder="可直接粘贴原提示词，也可以把文本框连接到左侧输入端口。"
          />
        </label>
      </div>
      <button className="nodrag revision-submit" disabled={data.busy} onClick={data.onRun}>{data.busy ? data.busyLabel || "修改中…" : "提交修改并输出完整提示词"}<b>{data.busy ? "···" : "↗"}</b></button>
    </NodeFrame>
  );
}

function ImageGenerationModelControls({ data }: { data: GraphData }) {
  const providerOptions = data.imageProviderOptions || IMAGE_GENERATION_PROVIDERS;
  const provider = normalizeImageGenerationProvider(data.imageProvider || providerOptions[0]?.provider);
  const runtime = providerOptions.find((option) => option.provider === provider) || providerOptions[0];
  const models = runtime?.models || [];
  const selectedModel = models.find((model) => model.model === data.imageModel) || models[0];
  return (
    <div className="image-generation-runtime nodrag">
      <label><span>图片模型供应商</span><select value={provider} onChange={(event) => { const nextProvider = normalizeImageGenerationProvider(event.target.value); const nextRuntime = providerOptions.find((option) => option.provider === nextProvider); const nextModel = nextRuntime?.models[0]; data.onUpdate?.({ imageProvider: nextProvider, imageModel: nextModel?.model, resolution: nextModel?.supportedResolutions?.[0] || "1K", generatedImages: undefined, imageError: undefined, generationMeta: undefined }); }}>{providerOptions.map((option) => <option value={option.provider} key={option.provider}>{option.label}{option.loading ? " · 读取中" : option.configured ? "" : " · 未配置"}</option>)}</select></label>
      <label><span>图片生成模型</span><select disabled={!runtime?.configured || !models.length} value={selectedModel?.model || data.imageModel || ""} onChange={(event) => { const nextModel = models.find((model) => model.model === event.target.value); const currentResolution = data.resolution as ImageGenerationResolution | undefined; data.onUpdate?.({ imageModel: event.target.value, resolution: nextModel?.supportedResolutions?.includes(currentResolution || "1K") ? currentResolution : nextModel?.supportedResolutions?.[0] || "1K", generatedImages: undefined, imageError: undefined, generationMeta: undefined }); }}>{models.length ? models.map((model) => <option value={model.model} key={model.id}>{model.displayName}</option>) : <option value="">{runtime?.loading ? "正在读取模型…" : "暂无可用模型"}</option>}</select></label>
      <small className={runtime?.configured ? "" : "runtime-warning"}>{runtime?.message || selectedModel?.description || "图片生成模型目录尚未配置"}</small>
    </div>
  );
}

function ImageGeneratorNode({ data }: NodeProps<GraphNode>) {
  const slots: MediaSlot[] = data.inputSlots || Array.from({ length: MAX_IMAGE_GENERATION_IMAGES }, (_, index) => ({ slot: index + 1, marker: `@图片${index + 1}`, hasMedia: false }));
  const promptConnected = Boolean(data.promptConnected);
  const promptValue = promptConnected ? String(data.promptInput || "") : String(data.instruction || "");
  const provider = normalizeImageGenerationProvider(data.imageProvider);
  const runtime = (data.imageProviderOptions || IMAGE_GENERATION_PROVIDERS).find((option) => option.provider === provider);
  const selectedModel = runtime?.models.find((model) => model.model === data.imageModel) || runtime?.models[0];
  const resolutions = selectedModel?.supportedResolutions?.length ? selectedModel.supportedResolutions : IMAGE_GENERATION_RESOLUTIONS;
  const resolution = resolutions.includes((data.resolution || "1K") as ImageGenerationResolution) ? (data.resolution || "1K") as ImageGenerationResolution : resolutions[0];
  const canRun = Boolean(!data.busy && runtime?.configured && selectedModel && promptValue.trim());
  return (
    <NodeFrame data={data} tone="image-generator" input={false} output>
      <ImageGenerationModelControls data={data} />

      <div className="image-generation-specs nodrag">
        <label><span>画幅</span><select value={data.ratio || "Auto"} onChange={(event) => data.onUpdate?.({ ratio: event.target.value })}>{ASPECT_RATIOS.map((ratio) => <option value={ratio} key={ratio}>{ratio}</option>)}</select></label>
        <label><span>分辨率</span><select value={resolution} onChange={(event) => data.onUpdate?.({ resolution: event.target.value as ImageGenerationResolution })}>{resolutions.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
      </div>

      <div className="image-input-list image-generation-references">
        <span className="input-list-title">参考输入 · 最多 12 张图片</span>
        {slots.map((slot) => (
          <div className={`image-input-slot ${slot.sourceId ? "connected" : ""}`} key={slot.slot}>
            <Handle type="target" position={Position.Left} id={`media-${slot.slot}`} className="slot-handle" />
            <b>{slot.marker}</b>
            <span>{slot.sourceId ? (slot.fileName || "已连接，等待选择图片") : "未连接"}</span>
            <i className={slot.hasMedia ? "ready" : ""} />
          </div>
        ))}
      </div>

      <label className={`image-generation-prompt nodrag ${promptConnected ? "is-linked" : ""}`}>
        <Handle type="target" position={Position.Left} id="prompt" className="prompt-handle" />
        <span>生成提示词 <small>{promptConnected ? "已连接上游，编辑已锁定" : "可自由编辑，或连接文本节点"}</small></span>
        <textarea
          value={promptValue}
          readOnly={promptConnected}
          onChange={(event) => data.onUpdate?.({ instruction: event.target.value })}
          placeholder="输入图片生成提示词；也可以把文本框连接到左侧提示词端口。"
        />
      </label>

      {data.imageError && <div className="image-generation-error">{data.imageError}</div>}

      <button className="nodrag core-run image-generation-run" disabled={!canRun} onClick={data.onRun}>
        {data.busy ? (data.busyLabel || "生成图片中…") : canRun ? "生成图片" : runtime?.loading ? "正在读取图片模型" : runtime?.configured ? "请输入生成提示词" : "图片供应商未配置"}<b>↗</b>
      </button>
    </NodeFrame>
  );
}

function VideoGenerationModelControls({ data }: { data: GraphData }) {
  const providerOptions = data.videoGenerationProviderOptions || VIDEO_GENERATION_PROVIDERS;
  const provider = normalizeVideoGenerationProvider(data.videoGenerationProvider || providerOptions[0]?.provider);
  const runtime = providerOptions.find((option) => option.provider === provider) || providerOptions[0];
  const models = runtime?.models || [];
  const selectedModel = models.find((model) => model.model === data.videoGenerationModel) || models[0];
  return (
    <div className="video-generation-runtime nodrag">
      <label><span>视频模型供应商</span><select value={provider} onChange={(event) => { const nextProvider = normalizeVideoGenerationProvider(event.target.value); const nextRuntime = providerOptions.find((option) => option.provider === nextProvider); const nextModel = nextRuntime?.models[0]; data.onUpdate?.({ videoGenerationProvider: nextProvider, videoGenerationModel: nextModel?.model, videoGenerationResolution: nextModel?.supportedResolutions?.[0] || "720p", generatedVideos: undefined, videoGenerationError: undefined, generationMeta: undefined, confirmLowCredit: false }); }}>{providerOptions.map((option) => <option value={option.provider} key={option.provider}>{option.label}{option.loading ? " · 读取中" : option.configured ? "" : " · 未配置"}</option>)}</select></label>
      <label><span>视频生成模型</span><select disabled={!runtime?.configured || !models.length} value={selectedModel?.model || data.videoGenerationModel || ""} onChange={(event) => { const nextModel = models.find((model) => model.model === event.target.value); data.onUpdate?.({ videoGenerationModel: event.target.value, videoGenerationResolution: nextModel?.supportedResolutions?.[0] || "720p", generatedVideos: undefined, videoGenerationError: undefined, generationMeta: undefined, confirmLowCredit: false }); }}>{models.length ? models.map((model) => <option value={model.model} key={model.id}>{model.displayName}</option>) : <option value="">{runtime?.loading ? "正在读取模型…" : "暂无可用模型"}</option>}</select></label>
      <small className={runtime?.configured ? "" : "runtime-warning"}>{runtime?.message || selectedModel?.description || "视频生成模型目录尚未配置"}</small>
    </div>
  );
}

function VideoGeneratorNode({ data }: NodeProps<GraphNode>) {
  const slots: MediaSlot[] = data.inputSlots || Array.from({ length: MAX_VIDEO_GENERATION_REFERENCES }, (_, index) => ({ slot: index + 1, marker: `槽位 ${index + 1}`, hasMedia: false }));
  const promptConnected = Boolean(data.promptConnected);
  const promptValue = promptConnected ? String(data.promptInput || "") : String(data.instruction || "");
  const provider = normalizeVideoGenerationProvider(data.videoGenerationProvider);
  const runtime = (data.videoGenerationProviderOptions || VIDEO_GENERATION_PROVIDERS).find((option) => option.provider === provider);
  const selectedModel = runtime?.models.find((model) => model.model === data.videoGenerationModel) || runtime?.models[0];
  const mode = (data.videoGenerationMode || "multimodal2video") as VideoGenerationMode;
  const modeDefinition = VIDEO_GENERATION_MODES.find((item) => item.id === mode) || VIDEO_GENERATION_MODES[4];
  const resolutions = selectedModel?.supportedResolutions?.length ? selectedModel.supportedResolutions : VIDEO_GENERATION_RESOLUTIONS;
  const durations = selectedModel?.supportedDurations?.length ? selectedModel.supportedDurations : Array.from({ length: 12 }, (_, index) => index + 4);
  const ratios = selectedModel?.supportedAspectRatios?.length ? selectedModel.supportedAspectRatios : VIDEO_ASPECT_RATIOS;
  const connected = slots.filter((slot) => slot.sourceId);
  const canRun = Boolean(!data.busy && runtime?.configured && selectedModel && promptValue.trim());
  const insertMarker = (marker: string) => {
    if (promptConnected) return;
    const current = String(data.instruction || "");
    const spacer = current && !/\s$/.test(current) ? " " : "";
    data.onUpdate?.({ instruction: `${current}${spacer}${marker} ` });
  };
  return (
    <NodeFrame data={data} tone="video-generator" input={false} output>
      <VideoGenerationModelControls data={data} />

      <div className="video-generation-specs nodrag">
        <label><span>生成模式</span><select value={mode} onChange={(event) => data.onUpdate?.({ videoGenerationMode: event.target.value as VideoGenerationMode, generatedVideos: undefined, videoGenerationError: undefined })}>{VIDEO_GENERATION_MODES.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        <label><span>时长</span><select value={Number(data.duration || durations[0] || 5)} onChange={(event) => data.onUpdate?.({ duration: event.target.value })}>{durations.map((duration) => <option value={duration} key={duration}>{duration}s</option>)}</select></label>
        <label><span>画幅</span><select value={data.ratio || ratios[0] || "16:9"} onChange={(event) => data.onUpdate?.({ ratio: event.target.value })}>{ratios.map((ratio) => <option value={ratio} key={ratio}>{ratio}</option>)}</select></label>
        <label><span>分辨率</span><select value={data.videoGenerationResolution || resolutions[0] || "720p"} onChange={(event) => data.onUpdate?.({ videoGenerationResolution: event.target.value as VideoGenerationResolution })}>{resolutions.map((resolution) => <option value={resolution} key={resolution}>{resolution}</option>)}</select></label>
        <label className="video-generation-audio"><span>声音</span><input type="checkbox" checked={data.generateAudio !== false} onChange={(event) => data.onUpdate?.({ generateAudio: event.target.checked })} /><b>同步生成音效 / 配乐</b></label>
        <small>{modeDefinition.helper}</small>
      </div>

      <div className="image-input-list video-generation-references">
        <span className="input-list-title">参考输入 · 12 个混合槽位（图片与视频分别编号）</span>
        {slots.map((slot) => (
          <div className={`image-input-slot ${slot.sourceId ? "connected" : ""}`} key={slot.slot}>
            <Handle type="target" position={Position.Left} id={`media-${slot.slot}`} className="slot-handle" />
            <b>{slot.sourceId ? slot.marker : `槽位 ${slot.slot}`}</b>
            <span>{slot.sourceId ? `${slot.mediaKind === "video" ? "视频" : "图片"} · ${slot.fileName || "等待添加素材"}` : "未连接"}</span>
            <i className={slot.hasMedia ? "ready" : ""} />
          </div>
        ))}
      </div>

      <label className={`video-generation-prompt nodrag ${promptConnected ? "is-linked" : ""}`}>
        <Handle type="target" position={Position.Left} id="prompt" className="prompt-handle" />
        <span>生成提示词 <small>{promptConnected ? "已连接上游，编辑与 @ 插入已锁定" : "可编辑；点击下方引用插入 @ 标记"}</small></span>
        {connected.length > 0 && <div className="video-reference-markers">{connected.map((slot) => <button type="button" disabled={promptConnected} onClick={() => insertMarker(slot.marker)} key={`${slot.slot}-${slot.marker}`}>{slot.marker}</button>)}</div>}
        <textarea
          value={promptValue}
          readOnly={promptConnected}
          onChange={(event) => data.onUpdate?.({ instruction: event.target.value })}
          placeholder="描述视频内容。全能参考模式可使用 @图片1、@视频1 指定每个素材的用途；也可以连接文本框。"
        />
      </label>

      {data.videoGenerationError && <div className="video-generation-error">{data.videoGenerationError.replace(/^LOW_CREDIT_CONFIRMATION_REQUIRED:\s*/, "")}</div>}

      <button className="nodrag core-run video-generation-run" disabled={!canRun} onClick={data.onRun}>
        {data.busy ? (data.busyLabel || "视频生成中…") : data.confirmLowCredit ? "确认余额并继续生成" : canRun ? "生成视频" : runtime?.loading ? "正在读取视频模型" : runtime?.configured ? "请输入生成提示词" : "视频供应商未配置"}<b>↗</b>
      </button>
    </NodeFrame>
  );
}

function ImageOutputNode({ data }: NodeProps<GraphNode>) {
  const images = data.generatedImages || [];
  return (
    <NodeFrame data={data} tone="image-output" input output={false}>
      <div className="media-output-status">
        <span>{data.busy ? data.busyLabel || "图片生成中…" : images.length ? `已生成 ${images.length} 张` : "等待图片"}</span>
        <small>{data.generationMeta || "连接图片生成节点后预览结果"}</small>
      </div>
      {images.length ? (
        <div className="image-generation-result-grid media-output-grid nodrag">
          {images.map((image, index) => (
            <div className="image-preview-card" key={`${image.dataUrl.slice(0, 48)}-${index}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.dataUrl} alt={`生成图片 ${index + 1}`} />
              <a className="image-download-float nodrag nopan" href={image.dataUrl} download={`generated-${index + 1}.${image.mediaType.includes("jpeg") ? "jpg" : image.mediaType.includes("webp") ? "webp" : "png"}`} aria-label={`下载图片 ${index + 1}`} onClick={(event) => event.stopPropagation()} onMouseDown={blockMiddleMouseDownload} onAuxClick={blockMiddleMouseDownload}>下载图片 {index + 1}</a>
            </div>
          ))}
        </div>
      ) : <div className="media-output-empty">{data.busy ? "任务已经提交，生成结果会自动显示在这里。" : "从图片生成节点连接到左侧端口，然后发起生成。"}</div>}
      {data.imageError && <div className="image-generation-error">{data.imageError}</div>}
    </NodeFrame>
  );
}

function VideoOutputNode({ data, selected }: NodeProps<GraphNode>) {
  const videos = data.generatedVideos || [];
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={320}
        minHeight={320}
        maxWidth={1100}
        maxHeight={960}
        color="#397f87"
        handleClassName="video-resize-handle"
        lineClassName="video-resize-line"
      />
      <NodeFrame data={data} tone="video-output" input output={false}>
        <div className="media-output-status">
          <span>{data.busy ? data.busyLabel || "视频生成中…" : videos.length ? `已生成 ${videos.length} 个` : "等待视频"}</span>
          <small>{data.generationMeta || "连接视频生成节点后预览结果"}</small>
        </div>
        {videos.length ? (
          <div className="video-output-results nodrag">
            {videos.map((video, index) => {
              const playbackUrl = videoPlaybackUrl(video);
              return <div className="video-generation-result" key={`${video.url}-${index}`}>
                <video controls playsInline preload="metadata" src={playbackUrl} />
                <a href={playbackUrl} download={`generated-${index + 1}.mp4`} onMouseDown={blockMiddleMouseDownload} onAuxClick={blockMiddleMouseDownload}>下载视频 {videos.length > 1 ? index + 1 : ""}</a>
              </div>;
            })}
          </div>
        ) : <div className="media-output-empty">{data.busy ? "任务已经提交，生成结果会自动显示在这里。" : "从视频生成节点连接到左侧端口，然后发起生成。"}</div>}
        {data.videoGenerationError && <div className="video-generation-error">{data.videoGenerationError.replace(/^LOW_CREDIT_CONFIRMATION_REQUIRED:\s*/, "")}</div>}
      </NodeFrame>
    </>
  );
}

function TextBoxNode({ data, selected }: NodeProps<GraphNode>) {
  const value = String(data.text ?? data.prompt ?? "");
  const count = value.replace(/\s/g, "").length;
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={280}
        minHeight={260}
        maxWidth={1000}
        maxHeight={1000}
        color="#6574b7"
        handleClassName="text-resize-handle"
        lineClassName="text-resize-line"
      />
      <NodeFrame data={data} tone="text-box" input output>
        <div className="text-node-status"><span>{data.source || "可编辑文本"}</span><small>{count} 字</small></div>
        <textarea
          className="nodrag text-node-editor"
          value={value}
          onChange={(event) => data.onUpdate?.({ text: event.target.value, prompt: event.target.value, source: "手动编辑" })}
          placeholder="输入文字，或从左侧接收上游结果。"
        />
        <div className="text-box-actions nodrag"><button onClick={data.onCopy}>复制</button><button onClick={data.onPaste}>粘贴</button></div>
      </NodeFrame>
    </>
  );
}

function CanvasGroupNode({ data, selected }: NodeProps<GraphNode>) {
  const memberCount = Number(data.memberCount || 0);
  const dropTarget = data.groupDropTarget === true;
  const title = String(data.title || "群组");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const beginRename = () => {
    setTitleDraft(title);
    setEditingTitle(true);
  };
  const saveTitle = () => {
    const nextTitle = titleDraft.trim().slice(0, 40) || "群组";
    setEditingTitle(false);
    setTitleDraft(nextTitle);
    if (nextTitle !== title) data.onUpdate?.({ title: nextTitle });
  };
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={180}
        minHeight={140}
        color="rgba(121, 101, 184, .42)"
        handleClassName="group-resize-handle"
        lineClassName="group-resize-line"
      />
      <div className={`canvas-group-frame ${selected ? "is-selected" : ""} ${dropTarget ? "is-drop-target" : ""}`} title="拖动节点进入群组可添加成员；拖动群组外框可整体移动；选中后可从边缘调整大小">
        <div className="canvas-group-caption">
          <span aria-hidden="true">组</span>
          {editingTitle ? (
            <input
              className="nodrag nopan group-title-input"
              autoFocus
              maxLength={40}
              aria-label="群组名称"
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={saveTitle}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  saveTitle();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setTitleDraft(title);
                  setEditingTitle(false);
                }
              }}
            />
          ) : (
            <button className="nodrag nopan group-title-button" type="button" title="双击重命名" onDoubleClick={(event) => { event.stopPropagation(); beginRename(); }}>{title}</button>
          )}
          <small>{dropTarget ? "松开加入群组" : `${memberCount} 个节点`}</small>
          {selected && !editingTitle && <button className="nodrag nopan group-rename-button" type="button" aria-label="重命名群组" title="重命名群组" onClick={(event) => { event.stopPropagation(); beginRename(); }}>✎</button>}
        </div>
      </div>
    </>
  );
}

const nodeTypes = {
  group: CanvasGroupNode,
  reference: ReferenceNode,
  video: VideoNode,
  skill: SkillNode,
  codex: CodexNode,
  prompteditor: PromptEditorNode,
  imagegenerator: ImageGeneratorNode,
  videogenerator: VideoGeneratorNode,
  imageoutput: ImageOutputNode,
  videooutput: VideoOutputNode,
  text: TextBoxNode,
  finalprompt: TextBoxNode,
  revision: TextBoxNode,
  revisedprompt: TextBoxNode,
  textinput: TextBoxNode,
  textoutput: TextBoxNode,
};

function DisconnectableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
  interactionWidth,
}: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth} />
      {selected && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan edge-disconnect-label"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <button
              type="button"
              className="edge-disconnect-button"
              aria-label="断开连接"
              title="断开连接"
              onClick={(event) => {
                event.stopPropagation();
                void deleteElements({ edges: [{ id }] });
              }}
            >
              <span aria-hidden="true">×</span> 断开
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes = { disconnectable: DisconnectableEdge } satisfies EdgeTypes;

function slotNumber(edge: Edge) {
  const match = edge.targetHandle?.match(/^(?:image|media)-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function isOutputNodeType(type?: string): type is "text" | "finalprompt" | "revisedprompt" | "textoutput" {
  return type === "text" || type === "finalprompt" || type === "revisedprompt" || type === "textoutput";
}

function isImageOutputNodeType(type?: string): type is "reference" | "imageoutput" {
  return type === "reference" || type === "imageoutput";
}

function isVideoOutputNodeType(type?: string): type is "video" | "videooutput" {
  return type === "video" || type === "videooutput";
}

function nodeText(node?: GraphNode) {
  return String(node?.data.text || node?.data.prompt || "").trim();
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
}

function blockMiddleMouseDownload(event: ReactMouseEvent<HTMLAnchorElement>) {
  if (event.button !== 1) return;
  event.preventDefault();
}

function videoPlaybackUrl(video: GeneratedVideo) {
  return video.savedPath
    ? `${BRIDGE_URL}/media-file?path=${encodeURIComponent(video.savedPath)}`
    : video.url;
}

function copyableNode(node: GraphNode, id = node.id, position = node.position, selected = false): GraphNode {
  const copy = {
    ...node,
    id,
    position: { ...position },
    data: { ...node.data },
    selected,
    dragging: false,
  };
  delete copy.measured;
  return copy;
}

function duplicatedNode(node: GraphNode, id = node.id, position = node.position, selected = false): GraphNode {
  const copy = copyableNode(node, id, position, selected);
  const data = { ...copy.data };
  delete data.threadId;
  delete data.sessionId;
  delete data.responseId;
  delete data.previousResponseId;
  delete data.busy;
  delete data.busyLabel;
  delete data.inputSlots;
  delete data.promptConnected;
  delete data.promptInput;
  delete data.assignedMarkers;
  delete data.modelOptions;
  delete data.providerOptions;
  delete data.imageProviderOptions;
  delete data.videoGenerationProviderOptions;
  delete data.onUpdate;
  delete data.onDelete;
  delete data.onRun;
  delete data.onCopy;
  delete data.onPaste;
  if (data.confirmLowCredit) data.confirmLowCredit = false;
  return { ...copy, data };
}

type CanvasHistorySnapshot = {
  projectId: string;
  nodes: GraphNode[];
  edges: Edge[];
};

const MAX_HISTORY_ENTRIES = 50;
const GROUP_PADDING_X = 42;
const GROUP_PADDING_TOP = 64;
const GROUP_PADDING_BOTTOM = 42;
const GROUP_DROP_OVERLAP_RATIO = 0.4;

function nodeVisualSize(node: GraphNode) {
  const styleWidth = typeof node.style?.width === "number" ? node.style.width : Number.parseFloat(String(node.style?.width || ""));
  const styleHeight = typeof node.style?.height === "number" ? node.style.height : Number.parseFloat(String(node.style?.height || ""));
  const width = Number(node.measured?.width ?? node.width ?? styleWidth);
  const height = Number(node.measured?.height ?? node.height ?? styleHeight);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 360,
    height: Number.isFinite(height) && height > 0 ? height : 320,
  };
}

function absoluteNodePosition(node: GraphNode, nodes: GraphNode[]) {
  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }
  return { x, y };
}

function detachNodeFromGroup(node: GraphNode, position: { x: number; y: number }) {
  const detached = { ...node, position: { ...position } };
  delete detached.parentId;
  delete detached.extent;
  delete detached.expandParent;
  return detached;
}

function addNodesToExistingGroup(nodes: GraphNode[], groupId: string, nodeIds: Iterable<string>) {
  const requestedIds = new Set(nodeIds);
  const group = nodes.find((node) => node.id === groupId && node.type === "group");
  const members = nodes.filter((node) => requestedIds.has(node.id) && node.type !== "group" && !node.parentId);
  if (!group || !members.length) return nodes;

  const groupSize = nodeVisualSize(group);
  const memberBounds = members.map((node) => {
    const position = absoluteNodePosition(node, nodes);
    return { node, position, ...nodeVisualSize(node) };
  });
  const nextGroupPosition = {
    x: Math.min(group.position.x, ...memberBounds.map(({ position }) => position.x - GROUP_PADDING_X)),
    y: Math.min(group.position.y, ...memberBounds.map(({ position }) => position.y - GROUP_PADDING_TOP)),
  };
  const nextGroupRight = Math.max(
    group.position.x + groupSize.width,
    ...memberBounds.map(({ position, width }) => position.x + width + GROUP_PADDING_X),
  );
  const nextGroupBottom = Math.max(
    group.position.y + groupSize.height,
    ...memberBounds.map(({ position, height }) => position.y + height + GROUP_PADDING_BOTTOM),
  );
  const existingShift = {
    x: group.position.x - nextGroupPosition.x,
    y: group.position.y - nextGroupPosition.y,
  };
  const currentMemberCount = nodes.filter((node) => node.parentId === groupId).length;
  const updated = nodes.map((node) => {
    if (node.id === groupId) {
      return {
        ...node,
        position: nextGroupPosition,
        selected: true,
        style: {
          ...node.style,
          width: Math.max(180, nextGroupRight - nextGroupPosition.x),
          height: Math.max(140, nextGroupBottom - nextGroupPosition.y),
        },
        data: { ...node.data, memberCount: currentMemberCount + members.length },
      };
    }
    if (node.parentId === groupId) {
      return {
        ...node,
        position: {
          x: node.position.x + existingShift.x,
          y: node.position.y + existingShift.y,
        },
        selected: false,
      };
    }
    const incoming = memberBounds.find(({ node: member }) => member.id === node.id);
    if (!incoming) return node.selected ? { ...node, selected: false } : node;
    return {
      ...node,
      parentId: groupId,
      extent: "parent" as const,
      expandParent: true,
      position: {
        x: incoming.position.x - nextGroupPosition.x,
        y: incoming.position.y - nextGroupPosition.y,
      },
      selected: false,
      dragging: false,
    };
  });
  const updatedGroup = updated.find((node) => node.id === groupId);
  return updatedGroup ? [updatedGroup, ...updated.filter((node) => node.id !== groupId)] : updated;
}

function removeNodesFromGroups(nodes: GraphNode[], nodeIds: Iterable<string>) {
  const requestedIds = new Set(nodeIds);
  const detachedIds = new Set(nodes.filter((node) => requestedIds.has(node.id) && node.parentId).map((node) => node.id));
  if (!detachedIds.size) return nodes;
  const updated = nodes.map((node) => detachedIds.has(node.id)
    ? { ...detachNodeFromGroup(node, absoluteNodePosition(node, nodes)), selected: true, dragging: false }
    : node);
  return updated.map((node) => node.type === "group"
    ? { ...node, data: { ...node.data, memberCount: updated.filter((member) => member.parentId === node.id).length } }
    : node);
}

function groupDropTargetForNode(draggedNode: GraphNode, nodes: GraphNode[]) {
  if (draggedNode.type === "group" || draggedNode.parentId) return "";
  const draggedPosition = absoluteNodePosition(draggedNode, nodes);
  const draggedSize = nodeVisualSize(draggedNode);
  const draggedArea = Math.max(1, draggedSize.width * draggedSize.height);
  let best = { id: "", ratio: 0 };
  for (const group of nodes.filter((node) => node.type === "group")) {
    const groupPosition = absoluteNodePosition(group, nodes);
    const groupSize = nodeVisualSize(group);
    const overlapWidth = Math.max(0, Math.min(draggedPosition.x + draggedSize.width, groupPosition.x + groupSize.width) - Math.max(draggedPosition.x, groupPosition.x));
    const overlapHeight = Math.max(0, Math.min(draggedPosition.y + draggedSize.height, groupPosition.y + groupSize.height) - Math.max(draggedPosition.y, groupPosition.y));
    const ratio = (overlapWidth * overlapHeight) / draggedArea;
    if (ratio >= GROUP_DROP_OVERLAP_RATIO && ratio > best.ratio) best = { id: group.id, ratio };
  }
  return best.id;
}

function clipboardSelectionNodes(nodes: GraphNode[]) {
  const selectedIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
  const selectedGroupIds = new Set(nodes.filter((node) => node.selected && node.type === "group").map((node) => node.id));
  selectedGroupIds.forEach((groupId) => nodes.filter((node) => node.parentId === groupId).forEach((node) => selectedIds.add(node.id)));
  const copied = nodes
    .filter((node) => selectedIds.has(node.id))
    .map((node) => {
      const copy = duplicatedNode(node);
      if (!copy.parentId || selectedIds.has(copy.parentId)) return copy;
      return detachNodeFromGroup(copy, absoluteNodePosition(node, nodes));
    });
  return [
    ...copied.filter((node) => node.type === "group"),
    ...copied.filter((node) => node.type !== "group"),
  ];
}

function clipboardSelectionEdges(edges: Edge[], copiedNodes: GraphNode[]) {
  if (copiedNodes.length <= 1) return [];
  const copiedIds = new Set(copiedNodes.map((node) => node.id));
  return edges
    .filter((edge) => copiedIds.has(edge.source) && copiedIds.has(edge.target))
    .map((edge) => ({ ...edge, selected: false }));
}

function clipboardNodeIdMap(copiedNodes: GraphNode[]) {
  return new Map(copiedNodes.map((node) => [node.id, `${node.type || "node"}-${crypto.randomUUID().slice(0, 8)}`]));
}

function pasteClipboardNodes(copiedNodes: GraphNode[], offset: { x: number; y: number }, idMap = clipboardNodeIdMap(copiedNodes)) {
  const copiedIds = new Set(copiedNodes.map((node) => node.id));
  return copiedNodes.map((node) => {
    const copiedParentId = node.parentId && copiedIds.has(node.parentId) ? node.parentId : undefined;
    const position = copiedParentId
      ? { ...node.position }
      : { x: node.position.x + offset.x, y: node.position.y + offset.y };
    const copy = duplicatedNode(node, idMap.get(node.id), position, !copiedParentId);
    if (copiedParentId) {
      copy.parentId = idMap.get(copiedParentId);
      copy.extent = "parent";
      copy.expandParent = true;
      copy.selected = false;
    } else {
      delete copy.parentId;
      delete copy.extent;
      delete copy.expandParent;
    }
    return copy;
  });
}

function pasteClipboardEdges(copiedEdges: Edge[], idMap: Map<string, string>) {
  return copiedEdges.flatMap((edge) => {
    const source = idMap.get(edge.source);
    const target = idMap.get(edge.target);
    if (!source || !target) return [];
    return [{
      ...edge,
      id: `edge-${crypto.randomUUID().slice(0, 8)}`,
      source,
      target,
      selected: false,
    }];
  });
}

function canvasHistorySnapshot(projectId: string, nodes: GraphNode[], edges: Edge[]): CanvasHistorySnapshot {
  return {
    projectId,
    nodes: nodes.map((node) => {
      const copy = { ...node, position: { ...node.position }, data: node.data, selected: false, dragging: false };
      delete copy.measured;
      return copy;
    }),
    edges: edges.map((edge) => ({ ...edge, selected: false })),
  };
}

function sameCanvasHistorySnapshot(left: CanvasHistorySnapshot, right: CanvasHistorySnapshot) {
  if (left.projectId !== right.projectId || left.nodes.length !== right.nodes.length || left.edges.length !== right.edges.length) return false;
  const sameNodes = left.nodes.every((node, index) => {
    const other = right.nodes[index];
    if (!other) return false;
    return node.id === other.id
      && node.type === other.type
      && node.parentId === other.parentId
      && node.extent === other.extent
      && node.expandParent === other.expandParent
      && node.position.x === other.position.x
      && node.position.y === other.position.y
      && node.width === other.width
      && node.height === other.height
      && node.data === other.data;
  });
  if (!sameNodes) return false;
  return left.edges.every((edge, index) => {
    const other = right.edges[index];
    if (!other) return false;
    return edge.id === other.id
      && edge.source === other.source
      && edge.target === other.target
      && edge.sourceHandle === other.sourceHandle
      && edge.targetHandle === other.targetHandle
      && edge.type === other.type
      && edge.data === other.data;
  });
}

function cleanNodes(nodes: GraphNode[]) {
  return nodes.map((node) => {
    const data = { ...node.data };
    delete data.onUpdate;
    delete data.onDelete;
    delete data.onRun;
    delete data.onCopy;
    delete data.onPaste;
    delete data.busy;
    delete data.busyLabel;
    delete data.inputSlots;
    delete data.promptConnected;
    delete data.promptInput;
    delete data.assignedMarkers;
    delete data.modelOptions;
    delete data.providerOptions;
    delete data.imageProviderOptions;
    delete data.videoGenerationProviderOptions;
    delete data.skillRegistry;
    delete data.skillConnected;
    delete data.skillInputId;
    delete data.skillInputLabel;
    delete data.onRegisterSkill;
    delete data.onRefreshSkill;
    delete data.onUnregisterSkill;
    delete data.preview;
    delete data.imageData;
    delete data.videoData;
    delete data.generatedImages;
    delete data.generatedVideos;
    delete data.fileName;
    return { ...node, data };
  });
}

function projectNodes(nodes: GraphNode[]) {
  return nodes.map((node) => {
    const data = { ...node.data };
    delete data.onUpdate;
    delete data.onDelete;
    delete data.onRun;
    delete data.onCopy;
    delete data.onPaste;
    delete data.busy;
    delete data.busyLabel;
    delete data.inputSlots;
    delete data.promptConnected;
    delete data.promptInput;
    delete data.assignedMarkers;
    delete data.modelOptions;
    delete data.providerOptions;
    delete data.imageProviderOptions;
    delete data.videoGenerationProviderOptions;
    delete data.skillRegistry;
    delete data.skillConnected;
    delete data.skillInputId;
    delete data.skillInputLabel;
    delete data.onRegisterSkill;
    delete data.onRefreshSkill;
    delete data.onUnregisterSkill;
    delete data.preview;
    return { ...node, data };
  });
}

function portableProjectNodes(nodes: GraphNode[]) {
  return projectNodes(nodes).map((node) => {
    const data = { ...node.data };
    delete data.threadId;
    delete data.sessionId;
    delete data.responseId;
    delete data.previousResponseId;
    return { ...node, data };
  });
}

const PORTABLE_NODE_TYPES = new Set([
  "group",
  "reference",
  "video",
  "skill",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parsePortableCanvas(value: unknown) {
  if (!isRecord(value)) throw new Error("画布文件内容无效");

  let project: Record<string, unknown> = value;
  if ("format" in value || "version" in value || "project" in value) {
    if (value.format !== "prompt-flow-canvas" || value.version !== 1 || !isRecord(value.project)) {
      throw new Error("不支持的画布文件格式或版本");
    }
    project = value.project;
  }

  if (!Array.isArray(project.nodes) || !Array.isArray(project.edges)) {
    throw new Error("画布文件缺少节点或连线数据");
  }
  if (project.nodes.length > MAX_PORTABLE_NODES) throw new Error(`画布最多支持 ${MAX_PORTABLE_NODES} 个节点`);
  if (project.edges.length > MAX_PORTABLE_EDGES) throw new Error(`画布最多支持 ${MAX_PORTABLE_EDGES} 条连线`);

  const nodeIds = new Set<string>();
  const nodes = project.nodes.map((item, index) => {
    if (!isRecord(item)) throw new Error(`第 ${index + 1} 个节点无效`);
    if (typeof item.id !== "string" || !item.id.trim() || nodeIds.has(item.id)) {
      throw new Error(`第 ${index + 1} 个节点的 ID 无效或重复`);
    }
    if (typeof item.type !== "string" || !PORTABLE_NODE_TYPES.has(item.type)) {
      throw new Error(`节点「${item.id}」的类型不受支持`);
    }
    if (!isRecord(item.position) || !Number.isFinite(item.position.x) || !Number.isFinite(item.position.y)) {
      throw new Error(`节点「${item.id}」的位置无效`);
    }
    if (!isRecord(item.data)) throw new Error(`节点「${item.id}」的数据无效`);
    if ((item.type === "codex" || item.type === "prompteditor") && item.data.provider !== undefined && !isAgentProvider(item.data.provider)) {
      throw new Error(`节点「${item.id}」使用了不支持的模型供应商`);
    }
    if (item.type === "imagegenerator" && item.data.imageProvider !== undefined && item.data.imageProvider !== "pending" && !isImageGenerationProvider(item.data.imageProvider)) {
      throw new Error(`节点「${item.id}」使用了不支持的图片生成供应商`);
    }
    if (item.type === "videogenerator" && item.data.videoGenerationProvider !== undefined && item.data.videoGenerationProvider !== "pending" && !isVideoGenerationProvider(item.data.videoGenerationProvider)) {
      throw new Error(`节点「${item.id}」使用了不支持的视频生成供应商`);
    }
    if ((item.type === "codex" || item.type === "prompteditor" || item.type === "skill") && item.data.skillId !== undefined && !String(item.data.skillId).startsWith("custom:") && !PROMPT_SKILLS.includes(item.data.skillId as PromptSkillId)) {
      throw new Error(`节点「${item.id}」使用了不支持的提示词 Skill`);
    }
    const mediaField = item.type === "reference" ? "imageData" : item.type === "video" ? "videoData" : "";
    const mediaValue = mediaField ? item.data[mediaField] : undefined;
    if (mediaValue && (typeof mediaValue !== "string" || !new RegExp(`^data:${item.type === "reference" ? "image" : "video"}/[a-z0-9.+-]+;base64,`, "i").test(mediaValue))) {
      throw new Error(`节点「${item.id}」包含无效的${item.type === "reference" ? "图片" : "视频"}素材`);
    }
    if ((item.type === "imagegenerator" || item.type === "imageoutput" || item.type === "reference") && item.data.generatedImages !== undefined) {
      if (!Array.isArray(item.data.generatedImages) || item.data.generatedImages.length > 10) {
        throw new Error(`节点「${item.id}」包含无效的生成结果`);
      }
      for (const generatedImage of item.data.generatedImages) {
        if (
          !isRecord(generatedImage)
          || typeof generatedImage.dataUrl !== "string"
          || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(generatedImage.dataUrl)
          || typeof generatedImage.mediaType !== "string"
          || !/^image\/[a-z0-9.+-]+$/i.test(generatedImage.mediaType)
        ) {
          throw new Error(`节点「${item.id}」包含无效的生成图片`);
        }
      }
    }
    if ((item.type === "videogenerator" || item.type === "videooutput" || item.type === "video") && item.data.generatedVideos !== undefined) {
      if (!Array.isArray(item.data.generatedVideos) || item.data.generatedVideos.length > 4) {
        throw new Error(`节点「${item.id}」包含无效的视频生成结果`);
      }
      for (const generatedVideo of item.data.generatedVideos) {
        if (
          !isRecord(generatedVideo)
          || typeof generatedVideo.url !== "string"
          || !/^(?:https?:\/\/|data:video\/[a-z0-9.+-]+;base64,)/i.test(generatedVideo.url)
          || typeof generatedVideo.mediaType !== "string"
          || !/^video\/[a-z0-9.+-]+$/i.test(generatedVideo.mediaType)
        ) {
          throw new Error(`节点「${item.id}」包含无效的生成视频`);
        }
      }
    }
    nodeIds.add(item.id);
    return item as GraphNode;
  });

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  nodes.forEach((node) => {
    if (!node.parentId) return;
    const parent = nodesById.get(node.parentId);
    if (!parent || parent.type !== "group" || node.type === "group") {
      throw new Error(`节点「${node.id}」引用了无效的群组`);
    }
  });

  const edgeIds = new Set<string>();
  const edges = project.edges.map((item, index) => {
    if (!isRecord(item)) throw new Error(`第 ${index + 1} 条连线无效`);
    if (typeof item.id !== "string" || !item.id.trim() || edgeIds.has(item.id)) {
      throw new Error(`第 ${index + 1} 条连线的 ID 无效或重复`);
    }
    if (typeof item.source !== "string" || typeof item.target !== "string" || !nodeIds.has(item.source) || !nodeIds.has(item.target)) {
      throw new Error(`连线「${item.id}」引用了不存在的节点`);
    }
    edgeIds.add(item.id);
    return item as Edge;
  });

  const name = typeof project.name === "string" ? project.name.trim().slice(0, 60) : "";
  return { name, nodes, edges };
}

function normalizeRewriteTitle(title: unknown) {
  const value = String(title || "").trim();
  if (!value || LEGACY_REWRITE_TITLES.has(value)) return REWRITE_NODE_TITLE;
  // Only normalize known exclusive defaults; keep user-custom titles intact.
  if (/^Seedance\s*[·•]?\s*(Codex|Agent)\s*改写$/i.test(value)) return REWRITE_NODE_TITLE;
  if (/^Codex\s*改写$/i.test(value)) return REWRITE_NODE_TITLE;
  return value;
}

/** Force wide-node layout and grow leftward so right-side connections stay put. */
function applyRewriteNodeLayout(node: GraphNode): GraphNode {
  if (node.type !== "codex" && node.type !== "imagegenerator" && node.type !== "videogenerator") return node;
  const previousWidth = Number(node.width ?? node.measured?.width ?? node.style?.width ?? LEGACY_REWRITE_NODE_WIDTH);
  const prior = Number.isFinite(previousWidth) && previousWidth > 0 ? previousWidth : LEGACY_REWRITE_NODE_WIDTH;
  const expandLeft = Math.max(0, REWRITE_NODE_WIDTH - prior);
  const nextStyle = {
    ...(node.style || {}),
    width: REWRITE_NODE_WIDTH,
  };
  return {
    ...node,
    width: REWRITE_NODE_WIDTH,
    style: nextStyle,
    measured: {
      width: REWRITE_NODE_WIDTH,
      height: node.measured?.height ?? node.height,
    },
    position: {
      x: Number(node.position?.x || 0) - expandLeft,
      y: Number(node.position?.y || 0),
    },
  };
}

function restoredNodes(nodes: GraphNode[]) {
  return nodes.map((node) => {
    const rest = { ...node };
    delete rest.deletable;
    const isTextNode = node.type === "text" || node.type === "textinput" || node.type === "textoutput" || node.type === "output" || node.type === "finalprompt" || node.type === "revisedprompt" || node.type === "revision";
    const isLegacyRevision = node.type === "revision" || node.type === "textinput";
    const isRewrite = node.type === "codex";
    const isImageGenerator = node.type === "imagegenerator";
    const isVideoGenerator = node.type === "videogenerator";
    const isImageNode = node.type === "reference" || node.type === "imageoutput";
    const isVideoNode = node.type === "video" || node.type === "videooutput";
    const hasRuntime = isRewrite || node.type === "prompteditor";
    const nextTitle = isTextNode
      ? "文本框"
      : isRewrite
          ? normalizeRewriteTitle(node.data.title)
          : isImageGenerator
            ? String(node.data.title || "图片生成")
          : isVideoGenerator
            ? String(node.data.title || "视频生成")
          : isImageNode
            ? "图片"
          : isVideoNode
            ? "视频"
          : node.data.title;
    const canonicalType = isTextNode ? "text" : isImageNode ? "reference" : isVideoNode ? "video" : node.type;
    const canonicalText = isLegacyRevision
      ? String(node.data.suggestion || node.data.text || "")
      : String(node.data.text ?? node.data.prompt ?? "");
    const nextNode = {
      ...rest,
      type: canonicalType,
      data: {
        ...node.data,
        kind: isTextNode ? "textBox" : isImageGenerator ? "imageGenerator" : isVideoGenerator ? "videoGenerator" : isImageNode ? "reference" : isVideoNode ? "video" : node.data.kind,
        title: nextTitle,
        text: isTextNode ? canonicalText : node.data.text,
        prompt: isTextNode ? canonicalText : node.data.prompt,
        preview: node.data.imageData || node.data.videoData || node.data.generatedImages?.[0]?.dataUrl || node.data.generatedVideos?.[0]?.url || node.data.preview,
        provider: hasRuntime ? normalizeProvider(node.data.provider) : node.data.provider,
        skillId: hasRuntime ? normalizePromptSkill(node.data.skillId) : node.data.skillId,
        imageProvider: isImageGenerator ? normalizeImageGenerationProvider(node.data.imageProvider) : node.data.imageProvider,
        videoGenerationProvider: isVideoGenerator ? normalizeVideoGenerationProvider(node.data.videoGenerationProvider) : node.data.videoGenerationProvider,
        videoGenerationMode: isVideoGenerator ? (node.data.videoGenerationMode || "multimodal2video") : node.data.videoGenerationMode,
        videoGenerationResolution: isVideoGenerator ? (node.data.videoGenerationResolution || "720p") : node.data.videoGenerationResolution,
        resolution: isImageGenerator ? (node.data.resolution || "1K") : node.data.resolution,
        ratio: isImageGenerator ? (node.data.ratio || "Auto") : isVideoGenerator ? (node.data.ratio || "16:9") : node.data.ratio,
        source: node.data.source,
      },
    } as GraphNode;
    if (isImageGenerator) delete nextNode.data.skillId;
    return isRewrite || isImageGenerator || isVideoGenerator ? applyRewriteNodeLayout(nextNode) : nextNode;
  });
}

function curvedEdges(edges: Edge[]) {
  return edges.map((edge) => ({
    ...edge,
    targetHandle: edge.targetHandle?.replace(/^image-/, "media-") || edge.targetHandle,
    type: "disconnectable",
  }));
}

function migratePromptEditorChains(nodes: GraphNode[], edges: Edge[]) {
  const nodeType = new Map(nodes.map((node) => [node.id, node.type]));
  const removed = new Set<string>();
  const directEdges: Edge[] = [];
  for (const editorEdge of edges) {
    if (nodeType.get(editorEdge.source) !== "prompteditor" || nodeType.get(editorEdge.target) !== "textinput") continue;
    const outputEdges = edges.filter((edge) => edge.source === editorEdge.target && isOutputNodeType(nodeType.get(edge.target)));
    for (const outputEdge of outputEdges) {
      removed.add(editorEdge.id);
      removed.add(outputEdge.id);
      if (!edges.some((edge) => edge.source === editorEdge.source && edge.target === outputEdge.target)) {
        directEdges.push({
          id: `${editorEdge.id}-${outputEdge.id}-direct`,
          source: editorEdge.source,
          target: outputEdge.target,
          type: "disconnectable",
        });
      }
    }
  }
  return [...edges.filter((edge) => !removed.has(edge.id)), ...directEdges];
}

function completeCanvas(nodes: GraphNode[], edges: Edge[]) {
  const legacyTextEdges = edges.filter((edge) => edge.targetHandle === "text");
  const legacyTextByCodex = new Map<string, string[]>();
  legacyTextEdges.forEach((edge) => {
    const source = nodes.find((node) => node.id === edge.source);
    const text = nodeText(source);
    if (!text) return;
    legacyTextByCodex.set(edge.target, [...(legacyTextByCodex.get(edge.target) || []), text]);
  });

  const restored = restoredNodes(nodes)
    .filter((node) => node.id !== "text-input")
    .map((node) => {
      if (node.type !== "codex") return node;
      const inherited = legacyTextByCodex.get(node.id) || [];
      const instruction = [inherited.join("\n\n"), String(node.data.instruction || "").trim()].filter(Boolean).join("\n\n");
      return { ...node, data: { ...node.data, instruction } };
  });
  const nodeIds = new Set(restored.map((node) => node.id));
  const migratedEdges = curvedEdges(migratePromptEditorChains(restored, edges))
    .filter((edge) => edge.targetHandle !== "text")
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  return { nodes: restored, edges: migratedEdges };
}

function freshCanvas() {
  return {
    nodes: structuredClone(defaultNodes) as GraphNode[],
    edges: structuredClone(defaultEdges) as Edge[],
  };
}

function nextCanvasName(projects: CanvasProjectSummary[]) {
  const numbers = projects.map((project) => project.name.match(/^未命名画布 (\d+)$/)?.[1]).filter(Boolean).map(Number);
  return `未命名画布 ${String((numbers.length ? Math.max(...numbers) : 0) + 1).padStart(2, "0")}`;
}

function suggestedCanvasName(nodes: GraphNode[]) {
  const instruction = String(nodes.find((node) => node.type === "codex")?.data.instruction || nodes.find((node) => node.type === "imagegenerator")?.data.instruction || nodes.find((node) => node.type === "videogenerator")?.data.instruction || nodes.find((node) => node.type === "prompteditor")?.data.prompt || nodes.find((node) => node.type === "text" && node.data.text)?.data.text || "")
    .replace(/@(图片|视频)\d+/g, "")
    .replace(/^(请|帮我|制作|生成|创建)(一个|一段|一条)?/u, "")
    .trim();
  const firstSentence = instruction.split(/[。！？.!?\n]/)[0].replace(/\s+/g, " ").trim();
  if (firstSentence) return firstSentence.slice(0, 22);
  const stamp = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date());
  return `提示词画布 ${stamp}`;
}

async function projectApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BRIDGE_URL}${path}`, init);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "画布文件操作失败");
  return data;
}

async function taskApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BRIDGE_URL}${path}`, init);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "任务操作失败");
  return data;
}

function formatTaskElapsed(task: CanvasTask, now: number) {
  const start = new Date(task.startedAt || task.createdAt).getTime();
  const end = task.finishedAt ? new Date(task.finishedAt).getTime() : now;
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function taskStageIndex(stage: TaskStage) {
  if (stage === "validating") return 1;
  if (stage === "preparing_media") return 2;
  if (stage === "codex" || stage === "openrouter" || stage === "comfly" || stage === "grok-build" || stage === "antigravity" || stage === "agent" || stage === "image-generation" || stage === "video-generation") return 3;
  if (stage === "writing" || stage === "completed") return 4;
  return 0;
}

function taskProviderLabel(task: CanvasTask) {
  const provider = String(task.provider || "codex");
  if (provider in PROVIDER_LABELS) return PROVIDER_LABELS[provider as AgentProvider];
  if (provider in IMAGE_GENERATION_PROVIDER_LABELS) return IMAGE_GENERATION_PROVIDER_LABELS[provider as ImageGenerationProvider];
  if (provider in VIDEO_GENERATION_PROVIDER_LABELS) return VIDEO_GENERATION_PROVIDER_LABELS[provider as VideoGenerationProvider];
  return provider;
}

function mergeCanvasTask(current: CanvasTask | undefined, incoming: CanvasTask) {
  if (!current) return incoming;

  const currentIsTerminal = TERMINAL_TASK_STATUSES.has(current.status);
  if (currentIsTerminal) return current;
  if (current.status === "running" && incoming.status === "queued") return current;
  if (current.status === "running" && incoming.status === "running" && taskStageIndex(incoming.stage) < taskStageIndex(current.stage)) return current;

  return { ...current, ...incoming };
}

function mergeTaskLists(current: CanvasTask[], incoming: CanvasTask[]) {
  const merged = new Map(current.map((task) => [task.id, task]));
  incoming.forEach((task) => merged.set(task.id, mergeCanvasTask(merged.get(task.id), task)));
  return [...merged.values()]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20);
}

function reconcileRuntimeNodes(nodes: GraphNode[], catalogs: ProviderCatalogs) {
  let changed = false;
  const next = nodes.map((node) => {
    if (node.type !== "codex" && node.type !== "prompteditor") return node;
    let provider: AgentProvider;
    try { provider = normalizeProvider(node.data.provider); }
    catch { return node; }
    const catalog = catalogs[provider];
    if (!catalog.configured || !catalog.models.length) return node;
    const selectedModel = catalog.models.find((model) => model.model === node.data.model) || catalog.models.find((model) => model.isDefault) || catalog.models[0];
    const efforts = selectedModel.supportedReasoningEfforts || [];
    const reasoningEffort = efforts.some((option) => option.reasoningEffort === node.data.reasoningEffort)
      ? node.data.reasoningEffort
      : selectedModel.defaultReasoningEffort;
    if (node.data.provider === provider && node.data.model === selectedModel.model && node.data.reasoningEffort === reasoningEffort) return node;
    changed = true;
    const modelChanged = Boolean(node.data.model && node.data.model !== selectedModel.model);
    return {
      ...node,
      data: {
        ...node.data,
        provider,
        model: selectedModel.model,
        reasoningEffort,
        threadId: modelChanged ? undefined : node.data.threadId,
      },
    };
  });
  return changed ? next : nodes;
}

async function saveCanvasProject(id: string, name: string, nodes: GraphNode[], edges: Edge[], expectedRevision?: number) {
  return projectApi<{ project: CanvasProjectSummary }>(`/projects/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, nodes: projectNodes(nodes), edges, ...(expectedRevision ? { expectedRevision } : {}) }),
  });
}

function FlowWorkspace() {
  const [nodes, setNodes] = useState<GraphNode[]>(defaultNodes);
  const [edges, setEdges] = useState<Edge[]>(defaultEdges);
  const [hydrated, setHydrated] = useState(false);
  const [bridgeState, setBridgeState] = useState<"checking" | "ready" | "offline">("checking");
  const [providerCatalogs, setProviderCatalogs] = useState<ProviderCatalogs>({
    codex: { configured: false, loading: true, models: [] },
    openrouter: { configured: false, loading: true, models: [] },
    comfly: { configured: false, loading: true, models: [] },
    "grok-build": { configured: false, loading: true, models: [] },
    antigravity: { configured: false, loading: true, models: [] },
  });
  const [imageProviderCatalogs, setImageProviderCatalogs] = useState<ImageGenerationProviderCatalogs>({
    openrouter: { configured: false, loading: true, models: [] },
    google: { configured: false, loading: true, models: [] },
    comfly: { configured: false, loading: true, models: [] },
  });
  const [videoGenerationProviderCatalogs, setVideoGenerationProviderCatalogs] = useState<VideoGenerationProviderCatalogs>({
    openrouter: { configured: false, loading: true, models: [] },
    comfly: { configured: false, loading: true, models: [] },
    "seedance-cli": { configured: false, loading: true, models: [] },
  });
  const [skillRegistry, setSkillRegistry] = useState<SkillRegistryItem[]>(DEFAULT_SKILL_REGISTRY);
  const [tasks, setTasks] = useState<CanvasTask[]>([]);
  const [taskConcurrency, setTaskConcurrency] = useState(2);
  const [taskClock, setTaskClock] = useState(() => Date.now());
  const [taskPanelOpen, setTaskPanelOpen] = useState(() => typeof window === "undefined" ? true : window.localStorage.getItem(TASK_PANEL_STATE_KEY) !== "false");
  const [toast, setToast] = useState("连接图片或视频到改写节点的参考序号端口");
  const [projectId, setProjectId] = useState("");
  const [projectRevision, setProjectRevision] = useState(0);
  const [pendingRemoteRevision, setPendingRemoteRevision] = useState(0);
  const [projectName, setProjectName] = useState("正在载入画布…");
  const [projects, setProjects] = useState<CanvasProjectSummary[]>([]);
  const [openProjectIds, setOpenProjectIds] = useState<string[]>([]);
  const [fileManagerOpen, setFileManagerOpen] = useState(false);
  const [apiKeySettingsOpen, setApiKeySettingsOpen] = useState(false);
  const [apiKeySettingsBusy, setApiKeySettingsBusy] = useState(false);
  const [apiKeySettings, setApiKeySettings] = useState<ApiKeySettings | null>(null);
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Partial<Record<ApiKeyName, string>>>({});
  const [apiKeyCleared, setApiKeyCleared] = useState<Partial<Record<ApiKeyName, boolean>>>({});
  const [apiKeyVisible, setApiKeyVisible] = useState<Partial<Record<ApiKeyName, boolean>>>({});
  const [apiKeySettingsError, setApiKeySettingsError] = useState("");
  const [mediaSettingsOpen, setMediaSettingsOpen] = useState(false);
  const [mediaSettingsBusy, setMediaSettingsBusy] = useState(false);
  const [mediaDirectory, setMediaDirectory] = useState("");
  const [mediaDefaultDirectory, setMediaDefaultDirectory] = useState("");
  const [mediaDirectoryDraft, setMediaDirectoryDraft] = useState("");
  const [renamingId, setRenamingId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
  const [libraryOpen, setLibraryOpen] = useState(() => typeof window === "undefined" ? true : window.localStorage.getItem(LIBRARY_STATE_KEY) !== "false");
  const [themePreference, setThemePreference] = useState<ThemePreference>(storedThemePreference);
  const [lastAddedNodeId, setLastAddedNodeId] = useState("");
  const [altCopyMode, setAltCopyMode] = useState(false);
  const [groupDropTargetId, setGroupDropTargetId] = useState("");
  const [historyAvailability, setHistoryAvailability] = useState({ canUndo: false, canRedo: false });
  const suppressDirty = useRef(true);
  const providerCatalogsRef = useRef(providerCatalogs);
  const imageProviderCatalogsRef = useRef(imageProviderCatalogs);
  const videoGenerationProviderCatalogsRef = useRef(videoGenerationProviderCatalogs);
  const appliedTaskIds = useRef(new Set<string>());
  const savedTaskIds = useRef(new Set<string>());
  const canvasFileInputRef = useRef<HTMLInputElement>(null);
  const projectLoadBusy = useRef(false);
  const canvasDraftMetaRef = useRef({ projectId: "", projectName: "", projectRevision: 0 });
  const latestCanvasRef = useRef({ projectId, projectName, nodes, edges });
  const saveInFlightRef = useRef(false);
  const canvasClipboardRef = useRef<CanvasClipboardPayload | null>(null);
  const pasteCountRef = useRef(0);
  const lastPointerClientRef = useRef<{ x: number; y: number } | null>(null);
  const altDragCopyActiveRef = useRef(false);
  const groupDropTargetIdRef = useRef("");
  const altDragCopyStateRef = useRef<{
    pairs: { originalId: string; copyId: string; originalPosition: { x: number; y: number } }[];
    previewEdgeIds: string[];
  } | null>(null);
  const undoStackRef = useRef<CanvasHistorySnapshot[]>([]);
  const redoStackRef = useRef<CanvasHistorySnapshot[]>([]);
  const currentHistoryRef = useRef<CanvasHistorySnapshot | null>(null);
  const pendingHistoryRef = useRef<CanvasHistorySnapshot | null>(null);
  const historyTimerRef = useRef<number | null>(null);
  const historyWarmupUntilRef = useRef(0);
  const workspaceRef = useRef<HTMLElement>(null);
  const libraryRef = useRef<HTMLElement>(null);
  const { fitView, screenToFlowPosition } = useReactFlow();

  const refreshSkillRegistry = useCallback(async () => {
    const result = await projectApi<{ skills: SkillRegistryItem[] }>("/skills");
    setSkillRegistry(result.skills?.length ? result.skills : DEFAULT_SKILL_REGISTRY);
    return result.skills;
  }, []);

  const registerSkill = useCallback(async (path: string) => {
    const result = await projectApi<{ skill: SkillRegistryItem }>("/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    await refreshSkillRegistry();
    setToast(`已注册 Skill：${result.skill.label}`);
  }, [refreshSkillRegistry]);

  const refreshRegisteredSkill = useCallback(async (skillId: PromptSkillId) => {
    if (skillId === "none") return;
    await projectApi(`/skills/${encodeURIComponent(skillId)}`, { method: "POST" });
    await refreshSkillRegistry();
    setToast(`已刷新 Skill：${promptSkillLabel(skillId, skillRegistry)}`);
  }, [refreshSkillRegistry, skillRegistry]);

  const unregisterSkill = useCallback(async (skillId: PromptSkillId) => {
    await projectApi(`/skills/${encodeURIComponent(skillId)}`, { method: "DELETE" });
    setNodes((current) => current.map((node) => node.data.skillId === skillId ? { ...node, data: { ...node.data, skillId: "none", threadId: undefined } } : node));
    await refreshSkillRegistry();
    setToast("已取消 Skill 注册；本地文件没有被删除");
  }, [refreshSkillRegistry]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => applyThemePreference(themePreference, media.matches);
    window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    syncTheme();
    if (themePreference !== "system") return;
    media.addEventListener("change", syncTheme);
    return () => media.removeEventListener("change", syncTheme);
  }, [themePreference]);
  useEffect(() => {
    let cancelled = false;
    projectApi<{ skills: SkillRegistryItem[] }>("/skills")
      .then((result) => {
        if (!cancelled) setSkillRegistry(result.skills?.length ? result.skills : DEFAULT_SKILL_REGISTRY);
      })
      .catch((error) => {
        if (!cancelled) setToast(error instanceof Error ? error.message : "无法读取 Skill 列表");
      });
    return () => { cancelled = true; };
  }, []);
  const finishAltDragCopy = useCallback((draggedNode?: GraphNode) => {
    const copyState = altDragCopyStateRef.current;
    if (!copyState) {
      altDragCopyActiveRef.current = false;
      return;
    }
    altDragCopyStateRef.current = null;
    altDragCopyActiveRef.current = false;
    const pairByOriginal = new Map(copyState.pairs.map((pair) => [pair.originalId, pair]));
    const pairByCopy = new Map(copyState.pairs.map((pair) => [pair.copyId, pair]));
    setNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node]));
      const copiedIds = new Set(copyState.pairs.map((pair) => pair.copyId));
      const finalPositions = new Map(copyState.pairs.map((pair) => {
        const movedNode = draggedNode?.id === pair.originalId ? draggedNode : currentById.get(pair.originalId);
        return [pair.originalId, movedNode ? { ...movedNode.position } : { ...pair.originalPosition }];
      }));
      return current.map((node) => {
        const originalPair = pairByOriginal.get(node.id);
        if (originalPair) return { ...node, position: { ...originalPair.originalPosition }, selected: false, dragging: false };
        const copyPair = pairByCopy.get(node.id);
        if (copyPair) return { ...node, position: finalPositions.get(copyPair.originalId) || node.position, selected: !node.parentId || !copiedIds.has(node.parentId), dragging: false };
        return node.selected ? { ...node, selected: false } : node;
      });
    });
    const copyToOriginalId = new Map(copyState.pairs.map((pair) => [pair.copyId, pair.originalId]));
    const originalToCopyId = new Map(copyState.pairs.map((pair) => [pair.originalId, pair.copyId]));
    const previewEdgeIds = new Set(copyState.previewEdgeIds);
    setEdges((current) => current.map((edge) => previewEdgeIds.has(edge.id)
      ? {
          ...edge,
          source: originalToCopyId.get(edge.source) || edge.source,
          target: originalToCopyId.get(edge.target) || edge.target,
          selected: false,
        }
      : {
          ...edge,
          source: copyToOriginalId.get(edge.source) || edge.source,
          target: copyToOriginalId.get(edge.target) || edge.target,
        }));
    setLastAddedNodeId(copyState.pairs[0]?.copyId || "");
    setToast(copyState.previewEdgeIds.length
      ? `已复制 ${copyState.pairs.length} 个节点及 ${copyState.previewEdgeIds.length} 条内部连线，原内容保持原位`
      : `已复制 ${copyState.pairs.length} 个独立节点，原节点和连线保持原位`);
  }, []);
  const providerOptions = useMemo<ProviderRuntimeOption[]>(() => PROVIDERS.map((provider) => ({
    provider,
    label: PROVIDER_LABELS[provider],
    ...providerCatalogs[provider],
  })), [providerCatalogs]);
  const imageProviderOptions = useMemo<ImageGenerationProviderOption[]>(() => IMAGE_GENERATION_PROVIDER_IDS.map((provider) => ({
    provider,
    label: IMAGE_GENERATION_PROVIDER_LABELS[provider],
    ...imageProviderCatalogs[provider],
  })), [imageProviderCatalogs]);
  const videoGenerationProviderOptions = useMemo<VideoGenerationProviderOption[]>(() => VIDEO_GENERATION_PROVIDER_IDS.map((provider) => ({
    provider,
    label: VIDEO_GENERATION_PROVIDER_LABELS[provider],
    ...videoGenerationProviderCatalogs[provider],
  })), [videoGenerationProviderCatalogs]);

  const refreshHistoryAvailability = useCallback(() => {
    const next = {
      canUndo: undoStackRef.current.length > 0 || Boolean(pendingHistoryRef.current),
      canRedo: redoStackRef.current.length > 0,
    };
    setHistoryAvailability((current) => current.canUndo === next.canUndo && current.canRedo === next.canRedo ? current : next);
  }, []);

  const commitPendingHistory = useCallback(() => {
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
    const next = pendingHistoryRef.current;
    pendingHistoryRef.current = null;
    const current = currentHistoryRef.current;
    if (!next || !current || sameCanvasHistorySnapshot(current, next)) return;
    undoStackRef.current = [...undoStackRef.current.slice(-(MAX_HISTORY_ENTRIES - 1)), current];
    redoStackRef.current = [];
    currentHistoryRef.current = next;
    refreshHistoryAvailability();
  }, [refreshHistoryAvailability]);

  const applyHistorySnapshot = useCallback((snapshot: CanvasHistorySnapshot) => {
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
    pendingHistoryRef.current = null;
    const restoredNodes = snapshot.nodes.map((node) => copyableNode(node, node.id, node.position, false));
    const restoredEdges = snapshot.edges.map((edge) => ({ ...edge, selected: false }));
    currentHistoryRef.current = canvasHistorySnapshot(projectId, restoredNodes, restoredEdges);
    setNodes(restoredNodes);
    setEdges(restoredEdges);
    refreshHistoryAvailability();
  }, [projectId, refreshHistoryAvailability]);

  const undoCanvas = useCallback(() => {
    commitPendingHistory();
    const previous = undoStackRef.current.pop();
    const current = currentHistoryRef.current;
    if (!previous || !current) {
      setToast("没有可撤销的画布操作");
      return;
    }
    redoStackRef.current = [...redoStackRef.current.slice(-(MAX_HISTORY_ENTRIES - 1)), current];
    applyHistorySnapshot(previous);
    setToast("已撤销上一步画布操作");
  }, [applyHistorySnapshot, commitPendingHistory]);

  const redoCanvas = useCallback(() => {
    commitPendingHistory();
    const next = redoStackRef.current.pop();
    const current = currentHistoryRef.current;
    if (!next || !current) {
      setToast("没有可重做的画布操作");
      return;
    }
    undoStackRef.current = [...undoStackRef.current.slice(-(MAX_HISTORY_ENTRIES - 1)), current];
    applyHistorySnapshot(next);
    setToast("已重做上一步画布操作");
  }, [applyHistorySnapshot, commitPendingHistory]);

  useEffect(() => {
    if (!hydrated || !projectId) return;
    const next = canvasHistorySnapshot(projectId, nodes, edges);
    const current = currentHistoryRef.current;
    if (!current || current.projectId !== projectId) {
      if (historyTimerRef.current !== null) window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
      pendingHistoryRef.current = null;
      currentHistoryRef.current = next;
      undoStackRef.current = [];
      redoStackRef.current = [];
      historyWarmupUntilRef.current = Date.now() + 1200;
      refreshHistoryAvailability();
      return;
    }
    if (Date.now() < historyWarmupUntilRef.current) {
      if (historyTimerRef.current !== null) window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
      pendingHistoryRef.current = null;
      currentHistoryRef.current = next;
      undoStackRef.current = [];
      redoStackRef.current = [];
      refreshHistoryAvailability();
      return;
    }
    if (sameCanvasHistorySnapshot(current, next)) return;
    pendingHistoryRef.current = next;
    refreshHistoryAvailability();
    if (historyTimerRef.current !== null) window.clearTimeout(historyTimerRef.current);
    historyTimerRef.current = window.setTimeout(commitPendingHistory, 240);
    return () => {
      if (historyTimerRef.current !== null) {
        window.clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }
    };
  }, [commitPendingHistory, edges, hydrated, nodes, projectId, refreshHistoryAvailability]);

  const groupSelectedNodes = useCallback(() => {
    const selectedNodes = nodes.filter((node) => node.selected);
    const selectedGroups = selectedNodes.filter((node) => node.type === "group");
    if (selectedGroups.length === 1) {
      const groupId = selectedGroups[0].id;
      const candidates = selectedNodes.filter((node) => node.type !== "group" && !node.parentId);
      const foreignMembers = selectedNodes.filter((node) => node.parentId && node.parentId !== groupId);
      if (foreignMembers.length) {
        setToast("不能把其他群组的成员直接加入当前群组，请先将它们移出");
        return;
      }
      if (!candidates.length) {
        setToast("请同时选中一个群组和至少一个未编组节点");
        return;
      }
      setNodes((current) => addNodesToExistingGroup(current, groupId, candidates.map((node) => node.id)));
      setEdges((current) => current.map((edge) => edge.selected ? { ...edge, selected: false } : edge));
      setToast(`已将 ${candidates.length} 个节点加入「${String(selectedGroups[0].data.title || "群组")}」`);
      return;
    }
    if (selectedGroups.length > 1) {
      setToast("一次只能向一个现有群组添加节点");
      return;
    }
    if (selectedNodes.length < 2) {
      setToast("请先选择至少 2 个节点再编组");
      return;
    }
    if (selectedNodes.some((node) => node.type === "group" || node.parentId)) {
      setToast("暂不支持嵌套编组，请先用 Ctrl/Cmd + Backspace 解组");
      return;
    }
    if (nodes.length >= MAX_PORTABLE_NODES) {
      setToast(`编组后会超过画布 ${MAX_PORTABLE_NODES} 个节点的上限`);
      return;
    }

    const selectedIds = new Set(selectedNodes.map((node) => node.id));
    const bounds = selectedNodes.map((node) => ({ node, ...nodeVisualSize(node) }));
    const minX = Math.min(...bounds.map(({ node }) => node.position.x));
    const minY = Math.min(...bounds.map(({ node }) => node.position.y));
    const maxX = Math.max(...bounds.map(({ node, width }) => node.position.x + width));
    const maxY = Math.max(...bounds.map(({ node, height }) => node.position.y + height));
    const groupId = `group-${crypto.randomUUID().slice(0, 8)}`;
    const groupPosition = { x: minX - GROUP_PADDING_X, y: minY - GROUP_PADDING_TOP };
    const groupNode: GraphNode = {
      id: groupId,
      type: "group",
      position: groupPosition,
      selected: true,
      style: {
        width: maxX - minX + GROUP_PADDING_X * 2,
        height: maxY - minY + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM,
      },
      data: { kind: "group", title: "群组", memberCount: selectedNodes.length },
    };

    setNodes((current) => [
      groupNode,
      ...current.map((node) => selectedIds.has(node.id)
        ? {
            ...node,
            parentId: groupId,
            extent: "parent" as const,
            expandParent: true,
            position: { x: node.position.x - groupPosition.x, y: node.position.y - groupPosition.y },
            selected: false,
          }
        : node.selected ? { ...node, selected: false } : node),
    ]);
    setEdges((current) => current.map((edge) => edge.selected ? { ...edge, selected: false } : edge));
    setLastAddedNodeId(groupId);
    setToast(`已将 ${selectedNodes.length} 个节点编为一组，拖动浅色外框可整体移动`);
  }, [nodes]);

  const removeSelectedGroupMembers = useCallback(() => {
    const memberIds = nodes.filter((node) => node.selected && node.parentId).map((node) => node.id);
    if (!memberIds.length) {
      setToast("请先选中需要移出群组的成员节点");
      return;
    }
    setNodes((current) => removeNodesFromGroups(current, memberIds));
    setToast(`已将 ${memberIds.length} 个节点移出群组，连线保持不变`);
  }, [nodes]);

  const ungroupSelectedNodes = useCallback(() => {
    const groupIds = new Set<string>();
    nodes.forEach((node) => {
      if (node.selected && node.type === "group") groupIds.add(node.id);
      if (node.selected && node.parentId) groupIds.add(node.parentId);
    });
    if (!groupIds.size) {
      setToast("请先选中群组外框或组内节点再解组");
      return;
    }

    setNodes((current) => {
      const groups = new Map(current.filter((node) => groupIds.has(node.id)).map((node) => [node.id, node]));
      return current.flatMap((node) => {
        if (groupIds.has(node.id)) return [];
        if (node.parentId && groupIds.has(node.parentId)) {
          const parent = groups.get(node.parentId);
          if (!parent) return [detachNodeFromGroup(node, absoluteNodePosition(node, current))];
          return [{
            ...detachNodeFromGroup(node, {
              x: parent.position.x + node.position.x,
              y: parent.position.y + node.position.y,
            }),
            selected: true,
          }];
        }
        return [node.selected ? { ...node, selected: false } : node];
      });
    });
    setToast(`已打散 ${groupIds.size} 个群组，节点与连线均已保留`);
  }, [nodes]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Alt") setAltCopyMode(true);
      if (fileManagerOpen || apiKeySettingsOpen || mediaSettingsOpen || isEditableTarget(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redoCanvas();
        else undoCanvas();
        return;
      }
      if (modifier && key === "y") {
        event.preventDefault();
        redoCanvas();
        return;
      }
      const target = event.target as HTMLElement | null;
      const canvasContext = !target || target === document.body || Boolean(target.closest(".flow-canvas"));
      if (!canvasContext) return;

      if (modifier && event.shiftKey && key === "g") {
        event.preventDefault();
        removeSelectedGroupMembers();
        return;
      }

      if (modifier && key === "g") {
        event.preventDefault();
        groupSelectedNodes();
        return;
      }

      if (modifier && event.key === "Backspace") {
        event.preventDefault();
        ungroupSelectedNodes();
        return;
      }

      if (modifier && key === "c") {
        const copiedNodes = clipboardSelectionNodes(nodes);
        if (!copiedNodes.length) return;
        const copiedEdges = clipboardSelectionEdges(edges, copiedNodes);
        canvasClipboardRef.current = {
          projectId,
          nodes: copiedNodes,
          edges: copiedEdges,
        };
        pasteCountRef.current = 0;
        event.preventDefault();
        const groupCount = copiedNodes.filter((node) => node.type === "group").length;
        const edgeSummary = copiedNodes.length === 1
          ? "，单节点不复制连线"
          : `，已包含 ${copiedEdges.length} 条内部连线`;
        setToast(groupCount
          ? `已复制 ${groupCount} 个群组及其 ${copiedNodes.length - groupCount} 个节点${edgeSummary}`
          : `已复制 ${copiedNodes.length} 个节点${edgeSummary}`);
        return;
      }

      if (modifier && key === "v") {
        const selectedNodes = nodes.filter((node) => node.selected);
        if (selectedNodes.length === 1 && selectedNodes[0].type === "reference") return;
        const clipboard = canvasClipboardRef.current;
        if (!clipboard?.nodes.length) return;
        event.preventDefault();
        if (clipboard.projectId !== projectId) {
          setToast("节点剪贴板属于另一个画布，请在当前画布重新复制");
          return;
        }
        if (nodes.length + clipboard.nodes.length > MAX_PORTABLE_NODES) {
          setToast(`粘贴后会超过画布 ${MAX_PORTABLE_NODES} 个节点的上限`);
          return;
        }
        pasteCountRef.current += 1;
        const rootNodes = clipboard.nodes.filter((node) => !node.parentId || !clipboard.nodes.some((parent) => parent.id === node.parentId));
        const minX = Math.min(...rootNodes.map((node) => node.position.x));
        const minY = Math.min(...rootNodes.map((node) => node.position.y));
        const pointer = lastPointerClientRef.current ? screenToFlowPosition(lastPointerClientRef.current) : null;
        const cascade = pasteCountRef.current * 22;
        const offsetX = pointer ? pointer.x - minX + cascade : cascade;
        const offsetY = pointer ? pointer.y - minY + cascade : cascade;
        const idMap = clipboardNodeIdMap(clipboard.nodes);
        const pastedNodes = pasteClipboardNodes(clipboard.nodes, { x: offsetX, y: offsetY }, idMap);
        const pastedEdges = pasteClipboardEdges(clipboard.edges || [], idMap);
        setNodes((current) => [...current.map((node) => node.selected ? { ...node, selected: false } : node), ...pastedNodes]);
        setEdges((current) => [...current.map((edge) => edge.selected ? { ...edge, selected: false } : edge), ...pastedEdges]);
        setLastAddedNodeId(pastedNodes[0]?.id || "");
        const pastedGroupCount = pastedNodes.filter((node) => node.type === "group").length;
        setToast(pastedGroupCount
          ? `已粘贴 ${pastedGroupCount} 个独立群组及 ${pastedEdges.length} 条内部连线`
          : pastedNodes.length === 1
            ? "已粘贴 1 个独立节点，不包含连线"
            : `已粘贴 ${pastedNodes.length} 个独立节点及 ${pastedEdges.length} 条内部连线`);
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const selectedNodeIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
      const selectedEdgeIds = new Set(edges.filter((edge) => edge.selected).map((edge) => edge.id));
      if (!selectedNodeIds.size && !selectedEdgeIds.size) return;
      event.preventDefault();
      const selectedGroupIds = new Set(nodes.filter((node) => node.selected && node.type === "group").map((node) => node.id));
      nodes.forEach((node) => { if (node.parentId && selectedGroupIds.has(node.parentId)) selectedNodeIds.add(node.id); });
      if (selectedNodeIds.size) {
        setNodes((current) => {
          const remaining = current.filter((node) => !selectedNodeIds.has(node.id));
          const populatedGroupIds = new Set(remaining.map((node) => node.parentId).filter((id): id is string => Boolean(id)));
          return remaining.filter((node) => node.type !== "group" || populatedGroupIds.has(node.id));
        });
      }
      setEdges((current) => current.filter((edge) => !selectedEdgeIds.has(edge.id) && !selectedNodeIds.has(edge.source) && !selectedNodeIds.has(edge.target)));
      setToast(selectedNodeIds.size
        ? selectedGroupIds.size
          ? `已删除 ${selectedGroupIds.size} 个群组及其中的 ${selectedNodeIds.size - selectedGroupIds.size} 个节点，可用 Ctrl/Cmd + Z 撤销`
          : `已删除 ${selectedNodeIds.size} 个节点及其连线`
        : `已断开 ${selectedEdgeIds.size} 条连接`);
    };
    const handleKeyUp = (event: KeyboardEvent) => { if (event.key === "Alt") setAltCopyMode(false); };
    const handleBlur = () => {
      setAltCopyMode(false);
      finishAltDragCopy();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [apiKeySettingsOpen, edges, fileManagerOpen, finishAltDragCopy, groupSelectedNodes, mediaSettingsOpen, nodes, projectId, redoCanvas, removeSelectedGroupMembers, screenToFlowPosition, undoCanvas, ungroupSelectedNodes]);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add({ reduceMotion: "(prefers-reduced-motion: reduce)" }, (context) => {
      const duration = context.conditions?.reduceMotion ? 0 : 0.28;
      gsap.from(".node-topbar", { y: -8, autoAlpha: 0, duration, ease: "power2.out" });
      gsap.from(".node-library", { x: -12, autoAlpha: 0, duration, ease: "power2.out" });
      gsap.from(".palette-card", { y: 5, autoAlpha: 0, duration, stagger: 0.025, ease: "power2.out" });
    });
    return () => media.revert();
  }, { scope: workspaceRef });

  useGSAP(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    gsap.to(workspaceRef.current, {
      "--sidebar-width": libraryOpen ? "248px" : "52px",
      duration: reduceMotion ? 0 : 0.22,
      ease: "power2.out",
      overwrite: "auto",
    });
    const libraryParts = libraryRef.current?.querySelectorAll(".node-library-copy, .node-library-grid, .node-library-foot");
    gsap.to(libraryParts || [], {
      autoAlpha: libraryOpen ? 1 : 0,
      duration: reduceMotion ? 0 : 0.14,
      ease: "power1.out",
      overwrite: "auto",
    });
  }, { dependencies: [libraryOpen], scope: workspaceRef });

  useGSAP(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    gsap.to(workspaceRef.current, {
      "--task-panel-width": taskPanelOpen ? "332px" : "48px",
      duration: reduceMotion ? 0 : 0.22,
      ease: "power2.out",
      overwrite: "auto",
    });
    const taskParts = workspaceRef.current?.querySelectorAll(".task-center-copy, .task-center-summary, .task-list, .task-center-foot");
    gsap.to(taskParts || [], {
      autoAlpha: taskPanelOpen ? 1 : 0,
      duration: reduceMotion ? 0 : 0.14,
      ease: "power1.out",
      overwrite: "auto",
    });
  }, { dependencies: [taskPanelOpen], scope: workspaceRef });

  useGSAP(() => {
    if (!lastAddedNodeId) return;
    const target = workspaceRef.current?.querySelector(`[data-id="${lastAddedNodeId}"] .core-node`);
    if (!target) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    gsap.fromTo(target, { y: reduceMotion ? 0 : 8, scale: reduceMotion ? 1 : 0.98, autoAlpha: 0 }, {
      y: 0,
      scale: 1,
      autoAlpha: 1,
      duration: reduceMotion ? 0 : 0.22,
      ease: "power2.out",
      clearProps: "transform,opacity,visibility",
    });
  }, { dependencies: [lastAddedNodeId], scope: workspaceRef });

  const toggleLibrary = useCallback(() => {
    setLibraryOpen((current) => {
      const next = !current;
      window.localStorage.setItem(LIBRARY_STATE_KEY, String(next));
      return next;
    });
  }, []);

  const toggleTaskPanel = useCallback(() => {
    setTaskPanelOpen((current) => {
      const next = !current;
      window.localStorage.setItem(TASK_PANEL_STATE_KEY, String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    projectApi<MediaOutputSettings>("/media-settings")
      .then((settings) => {
        if (cancelled) return;
        setMediaDirectory(settings.directory);
        setMediaDefaultDirectory(settings.defaultDirectory);
        setMediaDirectoryDraft(settings.directory);
      })
      .catch((error) => {
        if (!cancelled) setToast(error instanceof Error ? error.message : "无法读取媒体保存目录");
      });
    return () => { cancelled = true; };
  }, []);

  const openMediaSettings = useCallback(() => {
    setMediaDirectoryDraft(mediaDirectory || mediaDefaultDirectory);
    setMediaSettingsOpen(true);
  }, [mediaDefaultDirectory, mediaDirectory]);

  const saveMediaSettings = useCallback(async () => {
    const directory = mediaDirectoryDraft.trim();
    if (!directory || mediaSettingsBusy) return;
    setMediaSettingsBusy(true);
    try {
      const settings = await projectApi<MediaOutputSettings>("/media-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory }),
      });
      setMediaDirectory(settings.directory);
      setMediaDefaultDirectory(settings.defaultDirectory);
      setMediaDirectoryDraft(settings.directory);
      setMediaSettingsOpen(false);
      setToast(`生成结果将自动保存到：${settings.directory}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "保存媒体目录失败");
    } finally {
      setMediaSettingsBusy(false);
    }
  }, [mediaDirectoryDraft, mediaSettingsBusy]);

  const refreshApiKeyProviderCatalogs = useCallback(async () => {
    await Promise.all([
      ...(["openrouter", "comfly"] as AgentProvider[]).map(async (provider) => {
        try {
          const result = await projectApi<ModelCatalogResponse>(`/models?provider=${provider}`);
          const configured = (result.provider === undefined || result.provider === provider) && Boolean(result.configured);
          const nextCatalogs: ProviderCatalogs = {
            ...providerCatalogsRef.current,
            [provider]: {
              configured,
              loading: false,
              models: configured ? result.models || [] : [],
              message: result.message || (!configured ? `${PROVIDER_LABELS[provider]} 尚未配置` : undefined),
            },
          };
          providerCatalogsRef.current = nextCatalogs;
          setProviderCatalogs(nextCatalogs);
          setNodes((current) => reconcileRuntimeNodes(current, nextCatalogs));
        } catch (error) {
          const nextCatalogs: ProviderCatalogs = {
            ...providerCatalogsRef.current,
            [provider]: { configured: false, loading: false, models: [], message: error instanceof Error ? error.message : `无法刷新 ${PROVIDER_LABELS[provider]}` },
          };
          providerCatalogsRef.current = nextCatalogs;
          setProviderCatalogs(nextCatalogs);
        }
      }),
      ...IMAGE_GENERATION_PROVIDER_IDS.map(async (provider) => {
        try {
          const result = await projectApi<ImageGenerationModelCatalogResponse>(`/image-models?provider=${provider}`);
          const configured = result.provider === provider && result.configured;
          const nextCatalogs: ImageGenerationProviderCatalogs = {
            ...imageProviderCatalogsRef.current,
            [provider]: { configured, loading: false, models: configured ? result.models || [] : [], message: result.message },
          };
          imageProviderCatalogsRef.current = nextCatalogs;
          setImageProviderCatalogs(nextCatalogs);
        } catch (error) {
          const nextCatalogs: ImageGenerationProviderCatalogs = {
            ...imageProviderCatalogsRef.current,
            [provider]: { configured: false, loading: false, models: [], message: error instanceof Error ? error.message : `无法刷新 ${IMAGE_GENERATION_PROVIDER_LABELS[provider]}` },
          };
          imageProviderCatalogsRef.current = nextCatalogs;
          setImageProviderCatalogs(nextCatalogs);
        }
      }),
      ...(["openrouter", "comfly"] as VideoGenerationProvider[]).map(async (provider) => {
        try {
          const result = await projectApi<VideoGenerationModelCatalogResponse>(`/video-models?provider=${provider}`);
          const configured = result.provider === provider && result.configured;
          const nextCatalogs: VideoGenerationProviderCatalogs = {
            ...videoGenerationProviderCatalogsRef.current,
            [provider]: { configured, loading: false, models: configured ? result.models || [] : [], message: result.message },
          };
          videoGenerationProviderCatalogsRef.current = nextCatalogs;
          setVideoGenerationProviderCatalogs(nextCatalogs);
        } catch (error) {
          const nextCatalogs: VideoGenerationProviderCatalogs = {
            ...videoGenerationProviderCatalogsRef.current,
            [provider]: { configured: false, loading: false, models: [], message: error instanceof Error ? error.message : `无法刷新 ${VIDEO_GENERATION_PROVIDER_LABELS[provider]}` },
          };
          videoGenerationProviderCatalogsRef.current = nextCatalogs;
          setVideoGenerationProviderCatalogs(nextCatalogs);
        }
      }),
    ]);
  }, []);

  const openApiKeySettings = useCallback(async () => {
    setApiKeySettingsOpen(true);
    setApiKeySettingsBusy(true);
    setApiKeySettingsError("");
    setApiKeyDrafts({});
    setApiKeyCleared({});
    setApiKeyVisible({});
    try {
      setApiKeySettings(await projectApi<ApiKeySettings>("/api-key-settings"));
    } catch (error) {
      setApiKeySettingsError(error instanceof Error ? error.message : "无法读取 API 密钥配置");
    } finally {
      setApiKeySettingsBusy(false);
    }
  }, []);

  const saveApiKeySettings = useCallback(async () => {
    if (apiKeySettingsBusy) return;
    const changes: Partial<Record<ApiKeyName, string | null>> = {};
    API_KEY_FIELDS.forEach(({ name }) => {
      const value = apiKeyDrafts[name]?.trim();
      if (value) changes[name] = value;
      else if (apiKeyCleared[name]) changes[name] = null;
    });
    if (!Object.keys(changes).length) {
      setApiKeySettingsOpen(false);
      setToast("API 密钥没有修改");
      return;
    }
    setApiKeySettingsBusy(true);
    setApiKeySettingsError("");
    try {
      const settings = await projectApi<ApiKeySettings>("/api-key-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      setApiKeySettings(settings);
      setApiKeyDrafts({});
      setApiKeyCleared({});
      await refreshApiKeyProviderCatalogs();
      setApiKeySettingsOpen(false);
      setToast(`API 密钥已保存到 ${settings.envFile}，渠道状态已刷新`);
    } catch (error) {
      setApiKeySettingsError(error instanceof Error ? error.message : "保存 API 密钥失败");
    } finally {
      setApiKeySettingsBusy(false);
    }
  }, [apiKeyCleared, apiKeyDrafts, apiKeySettingsBusy, refreshApiKeyProviderCatalogs]);

  useEffect(() => {
    if (!tasks.some((task) => ACTIVE_TASK_STATUSES.has(task.status))) return;
    const timer = window.setInterval(() => setTaskClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [tasks]);

  useEffect(() => {
    let cancelled = false;
    async function initializeWorkspace() {
      let initial = freshCanvas();
      let storedDraft: ReturnType<typeof parseCanvasDraft> = null;
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        storedDraft = parseCanvasDraft(stored);
        if (storedDraft?.nodes?.length && storedDraft.edges) {
          initial = completeCanvas(storedDraft.nodes as GraphNode[], storedDraft.edges as Edge[]);
        }
      } catch { setToast("旧画布记录无法读取，已载入默认流程"); }

      try {
        const listed = await projectApi<{ projects: CanvasProjectSummary[] }>("/projects");
        const activeId = window.localStorage.getItem(ACTIVE_PROJECT_KEY);
        const active = listed.projects.find((project) => project.id === activeId) || listed.projects[0];
        let project: CanvasProject;
        let summaries = listed.projects;
        if (active) {
          project = await projectApi<CanvasProject>(`/projects/${active.id}`);
        } else {
          const id = crypto.randomUUID();
          const name = nextCanvasName(summaries);
          const saved = await saveCanvasProject(id, name, initial.nodes, initial.edges);
          project = { id, name, revision: saved.project.revision, createdAt: saved.project.createdAt, updatedAt: saved.project.updatedAt, ...initial };
          summaries = [saved.project];
        }
        if (cancelled) return;
        const restoreDraft = Boolean(storedDraft?.dirty && (!storedDraft.projectId || storedDraft.projectId === project.id));
        const restoredGraph = restoreDraft ? mergeCanvasDraft(project, storedDraft) : project;
        suppressDirty.current = !restoreDraft;
        const completed = completeCanvas(restoredGraph.nodes as GraphNode[], restoredGraph.edges as Edge[]);
        setNodes(reconcileRuntimeNodes(completed.nodes, providerCatalogsRef.current));
        setEdges(completed.edges);
        setProjectId(project.id);
        setProjectRevision(restoreDraft ? storedDraft?.baseRevision || project.revision || 1 : project.revision || 1);
        setProjectName(restoreDraft && storedDraft?.projectName ? storedDraft.projectName : project.name);
        setProjects(summaries);
        let storedOpenIds: string[] = [];
        try {
          const parsedOpenIds = JSON.parse(window.localStorage.getItem(OPEN_PROJECTS_KEY) || "[]") as unknown;
          if (Array.isArray(parsedOpenIds)) storedOpenIds = parsedOpenIds.filter((id): id is string => typeof id === "string");
        } catch { /* Invalid tab preferences are ignored. */ }
        const validIds = new Set(summaries.map((summary) => summary.id));
        setOpenProjectIds([...new Set([...storedOpenIds.filter((id) => validIds.has(id)), project.id])]);
        setSaveState(restoreDraft ? "unsaved" : "saved");
        window.localStorage.setItem(ACTIVE_PROJECT_KEY, project.id);
        setToast(restoreDraft ? `已恢复「${project.name}」未保存的本地草稿` : `已打开「${project.name}」`);
      } catch (error) {
        if (cancelled) return;
        suppressDirty.current = false;
        setNodes(reconcileRuntimeNodes(initial.nodes, providerCatalogsRef.current));
        setEdges(initial.edges);
        setProjectName("本地临时画布");
        setSaveState("error");
        setToast(error instanceof Error ? `${error.message}，当前使用临时画布` : "文件系统暂不可用");
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }
    initializeWorkspace();
    fetch(`${BRIDGE_URL}/health`).then((response) => {
      if (!response.ok) throw new Error();
      setBridgeState("ready");
    }).catch(() => setBridgeState("offline"));
    PROVIDERS.forEach((provider) => {
      projectApi<ModelCatalogResponse>(`/models?provider=${provider}`)
        .then((result) => {
          if (cancelled) return;
          const isLegacyResponse = result.provider === undefined && result.configured === undefined;
          const responseMatchesProvider = result.provider === undefined || result.provider === provider;
          const configured = responseMatchesProvider && (result.configured ?? (provider === "codex" && isLegacyResponse));
          const nextCatalogs: ProviderCatalogs = {
            ...providerCatalogsRef.current,
            [provider]: {
              configured,
              loading: false,
              models: configured ? result.models || [] : [],
              message: !responseMatchesProvider
                ? `模型服务返回了不匹配的供应商：${String(result.provider)}`
                : result.message || (!configured ? `${PROVIDER_LABELS[provider]} 尚未配置` : undefined),
            },
          };
          providerCatalogsRef.current = nextCatalogs;
          setProviderCatalogs(nextCatalogs);
          setNodes((current) => reconcileRuntimeNodes(current, nextCatalogs));
        })
        .catch((error) => {
          if (cancelled) return;
          const nextCatalogs: ProviderCatalogs = {
            ...providerCatalogsRef.current,
            [provider]: {
              configured: false,
              loading: false,
              models: [],
              message: error instanceof Error ? error.message : `无法读取 ${PROVIDER_LABELS[provider]} 模型列表`,
            },
          };
          providerCatalogsRef.current = nextCatalogs;
          setProviderCatalogs(nextCatalogs);
        });
    });
    IMAGE_GENERATION_PROVIDER_IDS.forEach((provider) => {
      projectApi<ImageGenerationModelCatalogResponse>(`/image-models?provider=${provider}`)
        .then((result) => {
          if (cancelled) return;
          const responseMatchesProvider = result.provider === provider;
          const configured = responseMatchesProvider && result.configured;
          const nextCatalogs: ImageGenerationProviderCatalogs = {
            ...imageProviderCatalogsRef.current,
            [provider]: {
              configured,
              loading: false,
              models: configured ? result.models || [] : [],
              message: !responseMatchesProvider
                ? `图片模型服务返回了不匹配的供应商：${String(result.provider)}`
                : result.message || (!configured ? `${IMAGE_GENERATION_PROVIDER_LABELS[provider]} 尚未配置` : undefined),
            },
          };
          imageProviderCatalogsRef.current = nextCatalogs;
          setImageProviderCatalogs(nextCatalogs);
        })
        .catch((error) => {
          if (cancelled) return;
          const nextCatalogs: ImageGenerationProviderCatalogs = {
            ...imageProviderCatalogsRef.current,
            [provider]: {
              configured: false,
              loading: false,
              models: [],
              message: error instanceof Error ? error.message : `无法读取 ${IMAGE_GENERATION_PROVIDER_LABELS[provider]} 图片模型`,
            },
          };
          imageProviderCatalogsRef.current = nextCatalogs;
          setImageProviderCatalogs(nextCatalogs);
        });
    });
    VIDEO_GENERATION_PROVIDER_IDS.forEach((provider) => {
      projectApi<VideoGenerationModelCatalogResponse>(`/video-models?provider=${provider}`)
        .then((result) => {
          if (cancelled) return;
          const responseMatchesProvider = result.provider === provider;
          const configured = responseMatchesProvider && result.configured;
          const nextCatalogs: VideoGenerationProviderCatalogs = {
            ...videoGenerationProviderCatalogsRef.current,
            [provider]: {
              configured,
              loading: false,
              models: configured ? result.models || [] : [],
              message: !responseMatchesProvider
                ? `视频模型服务返回了不匹配的供应商：${String(result.provider)}`
                : result.message || (!configured ? `${VIDEO_GENERATION_PROVIDER_LABELS[provider]} 尚未配置` : undefined),
            },
          };
          videoGenerationProviderCatalogsRef.current = nextCatalogs;
          setVideoGenerationProviderCatalogs(nextCatalogs);
        })
        .catch((error) => {
          if (cancelled) return;
          const nextCatalogs: VideoGenerationProviderCatalogs = {
            ...videoGenerationProviderCatalogsRef.current,
            [provider]: {
              configured: false,
              loading: false,
              models: [],
              message: error instanceof Error ? error.message : `无法读取 ${VIDEO_GENERATION_PROVIDER_LABELS[provider]} 视频模型`,
            },
          };
          videoGenerationProviderCatalogsRef.current = nextCatalogs;
          setVideoGenerationProviderCatalogs(nextCatalogs);
        });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    canvasDraftMetaRef.current = { projectId, projectName, projectRevision };
  }, [projectId, projectName, projectRevision]);

  useEffect(() => {
    latestCanvasRef.current = { projectId, projectName, nodes, edges };
  }, [projectId, projectName, nodes, edges]);

  useEffect(() => {
    if (!hydrated) return;
    const programmaticUpdate = suppressDirty.current;
    if (programmaticUpdate) suppressDirty.current = false;
    else setSaveState("unsaved");
    const timer = window.setTimeout(() => {
      const metadata = canvasDraftMetaRef.current;
      const snapshot = JSON.stringify(createCanvasDraft({
        projectId: metadata.projectId,
        projectName: metadata.projectName,
        baseRevision: metadata.projectRevision,
        dirty: !programmaticUpdate,
        nodes: cleanNodes(nodes),
        edges,
      }));
      try {
        window.localStorage.setItem(STORAGE_KEY, snapshot);
      } catch (error) {
        if (!(error instanceof DOMException) || (error.name !== "QuotaExceededError" && error.name !== "NS_ERROR_DOM_QUOTA_REACHED")) return;
        try {
          window.localStorage.removeItem(STORAGE_KEY);
          window.localStorage.setItem(STORAGE_KEY, snapshot);
          setToast("已清理旧的媒体草稿缓存；图片和视频只保存到输出目录");
        } catch {
          setToast("浏览器本地草稿空间不足，请先保存当前画布");
        }
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [nodes, edges, hydrated]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (saveState === "saved") return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [saveState]);

  useEffect(() => {
    if (!hydrated || !openProjectIds.length) return;
    window.localStorage.setItem(OPEN_PROJECTS_KEY, JSON.stringify(openProjectIds));
  }, [hydrated, openProjectIds]);

  const saveCurrent = useCallback(async () => {
    if (!projectId || fileBusy || saveInFlightRef.current) return false;
    saveInFlightRef.current = true;
    setFileBusy(true);
    setSaveState("saving");
    try {
      const saved = await saveCanvasProject(projectId, projectName, nodes, edges, projectRevision);
      setProjects((current) => [saved.project, ...current.filter((project) => project.id !== saved.project.id)]);
      const savedRevision = saved.project.revision || projectRevision + 1;
      setProjectRevision(savedRevision);
      const latest = latestCanvasRef.current;
      const hasNewerEdits = latest.nodes !== nodes || latest.edges !== edges || latest.projectName !== projectName;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(createCanvasDraft({
          projectId,
          projectName: latest.projectName,
          baseRevision: savedRevision,
          dirty: hasNewerEdits,
          nodes: cleanNodes(latest.nodes),
          edges: latest.edges,
        })));
      } catch { /* The saved filesystem project remains the durable source. */ }
      tasks
        .filter((task) => task.status === "completed" && task.projectId === projectId)
        .forEach((task) => savedTaskIds.current.add(task.id));
      const recentSavedTaskIds = [...savedTaskIds.current].slice(-100);
      savedTaskIds.current = new Set(recentSavedTaskIds);
      try {
        window.localStorage.setItem(SAVED_TASK_IDS_KEY, JSON.stringify(recentSavedTaskIds));
      } catch { /* Browser storage failure must not report a successful disk save as failed. */ }
      setSaveState(hasNewerEdits ? "unsaved" : "saved");
      setToast(hasNewerEdits
        ? `「${projectName}」已保存先前版本；保存期间的新修改尚未保存`
        : `「${projectName}」已保存，参考素材也已写入`);
      // A caller switching projects must not discard edits made during the save.
      return !hasNewerEdits;
    } catch (error) {
      setSaveState("error");
      setToast(error instanceof Error ? error.message : "保存画布失败");
      return false;
    } finally {
      saveInFlightRef.current = false;
      setFileBusy(false);
    }
  }, [projectId, projectName, nodes, edges, tasks, fileBusy, projectRevision]);

  const updateNode = useCallback((id: string, patch: Partial<GraphData>) => {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, data: { ...node.data, ...patch } } : node));
  }, []);

  const deleteNode = useCallback((id: string) => {
    const deleteIds = new Set([id]);
    if (nodes.find((node) => node.id === id)?.type === "group") {
      nodes.forEach((node) => { if (node.parentId === id) deleteIds.add(node.id); });
    }
    setNodes((current) => {
      const remaining = current.filter((node) => !deleteIds.has(node.id));
      const populatedGroupIds = new Set(remaining.map((node) => node.parentId).filter((parentId): parentId is string => Boolean(parentId)));
      return remaining.filter((node) => node.type !== "group" || populatedGroupIds.has(node.id));
    });
    setEdges((current) => current.filter((edge) => !deleteIds.has(edge.source) && !deleteIds.has(edge.target)));
    setToast("节点已删除");
  }, [nodes]);

  const applyTaskOutcome = useCallback((task: CanvasTask, applyResult = true) => {
    if (projectLoadBusy.current) return;
    const belongsToCurrentProject = task.projectId === projectId;
    if (!belongsToCurrentProject) return;
    if (!shouldApplyTaskOutcome(task)) {
      if (applyResult && TERMINAL_TASK_STATUSES.has(task.status)) {
        setToast(task.status === "completed"
          ? "后台任务已完成并保存，当前画布保持不变"
          : `后台任务${task.status === "failed" ? "失败" : "已取消"}，当前画布保持不变`);
      }
      return;
    }
    if (task.status === "completed" && applyResult && !appliedTaskIds.current.has(task.id)) {
      if (task.kind === "image-generation" && task.result?.images?.length) {
        appliedTaskIds.current.add(task.id);
        const first = task.result.images[0];
        const meta = `${taskProviderLabel(task)} · ${task.model || "图片模型"} · ${task.result.resolution || ""} · ${task.result.aspectRatio || ""}`.replace(/ · $/, "");
        setNodes((current) => current.map((node) => task.outputNodeIds.includes(node.id)
          ? { ...node, data: { ...node.data, generatedImages: task.result?.images, imageData: first.dataUrl, preview: first.dataUrl, fileName: `generated-${task.id.slice(0, 6)}.png`, generationMeta: meta, imageError: undefined } }
          : node.id === task.sourceNodeId ? { ...node, data: { ...node.data, generationMeta: meta, imageError: undefined } } : node));
        setToast(task.result.saveError
          ? `图片已写入节点，但自动保存失败：${task.result.saveError}`
          : `图片生成完成，已自动保存到：${task.result.outputDirectory || task.result.savedFiles?.[0] || "输出目录"}`);
        return;
      }
      if (task.kind === "video-generation" && task.result?.videos?.length) {
        appliedTaskIds.current.add(task.id);
        const meta = `${taskProviderLabel(task)} · ${task.model || "视频模型"} · ${task.result.duration || ""}s · ${task.result.resolution || ""} · ${task.result.aspectRatio || ""}`.replace(/ · $/, "");
        setNodes((current) => current.map((node) => task.outputNodeIds.includes(node.id)
          ? { ...node, data: { ...node.data, generatedVideos: task.result?.videos, preview: task.result?.videos?.[0]?.url, fileName: `generated-${task.id.slice(0, 6)}.mp4`, generationMeta: meta, videoGenerationError: undefined } }
          : node.id === task.sourceNodeId ? { ...node, data: { ...node.data, generationMeta: meta, videoGenerationError: undefined, confirmLowCredit: false } } : node));
        setToast(task.result.saveError
          ? `视频已写入节点，但自动保存失败：${task.result.saveError}`
          : `视频生成完成，已自动保存到：${task.result.outputDirectory || task.result.savedFiles?.[0] || "输出目录"}`);
        return;
      }
      if (!task.result?.prompt) return;
      let taskProvider: AgentProvider;
      try { taskProvider = normalizeTaskProvider(task.provider); }
      catch {
        appliedTaskIds.current.add(task.id);
        setToast("任务返回了未知模型供应商，结果未写入画布");
        return;
      }
      appliedTaskIds.current.add(task.id);
      setNodes((current) => current.map((node) => {
        if (task.outputNodeIds.includes(node.id)) {
          return { ...node, data: { ...node.data, text: task.result?.prompt, prompt: task.result?.prompt, source: providerSource(taskProvider) } };
        }
        if (node.id !== task.sourceNodeId || task.kind !== "generation" || !task.result?.threadId) return node;
        let nodeProvider: AgentProvider;
        try { nodeProvider = normalizeProvider(node.data.provider); }
        catch { return node; }
        const sameProvider = nodeProvider === taskProvider;
        const sameModel = !task.model || !node.data.model || node.data.model === task.model;
        const sameSkill = normalizePromptSkill(node.data.skillId) === normalizePromptSkill(task.skillId || task.result.skillId);
        return sameProvider && sameModel && sameSkill ? { ...node, data: { ...node.data, threadId: task.result.threadId } } : node;
      }));
      setToast(task.result.changes || task.result.title || "任务已完成，结果已写入输出节点");
    } else if (task.status === "failed" && applyResult && !appliedTaskIds.current.has(task.id)) {
      appliedTaskIds.current.add(task.id);
      if (task.kind === "image-generation") {
        setNodes((current) => current.map((node) => node.id === task.sourceNodeId || task.outputNodeIds.includes(node.id) ? { ...node, data: { ...node.data, imageError: task.error } } : node));
      } else if (task.kind === "video-generation") {
        setNodes((current) => current.map((node) => node.id === task.sourceNodeId || task.outputNodeIds.includes(node.id) ? { ...node, data: { ...node.data, videoGenerationError: task.error, confirmLowCredit: Boolean(task.error?.includes("LOW_CREDIT_CONFIRMATION_REQUIRED")) } } : node));
      }
      setToast(task.error || "任务执行失败");
    }
  }, [projectId]);

  const applyTaskUpdate = useCallback((task: CanvasTask, applyResult = true) => {
    setTasks((current) => mergeTaskLists(current, [task]));
    applyTaskOutcome(task, applyResult);
  }, [applyTaskOutcome]);

  useEffect(() => {
    if (!hydrated) return;
    let disposed = false;
    let pollTimer: number | undefined;
    let pollInFlight = false;
    let streamConnected = false;
    let hasTaskBaseline = false;
    let connectionWarningShown = false;

    try {
      const stored = JSON.parse(window.localStorage.getItem(SAVED_TASK_IDS_KEY) || "[]") as string[];
      savedTaskIds.current = new Set(stored.filter((id) => typeof id === "string"));
      savedTaskIds.current.forEach((id) => appliedTaskIds.current.add(id));
    } catch { savedTaskIds.current = new Set(); }

    const acceptSnapshot = (snapshot: CanvasTask[], concurrency: number) => {
      if (disposed) return;
      setTasks((current) => mergeTaskLists(current, snapshot));
      setTaskConcurrency(concurrency);
      if (!hasTaskBaseline) {
        snapshot.forEach((task) => {
          const belongsToCurrentProject = task.projectId === projectId;
          if (!belongsToCurrentProject) return;
          if (task.status === "completed" && !savedTaskIds.current.has(task.id)) applyTaskOutcome(task);
          else if (TERMINAL_TASK_STATUSES.has(task.status)) appliedTaskIds.current.add(task.id);
        });
        hasTaskBaseline = true;
        return;
      }
      snapshot.forEach((task) => applyTaskOutcome(task));
    };

    const schedulePoll = (delay: number) => {
      if (disposed) return;
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
      pollTimer = window.setTimeout(() => void pollTasks(), delay);
    };

    async function pollTasks() {
      if (disposed || pollInFlight) return;
      pollInFlight = true;
      try {
        const result = await taskApi<{ tasks: CanvasTask[]; concurrency: number }>("/tasks");
        acceptSnapshot(result.tasks, result.concurrency);
        connectionWarningShown = false;
      } catch {
        if (!disposed && !connectionWarningShown) {
          connectionWarningShown = true;
          setToast("任务实时连接中断，正在自动同步任务状态");
        }
      } finally {
        pollInFlight = false;
        schedulePoll(streamConnected ? TASK_POLL_CONNECTED_MS : TASK_POLL_FALLBACK_MS);
      }
    }

    const events = new EventSource(`${BRIDGE_URL}/tasks/events`);
    events.onopen = () => {
      if (disposed) return;
      streamConnected = true;
      connectionWarningShown = false;
      schedulePoll(TASK_POLL_CONNECTED_MS);
    };
    events.onerror = () => {
      if (disposed) return;
      streamConnected = false;
      schedulePoll(0);
    };
    events.onmessage = (event) => {
      if (disposed) return;
      try {
        const message = JSON.parse(event.data) as TaskEvent;
        if (message.type === "snapshot") {
          acceptSnapshot(message.tasks, message.concurrency);
        } else if (message.type === "task") {
          applyTaskUpdate(message.task);
        } else {
          setTaskConcurrency(message.concurrency);
        }
      } catch { /* Ignore malformed task events and keep the stream alive. */ }
    };
    void pollTasks();

    return () => {
      disposed = true;
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
      events?.close();
    };
  }, [applyTaskOutcome, applyTaskUpdate, hydrated, projectId]);

  useEffect(() => {
    if (!hydrated || !projectId) return;
    let disposed = false;
    const events = new EventSource(`${BRIDGE_URL}/projects/events`);
    events.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ProjectEvent | { type: "ready" };
        if (disposed || message.type !== "project") return;
        const decision = backgroundProjectEventDecision({
          event: message,
          currentProjectId: projectId,
          currentRevision: projectRevision,
          pendingRemoteRevision: 0,
        });
        if (decision.updateProjectList && message.project) {
          setProjects((current) => [message.project as CanvasProjectSummary, ...current.filter((item) => item.id !== message.projectId)]);
        }
        if (!decision.affectsCurrent || message.revision <= projectRevision) return;
        setPendingRemoteRevision((current) => backgroundProjectEventDecision({
          event: message,
          currentProjectId: projectId,
          currentRevision: projectRevision,
          pendingRemoteRevision: current,
        }).pendingRemoteRevision);
        setToast(message.actor === "automation-task"
          ? "后台任务结果已保存；当前编辑内容和视图未被刷新"
          : `后台画布已更新到 revision ${message.revision}；当前编辑内容保持不变`);
      } catch { /* Ignore malformed project events and keep the stream alive. */ }
    };
    return () => {
      disposed = true;
      events.close();
    };
  }, [hydrated, projectId, projectRevision]);

  const enqueueTask = useCallback(async (payload: Record<string, unknown>, taskMeta: Record<string, unknown>) => {
    const optimisticId = `local-${crypto.randomUUID()}`;
    const optimisticKind = (["generation", "revision", "image-generation", "video-generation"].includes(String(taskMeta.kind)) ? taskMeta.kind : "generation") as CanvasTaskKind;
    const optimisticTask: CanvasTask = {
      id: optimisticId,
      projectId: typeof taskMeta.projectId === "string" ? taskMeta.projectId : undefined,
      kind: optimisticKind,
      title: String(taskMeta.title || "正在创建任务"),
      status: "queued",
      stage: "queued",
      createdAt: new Date().toISOString(),
      provider: String(payload.provider || "codex") as CanvasTaskProvider,
      skillId: optimisticKind === "generation" || optimisticKind === "revision" ? normalizePromptSkill(payload.skillId) : undefined,
      model: String(payload.model || "default"),
      reasoningEffort: String(payload.reasoningEffort || "default"),
      sourceNodeId: String(taskMeta.sourceNodeId || ""),
      outputNodeIds: Array.isArray(taskMeta.outputNodeIds) ? taskMeta.outputNodeIds.map(String) : [],
    };
    setTasks((current) => [optimisticTask, ...current]);
    setTaskPanelOpen(true);
    window.localStorage.setItem(TASK_PANEL_STATE_KEY, "true");
    setToast("正在创建任务…");
    const submitController = new AbortController();
    const submitTimeout = window.setTimeout(() => submitController.abort(), TASK_SUBMIT_TIMEOUT_MS);
    try {
      const result = await taskApi<{ task: CanvasTask }>("/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, taskMeta }),
        signal: submitController.signal,
      });
      setTasks((current) => current.filter((task) => task.id !== optimisticId));
      applyTaskUpdate(result.task, false);
      setToast(result.task.status === "queued" ? "任务已加入队列" : "任务已开始");
      return result.task;
    } catch (error) {
      setTasks((current) => current.filter((task) => task.id !== optimisticId));
      if (submitController.signal.aborted) throw new Error("任务提交响应超时，任务中心会继续从服务器同步状态");
      throw error;
    } finally {
      window.clearTimeout(submitTimeout);
    }
  }, [applyTaskUpdate]);

  const getMediaSlots = useCallback((targetId: string) => {
    const connected = edges
      .filter((edge) => edge.target === targetId && slotNumber(edge) !== null)
      .map((edge) => ({ edge, slot: slotNumber(edge) as number, source: nodes.find((node) => node.id === edge.source) }))
      .filter((item) => item.source?.type === "reference" || item.source?.type === "video")
      .sort((a, b) => a.slot - b.slot);
    let imageIndex = 0;
    let videoIndex = 0;
    const bySlot = new Map<number, MediaSlot>();
    connected.forEach(({ slot, source }) => {
      if (!source) return;
      const mediaKind = source.type === "video" ? "video" : "image";
      const marker = mediaKind === "video" ? `@视频${++videoIndex}` : `@图片${++imageIndex}`;
      bySlot.set(slot, {
        slot,
        marker,
        sourceId: source.id,
        fileName: source.data.fileName,
        mediaKind,
        hasMedia: Boolean(mediaKind === "video" ? source.data.videoData || source.data.generatedVideos?.[0]?.url : source.data.imageData || source.data.generatedImages?.[0]?.dataUrl),
      });
    });
    return Array.from({ length: MAX_REWRITE_REFERENCES }, (_, index): MediaSlot => bySlot.get(index + 1) || {
      slot: index + 1,
      marker: `参考位 ${index + 1}`,
      hasMedia: false,
    });
  }, [nodes, edges]);

  const getImageGenerationSlots = useCallback((targetId: string) => {
    const connected = edges
      .filter((edge) => edge.target === targetId && slotNumber(edge) !== null)
      .map((edge) => ({ slot: slotNumber(edge) as number, source: nodes.find((node) => node.id === edge.source) }))
      .filter((item) => item.source?.type === "reference")
      .sort((a, b) => a.slot - b.slot);
    const bySlot = new Map<number, MediaSlot>();
    let imageIndex = 0;
    connected.forEach(({ slot, source }) => {
      if (!source) return;
      bySlot.set(slot, {
        slot,
        marker: `@图片${++imageIndex}`,
        sourceId: source.id,
        fileName: source.data.fileName,
        mediaKind: "image",
        hasMedia: Boolean(source.data.imageData || source.data.generatedImages?.[0]?.dataUrl),
      });
    });
    return Array.from({ length: MAX_IMAGE_GENERATION_IMAGES }, (_, index): MediaSlot => bySlot.get(index + 1) || {
      slot: index + 1,
      marker: `参考位 ${index + 1}`,
      hasMedia: false,
    });
  }, [nodes, edges]);

  const copyNodeText = useCallback(async (nodeId: string) => {
    const node = nodes.find((item) => item.id === nodeId);
    const prompt = nodeText(node);
    try {
      await navigator.clipboard.writeText(prompt);
      setToast(node?.type === "prompteditor" ? "编辑提示词已复制" : "文本已复制");
    } catch {
      setToast("无法写入剪贴板，请检查浏览器权限");
    }
  }, [nodes]);

  const pasteNodeText = useCallback(async (nodeId: string) => {
    try {
      const text = await navigator.clipboard.readText();
      updateNode(nodeId, { text, prompt: text, source: "剪贴板" });
      setToast("剪贴板内容已粘贴到文本框");
    } catch {
      setToast("无法读取剪贴板，请检查浏览器权限");
    }
  }, [updateNode]);

  const applyClipboardImage = useCallback(async (nodeId: string, blob: Blob, fileName?: string) => {
    if (!blob.type.startsWith("image/")) throw new Error("剪贴板内容不是图片");
    if (blob.size > MAX_IMAGE_UPLOAD_BYTES) throw new Error("剪贴板图片超过 15MB，无法载入");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("剪贴板图片读取失败"));
      reader.readAsDataURL(blob);
    });
    const extension = blob.type.includes("jpeg") ? "jpg" : blob.type.includes("webp") ? "webp" : blob.type.includes("gif") ? "gif" : "png";
    updateNode(nodeId, {
      fileName: fileName || `clipboard-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`,
      preview: dataUrl,
      imageData: dataUrl,
      generatedImages: undefined,
      imageError: undefined,
      generationMeta: undefined,
    });
  }, [updateNode]);

  const pasteNodeImage = useCallback(async (nodeId: string) => {
    try {
      if (!navigator.clipboard?.read) throw new Error("当前浏览器不支持直接读取剪贴板图片，请使用 Ctrl+V");
      const clipboardItems = await navigator.clipboard.read();
      const imageItem = clipboardItems.find((item) => item.types.some((type) => type.startsWith("image/")));
      const imageType = imageItem?.types.find((type) => type.startsWith("image/"));
      if (!imageItem || !imageType) throw new Error("剪贴板中没有可用图片");
      await applyClipboardImage(nodeId, await imageItem.getType(imageType));
      setToast("剪贴板图片已粘贴到图片节点");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "无法读取剪贴板图片，请检查浏览器权限");
    }
  }, [applyClipboardImage]);

  useEffect(() => {
    const handleImagePaste = (event: ClipboardEvent) => {
      if (fileManagerOpen || apiKeySettingsOpen || mediaSettingsOpen || isEditableTarget(event.target)) return;
      const selectedNodes = nodes.filter((node) => node.selected);
      if (selectedNodes.length !== 1 || selectedNodes[0].type !== "reference") return;
      const imageFile = Array.from(event.clipboardData?.items || [])
        .find((item) => item.kind === "file" && item.type.startsWith("image/"))
        ?.getAsFile();
      if (!imageFile) return;
      event.preventDefault();
      void applyClipboardImage(selectedNodes[0].id, imageFile, imageFile.name || undefined)
        .then(() => setToast("剪贴板图片已粘贴到选中的图片节点"))
        .catch((error) => setToast(error instanceof Error ? error.message : "剪贴板图片读取失败"));
    };
    window.addEventListener("paste", handleImagePaste);
    return () => window.removeEventListener("paste", handleImagePaste);
  }, [apiKeySettingsOpen, applyClipboardImage, fileManagerOpen, mediaSettingsOpen, nodes]);

  const runImageGeneration = useCallback(async (nodeId: string) => {
    const imageNode = nodes.find((node) => node.id === nodeId && node.type === "imagegenerator");
    if (!imageNode || imageNode.data.busy) return;
    const outputNodeIds = edges
      .filter((edge) => edge.source === nodeId && isImageOutputNodeType(nodes.find((node) => node.id === edge.target)?.type))
      .map((edge) => edge.target);
    if (!outputNodeIds.length) { setToast("请先把图片生成节点连接到一个图片节点"); return; }
    let provider: ImageGenerationProvider;
    try { provider = normalizeImageGenerationProvider(imageNode.data.imageProvider); }
    catch (error) { setToast(error instanceof Error ? error.message : "图片供应商无效"); return; }
    const catalog = imageProviderCatalogs[provider];
    if (catalog.loading) { setToast(`${IMAGE_GENERATION_PROVIDER_LABELS[provider]} 图片模型仍在载入`); return; }
    if (!catalog.configured) { setToast(catalog.message || `${IMAGE_GENERATION_PROVIDER_LABELS[provider]} 尚未配置`); return; }
    const selectedModel = catalog.models.find((model) => model.model === imageNode.data.imageModel) || catalog.models[0];
    if (!selectedModel) { setToast(`${IMAGE_GENERATION_PROVIDER_LABELS[provider]} 暂无可用图片模型`); return; }
    const supportedResolutions = selectedModel.supportedResolutions?.length ? selectedModel.supportedResolutions : IMAGE_GENERATION_RESOLUTIONS;
    const requestedResolution = (imageNode.data.resolution || "1K") as ImageGenerationResolution;
    const resolution = supportedResolutions.includes(requestedResolution) ? requestedResolution : supportedResolutions[0];

    const promptEdge = edges.find((edge) => edge.target === nodeId && edge.targetHandle === "prompt");
    const promptSource = promptEdge ? nodes.find((node) => node.id === promptEdge.source) : undefined;
    const prompt = String(promptEdge ? nodeText(promptSource) : imageNode.data.instruction || "").trim();
    if (!prompt) { setToast("请输入图片生成提示词，或连接一个包含文本的上游节点"); return; }

    const connected = getImageGenerationSlots(nodeId).filter((slot) => slot.sourceId);
    const missing = connected.filter((slot) => !slot.hasMedia);
    if (missing.length) { setToast(`${missing.map((slot) => slot.marker).join("、")} 已连接但还没有添加图片`); return; }
    const images = connected.map((slot) => {
      const source = nodes.find((node) => node.id === slot.sourceId);
      return {
        slot: slot.slot,
        marker: slot.marker,
        mediaKind: slot.mediaKind,
        fileName: source?.data.fileName,
        dataUrl: source?.data.imageData || source?.data.generatedImages?.[0]?.dataUrl,
      };
    });
    const conflict = tasks.find((task) => task.projectId === projectId && ACTIVE_TASK_STATUSES.has(task.status) && task.outputNodeIds.some((id) => outputNodeIds.includes(id)));
    if (conflict) { setTaskPanelOpen(true); setToast("这个图片节点已有任务正在排队或运行"); return; }
    try {
      await enqueueTask({
        provider,
        model: selectedModel.model,
        prompt,
        aspectRatio: imageNode.data.ratio || "Auto",
        resolution,
        images,
      }, {
        kind: "image-generation",
        projectId,
        title: `图片生成 · ${IMAGE_GENERATION_PROVIDER_LABELS[provider]} · ${prompt.replace(/\s+/g, " ").slice(0, 18)}`,
        sourceNodeId: nodeId,
        outputNodeIds,
      });
    } catch (error) {
      setToast(error instanceof Error ? error.message : "图片任务创建失败");
    }
  }, [nodes, edges, imageProviderCatalogs, getImageGenerationSlots, tasks, enqueueTask, projectId]);

  const runVideoGeneration = useCallback(async (nodeId: string) => {
    const videoNode = nodes.find((node) => node.id === nodeId && node.type === "videogenerator");
    if (!videoNode || videoNode.data.busy) return;
    const outputNodeIds = edges
      .filter((edge) => edge.source === nodeId && isVideoOutputNodeType(nodes.find((node) => node.id === edge.target)?.type))
      .map((edge) => edge.target);
    if (!outputNodeIds.length) { setToast("请先把视频生成节点连接到一个视频节点"); return; }
    let provider: VideoGenerationProvider;
    try { provider = normalizeVideoGenerationProvider(videoNode.data.videoGenerationProvider); }
    catch (error) { setToast(error instanceof Error ? error.message : "视频供应商无效"); return; }
    const catalog = videoGenerationProviderCatalogs[provider];
    if (catalog.loading) { setToast(`${VIDEO_GENERATION_PROVIDER_LABELS[provider]} 视频模型仍在载入`); return; }
    if (!catalog.configured) { setToast(catalog.message || `${VIDEO_GENERATION_PROVIDER_LABELS[provider]} 尚未配置`); return; }
    const selectedModel = catalog.models.find((model) => model.model === videoNode.data.videoGenerationModel) || catalog.models[0];
    if (!selectedModel) { setToast(`${VIDEO_GENERATION_PROVIDER_LABELS[provider]} 暂无可用视频模型`); return; }

    const promptEdge = edges.find((edge) => edge.target === nodeId && edge.targetHandle === "prompt");
    const promptSource = promptEdge ? nodes.find((node) => node.id === promptEdge.source) : undefined;
    const prompt = String(promptEdge ? nodeText(promptSource) : videoNode.data.instruction || "").trim();
    if (!prompt) { setToast("请输入视频生成提示词，或连接一个包含文本的上游节点"); return; }

    const connected = getMediaSlots(nodeId).filter((slot) => slot.sourceId);
    const missing = connected.filter((slot) => !slot.hasMedia);
    if (missing.length) { setToast(`${missing.map((slot) => slot.marker).join("、")} 已连接但还没有添加素材`); return; }
    const mode = (videoNode.data.videoGenerationMode || "multimodal2video") as VideoGenerationMode;
    const images = connected.filter((slot) => slot.mediaKind === "image");
    const videos = connected.filter((slot) => slot.mediaKind === "video");
    if (mode === "text2video" && connected.length) { setToast("文生视频模式不能连接参考素材；请断开素材或切换模式"); return; }
    if (mode === "image2video" && (images.length !== 1 || videos.length)) { setToast("单图生视频模式需要且只能连接 1 张图片"); return; }
    if (mode === "frames2video" && (images.length !== 2 || videos.length)) { setToast("首尾帧模式需要且只能连接 2 张图片"); return; }
    if (mode === "multiframe2video" && (images.length < 2 || videos.length)) { setToast("智能多帧模式需要至少 2 张图片，不能连接视频"); return; }
    if (mode === "multimodal2video" && (!connected.length || images.length > 9 || videos.length > 3)) { setToast("全能参考需要至少 1 个素材，最多 9 图 + 3 视频"); return; }
    const references = connected.map((slot) => {
      const source = nodes.find((node) => node.id === slot.sourceId);
      return {
        slot: slot.slot,
        marker: slot.marker,
        mediaKind: slot.mediaKind,
        fileName: source?.data.fileName,
        dataUrl: slot.mediaKind === "video" ? source?.data.videoData || source?.data.generatedVideos?.[0]?.url : source?.data.imageData || source?.data.generatedImages?.[0]?.dataUrl,
      };
    });
    const conflict = tasks.find((task) => task.projectId === projectId && ACTIVE_TASK_STATUSES.has(task.status) && task.outputNodeIds.some((id) => outputNodeIds.includes(id)));
    if (conflict) { setTaskPanelOpen(true); setToast("这个视频节点已有任务正在排队或运行"); return; }
    try {
      await enqueueTask({
        provider,
        model: selectedModel.model,
        mode,
        prompt,
        aspectRatio: videoNode.data.ratio || "16:9",
        resolution: videoNode.data.videoGenerationResolution || selectedModel.supportedResolutions?.[0] || "720p",
        duration: Number(videoNode.data.duration || selectedModel.supportedDurations?.[0] || 5),
        generateAudio: videoNode.data.generateAudio !== false,
        confirmLowCredit: videoNode.data.confirmLowCredit === true,
        references,
      }, {
        kind: "video-generation",
        projectId,
        title: `视频生成 · ${VIDEO_GENERATION_PROVIDER_LABELS[provider]} · ${prompt.replace(/\s+/g, " ").slice(0, 18)}`,
        sourceNodeId: nodeId,
        outputNodeIds,
      });
    } catch (error) {
      setToast((error instanceof Error ? error.message : "视频任务创建失败").replace(/^LOW_CREDIT_CONFIRMATION_REQUIRED:\s*/, ""));
    }
  }, [nodes, edges, videoGenerationProviderCatalogs, getMediaSlots, tasks, enqueueTask, projectId]);

  const runCodex = useCallback(async (nodeId: string) => {
    const codexNode = nodes.find((node) => node.id === nodeId && node.type === "codex");
    if (!codexNode) return;
    const outputNodes = edges
      .filter((edge) => edge.source === nodeId && isOutputNodeType(nodes.find((node) => node.id === edge.target)?.type))
      .map((edge) => nodes.find((node) => node.id === edge.target))
      .filter((node): node is GraphNode => Boolean(node));
    if (!outputNodes.length) { setToast("请先把改写节点连接到一个文本框"); return; }

    const instruction = String(codexNode.data.instruction || "").trim();
    if (!instruction) { setToast("请在改写节点的提示词输入框中输入需求"); return; }
    let skillId: PromptSkillId;
    try { skillId = normalizePromptSkill(codexNode.data.skillId); }
    catch (error) { setToast(error instanceof Error ? error.message : "提示词 Skill 无效"); return; }

    const mediaSlots = getMediaSlots(nodeId);
    const connected = mediaSlots.filter((slot) => slot.sourceId);
    const missing = connected.filter((slot) => !slot.hasMedia);
    if (missing.length) { setToast(`${missing.map((slot) => slot.marker).join("、")} 已连线但还没有添加素材`); return; }

    const images = connected.filter((slot) => slot.mediaKind === "image").map((slot) => {
      const source = nodes.find((node) => node.id === slot.sourceId);
      return { slot: Number(slot.marker.replace("@图片", "")), marker: slot.marker, fileName: source?.data.fileName, dataUrl: source?.data.imageData || source?.data.generatedImages?.[0]?.dataUrl };
    });
    const videos = connected.filter((slot) => slot.mediaKind === "video").map((slot) => {
      const source = nodes.find((node) => node.id === slot.sourceId);
      return { slot: Number(slot.marker.replace("@视频", "")), marker: slot.marker, fileName: source?.data.fileName, dataUrl: source?.data.videoData || source?.data.generatedVideos?.[0]?.url };
    });
    if (isImagePromptSkill(skillId) && videos.length) { setToast(`${PROMPT_SKILL_LABELS[skillId]}只支持参考图片，请断开参考视频`); return; }
    let selection: ReturnType<typeof runtimeSelection>;
    try { selection = runtimeSelection(codexNode.data, providerCatalogs); }
    catch (error) { setToast(error instanceof Error ? error.message : "模型供应商无效"); return; }
    const { provider, catalog, model: selectedModel, reasoningEffort: selectedEffort } = selection;
    if (catalog.loading) { setToast(`${PROVIDER_LABELS[provider]} 模型列表仍在载入，请稍等`); return; }
    if (!catalog.configured) { setToast(catalog.message || `${PROVIDER_LABELS[provider]} 尚未配置`); return; }
    if (!selectedModel || !selectedEffort) { setToast(`${PROVIDER_LABELS[provider]} 暂无可用模型`); return; }
    if (connected.length && !selectedModel.inputModalities?.includes("image")) { setToast(`${selectedModel.displayName} 仅支持文本，请选择支持参考素材的模型`); return; }
    const outputNodeIds = outputNodes.map((node) => node.id);
    const conflict = tasks.find((task) => task.projectId === projectId && ACTIVE_TASK_STATUSES.has(task.status) && task.outputNodeIds.some((id) => outputNodeIds.includes(id)));
    if (conflict) {
      setTaskPanelOpen(true);
      setToast("这个输出节点已有任务正在排队或运行");
      return;
    }

    try {
      await enqueueTask({
        prompt: instruction,
        instruction: skillId === "none"
          ? "不要加载或调用任何 Skill。根据用户需求和已连接的图片、视频参考，直接整理成一份完整、可复制使用的提示词。"
          : isImagePromptSkill(skillId)
          ? skillId === "photoreal"
            ? "根据用户需求和已连接的参考图片，按真实感场景 Skill 路由参考分类，生成一份可直接复制使用的完整真实感图像提示词。"
            : skillId === "nanobanana"
              ? "根据用户需求和已连接的参考图片，严格按 Image skill 的 Nano Banana 适配规则生成一份可直接复制使用的完整提示词。"
              : "根据用户需求和已连接的参考图片，严格按 Image skill 的 GPT Image 适配规则生成一份可直接复制使用的完整提示词。"
          : "根据用户需求和已连接的图片、视频参考，直接生成一段可用于 Seedance2 的最终中文提示词。视频参考应依据按时间顺序抽取的关键帧理解其动作、运镜与节奏。",
        skillId,
        provider,
        model: selectedModel.model,
        reasoningEffort: selectedEffort,
        spec: skillId === "none"
          ? { skillId, ratio: codexNode?.data.ratio, provider, model: selectedModel.model, reasoningEffort: selectedEffort, imageMarkers: images.map((image) => image.marker), videoMarkers: videos.map((video) => video.marker) }
          : isImagePromptSkill(skillId)
          ? { skillId, ratio: codexNode?.data.ratio, provider, model: selectedModel.model, reasoningEffort: selectedEffort, imageMarkers: images.map((image) => image.marker) }
          : { skillId, mode: codexNode?.data.mode, duration: codexNode?.data.duration, ratio: codexNode?.data.ratio, provider, model: selectedModel.model, reasoningEffort: selectedEffort, imageMarkers: images.map((image) => image.marker), videoMarkers: videos.map((video) => video.marker) },
        images,
        videos,
        threadId: codexNode?.data.threadId,
      }, {
        kind: "generation",
        projectId,
        title: `编辑改写 · ${promptSkillLabel(skillId, skillRegistry)} · ${instruction.replace(/\s+/g, " ").slice(0, 18)}`,
        sourceNodeId: nodeId,
        outputNodeIds,
      });
      setBridgeState("ready");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "任务创建失败");
    }
  }, [nodes, edges, getMediaSlots, providerCatalogs, tasks, enqueueTask, projectId, skillRegistry]);

  const runPromptEditor = useCallback(async (nodeId: string) => {
    const editorNode = nodes.find((node) => node.id === nodeId && node.type === "prompteditor");
    if (!editorNode || editorNode.data.busy) return;
    const inputEdge = edges.find((edge) => edge.target === nodeId && edge.targetHandle === "original-prompt");
    const inputNode = inputEdge ? nodes.find((node) => node.id === inputEdge.source) : undefined;
    const prompt = String(inputEdge ? nodeText(inputNode) : editorNode.data.prompt || "").trim();
    if (!prompt) { setToast("请先输入需要修改的完整提示词"); return; }
    const instruction = String(editorNode.data.instruction || "").trim();
    if (!instruction) { setToast("请先填写本次修改意见"); return; }
    const outputEdge = edges.find((edge) => edge.source === nodeId && isOutputNodeType(nodes.find((node) => node.id === edge.target)?.type));
    const outputNode = outputEdge ? nodes.find((node) => node.id === outputEdge.target) : undefined;
    if (!outputNode) { setToast("请把编辑提示词节点直接连接到文本框"); return; }

    let selection: ReturnType<typeof runtimeSelection>;
    try { selection = runtimeSelection(editorNode.data, providerCatalogs); }
    catch (error) { setToast(error instanceof Error ? error.message : "模型供应商无效"); return; }
    const { provider, catalog, model: selectedModel, reasoningEffort: selectedEffort } = selection;
    const skillEdge = edges.find((edge) => edge.target === nodeId && edge.targetHandle === "skill");
    const skillNode = skillEdge ? nodes.find((node) => node.id === skillEdge.source && node.type === "skill") : undefined;
    let skillId: PromptSkillId;
    try { skillId = normalizePromptSkill(skillNode?.data.skillId || editorNode.data.skillId); }
    catch (error) { setToast(error instanceof Error ? error.message : "提示词 Skill 无效"); return; }
    if (catalog.loading) { setToast(`${PROVIDER_LABELS[provider]} 模型列表仍在载入，请稍等`); return; }
    if (!catalog.configured) { setToast(catalog.message || `${PROVIDER_LABELS[provider]} 尚未配置`); return; }
    if (!selectedModel || !selectedEffort) { setToast(`${PROVIDER_LABELS[provider]} 暂无可用模型`); return; }
    const conflict = tasks.find((task) => task.projectId === projectId && ACTIVE_TASK_STATUSES.has(task.status) && task.outputNodeIds.includes(outputNode.id));
    if (conflict) {
      setTaskPanelOpen(true);
      setToast("这个输出节点已有任务正在排队或运行");
      return;
    }

    try {
      await enqueueTask({
        taskMode: "revision",
        prompt,
        instruction,
        skillId,
        provider,
        model: selectedModel.model,
        reasoningEffort: selectedEffort,
        threadId: editorNode.data.threadId,
        spec: skillId === "none"
          ? { skillId, ratio: editorNode.data.ratio, provider, model: selectedModel.model, reasoningEffort: selectedEffort }
          : isImagePromptSkill(skillId)
          ? { skillId, ratio: editorNode.data.ratio, provider, model: selectedModel.model, reasoningEffort: selectedEffort }
          : { skillId, mode: editorNode.data.mode, duration: editorNode.data.duration, ratio: editorNode.data.ratio, provider, model: selectedModel.model, reasoningEffort: selectedEffort },
      }, {
        kind: "revision",
        projectId,
        title: `编辑提示词 · ${promptSkillLabel(skillId, skillRegistry)} · ${prompt.replace(/\s+/g, " ").slice(0, 18)}`,
        sourceNodeId: nodeId,
        outputNodeIds: [outputNode.id],
      });
      setBridgeState("ready");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "任务创建失败");
    }
  }, [nodes, edges, providerCatalogs, tasks, enqueueTask, projectId, skillRegistry]);

  const renderNodes = useMemo(() => nodes.map((node) => {
    const activeTask = tasks.find((task) => task.projectId === projectId && (task.sourceNodeId === node.id || task.outputNodeIds.includes(node.id)) && ACTIVE_TASK_STATUSES.has(task.status));
    const assignedMarkers = node.type === "reference" || node.type === "video"
      ? edges
        .filter((edge) => {
          const targetType = nodes.find((target) => target.id === edge.target)?.type;
          return edge.source === node.id && (targetType === "codex" || targetType === "videogenerator" || (node.type === "reference" && targetType === "imagegenerator"));
        })
        .map((edge) => {
          const targetType = nodes.find((target) => target.id === edge.target)?.type;
          const slots = targetType === "imagegenerator" ? getImageGenerationSlots(edge.target) : getMediaSlots(edge.target);
          return slots.find((slot) => slot.sourceId === node.id && slotNumber(edge) === slot.slot)?.marker;
        })
        .filter((marker): marker is string => Boolean(marker))
      : undefined;
    const promptEdge = node.type === "imagegenerator" || node.type === "videogenerator" || node.type === "prompteditor"
      ? edges.find((edge) => edge.target === node.id && edge.targetHandle === (node.type === "prompteditor" ? "original-prompt" : "prompt"))
      : undefined;
    const promptSource = promptEdge ? nodes.find((source) => source.id === promptEdge.source) : undefined;
    const skillEdge = node.type === "prompteditor" ? edges.find((edge) => edge.target === node.id && edge.targetHandle === "skill") : undefined;
    const skillSource = skillEdge ? nodes.find((source) => source.id === skillEdge.source && source.type === "skill") : undefined;
    const linkedSkillId = skillSource ? normalizePromptSkill(skillSource.data.skillId || "none") : undefined;
    return {
      ...node,
      data: {
        ...node.data,
        inputSlots: node.type === "codex" || node.type === "videogenerator" ? getMediaSlots(node.id) : node.type === "imagegenerator" ? getImageGenerationSlots(node.id) : undefined,
        promptConnected: node.type === "imagegenerator" || node.type === "videogenerator" || node.type === "prompteditor" ? Boolean(promptEdge) : undefined,
        promptInput: (node.type === "imagegenerator" || node.type === "videogenerator" || node.type === "prompteditor") && promptEdge ? nodeText(promptSource) : undefined,
        skillConnected: node.type === "prompteditor" ? Boolean(skillEdge) : undefined,
        skillInputId: linkedSkillId,
        skillInputLabel: linkedSkillId ? promptSkillLabel(linkedSkillId, skillRegistry) : undefined,
        skillRegistry: node.type === "skill" || node.type === "prompteditor" ? skillRegistry : undefined,
        providerOptions: node.type === "codex" || node.type === "prompteditor" ? providerOptions : undefined,
        imageProviderOptions: node.type === "imagegenerator" ? imageProviderOptions : undefined,
        videoGenerationProviderOptions: node.type === "videogenerator" ? videoGenerationProviderOptions : undefined,
        assignedMarkers,
        memberCount: node.type === "group" ? nodes.filter((member) => member.parentId === node.id).length : node.data.memberCount,
        groupDropTarget: node.type === "group" ? node.id === groupDropTargetId : undefined,
        busy: Boolean(activeTask),
        busyLabel: activeTask ? TASK_STAGE_LABELS[activeTask.stage] : undefined,
        onUpdate: (patch: Partial<GraphData>) => updateNode(node.id, patch),
        onDelete: () => deleteNode(node.id),
        onRun: node.type === "codex" ? () => void runCodex(node.id) : node.type === "prompteditor" ? () => void runPromptEditor(node.id) : node.type === "imagegenerator" ? () => void runImageGeneration(node.id) : node.type === "videogenerator" ? () => void runVideoGeneration(node.id) : undefined,
        onCopy: isOutputNodeType(node.type) || node.type === "prompteditor" ? () => void copyNodeText(node.id) : undefined,
        onPaste: node.type === "text" ? () => void pasteNodeText(node.id) : node.type === "reference" ? () => void pasteNodeImage(node.id) : undefined,
        onRegisterSkill: node.type === "skill" ? registerSkill : undefined,
        onRefreshSkill: node.type === "skill" ? refreshRegisteredSkill : undefined,
        onUnregisterSkill: node.type === "skill" ? unregisterSkill : undefined,
      },
    };
  }), [nodes, edges, tasks, getMediaSlots, getImageGenerationSlots, providerOptions, imageProviderOptions, videoGenerationProviderOptions, skillRegistry, groupDropTargetId, updateNode, deleteNode, runCodex, runPromptEditor, runImageGeneration, runVideoGeneration, copyNodeText, pasteNodeText, pasteNodeImage, registerSkill, refreshRegisteredSkill, unregisterSkill, projectId]);

  const sortedTasks = useMemo(() => [...tasks].sort((a, b) => {
    const activeDifference = Number(ACTIVE_TASK_STATUSES.has(b.status)) - Number(ACTIVE_TASK_STATUSES.has(a.status));
    return activeDifference || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }), [tasks]);
  const activeTaskCount = tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status)).length;
  const queuedTaskCount = tasks.filter((task) => task.status === "queued").length;
  const { canUndo, canRedo } = historyAvailability;

  const cancelTask = useCallback(async (taskId: string) => {
    try {
      const result = await taskApi<{ task: CanvasTask }>(`/tasks/${taskId}`, { method: "DELETE" });
      applyTaskUpdate(result.task);
    } catch (error) { setToast(error instanceof Error ? error.message : "取消任务失败"); }
  }, [applyTaskUpdate]);

  const changeTaskConcurrency = useCallback(async (concurrency: number) => {
    try {
      const result = await taskApi<{ concurrency: number }>("/tasks/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concurrency }),
      });
      setTaskConcurrency(result.concurrency);
      setToast(`并行任务数已调整为 ${result.concurrency}`);
    } catch (error) { setToast(error instanceof Error ? error.message : "调整并行数失败"); }
  }, []);

  const clearCompletedTasks = useCallback(async () => {
    try {
      await taskApi<{ deleted: number }>("/tasks/completed", { method: "DELETE" });
      setTasks((current) => current.filter((task) => ACTIVE_TASK_STATUSES.has(task.status)));
      setToast("已清除完成、失败和取消的任务记录");
    } catch (error) { setToast(error instanceof Error ? error.message : "清理任务失败"); }
  }, []);

  const locateTaskNode = useCallback((task: CanvasTask, resultNode = false) => {
    if (task.projectId && task.projectId !== projectId) {
      const owner = projects.find((project) => project.id === task.projectId);
      setToast(`请先切换到任务所属画布${owner ? `「${owner.name}」` : ""}`);
      return;
    }
    const id = resultNode ? task.outputNodeIds[0] : task.sourceNodeId;
    const target = nodes.find((node) => node.id === id);
    if (!target) { setToast("对应节点已经被删除，任务记录仍然保留"); return; }
    void fitView({ nodes: [target], padding: 0.75, duration: 350 });
  }, [nodes, fitView, projectId, projects]);

  const retryTask = useCallback((task: CanvasTask) => {
    if (task.projectId && task.projectId !== projectId) {
      const owner = projects.find((project) => project.id === task.projectId);
      setToast(`请先切换到任务所属画布${owner ? `「${owner.name}」` : ""}`);
      return;
    }
    if (!nodes.some((node) => node.id === task.sourceNodeId)) { setToast("来源节点已删除，无法再次运行"); return; }
    const source = nodes.find((node) => node.id === task.sourceNodeId);
    if (task.kind === "image-generation") void runImageGeneration(task.sourceNodeId);
    else if (task.kind === "video-generation") void runVideoGeneration(task.sourceNodeId);
    else if (source?.type === "prompteditor" || task.kind === "revision") void runPromptEditor(task.sourceNodeId);
    else void runCodex(task.sourceNodeId);
  }, [nodes, runCodex, runPromptEditor, runImageGeneration, runVideoGeneration, projectId, projects]);

  const copyTaskError = useCallback(async (task: CanvasTask) => {
    try {
      await navigator.clipboard.writeText(task.error || "未知任务错误");
      setToast("错误信息已复制");
    } catch { setToast("无法写入剪贴板"); }
  }, []);

  const onNodesChange = useCallback((changes: NodeChange<GraphNode>[]) => setNodes((current) => applyNodeChanges(changes, current)), []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((current) => applyEdgeChanges(changes, current)), []);
  const onNodeDragStart = useCallback((event: MouseEvent | TouchEvent, draggedNode: GraphNode) => {
    groupDropTargetIdRef.current = "";
    setGroupDropTargetId("");
    const altPressed = "altKey" in event && event.altKey;
    if ((!altPressed && !altCopyMode) || altDragCopyActiveRef.current) return;
    const initialSourceNodes = draggedNode.selected ? nodes.filter((node) => node.selected) : [draggedNode];
    const selectedGroupIds = new Set(initialSourceNodes.filter((node) => node.type === "group").map((node) => node.id));
    const sourceIds = new Set(initialSourceNodes.map((node) => node.id));
    nodes.forEach((node) => { if (node.parentId && selectedGroupIds.has(node.parentId)) sourceIds.add(node.id); });
    const sourceNodes = nodes.filter((node) => sourceIds.has(node.id));
    if (nodes.length + sourceNodes.length > MAX_PORTABLE_NODES) {
      setToast(`Alt 拖动复制会超过画布 ${MAX_PORTABLE_NODES} 个节点的上限`);
      return;
    }
    altDragCopyActiveRef.current = true;
    const idMap = new Map(sourceNodes.map((node) => [node.id, `${node.type || "node"}-${crypto.randomUUID().slice(0, 8)}`]));
    const internalEdges = sourceNodes.length > 1
      ? edges.filter((edge) => sourceIds.has(edge.source) && sourceIds.has(edge.target))
      : [];
    const previewEdges = internalEdges.map((edge) => ({
      ...edge,
      id: `edge-${crypto.randomUUID().slice(0, 8)}`,
      selected: false,
    }));
    altDragCopyStateRef.current = {
      pairs: sourceNodes.map((node) => ({
        originalId: node.id,
        copyId: idMap.get(node.id) || `${node.type || "node"}-${crypto.randomUUID().slice(0, 8)}`,
        originalPosition: { ...node.position },
      })),
      previewEdgeIds: previewEdges.map((edge) => edge.id),
    };
    const stationaryCopies = sourceNodes.map((node) => {
      const copy = duplicatedNode(node, idMap.get(node.id), node.position, false);
      if (node.parentId && idMap.has(node.parentId)) copy.parentId = idMap.get(node.parentId);
      return copy;
    });
    setNodes((current) => [...current, ...stationaryCopies]);
    setEdges((current) => [
      ...current.map((edge) => ({
        ...edge,
        source: idMap.get(edge.source) || edge.source,
        target: idMap.get(edge.target) || edge.target,
      })),
      ...previewEdges,
    ]);
    setToast("正在拖动新副本，原节点和连线会保持原位");
  }, [altCopyMode, edges, nodes]);
  const onNodeDrag = useCallback((_event: MouseEvent | TouchEvent, draggedNode: GraphNode) => {
    const nextTargetId = altDragCopyActiveRef.current ? "" : groupDropTargetForNode(draggedNode, nodes);
    if (nextTargetId === groupDropTargetIdRef.current) return;
    groupDropTargetIdRef.current = nextTargetId;
    setGroupDropTargetId(nextTargetId);
  }, [nodes]);
  const onNodeDragStop = useCallback((_event: MouseEvent | TouchEvent, draggedNode: GraphNode) => {
    const wasAltCopy = altDragCopyActiveRef.current;
    const targetGroupId = groupDropTargetIdRef.current;
    groupDropTargetIdRef.current = "";
    setGroupDropTargetId("");
    finishAltDragCopy(draggedNode);
    if (wasAltCopy || !targetGroupId || draggedNode.type === "group" || draggedNode.parentId) return;
    setNodes((current) => {
      const withFinalPosition = current.map((node) => node.id === draggedNode.id
        ? { ...node, position: { ...draggedNode.position }, dragging: false }
        : node);
      const incomingIds = draggedNode.selected
        ? withFinalPosition.filter((node) => node.selected && node.type !== "group" && !node.parentId).map((node) => node.id)
        : [draggedNode.id];
      return addNodesToExistingGroup(withFinalPosition, targetGroupId, incomingIds);
    });
    const groupTitle = String(nodes.find((node) => node.id === targetGroupId)?.data.title || "群组");
    setToast(`已加入「${groupTitle}」，连线保持不变`);
  }, [finishAltDragCopy, nodes]);
  const onEdgeContextMenu = useCallback((event: ReactMouseEvent, edge: Edge) => {
    event.preventDefault();
    setEdges((current) => current.filter((item) => item.id !== edge.id));
    setToast("连接已断开");
  }, []);
  const isValidConnection = useCallback((connection: Edge | Connection) => {
    const source = nodes.find((node) => node.id === connection.source);
    const target = nodes.find((node) => node.id === connection.target);
    if (!source || !target || source.id === target.id) return false;
    if ((source.type === "reference" || source.type === "video") && target.type === "codex") {
      if (!connection.targetHandle?.startsWith("media-")) return false;
      if (source.type === "video" && isImagePromptSkill(target.data.skillId)) return false;
      const otherMediaEdges = edges.filter((edge) => edge.target === target.id && edge.targetHandle !== connection.targetHandle && slotNumber(edge) !== null);
      const imageCount = otherMediaEdges.filter((edge) => nodes.find((node) => node.id === edge.source)?.type === "reference").length;
      const videoCount = otherMediaEdges.filter((edge) => nodes.find((node) => node.id === edge.source)?.type === "video").length;
      return source.type === "reference" ? imageCount < MAX_REWRITE_IMAGES : videoCount < MAX_REWRITE_VIDEOS;
    }
    if (source.type === "reference" && target.type === "imagegenerator") {
      if (!connection.targetHandle?.startsWith("media-")) return false;
      const imageCount = edges.filter((edge) => edge.target === target.id
        && edge.targetHandle !== connection.targetHandle
        && slotNumber(edge) !== null
        && nodes.find((node) => node.id === edge.source)?.type === "reference").length;
      return imageCount < MAX_IMAGE_GENERATION_IMAGES;
    }
    if ((source.type === "reference" || source.type === "video") && target.type === "videogenerator") {
      if (!connection.targetHandle?.startsWith("media-")) return false;
      const mediaCount = edges.filter((edge) => edge.target === target.id
        && edge.targetHandle !== connection.targetHandle
        && slotNumber(edge) !== null
        && ["reference", "video"].includes(nodes.find((node) => node.id === edge.source)?.type || "")).length;
      return mediaCount < MAX_VIDEO_GENERATION_REFERENCES;
    }
    if ((source.type === "text" || source.type === "textinput" || isOutputNodeType(source.type)) && (target.type === "imagegenerator" || target.type === "videogenerator")) {
      return connection.targetHandle === "prompt";
    }
    if ((source.type === "text" || source.type === "textinput" || isOutputNodeType(source.type)) && target.type === "prompteditor") {
      return connection.targetHandle === "original-prompt";
    }
    if (source.type === "skill" && target.type === "prompteditor") {
      return connection.targetHandle === "skill";
    }
    if (source.type === "imagegenerator" && isImageOutputNodeType(target.type)) return true;
    if (source.type === "videogenerator" && isVideoOutputNodeType(target.type)) return true;
    if (source.type === "text" && target.type === "text") return true;
    return (source.type === "codex" || source.type === "prompteditor") && isOutputNodeType(target.type);
  }, [nodes, edges]);
  const onConnect = useCallback((connection: Connection) => {
    if (!isValidConnection(connection)) { setToast("连接不符合节点逻辑，或图片 / 视频参考已达到上限"); return; }
    setEdges((current) => {
      const targetNode = nodes.find((node) => node.id === connection.target);
      const withoutOccupiedSlot = targetNode?.type === "codex" || targetNode?.type === "imagegenerator" || targetNode?.type === "videogenerator" || targetNode?.type === "prompteditor"
        ? current.filter((edge) => !(edge.target === connection.target && edge.targetHandle === connection.targetHandle))
        : current.filter((edge) => edge.target !== connection.target);
      return addEdge({ ...connection, type: "disconnectable" }, withoutOccupiedSlot);
    });
    const targetType = nodes.find((node) => node.id === connection.target)?.type;
    const sourceNode = nodes.find((node) => node.id === connection.source);
    if (isImageOutputNodeType(targetType) && sourceNode?.type === "imagegenerator" && sourceNode.data.generatedImages?.length) {
      updateNode(connection.target, { generatedImages: sourceNode.data.generatedImages, generationMeta: sourceNode.data.generationMeta, imageError: sourceNode.data.imageError });
    }
    if (isVideoOutputNodeType(targetType) && sourceNode?.type === "videogenerator" && sourceNode.data.generatedVideos?.length) {
      updateNode(connection.target, { generatedVideos: sourceNode.data.generatedVideos, generationMeta: sourceNode.data.generationMeta, videoGenerationError: sourceNode.data.videoGenerationError });
    }
    setToast(connection.targetHandle === "skill"
      ? "Skill 已接入，将覆盖编辑提示词节点内的旧配置"
      : connection.targetHandle === "prompt" || connection.targetHandle === "original-prompt"
      ? connection.targetHandle === "original-prompt" ? "原提示词已接入，编辑区已锁定并会跟随上游文本" : "提示词输入已连接，节点内编辑已锁定"
      : connection.targetHandle?.startsWith("media-")
        ? targetType === "imagegenerator" ? "参考图片已连接并自动编号" : "参考素材已连接，图片与视频会分别自动编号并用于 @ 引用"
        : isImageOutputNodeType(targetType) ? "图片节点已连接，生成结果会在这里预览"
        : isVideoOutputNodeType(targetType) ? "视频节点已连接，生成结果会在这里预览"
        : "节点已连接");
  }, [isValidConnection, nodes, updateNode]);

  const addCanvasNode = (kind: PaletteNodeKind) => {
    if (nodes.length >= MAX_PORTABLE_NODES) {
      setToast(`当前画布最多支持 ${MAX_PORTABLE_NODES} 个节点`);
      return;
    }
    const id = `${kind}-${crypto.randomUUID().slice(0, 8)}`;
    const offset = (nodes.length % 5) * 18;
    const position = screenToFlowPosition({
      x: Math.max(390, window.innerWidth * 0.43) + offset,
      y: Math.max(230, window.innerHeight * 0.38) + offset,
    });
    let node: GraphNode;
    if (kind === "reference") {
      node = { id, type: "reference", position, data: { kind: "reference", title: "图片" } };
    } else if (kind === "video") {
      node = { id, type: "video", position, data: { kind: "video", title: "视频" } };
    } else if (kind === "codex") {
      node = {
        id,
        type: "codex",
        position,
        width: REWRITE_NODE_WIDTH,
        style: { width: REWRITE_NODE_WIDTH },
        data: { kind: "codex", title: REWRITE_NODE_TITLE, provider: "codex", skillId: "seedance", mode: "全能参考", duration: "4s", ratio: "16:9", instruction: "" },
      };
    } else if (kind === "imagegenerator") {
      node = {
        id,
        type: "imagegenerator",
        position,
        width: REWRITE_NODE_WIDTH,
        style: { width: REWRITE_NODE_WIDTH },
        data: { kind: "imageGenerator", title: "图片生成", imageProvider: "openrouter", imageModel: "", ratio: "Auto", resolution: "1K", instruction: "" },
      };
    } else if (kind === "videogenerator") {
      node = {
        id,
        type: "videogenerator",
        position,
        width: REWRITE_NODE_WIDTH,
        style: { width: REWRITE_NODE_WIDTH },
        data: { kind: "videoGenerator", title: "视频生成", videoGenerationProvider: "openrouter", videoGenerationModel: "", videoGenerationMode: "multimodal2video", duration: "5", ratio: "16:9", videoGenerationResolution: "720p", generateAudio: true, instruction: "" },
      };
    } else if (kind === "prompteditor") {
      node = { id, type: "prompteditor", position, data: { kind: "promptEditor", title: "编辑提示词", provider: "codex", skillId: "seedance", instruction: "", prompt: "" } };
    } else if (kind === "skill") {
      node = { id, type: "skill", position, data: { kind: "skill", title: "Skill", skillId: "none" } };
    } else {
      node = { id, type: "text", position, data: { kind: "textBox", title: "文本框", text: "", prompt: "", source: "可编辑文本" } };
    }
    setNodes((current) => reconcileRuntimeNodes([...current, node], providerCatalogsRef.current));
    setLastAddedNodeId(id);
    setToast(`${node.data.title}已添加，拖动端口即可连线`);
  };

  const addFlowPreset = useCallback((presetId: FlowPresetId, dropPosition?: { x: number; y: number }) => {
    const preset = FLOW_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    if (nodes.length + 3 > MAX_PORTABLE_NODES) {
      setToast(`加入预设后会超过画布 ${MAX_PORTABLE_NODES} 个节点的上限`);
      return;
    }
    const anchor = dropPosition || screenToFlowPosition({
      x: Math.max(390, window.innerWidth * 0.38),
      y: Math.max(210, window.innerHeight * 0.32),
    });
    const flowId = crypto.randomUUID().slice(0, 8);
    const referenceId = `reference-${flowId}`;
    const processorId = `${presetId}-${flowId}`;
    const outputId = `${presetId}-output-${flowId}`;
    const referenceNode: GraphNode = {
      id: referenceId,
      type: "reference",
      position: { ...anchor },
      selected: true,
      data: { kind: "reference", title: "参考图片" },
    };
    let processorNode: GraphNode;
    let outputNode: GraphNode;
    if (presetId === "prompt") {
      processorNode = {
        id: processorId,
        type: "codex",
        position: { x: anchor.x + 440, y: anchor.y - 35 },
        width: REWRITE_NODE_WIDTH,
        style: { width: REWRITE_NODE_WIDTH },
        selected: true,
        data: { kind: "codex", title: REWRITE_NODE_TITLE, provider: "codex", skillId: "seedance", mode: "全能参考", duration: "4s", ratio: "16:9", instruction: "" },
      };
      outputNode = {
        id: outputId,
        type: "text",
        position: { x: anchor.x + 1040, y: anchor.y + 70 },
        selected: true,
        data: { kind: "textBox", title: "提示词结果", text: "", prompt: "", source: "等待生成" },
      };
    } else if (presetId === "image-generation") {
      processorNode = {
        id: processorId,
        type: "imagegenerator",
        position: { x: anchor.x + 440, y: anchor.y - 35 },
        width: REWRITE_NODE_WIDTH,
        style: { width: REWRITE_NODE_WIDTH },
        selected: true,
        data: { kind: "imageGenerator", title: "图片生成", imageProvider: "openrouter", imageModel: "", ratio: "Auto", resolution: "1K", instruction: "" },
      };
      outputNode = {
        id: outputId,
        type: "reference",
        position: { x: anchor.x + 1040, y: anchor.y },
        selected: true,
        data: { kind: "reference", title: "生成图片" },
      };
    } else {
      processorNode = {
        id: processorId,
        type: "videogenerator",
        position: { x: anchor.x + 440, y: anchor.y - 35 },
        width: REWRITE_NODE_WIDTH,
        style: { width: REWRITE_NODE_WIDTH },
        selected: true,
        data: { kind: "videoGenerator", title: "视频生成", videoGenerationProvider: "openrouter", videoGenerationModel: "", videoGenerationMode: "multimodal2video", duration: "5", ratio: "16:9", videoGenerationResolution: "720p", generateAudio: true, instruction: "" },
      };
      outputNode = {
        id: outputId,
        type: "video",
        position: { x: anchor.x + 1040, y: anchor.y },
        selected: true,
        data: { kind: "video", title: "生成视频" },
      };
    }
    const presetNodes = [referenceNode, processorNode, outputNode];
    const presetEdges: Edge[] = [
      { id: `edge-${flowId}-reference`, source: referenceId, target: processorId, targetHandle: "media-1", type: "disconnectable" },
      { id: `edge-${flowId}-output`, source: processorId, target: outputId, type: "disconnectable" },
    ];
    setNodes((current) => reconcileRuntimeNodes([
      ...current.map((node) => node.selected ? { ...node, selected: false } : node),
      ...presetNodes,
    ], providerCatalogsRef.current));
    setEdges((current) => [
      ...current.map((edge) => edge.selected ? { ...edge, selected: false } : edge),
      ...presetEdges,
    ]);
    setLastAddedNodeId(processorId);
    setToast(`已加入「${preset.label}」预设：3 个节点、2 条连线、1 个参考位`);
  }, [nodes, screenToFlowPosition]);

  const handlePresetDragStart = useCallback((event: ReactDragEvent<HTMLButtonElement>, presetId: FlowPresetId) => {
    event.dataTransfer.setData(FLOW_PRESET_DRAG_TYPE, presetId);
    event.dataTransfer.effectAllowed = "copy";
  }, []);

  const handleCanvasPresetDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer.types).includes(FLOW_PRESET_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleCanvasPresetDrop = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const presetId = event.dataTransfer.getData(FLOW_PRESET_DRAG_TYPE);
    if (!FLOW_PRESETS.some((preset) => preset.id === presetId)) return;
    event.preventDefault();
    event.stopPropagation();
    addFlowPreset(presetId as FlowPresetId, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }, [addFlowPreset, screenToFlowPosition]);

  const openCanvasProject = useCallback(async (id: string, closeManager = true, skipSave = false, forceReload = false) => {
    const reloadCurrent = id === projectId && (forceReload || pendingRemoteRevision > projectRevision);
    if (id === projectId && !reloadCurrent) {
      if (closeManager) setFileManagerOpen(false);
      return true;
    }
    if (reloadCurrent && saveState !== "saved") {
      setToast("当前有未保存编辑，请先保存副本，再载入后台版本");
      return false;
    }
    if (projectLoadBusy.current || saveInFlightRef.current) {
      setToast("正在保存或切换画布，请稍候");
      return false;
    }
    projectLoadBusy.current = true;
    try {
      if (!skipSave && (saveState === "unsaved" || saveState === "error") && !(await saveCurrent())) return false;
      setFileBusy(true);
      const project = await projectApi<CanvasProject>(`/projects/${id}`);
      suppressDirty.current = true;
      const completed = completeCanvas(project.nodes, project.edges);
      setNodes(reconcileRuntimeNodes(completed.nodes, providerCatalogsRef.current));
      setEdges(completed.edges);
      setProjectId(project.id);
      setProjectRevision(project.revision || 1);
      setPendingRemoteRevision(0);
      setProjectName(project.name);
      setOpenProjectIds((current) => current.includes(project.id) ? current : [...current, project.id]);
      setSaveState("saved");
      if (closeManager) setFileManagerOpen(false);
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, project.id);
      window.setTimeout(() => fitView({ padding: 0.12, duration: 350 }), 50);
      setToast(`已打开「${project.name}」`);
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "读取画布失败");
      return false;
    } finally {
      setFileBusy(false);
      projectLoadBusy.current = false;
    }
  }, [fitView, pendingRemoteRevision, projectId, projectRevision, saveCurrent, saveState]);

  const createCanvasProject = useCallback(async () => {
    if (projectLoadBusy.current || saveInFlightRef.current) return;
    projectLoadBusy.current = true;
    try {
      if ((saveState === "unsaved" || saveState === "error") && !(await saveCurrent())) return;
      setFileBusy(true);
      const fresh = freshCanvas();
      const id = crypto.randomUUID();
      const name = nextCanvasName(projects);
      const saved = await saveCanvasProject(id, name, fresh.nodes, fresh.edges);
      suppressDirty.current = true;
      setNodes(reconcileRuntimeNodes(fresh.nodes, providerCatalogsRef.current));
      setEdges(fresh.edges);
      setProjectId(id);
      setProjectRevision(saved.project.revision || 1);
      setProjectName(name);
      setProjects((current) => [saved.project, ...current]);
      setOpenProjectIds((current) => [...current.filter((openId) => openId !== id), id]);
      setSaveState("saved");
      setFileManagerOpen(false);
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, id);
      window.setTimeout(() => fitView({ padding: 0.12, duration: 350 }), 50);
      setToast(`已新建「${name}」`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "新建画布失败");
    } finally {
      setFileBusy(false);
      projectLoadBusy.current = false;
    }
  }, [fitView, projects, saveCurrent, saveState]);

  const closeCanvasTab = useCallback(async (id: string) => {
    if (openProjectIds.length <= 1) {
      setToast("至少需要保留一个画布标签");
      return;
    }
    const closingIndex = openProjectIds.indexOf(id);
    const remaining = openProjectIds.filter((openId) => openId !== id);
    if (id !== projectId) {
      setOpenProjectIds(remaining);
      return;
    }
    if ((saveState === "unsaved" || saveState === "error") && !(await saveCurrent())) return;
    const nextId = remaining[Math.min(closingIndex, remaining.length - 1)];
    if (await openCanvasProject(nextId, false, true)) setOpenProjectIds((current) => current.filter((openId) => openId !== id));
  }, [openCanvasProject, openProjectIds, projectId, saveCurrent, saveState]);

  const saveCanvasAs = useCallback(async () => {
    if (!projectId || projectLoadBusy.current || saveInFlightRef.current) return;
    projectLoadBusy.current = true;
    setFileBusy(true);
    try {
      const baseName = `${projectName} 副本`.slice(0, 60);
      const existingNames = new Set(projects.map((project) => project.name));
      let name = baseName;
      let suffix = 2;
      while (existingNames.has(name)) name = `${baseName.slice(0, 54)} ${suffix++}`;
      const id = crypto.randomUUID();
      const clonedNodes = structuredClone(portableProjectNodes(nodes)) as GraphNode[];
      const clonedEdges = structuredClone(edges) as Edge[];
      const saved = await saveCanvasProject(id, name, clonedNodes, clonedEdges);
      suppressDirty.current = true;
      setNodes(reconcileRuntimeNodes(clonedNodes, providerCatalogsRef.current));
      setEdges(clonedEdges);
      setProjectId(id);
      setProjectRevision(saved.project.revision || 1);
      setProjectName(name);
      setProjects((current) => [saved.project, ...current]);
      setOpenProjectIds((current) => [...current.filter((openId) => openId !== id), id]);
      setSaveState("saved");
      setFileManagerOpen(false);
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, id);
      setToast(`已另存为「${name}」，原画布未被覆盖`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "另存画布失败");
    } finally {
      setFileBusy(false);
      projectLoadBusy.current = false;
    }
  }, [edges, nodes, projectId, projectName, projects]);

  const exportCanvas = useCallback(() => {
    if (!projectId) return;
    try {
      const payload = {
        format: "prompt-flow-canvas",
        version: 1,
        exportedAt: new Date().toISOString(),
        project: { name: projectName, nodes: portableProjectNodes(nodes), edges },
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const safeName = (projectName || "Agent Canvas 画布").replace(/[\\/:*?"<>|]+/g, "-").trim();
      anchor.href = url;
      anchor.download = `${safeName || "Agent Canvas 画布"}.promptflow.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setToast("画布分享文件已导出");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "导出画布失败");
    }
  }, [edges, nodes, projectId, projectName]);

  const importCanvasFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || projectLoadBusy.current || saveInFlightRef.current) return;
    projectLoadBusy.current = true;
    try {
      if (file.size > MAX_PORTABLE_FILE_BYTES) throw new Error("画布分享文件超过 200MB，无法导入");
      if ((saveState === "unsaved" || saveState === "error") && !(await saveCurrent())) return;
      setFileBusy(true);
      const raw = JSON.parse(await file.text()) as unknown;
      const imported = parsePortableCanvas(raw);
      const sanitized = completeCanvas(portableProjectNodes(imported.nodes), imported.edges);
      const id = crypto.randomUUID();
      const fallbackName = file.name.replace(/\.promptflow\.json$|\.json$/i, "").trim();
      const name = (imported.name || fallbackName || "导入画布").slice(0, 60);
      const saved = await saveCanvasProject(id, name, sanitized.nodes, sanitized.edges);
      suppressDirty.current = true;
      setNodes(reconcileRuntimeNodes(sanitized.nodes, providerCatalogsRef.current));
      setEdges(sanitized.edges);
      setProjectId(id);
      setProjectRevision(saved.project.revision || 1);
      setProjectName(name);
      setProjects((current) => [saved.project, ...current]);
      setOpenProjectIds((current) => [...current.filter((openId) => openId !== id), id]);
      setSaveState("saved");
      setFileManagerOpen(false);
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, id);
      window.setTimeout(() => fitView({ padding: 0.12, duration: 350 }), 50);
      setToast(`已将「${name}」作为新画布打开`);
    } catch (error) {
      setToast(error instanceof SyntaxError ? "画布文件不是有效的 JSON" : error instanceof Error ? error.message : "打开画布文件失败");
    } finally {
      setFileBusy(false);
      projectLoadBusy.current = false;
    }
  }, [fitView, saveCurrent, saveState]);

  const beginRename = (project: CanvasProjectSummary) => {
    setRenamingId(project.id);
    setRenameValue(project.name);
  };

  const confirmRename = async (id: string, name = renameValue) => {
    const normalized = name.trim().slice(0, 60);
    if (!normalized || fileBusy) return;
    setFileBusy(true);
    try {
      const result = await projectApi<{ project: CanvasProjectSummary }>(`/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: normalized }),
      });
      setProjects((current) => [result.project, ...current.filter((project) => project.id !== id)]);
      if (id === projectId) {
        setProjectName(result.project.name);
        setProjectRevision(result.project.revision || projectRevision + 1);
      }
      setRenamingId("");
      setRenameValue("");
      setToast(`已重命名为「${result.project.name}」`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "重命名失败");
    } finally { setFileBusy(false); }
  };

  const autoNameCurrent = async () => {
    if (!projectId) return;
    const name = suggestedCanvasName(nodes);
    await confirmRename(projectId, name);
  };

  const organize = () => {
    const depthCache = new Map<string, number>();
    const getDepth = (id: string, path = new Set<string>()): number => {
      if (depthCache.has(id)) return depthCache.get(id) as number;
      if (path.has(id)) return 0;
      const nextPath = new Set(path).add(id);
      const parents = edges.filter((edge) => edge.target === id).map((edge) => edge.source);
      const depth = parents.length ? Math.max(...parents.map((parent) => getDepth(parent, nextPath))) + 1 : 0;
      depthCache.set(id, depth);
      return depth;
    };
    const columnY = new Map<number, number>();
    setNodes((current) => current.map((node) => {
      if (node.type === "group" || node.parentId) return node;
      const depth = getDepth(node.id);
      const y = columnY.get(depth) || 110;
      const height = node.type === "videogenerator" ? 1080 : node.type === "imagegenerator" ? 820 : node.type === "video" ? 520 : node.type === "reference" ? 460 : node.type === "codex" ? 700 : node.type === "prompteditor" ? 520 : node.type === "skill" ? 460 : isOutputNodeType(node.type) ? 430 : 270;
      columnY.set(depth, y + height);
      const position = { x: 80 + depth * 500, y };
      return { ...node, position };
    }));
    window.setTimeout(() => fitView({ padding: 0.12, duration: 350 }), 50);
    setToast(nodes.some((node) => node.type === "group") ? "已整理未编组节点，群组内部布局保持不变" : "画布节点已整理");
  };

  const reset = () => {
    const fresh = freshCanvas();
    setNodes(reconcileRuntimeNodes(fresh.nodes, providerCatalogsRef.current)); setEdges(fresh.edges); window.localStorage.removeItem(STORAGE_KEY);
    window.setTimeout(() => fitView({ padding: 0.12, duration: 350 }), 50);
    setToast("已恢复最简核心流程");
  };

  const openProjects = useMemo(() => openProjectIds
    .map((id) => projects.find((project) => project.id === id))
    .filter((project): project is CanvasProjectSummary => Boolean(project)), [openProjectIds, projects]);

  useEffect(() => {
    document.getElementById(`canvas-tab-${projectId}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [openProjectIds, projectId]);

  useEffect(() => {
    const handleFileShortcuts = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        void createCanvasProject();
      } else if (key === "o") {
        event.preventDefault();
        canvasFileInputRef.current?.click();
      } else if (key === "s" && event.shiftKey) {
        event.preventDefault();
        void saveCanvasAs();
      } else if (key === "s") {
        event.preventDefault();
        void saveCurrent();
      }
    };
    window.addEventListener("keydown", handleFileShortcuts);
    return () => window.removeEventListener("keydown", handleFileShortcuts);
  }, [createCanvasProject, saveCanvasAs, saveCurrent]);

  return (
    <main className={`node-app ${altCopyMode ? "is-alt-copy" : ""}`} ref={workspaceRef}>
      <div className="app-chrome">
        <header className="node-topbar">
        <div className="topbar-left">
          <div className="node-brand"><span>A</span><div><strong>Agent Canvas</strong><small>多 Skill 视觉工作流画板</small></div></div>
        </div>
        <div className="topbar-center"><span className={`bridge-pill ${bridgeState}`}><i />{bridgeState === "ready" ? "Agent 服务已连接" : bridgeState === "checking" ? "检查中" : "Agent 服务未连接"}</span><b>连接节点，组织你的视觉提示词工作流</b></div>
        <div className="node-actions"><button className="library-button" onClick={toggleLibrary}>节点库</button><button className="task-panel-button" onClick={toggleTaskPanel}>任务{activeTaskCount ? ` ${activeTaskCount}` : ""}</button><button className="file-manager-button" onClick={() => setFileManagerOpen(true)}>文件</button><button className="api-key-settings-button" onClick={() => void openApiKeySettings()}>API 密钥</button><label className="theme-selector" title="切换 Agent Canvas 界面主题"><span>主题</span><select aria-label="界面主题" value={themePreference} onChange={(event) => setThemePreference(event.target.value as ThemePreference)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label><button className="media-settings-button" onClick={openMediaSettings}>输出目录</button><button className="organize-button" onClick={organize}>整理</button><button className="history-action" title="撤销（Ctrl+Z）" disabled={!canUndo} onClick={undoCanvas}>撤销</button><button className="history-action" title="重做（Ctrl+Shift+Z / Ctrl+Y）" disabled={!canRedo} onClick={redoCanvas}>重做</button>{pendingRemoteRevision > projectRevision && <button className="history-action" title={saveState === "saved" ? "载入后台保存的新版本" : "请先保存或另存当前编辑"} disabled={fileBusy || saveState !== "saved"} onClick={() => void openCanvasProject(projectId, false, true, true)}>后台更新可载入</button>}<button className={`top-save ${saveState}`} disabled={!projectId || fileBusy} onClick={() => void saveCurrent()}>{saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存" : "保存画布"}</button></div>
        </header>
        <div className="canvas-tabs">
          <div className="canvas-tab-list" role="tablist" aria-label="已打开的画布">
            {openProjects.map((project) => {
              const active = project.id === projectId;
              const unsaved = active && saveState !== "saved";
              return (
                <div id={`canvas-tab-${project.id}`} className={`canvas-tab ${active ? "active" : ""} ${unsaved ? "unsaved" : ""}`} key={project.id}>
                  <button className="canvas-tab-main" role="tab" aria-selected={active} aria-controls="canvas-workspace-panel" tabIndex={active ? 0 : -1} disabled={fileBusy} onClick={() => void openCanvasProject(project.id, false)}>
                    <i className="tab-status-dot" aria-hidden="true" />
                    <span>{project.name}</span>
                  </button>
                  <button className="canvas-tab-close" aria-label={`关闭画布标签：${project.name}`} disabled={fileBusy} onClick={() => void closeCanvasTab(project.id)}>×</button>
                </div>
              );
            })}
          </div>
          <div className="canvas-tab-tools">
            <button aria-label="新建画布" title="新建画布（Ctrl/Cmd + N）" disabled={fileBusy} onClick={() => void createCanvasProject()}>＋</button>
            <button aria-label="打开画布文件" title="打开画布文件（Ctrl/Cmd + O）" disabled={fileBusy} onClick={() => canvasFileInputRef.current?.click()}>打开文件</button>
            <button aria-label="查看全部画布" onClick={() => setFileManagerOpen(true)}>全部画布</button>
          </div>
          <input ref={canvasFileInputRef} className="canvas-file-input" type="file" hidden accept=".promptflow.json,.json,application/json" onChange={(event) => void importCanvasFile(event)} />
        </div>
      </div>

      {apiKeySettingsOpen && (
        <div className="file-manager-backdrop">
          <section className="api-key-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="api-key-settings-title">
            <header className="file-manager-head">
              <div><span>本机凭据</span><h2 id="api-key-settings-title">API 密钥</h2><p>密钥只写入本机 .env.local，不会进入画布、分享文件或浏览器存储。</p></div>
              <button aria-label="关闭 API 密钥设置" disabled={apiKeySettingsBusy} onClick={() => setApiKeySettingsOpen(false)}>×</button>
            </header>
            <div className="api-key-settings-body">
              {apiKeySettingsBusy && !apiKeySettings && <div className="api-key-settings-loading">正在读取本机配置…</div>}
              {(["通用渠道", "Comfly GPT Image 2 专用"] as const).map((group) => (
                <section className="api-key-settings-group" key={group}>
                  <header><strong>{group}</strong><span>{group === "通用渠道" ? "提示词、图片与视频共用渠道" : "不同分辨率严格使用各自的 Key"}</span></header>
                  <div className="api-key-field-list">
                    {API_KEY_FIELDS.filter((field) => field.group === group).map((field) => {
                      const configured = Boolean(apiKeySettings?.configured[field.name]);
                      const cleared = Boolean(apiKeyCleared[field.name]);
                      const draft = apiKeyDrafts[field.name] || "";
                      return (
                        <div className={`api-key-field ${configured ? "is-configured" : ""} ${cleared ? "is-cleared" : ""}`} key={field.name}>
                          <label htmlFor={`api-key-${field.name}`}><span><strong>{field.label}</strong><small>{field.description}</small></span><code>{field.name}</code></label>
                          <div className="api-key-input-row">
                            <input
                              id={`api-key-${field.name}`}
                              type={apiKeyVisible[field.name] ? "text" : "password"}
                              autoComplete="new-password"
                              spellCheck={false}
                              disabled={apiKeySettingsBusy || cleared}
                              value={draft}
                              placeholder={cleared ? "保存后清除" : configured ? "已配置；输入新值可替换" : "粘贴 API Key"}
                              onChange={(event) => {
                                const value = event.target.value;
                                setApiKeyDrafts((current) => ({ ...current, [field.name]: value }));
                                if (apiKeyCleared[field.name]) setApiKeyCleared((current) => ({ ...current, [field.name]: false }));
                              }}
                            />
                            <button type="button" disabled={!draft || apiKeySettingsBusy || cleared} onClick={() => setApiKeyVisible((current) => ({ ...current, [field.name]: !current[field.name] }))}>{apiKeyVisible[field.name] ? "隐藏" : "显示"}</button>
                            <button className="api-key-clear" type="button" disabled={apiKeySettingsBusy || (!configured && !draft && !cleared)} onClick={() => { setApiKeyDrafts((current) => ({ ...current, [field.name]: "" })); setApiKeyCleared((current) => ({ ...current, [field.name]: !current[field.name] })); }}>{cleared ? "撤销" : "清除"}</button>
                          </div>
                          <div className="api-key-field-status"><i aria-hidden="true" /><span>{cleared ? "待清除" : configured ? "已配置，真实值不会回显" : "未配置"}</span></div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
              {apiKeySettingsError && <div className="api-key-settings-error" role="alert">{apiKeySettingsError}</div>}
            </div>
            <footer className="media-settings-actions api-key-settings-actions">
              <small>保存文件：{apiKeySettings?.envFile || ".env.local"}</small>
              <div><button disabled={apiKeySettingsBusy} onClick={() => setApiKeySettingsOpen(false)}>取消</button><button className="primary" disabled={apiKeySettingsBusy} onClick={() => void saveApiKeySettings()}>{apiKeySettingsBusy ? "保存中…" : "保存并刷新渠道"}</button></div>
            </footer>
          </section>
        </div>
      )}

      {mediaSettingsOpen && (
        <div className="file-manager-backdrop">
          <section className="media-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="media-settings-title">
            <header className="file-manager-head">
              <div><span>自动下载</span><h2 id="media-settings-title">图片与视频保存目录</h2><p>生成任务完成后，桥接服务会自动把原始图片或视频保存到这个本机目录。</p></div>
              <button aria-label="关闭输出目录设置" onClick={() => setMediaSettingsOpen(false)}>×</button>
            </header>
            <div className="media-settings-body">
              <label><span>本机绝对路径</span><input autoFocus value={mediaDirectoryDraft} disabled={mediaSettingsBusy} placeholder={mediaDefaultDirectory || "D:\\生成结果"} onChange={(event) => setMediaDirectoryDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveMediaSettings(); } }} /></label>
              <small>目录不存在时会自动创建。当前目录：{mediaDirectory || "正在读取…"}</small>
            </div>
            <footer className="media-settings-actions">
              <button disabled={mediaSettingsBusy || !mediaDefaultDirectory} onClick={() => setMediaDirectoryDraft(mediaDefaultDirectory)}>恢复默认</button>
              <div><button disabled={mediaSettingsBusy} onClick={() => setMediaSettingsOpen(false)}>取消</button><button className="primary" disabled={mediaSettingsBusy || !mediaDirectoryDraft.trim()} onClick={() => void saveMediaSettings()}>{mediaSettingsBusy ? "保存中…" : "保存设置"}</button></div>
            </footer>
          </section>
        </div>
      )}

      {fileManagerOpen && (
        <div className="file-manager-backdrop">
          <section className="file-manager" role="dialog" aria-modal="true" aria-labelledby="file-manager-title">
            <header className="file-manager-head">
              <div><span>本地画布管理</span><h2 id="file-manager-title">画布文件</h2><p>画布、提示词、图片和视频参考都保存在这台电脑上。</p></div>
              <button aria-label="关闭文件管理" onClick={() => setFileManagerOpen(false)}>×</button>
            </header>

            <div className="file-manager-toolbar">
              <div><b>{projects.length}</b><span>个画布文件</span></div>
              <div><button className="open-file-button" disabled={fileBusy} onClick={() => canvasFileInputRef.current?.click()}>打开画布文件</button><button className="save-as-button" disabled={!projectId || fileBusy} onClick={() => void saveCanvasAs()}>另存为</button><button className="export-canvas-button" disabled={!projectId || fileBusy} onClick={exportCanvas}>导出分享</button><button className="auto-name-button" disabled={!projectId || fileBusy} onClick={() => void autoNameCurrent()}>自动命名当前画布</button><button className="new-canvas-button" disabled={fileBusy} onClick={() => void createCanvasProject()}>＋ 新建画布</button></div>
            </div>

            <div className="project-list">
              {projects.map((project) => (
                <article className={`project-row ${project.id === projectId ? "current" : ""}`} key={project.id}>
                  <div className="project-open">
                    <span className="project-file-icon">PF</span>
                    {renamingId === project.id ? <span className="project-file-info"><input autoFocus value={renameValue} maxLength={60} aria-label="画布名称" onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void confirmRename(project.id); } if (event.key === "Escape") setRenamingId(""); }} /><small>{new Date(project.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} · {project.referenceCount} 个参考节点 · {project.mediaCount ?? project.imageCount} 个素材文件</small></span> : <button className="project-file-info" disabled={fileBusy} onClick={() => void openCanvasProject(project.id)}><strong>{project.name}</strong><small>{new Date(project.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} · {project.referenceCount} 个参考节点 · {project.mediaCount ?? project.imageCount} 个素材文件</small></button>}
                    {project.id === projectId && <b className="current-project-badge">当前</b>}
                  </div>
                  <div className="project-row-actions">
                    {renamingId === project.id ? <><button disabled={fileBusy} onClick={() => void confirmRename(project.id)}>确定</button><button onClick={() => setRenamingId("")}>取消</button></> : <button onClick={() => beginRename(project)}>重命名</button>}
                  </div>
                </article>
              ))}
              {!projects.length && <div className="project-list-empty">还没有画布文件，点击“新建画布”开始。</div>}
            </div>

            <footer className="file-manager-foot"><span>修改画布后点击顶部“保存画布”，也可以按 Ctrl + S。</span><button onClick={() => { reset(); setFileManagerOpen(false); }}>将当前画布恢复为初始节点</button></footer>
          </section>
        </div>
      )}

      <section className="workspace-shell" id="canvas-workspace-panel" role="tabpanel" aria-label={`当前画布：${projectName}`}>
        <aside ref={libraryRef} className={`node-library ${libraryOpen ? "is-open" : "is-closed"}`} aria-label="节点库">
          <header className="node-library-head">
            <div className="node-library-copy"><strong>节点库</strong><span>点击添加到画布</span></div>
            <button className="library-toggle" aria-label={libraryOpen ? "收起节点库" : "展开节点库"} aria-expanded={libraryOpen} onClick={toggleLibrary}>{libraryOpen ? "‹" : "›"}</button>
          </header>
          <div className="node-library-grid">
            <button className="palette-card palette-reference" onClick={() => addCanvasNode("reference")}><span className="palette-glyph">图</span><span className="palette-copy"><b>图片</b><small>上传、预览或接收生成图片</small></span><i>＋</i></button>
            <button className="palette-card palette-video" onClick={() => addCanvasNode("video")}><span className="palette-glyph">视</span><span className="palette-copy"><b>视频</b><small>上传、播放或接收生成视频</small></span><i>＋</i></button>
            <button className="palette-card palette-output" onClick={() => addCanvasNode("text")}><span className="palette-glyph">文</span><span className="palette-copy"><b>文本框</b><small>左右连线，支持复制与粘贴</small></span><i>＋</i></button>
            <button className="palette-card palette-skill" onClick={() => addCanvasNode("skill")}><span className="palette-glyph">技</span><span className="palette-copy"><b>Skill</b><small>管理并接入提示词编辑技能</small></span><i>＋</i></button>
            <button className="palette-card palette-rewrite" onClick={() => addCanvasNode("codex")}><span className="palette-glyph">改</span><span className="palette-copy"><b>编辑改写</b><small>选择 Agent 与提示词 Skill</small></span><i>＋</i></button>
            <button className="palette-card palette-image-generator" onClick={() => addCanvasNode("imagegenerator")}><span className="palette-glyph">生</span><span className="palette-copy"><b>图片生成</b><small>12 图参考与可连接提示词</small></span><i>＋</i></button>
            <button className="palette-card palette-video-generator" onClick={() => addCanvasNode("videogenerator")}><span className="palette-glyph">影</span><span className="palette-copy"><b>视频生成</b><small>三路供应商与 12 位全能参考</small></span><i>＋</i></button>
            <button className="palette-card palette-editor" onClick={() => addCanvasNode("prompteditor")}><span className="palette-glyph">编</span><span className="palette-copy"><b>编辑提示词</b><small>修改意见、原提示词接入与完整输出</small></span><i>＋</i></button>
            <section className="preset-library" aria-labelledby="preset-library-title">
              <header><div><strong id="preset-library-title">预设库</strong><span>拖入一段已连线流程</span></div><b>3</b></header>
              <div className="preset-library-list">
                {FLOW_PRESETS.map((preset) => (
                  <button className={`preset-card preset-${preset.id}`} type="button" draggable onDragStart={(event) => handlePresetDragStart(event, preset.id)} onClick={() => addFlowPreset(preset.id)} title={`拖到画布，或点击添加「${preset.label}」`} key={preset.id}>
                    <span>{preset.glyph}</span><span><b>{preset.label}</b><small>{preset.description}</small></span><i>⋮⋮</i>
                  </button>
                ))}
              </div>
              <small className="preset-library-note">每个预设仅放入 1 个参考位，不包含真实素材</small>
            </section>
          </div>
          <footer className="node-library-foot"><span>{nodes.length} 个节点</span><b>拖入预设快速搭建</b></footer>
        </aside>
        <section className="flow-canvas" aria-label="Agent Canvas 画布" tabIndex={0} onDragOver={handleCanvasPresetDragOver} onDrop={handleCanvasPresetDrop} onMouseMove={(event) => { lastPointerClientRef.current = { x: event.clientX, y: event.clientY }; }}>
          <ReactFlow
            nodes={renderNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onEdgeContextMenu={onEdgeContextMenu}
            isValidConnection={isValidConnection}
            connectionLineType={ConnectionLineType.Bezier}
            connectionLineStyle={{ stroke: "var(--edge-color)", strokeWidth: 2.1 }}
            fitView
            fitViewOptions={{ padding: 0.12 }}
            minZoom={CANVAS_MIN_ZOOM}
            maxZoom={CANVAS_MAX_ZOOM}
            deleteKeyCode={null}
            multiSelectionKeyCode="Shift"
            defaultEdgeOptions={{ type: "disconnectable", interactionWidth: 24, style: { stroke: "var(--edge-color)", strokeWidth: 2.1 } }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.1} color="var(--canvas-dot)" />
            <Controls position="bottom-right" showInteractive={false} />
          </ReactFlow>
          <div className="canvas-shortcuts-hint" aria-hidden="true"><kbd>Alt</kbd> 拖动复制 <span>·</span> <kbd>Ctrl G</kbd> 编组 / 加入 <span>·</span> <kbd>Ctrl ⇧ G</kbd> 移出 <span>·</span> <kbd>Ctrl ⌫</kbd> 解组 <span>·</span> <kbd>Ctrl</kbd> Z 撤销 <span>·</span> <kbd>Delete</kbd> 删除</div>
          <div className="flow-toast"><i className={bridgeState} />{toast}</div>
        </section>
        <aside className={`task-center ${taskPanelOpen ? "is-open" : "is-closed"}`} aria-label="任务中心">
          <header className="task-center-head">
            <div className="task-center-copy"><strong>任务中心</strong><span>生成进度与并行队列</span></div>
            <button className="task-center-toggle" aria-label={taskPanelOpen ? "收起任务中心" : "展开任务中心"} aria-expanded={taskPanelOpen} onClick={toggleTaskPanel}>›</button>
          </header>
          <div className="task-center-summary">
            <div><b>进行中 {activeTaskCount}</b><span>排队 {queuedTaskCount}</span></div>
            <label className="task-concurrency">并行<select value={taskConcurrency} onChange={(event) => void changeTaskConcurrency(Number(event.target.value))}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>
          </div>
          <div className="task-list">
            {!sortedTasks.length && <div className="task-empty"><strong>还没有任务</strong><span>点击提示词、图片或视频生成后，真实进度会显示在这里。</span></div>}
            {sortedTasks.map((task) => {
              const stageIndex = taskStageIndex(task.stage);
              const isActive = ACTIVE_TASK_STATUSES.has(task.status);
              const promptTask = task.kind === "generation" || task.kind === "revision";
              let agentTaskProvider: AgentProvider | null = null;
              if (promptTask) {
                try { agentTaskProvider = normalizeTaskProvider(task.provider); }
                catch { /* Unknown providers remain visible but never masquerade as Codex. */ }
              }
              const taskModel = agentTaskProvider ? providerCatalogs[agentTaskProvider].models.find((model) => model.model === task.model) : undefined;
              const taskCategory = task.kind === "image-generation" ? "图片生成" : task.kind === "video-generation" ? "视频生成" : promptSkillLabel(normalizePromptSkill(task.skillId), skillRegistry);
              const taskMetaText = [taskCategory, taskProviderLabel(task), taskModel?.displayName || task.model || "默认模型", promptTask ? REASONING_LABELS[task.reasoningEffort || ""] || task.reasoningEffort || "默认思考" : null].filter(Boolean).join(" · ");
              return (
                <article className={`task-card status-${task.status}`} key={task.id}>
                  <div className="task-card-head"><i className="task-status-dot" /><strong className="task-title" title={task.title}>{task.title}</strong><small>{task.id.slice(0, 6)}</small></div>
                  <div className="task-meta"><span>{taskMetaText}</span><time>{formatTaskElapsed(task, taskClock)}</time></div>
                  <div className="task-stage"><span title={task.error || task.result?.saveError}>{task.error || task.result?.saveError || TASK_STAGE_LABELS[task.stage]}</span></div>
                  <div className="task-progress" aria-label={`任务阶段：${TASK_STAGE_LABELS[task.stage]}`}>
                    {[1, 2, 3, 4].map((step) => <i className={`${task.status === "completed" || stageIndex > step ? "done" : ""} ${isActive && stageIndex === step ? "active" : ""}`} key={step} />)}
                  </div>
                  <div className="task-card-actions">
                    <button onClick={() => locateTaskNode(task)}>定位节点</button>
                    {task.status === "completed" && <button onClick={() => locateTaskNode(task, true)}>查看结果</button>}
                    {task.status === "failed" && <button onClick={() => void copyTaskError(task)}>复制错误</button>}
                    {isActive ? <button disabled={task.id.startsWith("local-")} onClick={() => void cancelTask(task.id)}>{task.id.startsWith("local-") ? "提交中" : "取消"}</button> : <button onClick={() => retryTask(task)}>再次运行</button>}
                  </div>
                </article>
              );
            })}
          </div>
          <footer className="task-center-foot"><span>保留最近 20 条任务</span><button disabled={!tasks.some((task) => !ACTIVE_TASK_STATUSES.has(task.status))} onClick={() => void clearCompletedTasks()}>清除已结束</button></footer>
        </aside>
      </section>
    </main>
  );
}

export default function FlowCanvas() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setMounted(true), 0); return () => window.clearTimeout(timer); }, []);
  if (!mounted) return <main className="node-app node-loading"><div><span>P</span><strong>正在载入节点画板…</strong></div></main>;
  return <ReactFlowProvider><FlowWorkspace /></ReactFlowProvider>;
}
