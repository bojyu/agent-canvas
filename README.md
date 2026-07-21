# Agent Canvas

## OpenRouter Agent SDK（可选）

画板保留原有 Codex SDK 通道，并可通过官方 `@openrouter/agent` SDK 切换到 OpenRouter 模型。OpenRouter 通道会按节点选择加载本机 Seedance 或 Image Skill、处理参考图片（Seedance 还支持视频抽帧），并使用与 Codex 通道相同的任务队列、取消、超时和严格 JSON 输出协议。

1. 把 `.env.example` 复制为 `.env.local`。
2. 在 `.env.local` 中填写 `OPENROUTER_API_KEY`，不要把真实密钥写进代码、画布或分享文件。
3. 重新运行 `npm run dev`，或重新双击桌面/项目中的启动快捷方式。

未配置密钥时，Codex 通道不受影响；OpenRouter 会显示为“未配置”，不会发起外部请求。OpenRouter 是独立计费服务，提示词及参考图片会发送给 OpenRouter 及其实际路由的模型供应商。`@openrouter/agent` 当前为 Beta，因此项目将依赖精确锁定在 `0.7.2`。

Provider 行为说明：模型列表、思考强度和任务阶段都跟随节点当前选择的 Provider。Codex 继续复用本机 `codex login` 与 Codex 额度；OpenRouter 使用 `.env.local` 中的 API Key 并按 OpenRouter 账户独立计费；Comfly 提示词通道优先使用 `COMFLY_LLM_API_KEY`，留空时回退到通用 `COMFLY_API_KEY`；Grok Build 使用本机 `grok login` 的订阅状态；Antigravity 使用本机 `gemini` / `agy` 的 Google 账号登录（Google AI Pro/Ultra 订阅额度）。提示词、参考图片以及本地从参考视频抽取的关键帧会发送给所选外部服务，原始视频文件不会直接上传。排队中的任务在真正开始前不会调用所选 Agent，取消排队任务也不会产生模型调用。各 Provider 的会话标识相互隔离，切换后不会错误续接另一方会话。

## Antigravity / Google AI 订阅通道（可选）

自 **2026-06-18** 起，个人 / Google AI Pro / Ultra 订阅**不能再**用 Gemini CLI（`gemini`）走订阅额度，官方要求改用 **Antigravity CLI（命令 `agy`）**。桌面「Antigravity IDE」≠ headless 的 `agy`。

### 推荐验证流程（本仓库脚本）

双击或运行：

```powershell
.\scripts\antigravity-verify.cmd
```

脚本会依次检查：`agy` 是否安装 → 引导交互登录 → `agy -p` headless 探测 → 对接画板说明。

### 手工步骤摘要

1. **安装 Antigravity CLI**（Windows PowerShell）：
   ```powershell
   irm https://antigravity.google/cli/install.ps1 | iex
   ```
2. **交互登录**（画板不会弹浏览器）：
   ```powershell
   agy
   ```
   选择 Google OAuth，浏览器授权；需要时把 code 贴回终端。
3. **验证 headless**（与画板调用形态一致）：
   ```powershell
   agy -p "Reply with exactly OK and nothing else."
   ```
4. 在 `.env.local` 指定路径（可选但推荐）：
   ```env
   ANTIGRAVITY_CLI=C:\path\to\agy.exe
   ```
5. 重启 `npm run dev`，画板选供应商 **Antigravity**；或检查  
   `http://127.0.0.1:4317/models?provider=antigravity` 是否 `configured: true`。

说明：任务在隔离临时目录运行，只预载节点当前选择的 Seedance 或 Image skill；参考图会复制到 `media/`。请勿用第三方工具转发 Google OAuth（有封号风险）。若必须临时回退到仍可用的 API Key 版 Gemini CLI，需自行设置 `ALLOW_GEMINI_CLI_FALLBACK=1`（默认关闭）。

## Grok Build 订阅通道（可选）

画板通过 xAI 官方 Grok Build CLI 的 ACP 接口接入，不模拟点击窗口，也不需要一直打开 Grok 桌面端。安装官方 CLI 后，在终端运行一次：

```powershell
grok login
```

请使用拥有 SuperGrok 或 X Premium Plus 的账号登录。画板会从 `grok models` 读取该订阅实际可用的模型，并通过 ACP 明确选择 `cached_token`；不会自动回退到 `XAI_API_KEY`。为避免误走按量 API 计费，Grok Build 子进程会清除 API Key 环境变量，并在检测到 `config.toml` 中的 `model.api_key`、`model.env_key` 或外部认证命令时拒绝运行。

