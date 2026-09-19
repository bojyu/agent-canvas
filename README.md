# Agent Canvas

本地跑的节点式画布，用来搭提示词、生图、生视频的工作流。左边拖节点、连线，右边看任务进度，生成完的图片视频直接落在画布里，也会自动存一份到你设置的输出目录。

## 支持的几个通道

节点里能选的生成"引擎"目前有这几个：

- **Codex**：复用本机 `codex login` 的登录状态和额度，不用额外配置。
- **OpenRouter**：官方 `@openrouter/agent` SDK，需要自己在 `.env.local` 填 `OPENROUTER_API_KEY`，按 OpenRouter 账户单独计费。
- **Comfly**：OpenAI 兼容的文本接口，提示词改写优先用 `COMFLY_LLM_API_KEY`，没填就退到通用的 `COMFLY_API_KEY`。
- **Grok Build**：走 xAI 官方 CLI 的 ACP 接口，需要 `grok login`，吃的是 SuperGrok / X Premium Plus 订阅额度，不会走 API Key 计费。
- **Antigravity**：Google AI Pro/Ultra 订阅走这个，命令行工具是 `agy`（不是桌面版 Antigravity IDE，这俩不是一回事）。

各个通道的会话相互隔离，切供应商不会把上一个的对话历史带过去。

## Codex 插件

`plugins/agent-canvas` 是给 Codex App 用的本地插件，走 MCP 调语义化接口，不是模拟点鼠标那种。能干的事：读画布、原子级增删节点连线、套预设、挂载本机素材、查模型、跑单个生成节点、等任务结果。插件本身不碰 API Key，也不会把图片/视频塞进 Codex 的上下文里传来传去。

用法：

```powershell
npm run dev
```

启动后在 Codex App 里打开这个仓库，`.agents/plugins/marketplace.json` 提供了一个本地市场叫 `agent-canvas-local`。插件页要是没自动出现就重启一下 Codex App，装上 **Agent Canvas**，开个新对话让 Skill 和 MCP 工具加载进去。

写操作靠 `revision` / `expectedRevision` / `transactionId` 做冲突保护，插件会先 dry-run 一遍再一次性提交。浏览器里要是还有没保存的改动，不会被插件静默覆盖，会提示先去看一眼版本。插件提交的任务照样进任务中心，浏览器关了也没事，服务端跑完会自己写回输出节点存好。后台自动化不会去抢当前编辑器的焦点，也不会整图刷新替换；有新版本时顶部会提示"后台更新可载入"，什么时候读盘由你自己点。没保存的草稿会按项目自动恢复。插件默认新建一个独立的后台画布，除非明确告诉它用哪张已有画布。

也有个同功能的 CLI 版本：

```powershell
npm run canvas -- status
npm run canvas -- projects
npm run canvas -- inspect <projectId>
npm run canvas -- preset <projectId> image-generation --expected-revision <revision> --dry-run
```

第一版故意只做单节点执行，整条 DAG 的依赖调度、成本预算这些留到后面再加，先这样避免一句指令不小心触发一堆付费生成。计划细节在 [`docs/plans/agent-canvas-codex-plugin.md`](docs/plans/agent-canvas-codex-plugin.md)。

## OpenRouter（可选）

除了 Codex，画板还能通过官方 `@openrouter/agent` SDK 切到 OpenRouter 的模型。节点选了以后会按需加载本机的 Seedance 或 Image Skill，也可以选"不加载 Skill"；参考图会处理，Seedance 和无 Skill 模式下参考视频还会抽帧。任务队列、取消、超时、JSON 输出这套跟 Codex 通道是共用的。

配置很简单：

1. 复制 `.env.example` 成 `.env.local`。
2. 填上 `OPENROUTER_API_KEY`，记得别把真实密钥写进代码、画布或者分享出去的文件里。
3. 重跑 `npm run dev`，或者重新点一下启动脚本。

没配 Key 也不影响 Codex 通道正常用，OpenRouter 那栏就显示"未配置"，不会偷偷发请求出去。这是独立计费的服务，提示词和参考图会发给 OpenRouter 以及它实际路由到的模型供应商。`@openrouter/agent` 现在还是 Beta，所以版本锁死在 `0.7.2`。

模型列表、思考强度、任务阶段这些都跟着节点当前选的供应商走。Codex 用本机登录态和额度；OpenRouter 用 `.env.local` 里的 Key 独立计费；Comfly 提示词优先用 `COMFLY_LLM_API_KEY`，没填就退到 `COMFLY_API_KEY`；Grok Build 靠 `grok login` 的订阅状态；Antigravity 走 `gemini` / `agy` 的 Google 账号（Pro/Ultra 订阅额度）。提示词、参考图，以及从参考视频里抽出来的关键帧会发给对应的外部服务，原始视频文件不会直接传上去。任务在排队阶段不会真的调用 Agent，取消排队中的任务也不产生模型调用。各供应商的会话标识互相隔离，切换后不会错误续上另一方的会话。

