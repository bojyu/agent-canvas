"use client";

import { ChangeEvent, MouseEvent as ReactMouseEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

gsap.registerPlugin(useGSAP);

type NodeKind = "reference" | "video" | "textBox" | "codex" | "promptEditor" | "imageGenerator" | "videoGenerator" | "imageOutput" | "videoOutput" | "output" | "revision" | "revisedOutput" | "textInput" | "textOutput";
type PaletteNodeKind = "reference" | "video" | "text" | "codex" | "prompteditor" | "imagegenerator" | "videogenerator";
type MediaSlot = {
  slot: number;
  marker: string;
  sourceId?: string;
  fileName?: string;
  mediaKind?: "image" | "video";
  hasMedia: boolean;
};
type AgentProvider = "codex" | "openrouter" | "comfly" | "grok-build" | "antigravity";
type PromptSkillId = "seedance" | "image" | "photoreal";
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
  generatedImages?: GeneratedImage[];
  generatedVideos?: GeneratedVideo[];
  imageError?: string;
  videoGenerationError?: string;
  generationMeta?: string;
  assignedMarkers?: string[];
  onUpdate?: (patch: Partial<GraphData>) => void;
  onDelete?: () => void;
  onRun?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
};

type GraphNode = Node<GraphData>;
type CanvasProjectSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  referenceCount: number;
  imageCount: number;
  mediaCount?: number;
};
type CanvasProject = { id: string; name: string; createdAt: string; updatedAt: string; nodes: GraphNode[]; edges: Edge[] };
type CanvasClipboardPayload = { projectId: string; nodes: GraphNode[] };
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
  result?: { prompt?: string; changes?: string; title?: string; threadId?: string; skillId?: PromptSkillId; images?: GeneratedImage[]; videos?: GeneratedVideo[]; resolution?: string; aspectRatio?: string; duration?: number; mode?: VideoGenerationMode; jobId?: string; savedFiles?: string[]; outputDirectory?: string; saveError?: string };
  error?: string;
};
type TaskEvent =
  | { type: "snapshot"; tasks: CanvasTask[]; concurrency: number }
  | { type: "task"; task: CanvasTask }
  | { type: "config"; concurrency: number };
const STORAGE_KEY = "prompt-flow-core-v3";
const ACTIVE_PROJECT_KEY = "prompt-flow-active-project";
const OPEN_PROJECTS_KEY = "prompt-flow-open-projects";
const LIBRARY_STATE_KEY = "prompt-flow-library-open";
const TASK_PANEL_STATE_KEY = "prompt-flow-task-panel-open";
const SAVED_TASK_IDS_KEY = "prompt-flow-saved-task-ids";
const BRIDGE_URL = "http://127.0.0.1:4317";
const PROVIDERS: AgentProvider[] = ["codex", "openrouter", "comfly", "grok-build", "antigravity"];
const PROVIDER_LABELS: Record<AgentProvider, string> = {
  codex: "Codex",
  openrouter: "OpenRouter",
  comfly: "Comfly",
  "grok-build": "Grok Build",
  antigravity: "Antigravity",
};
const PROMPT_SKILLS: PromptSkillId[] = ["seedance", "image", "photoreal"];
const PROMPT_SKILL_LABELS: Record<PromptSkillId, string> = {
  seedance: "Seedance 视频提示词",
  image: "Image 图像提示词",
  photoreal: "真实感场景与模特图",
};
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
const MAX_IMAGE_GENERATION_IMAGES = 12;
const MAX_VIDEO_GENERATION_REFERENCES = 12;
const MAX_IMAGES = MAX_IMAGE_GENERATION_IMAGES;
const MAX_VIDEOS = 3;
const MAX_REWRITE_REFERENCES = MAX_REWRITE_IMAGES + MAX_VIDEOS;
const MAX_CANVAS_REFERENCES = MAX_IMAGES + MAX_VIDEOS;
const ACTIVE_TASK_STATUSES = new Set<TaskStatus>(["queued", "running"]);
const TERMINAL_TASK_STATUSES = new Set<TaskStatus>(["completed", "failed", "cancelled"]);
const TASK_POLL_FALLBACK_MS = 3_000;
const TASK_POLL_CONNECTED_MS = 15_000;
const TASK_SUBMIT_TIMEOUT_MS = 30_000;
const MAX_PORTABLE_NODES = 500;
const MAX_PORTABLE_EDGES = 2_000;
const MAX_PORTABLE_FILE_BYTES = 200_000_000;
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
  if (skillId === "seedance" || skillId === "image" || skillId === "photoreal") return skillId;
  throw new Error(`不支持的提示词 Skill：${String(skillId)}`);
}