Grok Build 在隔离临时目录中只加载节点当前选择的 Seedance 或 Image Skill，参考图片和 Seedance 视频抽帧通过 ACP 图片块发送。临时登录副本、Skill 和素材上下文会在任务结束后删除；画布与分享文件不会保存 Grok 登录凭证。

面向视频与图像生成的本地节点式提示词画板。左侧可伸缩节点库可以添加“图片、视频、文本框、编辑改写、图片生成、视频生成、编辑提示词”七类节点，并通过端口自由组成流程。编辑改写节点可选择 Seedance 视频提示词或 Image 图像提示词；Seedance 的参考位会自动编号为 `@图片1` 到 `@图片9`、`@视频1` 到 `@视频3`，Image 只接收参考图片。

“图片生成”节点提供图片模型供应商与模型目录区域，不加载 Skill，也不包含思考强度；可设置常用画幅及 `1K` / `2K` / `4K` 分辨率，并连接最多 12 张参考图。提示词可以直接在节点内编辑，也可由输入文本框或输出文本框接入；连接提示词端口后，节点内文本会跟随上游并锁定编辑。当前支持 OpenRouter、Google 官方 Gemini API 和 Comfly 三个生图渠道；生成结果会在节点内预览，点击预览图即可下载。

图片供应商密钥写入 `.env.local` 后重启画板：

```dotenv
OPENROUTER_API_KEY=
GEMINI_API_KEY=
COMFLY_API_KEY=
COMFLY_LLM_API_KEY=
COMFLY_GPT_IMAGE_2_1K_API_KEY=
COMFLY_GPT_IMAGE_2_2K_API_KEY=
COMFLY_GPT_IMAGE_2_4K_API_KEY=
```

OpenRouter 可选 GPT Image 2 与 Nano Banana 2；Google 官方使用 `gemini-3.1-flash-image`；Comfly 可选 GPT Image 2 与 Nano Banana 2。Comfly GPT Image 2 的 1K、2K、4K 请求分别严格使用三个分辨率专用 Key，不会回退占用通用 Key；`COMFLY_API_KEY` 只供 Nano Banana、视频和其他非 GPT Image 2 模型使用。画板会根据已配置的专用 Key 只展示可用分辨率。未配置的渠道会明确显示“未配置”，不会向外部服务发送请求。

“视频生成”节点不加载 Skill，也不包含思考强度。当前提供 OpenRouter、Comfly 与本机 Seedance CLI 三路供应商，包含文生视频、单图生视频、首尾帧、智能多帧和全能参考五种模式，以及时长、画幅、分辨率和声音开关。节点有 12 个图片/视频混合参考位，按槽位顺序分别编号为 `@图片N` 与 `@视频N`；全能参考遵循 9 图 + 3 视频上限。已连接的引用标记可点击插入提示词，连接输入或输出文本框后节点内编辑和引用插入都会锁定。

OpenRouter 与 Comfly 分别使用已有的 `OPENROUTER_API_KEY`、`COMFLY_API_KEY`。Seedance CLI 需先安装官方 `dreamina` 并完成 `dreamina login`；如果命令不在 PATH，可设置：

```dotenv
DREAMINA_CLI_PATH=C:\Users\you\bin\dreamina.exe
```

视频调用是异步任务：画板提交后持续查询结果，成功后在节点内预览和下载。Seedance CLI 在生成前检查积分；低于 100 会停止，低于 500 会要求再次点击确认。生成视频会消耗所选供应商的额度，只有点击节点“生成视频”才会提交。

## 使用

双击 `启动提示词画板.cmd`。浏览器会打开 `http://127.0.0.1:4173`，终端窗口保持打开时画板可用。

也可以在终端运行：

```powershell
npm run dev
```

顶部“文件”入口可以新建、打开、重命名和自动命名画布。点击“保存画布”或按 `Ctrl + S` 会把节点、连线、提示词、图片和视频参考一起保存；下次启动时自动打开上次使用的画布。

## 多画布、另存和分享

标题栏下方是画布标签栏。新建画布、从“全部画布”打开已有画布，或导入别人分享的文件时，都会在这里增加一个标签；点击标签即可切换当前画布。切换前，当前画布如有修改会先保存。关闭标签只会把它从标签栏移走，不会删除本地画布文件；为避免没有工作区，最后一个标签不能关闭。重新启动后会恢复上次打开的标签和当前画布。