## Antigravity / Google AI 订阅通道（可选）

**2026-06-18** 之后 Google AI Pro/Ultra 的个人订阅额度就不能走 Gemini CLI（`gemini`）了，官方要求换成 **Antigravity CLI**（命令是 `agy`）。容易搞混的一点：桌面版「Antigravity IDE」跟 headless 的 `agy` 不是同一个东西。

### 一键验证

```powershell
.\scripts\antigravity-verify.cmd
```

这个脚本会挨个检查：`agy` 装没装 → 引导登录 → headless 探测 → 给出对接画板的说明。

### 手动步骤

1. 装 CLI（Windows PowerShell）：
   ```powershell
   irm https://antigravity.google/cli/install.ps1 | iex
   ```
2. 交互登录（画板不会弹浏览器，得自己在终端里走）：
   ```powershell
   agy
   ```
   选 Google OAuth，浏览器授权，必要时把 code 贴回终端。
3. 验证 headless 调用（跟画板实际调用的形态一致）：
   ```powershell
   agy -p "Reply with exactly OK and nothing else."
   ```
4. CLI 不在默认路径的话，在 `.env.local` 里指一下（可选但建议加上）：
   ```env
   ANTIGRAVITY_CLI=C:\path\to\agy.exe
   ```
5. 重启 `npm run dev`，供应商选 **Antigravity**；或者直接访问 `http://127.0.0.1:4317/models?provider=antigravity` 看是不是 `configured: true`。

任务是在隔离的临时目录里跑的，只会预加载节点当前选的 Seedance 或 Image skill，选"不加载 Skill"时目录里就什么 Skill 都没有。参考图会复制到 `media/` 下。别用第三方工具转发 Google OAuth，有封号风险。真要临时退回 API Key 版 Gemini CLI 的话，自己手动开 `ALLOW_GEMINI_CLI_FALLBACK=1`（默认是关的）。

## Grok Build 订阅通道（可选）

走 xAI 官方 Grok Build CLI 的 ACP 接口，不是模拟点击，也不需要一直开着 Grok 桌面端。装好官方 CLI 后跑一次：

```powershell
grok login
```

得用有 SuperGrok 或 X Premium Plus 的账号登录。画板会从 `grok models` 读这个订阅实际能用的模型，ACP 那边明确指定 `cached_token`，不会退回去用 `XAI_API_KEY`。为了不小心走成按量计费，Grok Build 的子进程会把 API Key 相关的环境变量清掉，发现 `config.toml` 里配了 `model.api_key`、`model.env_key` 或者外部认证命令就直接拒绝运行。

跟 Antigravity 类似，Grok Build 也是在隔离临时目录里只加载当前选的 Skill，参考图和视频抽帧通过 ACP 图片块发送。任务跑完，临时的登录副本、Skill、素材上下文都会删掉，画布和分享文件里不会留 Grok 的登录凭证。

## 画布长什么样

左边是可以收起来的节点库，七种节点：图片、视频、文本框、编辑改写、图片生成、视频生成、编辑提示词，拖出来自由连线组流程。编辑改写节点可以选"不加载 Skill""Seedance 视频提示词""Nano Banana 图像提示词""GPT Image 图像提示词"或"真实感场景与模特图"。Seedance 和无 Skill 模式下参考位会自动编号成 `@图片1` 到 `@图片9`、`@视频1` 到 `@视频3`；图像提示词 Skill 只吃参考图片。

节点库下面是预设库，常规提示词/图片生成/视频生成三种预设可以直接拖到画布上，或者点一下加到画布中间。每个预设一次给你 3 个连好线的节点，外加 1 个空的参考图片节点。预设本身不带素材，也不会自动发任务。"最多 12 个参考位"这种容量限制只算单个生成节点的输入连接数，不会把下游的输出预览节点也算进去。

图片生成节点自带供应商和模型选择，不加载 Skill，没有思考强度这个概念，能设常用画幅和 1K/2K/4K 分辨率，最多接 12 张参考图。提示词能直接在节点里改，也能从上游文本框接进来，接了以后节点内容就跟着上游走，锁定不给手动改了。目前接了 OpenRouter、Google 官方 Gemini API、Comfly 三条生图路线，生成完直接在节点里能看，点预览图能下载。