function isImagePromptSkill(skillId: unknown): skillId is "image" | "photoreal" {
  const normalized = normalizePromptSkill(skillId);
  return normalized === "image" || normalized === "photoreal";
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

function NodeFrame({ data, tone, children, input = false, inputHandleId, output = true, onDoubleClick }: { data: GraphData; tone: string; children: ReactNode; input?: boolean; inputHandleId?: string; output?: boolean; onDoubleClick?: (event: ReactMouseEvent<HTMLElement>) => void }) {
  return (
    <article className={`core-node tone-${tone}`} onDoubleClick={onDoubleClick}>
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
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => data.onUpdate?.({ fileName: file.name, preview: String(reader.result), imageData: String(reader.result), generatedImages: undefined, imageError: undefined, generationMeta: undefined });
    reader.readAsDataURL(file);
    event.target.value = "";
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
      <NodeFrame data={data} tone="image" input output onDoubleClick={handleDoubleClick}>
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
        ) : <div className="media-output-empty">{data.busy ? "图片任务执行中，结果会自动写入这里。" : "双击节点上传图片，也可以粘贴剪贴板图片或连接图片生成节点。"}</div>}
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

function CodexNode({ data }: NodeProps<GraphNode>) {
  const skillId = normalizePromptSkill(data.skillId);
  const imagePromptSkill = isImagePromptSkill(skillId);
  const slots: MediaSlot[] = data.inputSlots || Array.from({ length: MAX_REWRITE_REFERENCES }, (_, index) => ({ slot: index + 1, marker: `参考位 ${index + 1}`, hasMedia: false }));
  return (
    <NodeFrame data={data} tone="codex" input={false}>
      <label className="skill-selector nodrag"><span>提示词 Skill</span><select value={skillId} onChange={(event) => data.onUpdate?.({ skillId: normalizePromptSkill(event.target.value), threadId: undefined })}>{PROMPT_SKILLS.map((id) => <option value={id} key={id}>{PROMPT_SKILL_LABELS[id]}</option>)}</select></label>

      <ModelControls data={data} helper={imagePromptSkill ? "支持参考图片" : "支持图片与视频取帧"} mediaAware />

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
        <textarea value={data.instruction} onChange={(event) => data.onUpdate?.({ instruction: event.target.value })} placeholder={imagePromptSkill ? "输入图像创作或改图需求；引用素材时使用上方显示的 @图片N。" : "输入视频创作需求；引用素材时使用上方显示的 @图片N / @视频N。"} />
      </label>

      <button className="nodrag core-run" disabled={data.busy} onClick={data.onRun}>
        {data.busy ? data.busyLabel || "任务处理中…" : imagePromptSkill ? skillId === "photoreal" ? "生成真实感提示词" : "生成图像提示词" : "生成视频提示词"}<b>{data.busy ? "···" : "↗"}</b>
      </button>
    </NodeFrame>
  );
}

function PromptEditorNode({ data }: NodeProps<GraphNode>) {
  const originalPrompt = String(data.promptConnected ? data.promptInput || "" : data.prompt || "");
  const promptCount = originalPrompt.replace(/\s/g, "").length;
  const instruction = String(data.instruction || "");
  const instructionCount = instruction.replace(/\s/g, "").length;
  const skillId = normalizePromptSkill(data.skillId);
  return (
    <NodeFrame data={data} tone="prompt-editor" output>
      <div className="editor-mode"><i />只修改现有提示词，不重新生成创意</div>
      <label className="skill-selector nodrag"><span>提示词 Skill</span><select value={skillId} onChange={(event) => data.onUpdate?.({ skillId: normalizePromptSkill(event.target.value), threadId: undefined })}>{PROMPT_SKILLS.map((id) => <option value={id} key={id}>{PROMPT_SKILL_LABELS[id]}</option>)}</select></label>
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

const nodeTypes = {
  reference: ReferenceNode,
  video: VideoNode,
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
    if (item.type === "codex" && item.data.skillId !== undefined && !PROMPT_SKILLS.includes(item.data.skillId as PromptSkillId)) {
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

async function saveCanvasProject(id: string, name: string, nodes: GraphNode[], edges: Edge[]) {
  return projectApi<{ project: CanvasProjectSummary }>(`/projects/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, nodes: projectNodes(nodes), edges }),
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
  const [tasks, setTasks] = useState<CanvasTask[]>([]);
  const [taskConcurrency, setTaskConcurrency] = useState(2);
  const [taskClock, setTaskClock] = useState(() => Date.now());
  const [taskPanelOpen, setTaskPanelOpen] = useState(() => typeof window === "undefined" ? true : window.localStorage.getItem(TASK_PANEL_STATE_KEY) !== "false");
  const [toast, setToast] = useState("连接图片或视频到改写节点的参考序号端口");
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("正在载入画布…");
  const [projects, setProjects] = useState<CanvasProjectSummary[]>([]);
  const [openProjectIds, setOpenProjectIds] = useState<string[]>([]);
  const [fileManagerOpen, setFileManagerOpen] = useState(false);
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
  const [lastAddedNodeId, setLastAddedNodeId] = useState("");
  const [altCopyMode, setAltCopyMode] = useState(false);
  const [historyAvailability, setHistoryAvailability] = useState({ canUndo: false, canRedo: false });
  const suppressDirty = useRef(true);
  const providerCatalogsRef = useRef(providerCatalogs);
  const imageProviderCatalogsRef = useRef(imageProviderCatalogs);
  const videoGenerationProviderCatalogsRef = useRef(videoGenerationProviderCatalogs);
  const appliedTaskIds = useRef(new Set<string>());
  const savedTaskIds = useRef(new Set<string>());
  const canvasFileInputRef = useRef<HTMLInputElement>(null);
  const projectLoadBusy = useRef(false);
  const canvasClipboardRef = useRef<CanvasClipboardPayload | null>(null);
  const pasteCountRef = useRef(0);
  const lastPointerClientRef = useRef<{ x: number; y: number } | null>(null);
  const altDragCopyActiveRef = useRef(false);
  const altDragCopyStateRef = useRef<{
    pairs: { originalId: string; copyId: string; originalPosition: { x: number; y: number } }[];
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
      const finalPositions = new Map(copyState.pairs.map((pair) => {
        const movedNode = draggedNode?.id === pair.originalId ? draggedNode : currentById.get(pair.originalId);
        return [pair.originalId, movedNode ? { ...movedNode.position } : { ...pair.originalPosition }];
      }));
      return current.map((node) => {
        const originalPair = pairByOriginal.get(node.id);
        if (originalPair) return { ...node, position: { ...originalPair.originalPosition }, selected: false, dragging: false };
        const copyPair = pairByCopy.get(node.id);
        if (copyPair) return { ...node, position: finalPositions.get(copyPair.originalId) || node.position, selected: true, dragging: false };
        return node.selected ? { ...node, selected: false } : node;
      });
    });
    const copyToOriginalId = new Map(copyState.pairs.map((pair) => [pair.copyId, pair.originalId]));
    setEdges((current) => current.map((edge) => ({
      ...edge,
      source: copyToOriginalId.get(edge.source) || edge.source,
      target: copyToOriginalId.get(edge.target) || edge.target,
    })));
    setLastAddedNodeId(copyState.pairs[0]?.copyId || "");
    setToast(`已复制 ${copyState.pairs.length} 个独立节点，原节点和连线保持原位`);
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Alt") setAltCopyMode(true);
      if (fileManagerOpen || mediaSettingsOpen || isEditableTarget(event.target)) return;
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

      if (modifier && key === "c") {
        const selectedNodes = nodes.filter((node) => node.selected);
        if (!selectedNodes.length) return;
        canvasClipboardRef.current = {
          projectId,
          nodes: selectedNodes.map((node) => duplicatedNode(node)),
        };
        pasteCountRef.current = 0;
        event.preventDefault();
        setToast(`已复制 ${selectedNodes.length} 个节点，不包含连线`);
        return;
      }

      if (modifier && key === "v") {
        const clipboard = canvasClipboardRef.current;
        if (!clipboard?.nodes.length) return;
        event.preventDefault();
        if (clipboard.projectId !== projectId) {
          setToast("节点剪贴板属于另一个画布，请在当前画布重新复制");
          return;
        }
        const imageCopies = clipboard.nodes.filter((node) => node.type === "reference").length;
        const videoCopies = clipboard.nodes.filter((node) => node.type === "video").length;
        const currentImages = nodes.filter((node) => node.type === "reference").length;
        const currentVideos = nodes.filter((node) => node.type === "video").length;
        if (currentImages + imageCopies > MAX_IMAGES || currentVideos + videoCopies > MAX_VIDEOS || currentImages + currentVideos + imageCopies + videoCopies > MAX_CANVAS_REFERENCES) {
          setToast("粘贴后会超过图片或视频节点上限");
          return;
        }
        pasteCountRef.current += 1;
        const minX = Math.min(...clipboard.nodes.map((node) => node.position.x));
        const minY = Math.min(...clipboard.nodes.map((node) => node.position.y));
        const pointer = lastPointerClientRef.current ? screenToFlowPosition(lastPointerClientRef.current) : null;
        const cascade = pasteCountRef.current * 22;
        const offsetX = pointer ? pointer.x - minX + cascade : cascade;
        const offsetY = pointer ? pointer.y - minY + cascade : cascade;
        const pastedNodes = clipboard.nodes.map((node) => duplicatedNode(node, `${node.type || "node"}-${crypto.randomUUID().slice(0, 8)}`, {
          x: node.position.x + offsetX,
          y: node.position.y + offsetY,
        }, true));
        setNodes((current) => [...current.map((node) => node.selected ? { ...node, selected: false } : node), ...pastedNodes]);
        setLastAddedNodeId(pastedNodes[0]?.id || "");
        setToast(`已粘贴 ${pastedNodes.length} 个独立节点`);
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const selectedNodeIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
      const selectedEdgeIds = new Set(edges.filter((edge) => edge.selected).map((edge) => edge.id));
      if (!selectedNodeIds.size && !selectedEdgeIds.size) return;
      event.preventDefault();
      if (selectedNodeIds.size) setNodes((current) => current.filter((node) => !selectedNodeIds.has(node.id)));
      setEdges((current) => current.filter((edge) => !selectedEdgeIds.has(edge.id) && !selectedNodeIds.has(edge.source) && !selectedNodeIds.has(edge.target)));
      setToast(selectedNodeIds.size
        ? `已删除 ${selectedNodeIds.size} 个节点及其连线`
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
  }, [edges, fileManagerOpen, finishAltDragCopy, mediaSettingsOpen, nodes, projectId, redoCanvas, screenToFlowPosition, undoCanvas]);

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

  useEffect(() => {
    if (!tasks.some((task) => ACTIVE_TASK_STATUSES.has(task.status))) return;
    const timer = window.setInterval(() => setTaskClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [tasks]);

  useEffect(() => {
    let cancelled = false;
    async function initializeWorkspace() {
      let initial = freshCanvas();
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as { nodes?: GraphNode[]; edges?: Edge[] };
          if (parsed.nodes?.length && parsed.edges) initial = completeCanvas(parsed.nodes, parsed.edges);
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
          project = { id, name, createdAt: saved.project.createdAt, updatedAt: saved.project.updatedAt, ...initial };
          summaries = [saved.project];
        }
        if (cancelled) return;
        suppressDirty.current = true;
        const completed = completeCanvas(project.nodes, project.edges);
        setNodes(reconcileRuntimeNodes(completed.nodes, providerCatalogsRef.current));
        setEdges(completed.edges);
        setProjectId(project.id);
        setProjectName(project.name);
        setProjects(summaries);
        let storedOpenIds: string[] = [];
        try {
          const parsedOpenIds = JSON.parse(window.localStorage.getItem(OPEN_PROJECTS_KEY) || "[]") as unknown;
          if (Array.isArray(parsedOpenIds)) storedOpenIds = parsedOpenIds.filter((id): id is string => typeof id === "string");
        } catch { /* Invalid tab preferences are ignored. */ }
        const validIds = new Set(summaries.map((summary) => summary.id));
        setOpenProjectIds([...new Set([...storedOpenIds.filter((id) => validIds.has(id)), project.id])]);
        setSaveState("saved");
        window.localStorage.setItem(ACTIVE_PROJECT_KEY, project.id);
        setToast(`已打开「${project.name}」`);
      } catch (error) {
        if (cancelled) return;
        suppressDirty.current = true;
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
    if (!hydrated) return;
    if (suppressDirty.current) suppressDirty.current = false;
    else setSaveState("unsaved");
    const timer = window.setTimeout(() => {
      const snapshot = JSON.stringify({ nodes: cleanNodes(nodes), edges });
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
    if (!hydrated || !openProjectIds.length) return;
    window.localStorage.setItem(OPEN_PROJECTS_KEY, JSON.stringify(openProjectIds));
  }, [hydrated, openProjectIds]);

  const saveCurrent = useCallback(async () => {
    if (!projectId || fileBusy) return false;
    setFileBusy(true);
    setSaveState("saving");
    try {
      const saved = await saveCanvasProject(projectId, projectName, nodes, edges);
      setProjects((current) => [saved.project, ...current.filter((project) => project.id !== saved.project.id)]);
      tasks
        .filter((task) => task.status === "completed" && task.projectId === projectId)
        .forEach((task) => savedTaskIds.current.add(task.id));
      const recentSavedTaskIds = [...savedTaskIds.current].slice(-100);
      savedTaskIds.current = new Set(recentSavedTaskIds);
      window.localStorage.setItem(SAVED_TASK_IDS_KEY, JSON.stringify(recentSavedTaskIds));
      setSaveState("saved");
      setToast(`「${projectName}」已保存，参考素材也已写入`);
      return true;
    } catch (error) {
      setSaveState("error");
      setToast(error instanceof Error ? error.message : "保存画布失败");
      return false;
    } finally { setFileBusy(false); }
  }, [projectId, projectName, nodes, edges, tasks, fileBusy]);

  const updateNode = useCallback((id: string, patch: Partial<GraphData>) => {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, data: { ...node.data, ...patch } } : node));
  }, []);

  const deleteNode = useCallback((id: string) => {
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
    setToast("节点已删除");
  }, []);

  const applyTaskOutcome = useCallback((task: CanvasTask, applyResult = true) => {
    if (projectLoadBusy.current) return;
    const belongsToCurrentProject = task.projectId === projectId;
    if (!belongsToCurrentProject) return;
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
    if (blob.size > 15 * 1024 * 1024) throw new Error("剪贴板图片超过 15MB，无法载入");
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
      if (fileManagerOpen || mediaSettingsOpen || isEditableTarget(event.target)) return;
      const selectedImages = nodes.filter((node) => node.selected && node.type === "reference");
      if (selectedImages.length !== 1) return;
      const imageFile = Array.from(event.clipboardData?.items || [])
        .find((item) => item.kind === "file" && item.type.startsWith("image/"))
        ?.getAsFile();
      if (!imageFile) return;
      event.preventDefault();
      void applyClipboardImage(selectedImages[0].id, imageFile, imageFile.name || undefined)
        .then(() => setToast("剪贴板图片已粘贴到选中的图片节点"))
        .catch((error) => setToast(error instanceof Error ? error.message : "剪贴板图片读取失败"));
    };
    window.addEventListener("paste", handleImagePaste);
    return () => window.removeEventListener("paste", handleImagePaste);
  }, [applyClipboardImage, fileManagerOpen, mediaSettingsOpen, nodes]);

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
        instruction: isImagePromptSkill(skillId)
          ? skillId === "photoreal"
            ? "根据用户需求和已连接的参考图片，按真实感场景 Skill 路由参考分类，生成一份可直接复制使用的完整真实感图像提示词。"
            : "根据用户需求和已连接的参考图片，按 Image skill 选择合适的图像模型并生成一份可直接复制使用的完整图像提示词。"
          : "根据用户需求和已连接的图片、视频参考，直接生成一段可用于 Seedance2 的最终中文提示词。视频参考应依据按时间顺序抽取的关键帧理解其动作、运镜与节奏。",
        skillId,
        provider,
        model: selectedModel.model,
        reasoningEffort: selectedEffort,
        spec: isImagePromptSkill(skillId)
          ? { skillId, ratio: codexNode?.data.ratio, provider, model: selectedModel.model, reasoningEffort: selectedEffort, imageMarkers: images.map((image) => image.marker) }
          : { skillId, mode: codexNode?.data.mode, duration: codexNode?.data.duration, ratio: codexNode?.data.ratio, provider, model: selectedModel.model, reasoningEffort: selectedEffort, imageMarkers: images.map((image) => image.marker), videoMarkers: videos.map((video) => video.marker) },
        images,
        videos,
        threadId: codexNode?.data.threadId,
      }, {
        kind: "generation",
        projectId,
        title: `编辑改写 · ${PROMPT_SKILL_LABELS[skillId]} · ${instruction.replace(/\s+/g, " ").slice(0, 18)}`,
        sourceNodeId: nodeId,
        outputNodeIds,
      });
      setBridgeState("ready");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "任务创建失败");
    }
  }, [nodes, edges, getMediaSlots, providerCatalogs, tasks, enqueueTask, projectId]);

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
    let skillId: PromptSkillId;
    try { skillId = normalizePromptSkill(editorNode.data.skillId); }
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
        spec: isImagePromptSkill(skillId)
          ? { skillId, ratio: editorNode.data.ratio, provider, model: selectedModel.model, reasoningEffort: selectedEffort }
          : { skillId, mode: editorNode.data.mode, duration: editorNode.data.duration, ratio: editorNode.data.ratio, provider, model: selectedModel.model, reasoningEffort: selectedEffort },
      }, {
        kind: "revision",
        projectId,
        title: `编辑提示词 · ${PROMPT_SKILL_LABELS[skillId]} · ${prompt.replace(/\s+/g, " ").slice(0, 18)}`,
        sourceNodeId: nodeId,
        outputNodeIds: [outputNode.id],
      });
      setBridgeState("ready");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "任务创建失败");
    }
  }, [nodes, edges, providerCatalogs, tasks, enqueueTask, projectId]);

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
    return {
      ...node,
      data: {
        ...node.data,
        inputSlots: node.type === "codex" || node.type === "videogenerator" ? getMediaSlots(node.id) : node.type === "imagegenerator" ? getImageGenerationSlots(node.id) : undefined,
        promptConnected: node.type === "imagegenerator" || node.type === "videogenerator" || node.type === "prompteditor" ? Boolean(promptEdge) : undefined,
        promptInput: (node.type === "imagegenerator" || node.type === "videogenerator" || node.type === "prompteditor") && promptEdge ? nodeText(promptSource) : undefined,
        providerOptions: node.type === "codex" || node.type === "prompteditor" ? providerOptions : undefined,
        imageProviderOptions: node.type === "imagegenerator" ? imageProviderOptions : undefined,
        videoGenerationProviderOptions: node.type === "videogenerator" ? videoGenerationProviderOptions : undefined,
        assignedMarkers,
        busy: Boolean(activeTask),
        busyLabel: activeTask ? TASK_STAGE_LABELS[activeTask.stage] : undefined,
        onUpdate: (patch: Partial<GraphData>) => updateNode(node.id, patch),
        onDelete: () => deleteNode(node.id),
        onRun: node.type === "codex" ? () => void runCodex(node.id) : node.type === "prompteditor" ? () => void runPromptEditor(node.id) : node.type === "imagegenerator" ? () => void runImageGeneration(node.id) : node.type === "videogenerator" ? () => void runVideoGeneration(node.id) : undefined,
        onCopy: isOutputNodeType(node.type) || node.type === "prompteditor" ? () => void copyNodeText(node.id) : undefined,
        onPaste: node.type === "text" ? () => void pasteNodeText(node.id) : node.type === "reference" ? () => void pasteNodeImage(node.id) : undefined,
      },
    };
  }), [nodes, edges, tasks, getMediaSlots, getImageGenerationSlots, providerOptions, imageProviderOptions, videoGenerationProviderOptions, updateNode, deleteNode, runCodex, runPromptEditor, runImageGeneration, runVideoGeneration, copyNodeText, pasteNodeText, pasteNodeImage, projectId]);

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
    const altPressed = "altKey" in event && event.altKey;
    if ((!altPressed && !altCopyMode) || altDragCopyActiveRef.current) return;
    const sourceNodes = draggedNode.selected ? nodes.filter((node) => node.selected) : [draggedNode];
    const imageCopies = sourceNodes.filter((node) => node.type === "reference").length;
    const videoCopies = sourceNodes.filter((node) => node.type === "video").length;
    const currentImages = nodes.filter((node) => node.type === "reference").length;
    const currentVideos = nodes.filter((node) => node.type === "video").length;
    if (currentImages + imageCopies > MAX_IMAGES || currentVideos + videoCopies > MAX_VIDEOS || currentImages + currentVideos + imageCopies + videoCopies > MAX_CANVAS_REFERENCES) {
      setToast("Alt 拖动复制会超过图片或视频节点上限");
      return;
    }
    altDragCopyActiveRef.current = true;
    const idMap = new Map(sourceNodes.map((node) => [node.id, `${node.type || "node"}-${crypto.randomUUID().slice(0, 8)}`]));
    altDragCopyStateRef.current = {
      pairs: sourceNodes.map((node) => ({
        originalId: node.id,
        copyId: idMap.get(node.id) || `${node.type || "node"}-${crypto.randomUUID().slice(0, 8)}`,
        originalPosition: { ...node.position },
      })),
    };
    const stationaryCopies = sourceNodes.map((node) => duplicatedNode(node, idMap.get(node.id), node.position, false));
    setNodes((current) => [...current, ...stationaryCopies]);
    setEdges((current) => current.map((edge) => ({
      ...edge,
      source: idMap.get(edge.source) || edge.source,
      target: idMap.get(edge.target) || edge.target,
    })));
    setToast("正在拖动新副本，原节点和连线会保持原位");
  }, [altCopyMode, nodes]);
  const onNodeDragStop = useCallback((_event: MouseEvent | TouchEvent, draggedNode: GraphNode) => {
    finishAltDragCopy(draggedNode);
  }, [finishAltDragCopy]);
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
      return source.type === "reference" ? imageCount < MAX_REWRITE_IMAGES : videoCount < MAX_VIDEOS;
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
    setToast(connection.targetHandle === "prompt" || connection.targetHandle === "original-prompt"
      ? connection.targetHandle === "original-prompt" ? "原提示词已接入，编辑区已锁定并会跟随上游文本" : "提示词输入已连接，节点内编辑已锁定"
      : connection.targetHandle?.startsWith("media-")
        ? targetType === "imagegenerator" ? "参考图片已连接并自动编号" : "参考素材已连接，图片与视频会分别自动编号并用于 @ 引用"
        : isImageOutputNodeType(targetType) ? "图片节点已连接，生成结果会在这里预览"
        : isVideoOutputNodeType(targetType) ? "视频节点已连接，生成结果会在这里预览"
        : "节点已连接");
  }, [isValidConnection, nodes, updateNode]);

  const addCanvasNode = (kind: PaletteNodeKind) => {
    if (kind === "reference" && nodes.filter((node) => node.type === "reference").length >= MAX_IMAGES) {
      setToast("当前画布最多添加 12 张参考图");
      return;
    }
    if (kind === "video" && nodes.filter((node) => node.type === "video").length >= MAX_VIDEOS) {
      setToast("当前画布最多添加 3 个参考视频");
      return;
    }
    if ((kind === "reference" || kind === "video") && nodes.filter((node) => node.type === "reference" || node.type === "video").length >= MAX_CANVAS_REFERENCES) {
      setToast("当前画布的图片与视频参考合计最多 15 个");
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
    } else {
      node = { id, type: "text", position, data: { kind: "textBox", title: "文本框", text: "", prompt: "", source: "可编辑文本" } };
    }
    setNodes((current) => reconcileRuntimeNodes([...current, node], providerCatalogsRef.current));
    setLastAddedNodeId(id);
    setToast(`${node.data.title}已添加，拖动端口即可连线`);
  };

  const openCanvasProject = useCallback(async (id: string, closeManager = true, skipSave = false) => {
    if (id === projectId) {
      if (closeManager) setFileManagerOpen(false);
      return true;
    }
    if (projectLoadBusy.current) {
      setToast("正在切换画布，请稍候");
      return false;
    }
    projectLoadBusy.current = true;
    try {
      if (!skipSave && saveState === "unsaved" && !(await saveCurrent())) return false;
      setFileBusy(true);
      const project = await projectApi<CanvasProject>(`/projects/${id}`);
      suppressDirty.current = true;
      const completed = completeCanvas(project.nodes, project.edges);
      setNodes(reconcileRuntimeNodes(completed.nodes, providerCatalogsRef.current));
      setEdges(completed.edges);
      setProjectId(project.id);
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
  }, [fitView, projectId, saveCurrent, saveState]);

  const createCanvasProject = useCallback(async () => {
    if (projectLoadBusy.current) return;
    projectLoadBusy.current = true;
    try {
      if (saveState === "unsaved" && !(await saveCurrent())) return;
      setFileBusy(true);
      const fresh = freshCanvas();
      const id = crypto.randomUUID();
      const name = nextCanvasName(projects);
      const saved = await saveCanvasProject(id, name, fresh.nodes, fresh.edges);
      suppressDirty.current = true;
      setNodes(reconcileRuntimeNodes(fresh.nodes, providerCatalogsRef.current));
      setEdges(fresh.edges);
      setProjectId(id);
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
    if (saveState === "unsaved" && !(await saveCurrent())) return;
    const nextId = remaining[Math.min(closingIndex, remaining.length - 1)];
    if (await openCanvasProject(nextId, false, true)) setOpenProjectIds((current) => current.filter((openId) => openId !== id));
  }, [openCanvasProject, openProjectIds, projectId, saveCurrent, saveState]);

  const saveCanvasAs = useCallback(async () => {
    if (!projectId || projectLoadBusy.current) return;
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
    if (!file || projectLoadBusy.current) return;
    projectLoadBusy.current = true;
    try {
      if (file.size > MAX_PORTABLE_FILE_BYTES) throw new Error("画布分享文件超过 200MB，无法导入");
      if (saveState === "unsaved" && !(await saveCurrent())) return;
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
      if (id === projectId) setProjectName(result.project.name);
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
      const depth = getDepth(node.id);
      const y = columnY.get(depth) || 110;
      const height = node.type === "videogenerator" ? 1080 : node.type === "imagegenerator" ? 820 : node.type === "video" ? 520 : node.type === "reference" ? 460 : node.type === "codex" ? 700 : node.type === "prompteditor" ? 520 : isOutputNodeType(node.type) ? 430 : 270;
      columnY.set(depth, y + height);
      const position = { x: 80 + depth * 500, y };
      return { ...node, position };
    }));
    window.setTimeout(() => fitView({ padding: 0.12, duration: 350 }), 50);
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
        <div className="node-actions"><button className="library-button" onClick={toggleLibrary}>节点库</button><button className="task-panel-button" onClick={toggleTaskPanel}>任务{activeTaskCount ? ` ${activeTaskCount}` : ""}</button><button className="file-manager-button" onClick={() => setFileManagerOpen(true)}>文件</button><button className="media-settings-button" onClick={openMediaSettings}>输出目录</button><button className="organize-button" onClick={organize}>整理</button><button className="history-action" title="撤销（Ctrl+Z）" disabled={!canUndo} onClick={undoCanvas}>撤销</button><button className="history-action" title="重做（Ctrl+Shift+Z / Ctrl+Y）" disabled={!canRedo} onClick={redoCanvas}>重做</button><button className={`top-save ${saveState}`} disabled={!projectId || fileBusy} onClick={() => void saveCurrent()}>{saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存" : "保存画布"}</button></div>
        </header>
        <div className="canvas-tabs">
          <div className="canvas-tab-list" role="tablist" aria-label="已打开的画布">
            {openProjects.map((project) => {
              const active = project.id === projectId;
              const unsaved = active && saveState === "unsaved";
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
            <button className="palette-card palette-rewrite" onClick={() => addCanvasNode("codex")}><span className="palette-glyph">改</span><span className="palette-copy"><b>编辑改写</b><small>选择 Agent 与提示词 Skill</small></span><i>＋</i></button>
            <button className="palette-card palette-image-generator" onClick={() => addCanvasNode("imagegenerator")}><span className="palette-glyph">生</span><span className="palette-copy"><b>图片生成</b><small>12 图参考与可连接提示词</small></span><i>＋</i></button>
            <button className="palette-card palette-video-generator" onClick={() => addCanvasNode("videogenerator")}><span className="palette-glyph">影</span><span className="palette-copy"><b>视频生成</b><small>三路供应商与 12 位全能参考</small></span><i>＋</i></button>
            <button className="palette-card palette-editor" onClick={() => addCanvasNode("prompteditor")}><span className="palette-glyph">编</span><span className="palette-copy"><b>编辑提示词</b><small>修改意见、原提示词接入与完整输出</small></span><i>＋</i></button>
          </div>
          <footer className="node-library-foot"><span>{nodes.length} 个节点</span><b>拖动端口建立连接</b></footer>
        </aside>
        <section className="flow-canvas" onMouseMove={(event) => { lastPointerClientRef.current = { x: event.clientX, y: event.clientY }; }}>
          <ReactFlow
            nodes={renderNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onEdgeContextMenu={onEdgeContextMenu}
            isValidConnection={isValidConnection}
            connectionLineType={ConnectionLineType.Bezier}
            connectionLineStyle={{ stroke: "#735cc5", strokeWidth: 2.1 }}
            fitView
            fitViewOptions={{ padding: 0.12 }}
            minZoom={0.35}
            maxZoom={1.5}
            deleteKeyCode={null}
            multiSelectionKeyCode="Shift"
            defaultEdgeOptions={{ type: "disconnectable", interactionWidth: 24, style: { stroke: "#735cc5", strokeWidth: 2.1 } }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.1} color="#cbc7bf" />
            <Controls position="bottom-right" showInteractive={false} />
          </ReactFlow>
          <div className="canvas-shortcuts-hint" aria-hidden="true"><kbd>Alt</kbd> 拖动复制 <span>·</span> <kbd>Ctrl</kbd> C / V <span>·</span> <kbd>Ctrl</kbd> Z 撤销 <span>·</span> <kbd>Delete</kbd> 删除</div>
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
              const taskCategory = task.kind === "image-generation" ? "图片生成" : task.kind === "video-generation" ? "视频生成" : PROMPT_SKILL_LABELS[normalizePromptSkill(task.skillId)];
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