文件相关操作可以从顶部标签栏或“文件 → 画布文件”进入：

- “新建画布”创建一张独立的新画布；快捷键为 `Ctrl + N`。
- “打开画布文件”读取 `.promptflow.json` 或 `.json` 分享文件；快捷键为 `Ctrl + O`。导入内容会分配新的本地画布 ID 并作为新标签打开，不会覆盖本机同名或同 ID 的画布。
- “另存为”把当前节点、连线、提示词以及图片和视频参考完整复制为一张新画布，并保留原画布；快捷键为 `Ctrl + Shift + S`。
- “导出分享”会下载一个 `.promptflow.json` 文件。把该文件发送给别人，对方点击“打开画布文件”即可加载。分享文件包含节点、连线、提示词和参考素材，但不会携带 Codex、OpenRouter 或 Grok Build 的会话标识，因此导入后会从一个干净的新会话开始。

参考图片和视频以文件内容形式包含在分享文件中，素材越多，导出的 JSON 文件越大；单个分享文件的导入上限为 200MB。打开外来文件时会检查文件版本、节点类型、节点与连线 ID、坐标、素材格式和连线引用；无效或不受支持的文件不会写入本地画布库。

编辑改写节点和编辑提示词节点都可以先选择 `Seedance 视频提示词`、`Image 图像提示词` 或 `真实感场景与模特图` Skill，再选择 `Codex`、`OpenRouter`、`Comfly`、`Grok Build` 或 `Antigravity` 及其实时模型。Comfly 会把所选 Skill 的核心规则和按任务路由的白名单参考文档一并注入请求；由于中转模型能力不统一，思考强度显示为“自动”，结构化结果会在本地再次校验。“思考强度”只显示该模型支持的档位；切换 Skill、供应商、模型或思考强度会清除不兼容的会话标识。旧画布没有 `skillId` 时默认按 Seedance 兼容，没有 `provider` 时按 Codex 兼容。

创作需求只在编辑改写节点自己的提示词输入框中填写。选择 Seedance 时可连接图片和视频参考，并设置参考模式、时长和画幅；选择 Image 或真实感场景 Skill 时只接收图片参考并设置目标画幅。真实感 Skill 会先读取参考库总索引，再按办公室、居家办公、创意工作室、卧室或电竞房路由一个场景分类，优先检查结构、透视、人物重心、接触、光影与材质。图片生成节点不加载 Skill，只负责把上游或节点内的最终提示词、参考图、画幅和分辨率提交给所选生图渠道。

输入文本框和输出文本框已经统一为“文本框”节点。节点左右分别提供输入、输出连接点，内容可自由编辑，底部只保留“复制”和“粘贴”；当文本框接收上游结果时会同步显示最新文本。所有节点（包括默认节点）都可以删除。

如果只想优化一段现成提示词，直接使用“编辑提示词 → 文本框”。编辑节点保存待优化提示词，并独立选择 Skill、Agent 服务、模型和思考强度；连接文本框后点击“提交修改”，处理结果会直接写入文本框。旧画布中的输入、输出文本节点会在载入时自动迁移为统一文本框，并保留已有文字与连线。

参考图和图片输出统一为“图片”节点，参考视频和视频输出统一为“视频”节点。两种媒体节点都在左右提供输入、输出连接点：既能作为生成节点的参考素材，也能接收、预览、下载生成结果，并继续传给下游节点。旧画布里的图片输出和视频输出节点会自动迁移为对应的统一媒体节点。

顶部“输出目录”可以设置生成文件的本机绝对路径。图片生成完成后会把 Base64 原图解码落盘，视频生成完成后会自动下载结果文件；默认目录为 `.prompt-flow-data/outputs`。节点会显示实际保存路径，目录写入失败时任务仍会保留生成结果并给出明确提示。浏览器本地草稿只保存轻量节点数据，不再写入图片或视频二进制，避免触发 LocalStorage 容量上限。

页面统一使用本地 Geist 字体、浅色工具栏、固定左侧节点栏和暖灰无限画布。节点栏会在展开时为画布让出空间，收起后只保留窄控制条；开合与节点加入反馈由 GSAP 驱动，并兼容“减少动态效果”系统设置。

## 任务中心与并行

点击“生成视频提示词”“生成图像提示词”“提交修改”“生成图片”或“生成视频”后，任务都会立即加入右侧任务中心，不需要停留在原节点等待。任务卡会显示任务类型、排队、检查输入、处理参考素材、供应商生成、写入输出、完成、失败或取消等真实阶段，并持续显示实际供应商、模型和用时；处理期间使用动态阶段条，不显示虚假的百分比。