顶部"API 密钥"那个入口可以直接配 OpenRouter、Google Gemini、Comfly（通用/提示词），还有 Comfly GPT Image 2 的 1K/2K/4K 专用 Key。前端只告诉你"配了"还是"没配"，不会把真实密钥读出来或者回显。输入框留空表示不改原来的值，只有点了"清除"并保存才真的删。这些内容只写进本机 `.env.local` 和当前桥接进程，不会进浏览器存储、画布或者分享文件，保存完立刻生效，不用重启。

嫌麻烦也可以直接手改 `.env.local`（改完记得重启一下）：

```dotenv
OPENROUTER_API_KEY=
GEMINI_API_KEY=
COMFLY_API_KEY=
COMFLY_LLM_API_KEY=
COMFLY_GPT_IMAGE_2_1K_API_KEY=
COMFLY_GPT_IMAGE_2_2K_API_KEY=
COMFLY_GPT_IMAGE_2_4K_API_KEY=
```

OpenRouter 能选 GPT Image 2 和 Nano Banana 2；Google 官方是 `gemini-3.1-flash-image`；Comfly 也能选 GPT Image 2 和 Nano Banana 2。注意 Comfly 的 GPT Image 2 三个分辨率是各用各的 Key，不会互相回退，`COMFLY_API_KEY` 只给 Nano Banana、视频和其他非 GPT Image 2 模型用。哪个 Key 配了，画板就只显示对应能用的分辨率；没配的渠道会老实标"未配置"，不会偷偷往外发请求。

视频生成节点同样不加载 Skill、没有思考强度。目前是 OpenRouter、Comfly、本机 Seedance CLI 三路，模式有文生视频、单图生视频、首尾帧、智能多帧、全能参考五种，加上时长、画幅、分辨率、声音开关。12 个图片/视频混合参考位按顺序编号 `@图片N` / `@视频N`，全能参考模式最多 9 图 + 3 视频。已连接的引用标记点一下就能插进提示词里。

OpenRouter 和 Comfly 沿用前面那两个 Key；Seedance CLI 得先装官方的 `dreamina` 并且 `dreamina login` 过。命令不在 PATH 里的话可以指一下：

```dotenv
DREAMINA_CLI_PATH=C:\Users\you\bin\dreamina.exe
```

视频是异步任务，提交完画板会一直查结果，成功了在节点里能看能下。Seedance CLI 生成前会先查积分，低于 100 直接不让生成，低于 500 会让你再确认一次点击。这块会真的消耗额度，所以只有点了"生成视频"才会提交，别的操作不会。

## 使用

双击 `启动提示词画板.cmd`，浏览器会自动打开 `http://127.0.0.1:4173`，终端窗口开着画板才能用。

或者直接命令行跑：

```powershell
npm run dev
```

顶部"文件"能新建/打开/重命名/自动命名画布。点"保存画布"或者 `Ctrl + S` 会把节点、连线、提示词、图片视频参考都存下来；下次打开自动接着上次那张画布。

顶部"主题"可以切"跟随系统""浅色""深色"，偏好存在浏览器本地，作用于整个界面（画布、节点、群组、节点栏、任务中心、设置弹窗都算），不会写进画布项目或分享文件。深色模式只改界面颜色，不会给图片视频预览套滤镜。

## 多画布、另存、分享

标题栏下面是画布标签栏，新建画布、从"全部画布"打开旧的，或者导入别人分享的文件，都会在这多一个标签。点标签切当前画布，切之前如果有改动会先自动存。关标签只是从标签栏移走，本地文件不会删，不能关到一个都不剩，总得留个工作区。重启之后会恢复上次开着的标签。

- "新建画布"（`Ctrl + N`）建一张全新的。
- "打开画布文件"（`Ctrl + O`）读 `.promptflow.json` 或 `.json` 分享文件，导入的会分配新 ID 作为新标签打开，不会覆盖本机同名同 ID 的画布。
- "另存为"（`Ctrl + Shift + S`）把当前节点连线、提示词、图片视频参考整个复制成一张新画布，原来那张还在。
- "导出分享"下载一个 `.promptflow.json`，发给别人，对方"打开画布文件"就能加载。分享文件带节点、连线、提示词和素材，但不带 Codex/OpenRouter/Grok Build 的会话标识，导入后是干净的新会话。

参考图和视频是以文件内容形式塞进分享文件的，素材越多导出的 JSON 越大，单个分享文件导入上限 200MB。打开外来文件会先校验版本、节点类型、节点连线 ID、坐标、素材格式、连线引用这些，不对的话不会写进本地画布库。