任务中心默认同时运行 2 个任务，可在右上角切换为 1、2 或 3 个。超过并行数量的任务会自动排队；指向同一个文本、图片或视频输出节点的任务不能同时创建，避免较晚完成的内容覆盖已有结果。页面通过本地实时事件流自动接收进度，任务完成后会把文字、图片或视频写入对应节点。

如果实时事件流暂时断开，页面会每 3 秒轮询一次任务列表作为兜底；连接恢复后仍会每 15 秒做一次低频同步。任务状态按进度单调合并，延迟到达的“排队中”旧状态不会覆盖已经进入运行、完成、失败或取消的状态，因此任务卡不会因为一次过期响应一直停留在排队中。

单次 Agent 处理最长等待 10 分钟。超过时限后任务会明确标记为失败，并提示降低思考强度后重试，不会继续显示为排队中。

任务卡支持以下操作：

- “定位节点”返回任务来源，“查看结果”定位输出文本框。
- 排队中或运行中的任务可以取消；失败任务可以复制错误。
- 已结束任务可以按当前节点配置再次运行，也可以统一清除。
- 右侧面板可以收起，顶部“任务”按钮会重新展开并显示活动任务数量。

任务中心最多保留最近 20 条记录，并写入 `.prompt-flow-data/tasks.json`。关闭页面后重新打开仍可查看历史；如果桥接服务在任务运行中退出，该任务会在重启后标记为中断失败。

## 隐私与额度

- 画布项目保存在项目目录下的 `.prompt-flow-data/projects`，仅供本机画板读取。
- 图片和视频会跟随画布项目保存在本机；生成结果还会自动保存到“输出目录”设置的路径。视频先由本机 `ffmpeg` 最多抽取 4 张顺序关键帧，最终提示词仍使用 `@视频N` 引用。
- 选择 Codex 时，图片和视频帧由 `@openai/codex-sdk` 交给本机 Codex，复用当前 `codex login` 登录状态和 Codex 额度。
- 选择 OpenRouter 时，提示词、参考图片和视频帧会通过 `@openrouter/agent` 发送给 OpenRouter 及其实际路由的模型供应商，并按 OpenRouter 账户独立计费；本地文件路径和 API Key 不会写入请求内容、画布或分享文件。
- 选择 Comfly 作为提示词供应商时，画板调用其 OpenAI 兼容文本接口，并发送节点内容、所选 Skill 规则及相关白名单参考文档；请求只执行一次，不会在失败后自动切换模型或重复计费。
- 图片生成节点选择 OpenRouter、Google 官方或 Comfly 后，提示词和已连接的参考图会发送给所选服务；生成图片会转换成 Data URL 写回本机画布，API Key 始终只保留在本地桥接进程的环境变量中。
- 视频生成节点选择 OpenRouter 或 Comfly 后，会发送提示词及所连接的原始图片/视频参考，并把任务 ID 和结果链接写回节点；选择 Seedance CLI 时，素材只会临时落盘供本机 `dreamina` 上传，任务结束后立即删除临时副本。视频生成节点不调用提示词 Skill。
- 选择 Grok Build 时，提示词、参考图片和视频帧会通过本机官方 CLI 的 ACP 接口发送给 xAI，并使用 `grok login` 对应账号的订阅额度。画板强制 cached-token 模式；检测到可能抢占认证的 API Key 配置会停止任务并明确提示。
- 点击生成或提交只会先向本地 `POST /tasks` 创建任务；任务真正开始运行时才调用所选 Agent。排队任务取消后不会产生模型调用。
- 所有通道都只加载节点明确选择的 Seedance、Image 或真实感场景 Skill；若所选 Skill 不存在，改写接口会直接停止，不会退化为普通提示词生成。OpenRouter 只能读取对应 Skill 的白名单参考文档；Grok Build 与 Antigravity 使用只包含所选完整 Skill Bundle 的隔离工作区，并禁用工具、Web、插件、MCP 与子 Agent。真实感 Skill 默认从项目同级目录 `真实感skill/photoreal_scene_model_skill/SKILL.md` 读取，也可以用 `PHOTOREAL_SKILL_PATH` 指向 Skill 根目录或 `SKILL.md`。
- 本地 Agent 桥接只监听 `127.0.0.1`，且只接受本机网页来源。