编辑改写和编辑提示词节点都能先选 Skill（不加载/Seedance/Nano Banana/GPT Image/真实感场景与模特图），再选 Agent 服务（Codex/OpenRouter/Comfly/Grok Build/Antigravity）和对应的实时模型。"不加载 Skill"就是纯按节点内容和参考素材生成/修改，不读 Skill 文件、不挂 Skill 工具、不注入模型专用模板。Nano Banana 和 GPT Image 两个入口共用同一份本机 Image Skill，只是分别锁自然语言结构和五段式结构，免得模型改写时选错版本。Comfly 会把选中 Skill 的核心规则、模型规则、按任务路由的白名单参考文档一起塞进请求；无 Skill 模式只发通用 JSON 约束。因为中转模型能力参差不齐，思考强度这栏显示"自动"，结构化结果会在本地再校验一遍。思考强度只显示当前模型支持的档位；切 Skill/供应商/模型/思考强度会把不兼容的会话标识清掉。旧画布没有 `skillId` 的按 Seedance 兼容处理，没有 `provider` 的按 Codex 兼容处理。

创作需求只填在编辑改写节点自己的输入框里。选 Seedance 能接图片视频参考，能设参考模式、时长、画幅；选 Image 或真实感场景 Skill 只收图片参考，设目标画幅。真实感 Skill 会先读参考库总索引，再按办公室/居家办公/创意工作室/卧室/电竞房分类路由，优先检查结构、透视、人物重心、接触、光影、材质这些。图片生成节点不加载 Skill，只管把最终提示词、参考图、画幅、分辨率提交给选中的生图渠道。

输入输出文本框统一成了"文本框"节点，左右各有连接点，内容随便改，底部就留"复制""粘贴"两个按钮；接了上游结果会自动同步最新文本。所有节点（包括默认自带的）都能删。

`Ctrl/Cmd + C`、`Ctrl/Cmd + V` 或者按住 `Alt` 拖动能复制节点，只复制节点自身内容和配置，连线不会带过来，Agent 会话和运行时端口状态也不会继承。`Alt` 拖动时鼠标带走的是新副本，原节点和连线留在原地；多选节点同理。"另存为"和"导出分享"倒是会完整保留连线。

选中至少 2 个没编组的节点按 `Ctrl/Cmd + G` 建群组。把节点拖进群组、跟外框重叠超过 40% 会高亮，松手就加进去，群组会自动扩展；也能同时选一个群组和几个散节点一起按 `Ctrl/Cmd + G` 批量加。选中组内成员按 `Ctrl/Cmd + Shift + G` 只把这些人移出来，位置和连线都保持；选中外框或任一成员按 `Ctrl/Cmd + Backspace` 直接打散整个群组。外框是浅色半透明的，可以整体拖动、低对比度缩放，标题栏小铅笔或者双击名字能改名。群组不支持嵌套；复制整个群组会保留成员关系和内部连线，删群组连带删成员，所有调整都能 `Ctrl/Cmd + Z` 撤销。保存/另存为/分享文件都会保留群组名字和编组关系，"整理"按钮只排未编组的节点，不动群组内部布局。

只想优化一段现成提示词的话，用"编辑提示词 → 文本框"就行。编辑节点存着待优化的提示词，独立选 Skill、Agent 服务、模型、思考强度；接上文本框点"提交修改"，结果直接写进文本框。旧画布里的输入输出文本节点打开时会自动迁移成统一文本框，原有文字和连线都保留。

参考图和图片输出统一成"图片"节点，参考视频和视频输出统一成"视频"节点，左右都有连接点，既能当生成节点的参考素材，也能接收预览下载生成结果，还能继续传给下游。双击图片节点空白处会弹系统图片选择器，也能点"粘贴剪贴板图片"，或者选中单个图片节点直接 `Ctrl/Cmd + V` 粘贴截图/别处复制的图片。点预览图本身不会下载，悬停后点浮动下载按钮才会存。旧画布里的图片输出、视频输出节点打开时会自动迁移成对应的媒体节点。

顶部"输出目录"能设生成文件存哪，默认是 `.prompt-flow-data/outputs`。图片生成完会把 Base64 解码落盘，视频生成完自动下载结果文件，节点上会显示实际存到哪了；目录写入失败任务也不会丢，会明确提示。浏览器本地草稿只存轻量的节点数据，不写图片视频二进制，免得把 LocalStorage 撑爆。

字体用的本地 Geist，浅色工具栏，左侧节点栏固定，画布是暖灰色的无限画布，没有平移边界，最小能缩到 6%，大工作流也能拉远看全局。节点栏展开时会给画布让空间，收起来只留一条窄控制条，展开收起和节点加入的动效是 GSAP 做的，也兼容系统的"减少动态效果"设置。

## 任务中心

点"生成视频提示词""生成图像提示词""提交修改""生成图片""生成视频"这些按钮，任务立刻进右边任务中心，不用守在原节点等。任务卡上能看到类型、排队/检查输入/处理参考素材/供应商生成/写入输出/完成/失败/取消这些真实阶段，还有实际用的供应商、模型、耗时；跑的时候是动态阶段条，不搞假进度百分比。

任务中心默认同时跑 2 个，右上角能切 1/2/3。超出并行数的自动排队；指向同一个输出节点的任务不能同时建，免得后完成的把先完成的结果覆盖掉。进度靠本地实时事件流自动推，完成后文字/图片/视频直接写进对应节点。

实时事件流断了的话，页面每 3 秒轮询一次任务列表兜底；连上以后还会每 15 秒低频同步一次。任务状态是按进度单调合并的，迟到的"排队中"旧状态不会把已经在跑、完成、失败、取消的状态覆盖掉，所以不会出现任务卡莫名其妙又变回排队中的情况。

单次 Agent 处理最长等 10 分钟，超了直接标失败，提示降低思考强度重试，不会一直显示排队中。

任务卡能做的事：

- "定位节点"跳回任务来源，"查看结果"跳到输出文本框。
- 排队中/运行中的能取消；失败的能复制错误信息。
- 结束的任务能按当前节点配置重跑一次，也能一键清空。
- 右侧面板能收起来，顶部"任务"按钮会显示当前活动任务数，点一下重新展开。

最近 20 条任务记录会存到 `.prompt-flow-data/tasks.json`，关掉页面重开还能看历史。要是桥接服务在任务跑着的时候退出了，重启后那个任务会标成中断失败。

## 隐私和额度怎么算

- 画布项目存在项目目录下的 `.prompt-flow-data/projects`，只有本机画板会读。
- 图片视频跟着画布项目存在本机，生成结果也会自动存一份到"输出目录"。视频会先由本机 `ffmpeg` 抽最多 4 张关键帧，最终提示词里还是用 `@视频N` 引用。
- 选 Codex 的话，图片视频帧是通过 `@openai/codex-sdk` 交给本机 Codex 处理，用的是当前 `codex login` 的登录状态和额度。
- 选 OpenRouter，提示词、参考图、视频帧会经 `@openrouter/agent` 发给 OpenRouter 和它实际路由的模型供应商，按 OpenRouter 账户单独计费；本地文件路径和 API Key 不会写进请求内容、画布或分享文件。
- Comfly 作为提示词供应商时，调的是它 OpenAI 兼容的文本接口，发送节点内容、选中的 Skill 规则和相关白名单参考文档；请求只发一次，失败了不会自动换模型重试或者重复计费。
- 图片生成节点选 OpenRouter/Google 官方/Comfly，提示词和接的参考图会发给对应服务；生成的图会转成 Data URL 写回本机画布，API Key 一直只留在本地桥接进程的环境变量里。
- 视频生成节点选 OpenRouter/Comfly，会发提示词和接的原始图片/视频参考，任务 ID 和结果链接写回节点；选 Seedance CLI 的话，素材只是临时落盘给本机 `dreamina` 上传，任务结束立刻删临时副本。视频生成节点不调用提示词 Skill。
- 点"生成"或"提交修改"先是往本地 `POST /tasks` 建个任务，真正开始跑的时候才会调用选中的 Agent。排队中取消掉不会产生模型调用。
- 所有通道只加载节点明确选的 Seedance/Nano Banana/GPT Image/真实感场景 Skill，选"不加载 Skill"就什么都不读、不复制、不注入。Nano Banana 和 GPT Image 共用本机 Image Skill 文件，但各自只预载自己的模型规则。选中的 Skill 要是不存在，改写接口直接停，不会悄悄退化成别的，只有主动选"不加载 Skill"才走通用路径。OpenRouter 只能读对应 Skill 的白名单参考文档；Grok Build 和 Antigravity 用的是只包含选中 Skill 完整 Bundle 的隔离工作区，无 Skill 模式就是个不含 Skill、且禁用工具/Web/插件/MCP/子 Agent 的隔离工作区。真实感 Skill 默认从项目同级目录 `真实感skill/photoreal_scene_model_skill/SKILL.md` 读，也可以用 `PHOTOREAL_SKILL_PATH` 指到 Skill 根目录或 `SKILL.md`。
- 本地 Agent 桥接只监听 `127.0.0.1`，只认本机网页来源。
