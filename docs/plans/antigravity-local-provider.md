# 执行计划：Antigravity 本机订阅通道（对齐 Codex / Grok Build）

**状态**：已实现（Phase 1–3 代码合入；本机需 `gemini`/`agy` Google OAuth 登录后可用）  
**日期**：2026-07-17  
**目标**：把 Google Antigravity（`agy` CLI / Gemini CLI + Google AI Pro/Ultra 订阅登录）做成画板第四个 Agent Provider，本机调用、注入 Seedance skill、支持参考图、严格 JSON 输出，接入现有任务中心。

**实现备注**：本机实测 `antigravity.exe` 为桌面 IDE；headless 走 `@google/gemini-cli`（`gemini`）。见 `docs/plans/antigravity-poc-notes.md`。

---

## 0. 目标与非目标

### 目标（必须）

1. 节点供应商下拉新增 **Antigravity**（内部 id：`antigravity`）。
2. 本机检测 `agy` 是否安装、是否已 Google OAuth 登录、是否可用。
3. 任务路径与现有一致：`POST /tasks` → 排队 → 抽帧/物化媒体 → Agent → 写回输出节点。
4. **强制加载本机 Seedance skill**（与 Grok 一样优先「预载全量 bundle」，弱依赖 tools）。
5. 输出协议仍为 `{ prompt, title, changes }`，本地 `validateStructuredResult` 校验。
6. 会话 id 前缀隔离：`antigravity:`，不可与 codex/openrouter/grok-build 混用。
7. 取消 / 10 分钟超时 / 并发与输出节点互斥逻辑复用现有任务中心。

### 非目标（本阶段不做）

- 不模拟点击 Antigravity 桌面 GUI。
- 不把 Google OAuth 转成对外 HTTP 中转网关（ToS 风险）。
- 不恢复旧画布里「试验期 antigravity 被强迁 Codex」之前的会话续聊（旧 threadId 一律作废）。
- 不承诺 ACP 对等 Grok（官方主路径是 `agy -p` headless；若日后有 ACP 再升级）。
- 不把 AI Studio 按量 API Key 当成主认证（可作可选 fallback，默认关闭）。

### 成功标准（验收）

| # | 验收项 |
|---|--------|
| A1 | 本机 `agy` 已登录 Pro/Ultra 时，供应商显示「已配置」，模型列表非空 |
| A2 | 无 `agy` / 未登录时，显示明确中文原因，不发起任务 |
| A3 | 带 1 张参考图 + 改写需求可完成任务，输出合法 JSON，结果写入输出节点 |
| A4 | 任务卡阶段含 `antigravity`，可取消排队/运行中任务 |
| A5 | Seedance skill 缺失时直接失败，不降级普通改写 |
| A6 | 单元测试覆盖：会话前缀、状态探测 mock、结果 JSON 解析（含 code fence） |
| A7 | 文档：`README` 增加安装 `agy`、登录、与 Pro 额度说明及 ToS 注意 |

---

## 1. 架构决策（先定死，避免返工）

### 1.1 调用形态：Phase 1 = CLI headless（推荐）

对齐「本机登录 + 本机进程」，不走 OpenRouter 式云 SDK：

```text
画板 → bridge → spawn `agy -p "..." [图片参数?] [--output-format json]`
              → stdout 文本 → validateStructuredResult
              → 返回 {prompt,title,changes,threadId,usage?}
```

**为何不先 ACP**

- 公开资料主推 TUI + `agy -p` print 模式；ACP 无成熟对标 Grok 的文档。
- Phase 1 用 headless 验证订阅额度、JSON、图、skill；稳定后再考虑 ACP/SDK。

### 1.2 Skill 策略：对齐 Grok「全量预载」

| 方案 | 选择 |
|------|------|
| tools 读 references | 不做 Phase 1（CLI 工具可能乱改文件） |
| 预载 `SKILL.md` + 全部 references | **采用**（`seedanceInstructions(bundle, { includeAllReferences: true })`） |
| 隔离 cwd | **采用**：临时目录只放 skill 副本与媒体，禁止落到用户工程目录 |

### 1.3 安全与 ToS

| 规则 | 做法 |
|------|------|
| 只用本机已登录 CLI | 探测 `agy` + 登录状态；不抓浏览器 cookie |
| 不转发 OAuth 给第三方 | 子进程仅本机 bridge 调用 |
| 限制 agent 副作用 | 尽可能 `--print` 单次、工作目录隔离；prompt 内明确「禁止写文件/跑 shell/装依赖」 |
| 失败文案 | 额度用尽 / 未登录 / 未安装 与 Google 产品文档用语对齐 |

### 1.4 与历史 `antigravity` 字段的关系

当前前端：

- `normalizeProvider("antigravity")` → **误当成 codex**
- `normalizeTaskProvider("antigravity")` → **抛错已停用**

**新行为（破坏性但正确）**：

- `antigravity` 重新成为合法 `AgentProvider`
- **旧任务**里失败的 antigravity 记录可保留；**旧节点**若 provider 为 antigravity，恢复为真实 Antigravity，而不是迁 Codex
- README 中「试验迁回 Codex」改为「正式通道；旧试验会话不可续」

---

## 2. 本机探测契约（实施前先 POC，阻塞后续）

在写 provider 前，在本机 Windows 上完成下列 POC（记录实际命令与输出样例）：

| ID | 命令/动作 | 期望 |
|----|-----------|------|
| P0 | `agy --version` | 可执行，得到版本 |
| P1 | 未登录时运行 `agy -p "ping"` | 可解析错误（需登录） |
| P2 | `agy login` / 交互 OAuth 一次 | 登录成功 |
| P3 | `agy -p "只回复 ok"` | stdout 有文本，进程退出码 0 |
| P4 | `agy -p "..." --output-format json`（或等价 flag） | 可解析结构；记录真实 flag 名 |
| P5 | 带本地图片（若 CLI 支持 `@file` / `--image` / 多模态语法） | 能描述图；**不支持则 Phase 1 仅文字+把图说明写进 prompt，并文档声明限制** |
| P6 | 超长 prompt（预载全 skill ~数十 k tokens） | 是否超时/截断；必要时改为「主文档+白名单摘要」 |
| P7 | 取消：kill 子进程 | 任务可中止 |
| P8 | 模型列表：`agy models` / settings / 固定表 | 有可展示列表或 fallback 默认模型 |

**POC 出口**：

- 若 P3/P4 失败 → 暂停接入，改评估 Gemini API 按量通道。
- 若仅 P5 失败 → 仍可上线「无图/弱图」并在 UI 标注；有图任务可提示改用 Codex/Grok。

POC 产出物：`docs/plans/antigravity-poc-notes.md`（命令、flag、样例 stdout、是否支持图）。

---

## 3. 模块设计

### 3.1 新文件

| 文件 | 职责 |
|------|------|
| `scripts/antigravity-provider.mjs` | 状态探测、模型列表、隔离 workspace、`runAntigravityRefine`、会话 id |
| `tests/antigravity-provider.test.mjs` | 纯函数与 mock spawn 测试 |
| `docs/plans/antigravity-poc-notes.md` | POC 实录（实施时填写） |

复用：

- `scripts/seedance-bundle.mjs` — load / instructions / 隔离拷贝
- `scripts/agent-protocol.mjs` — `AGENT_OUTPUT_SCHEMA` / `validateStructuredResult`

### 3.2 Provider 常量（建议）

```js
export const ANTIGRAVITY_PROVIDER_ID = "antigravity";
export const ANTIGRAVITY_SESSION_PREFIX = "antigravity:";
// 思考强度：按 POC 能映射到的档位收敛，未知则仅 "default" 或 low/medium/high
```

### 3.3 状态 API 形状（对齐 Grok）

`getAntigravityStatus()` →

```ts
{
  ready: boolean,
  installed: boolean,
  loggedIn: boolean,
  message?: string,
  models: AgentModelOption[],
  cliVersion?: string,
}
```

### 3.4 `runAntigravityRefine` 输入/输出

输入：与 `runGrokBuildRefine` 同形  
`{ model, reasoningEffort, textPrompt, attachments, outputSchema, seedanceSkillPath, threadId, signal, timeoutMs }`

输出：

```ts
{
  prompt, title, changes,
  threadId, // antigravity:uuid
  usage?: unknown,
  provider: "antigravity",
  seedanceSkill: true,
  seedanceSkillId, seedanceSkillHash,
  sessionMode: "stateless",
}
```

### 3.5 隔离工作区

```text
tmpdir/prompt-flow-antigravity-*/
  .agents/skills/seedance/...   # 或 agy 约定的 skills 路径（POC 确认）
  media/img-*.png
```

任务结束 `rm` 递归删除。不复制用户 Google 登录态到临时目录（用全局已登录 CLI，与 Grok「拷 login」策略不同——以 POC 为准：若 `agy` 仅读用户 profile，则不必拷凭证）。

### 3.6 Prompt 拼装（强约束）

1. 声明：仅完成 Agent Canvas 提示词任务；禁止 shell、写盘、装包、web、子 agent。  
2. 全量 Seedance instructions。  
3. `buildInstruction` 生成的任务正文（bridge 已有）。  
4. 附件映射说明 + 若 CLI 不能真正喂图，则说明「下列为本地参考文件路径/已无法嵌入，请严格使用 @图片N 编号」。  
5. 要求只输出三字段 JSON。

---

## 4. 集成改动清单（按层）

### 4.1 Bridge：`scripts/codex-bridge.mjs`

| 改动点 | 内容 |
|--------|------|
| import | `antigravity-provider.mjs` |
| `normalizeProvider` | 允许 `antigravity` |
| `providerLabel` / `providerModels` / `assertProviderThread` | 分支 |
| `executeRefine` | 与 openrouter/grok 并列的 stage `antigravity` + 超时 + abort |
| `/health` | `providers.antigravity` 块 |
| `/models?provider=antigravity` | 返回 status/models |
| 任务持久化 provider 兼容 | 读取历史 `antigravity` 不再当 codex |

### 4.2 前端：`app/FlowCanvas.tsx`

| 改动点 | 内容 |
|--------|------|
| `AgentProvider` | 增加 `"antigravity"` |
| `PROVIDERS` / `PROVIDER_LABELS` | Antigravity |
| `TaskStage` + `TASK_STAGE_LABELS` | `antigravity: "Antigravity 处理中"` |
| `isAgentProvider` / `normalizeProvider` | **删除**「antigravity → codex」兼容迁移 |
| `normalizeTaskProvider` | **删除**「已停用」抛错；改为正常 normalize |
| `providerSource` | `"Antigravity"` |
| `providerCatalogs` 初始 state | 增加 antigravity |
| 模型拉取 `useEffect` | 已有按 PROVIDERS 循环则可自动覆盖；检查 hardcode |
| 旧 source 文案 | `Antigravity` 作为合法生成来源 |

### 4.3 测试

| 文件 | 内容 |
|------|------|
| `tests/antigravity-provider.test.mjs` | session 前缀、错误文案、JSON 解析、status 归一 |
| `tests/rendered-html.test.mjs` | 断言存在 `antigravity` provider 标签；去掉/改写「迁回 codex」旧断言 |
| 可选 | mock `spawn` 集成测 refine 成功路径 |

### 4.4 文档

| 文件 | 内容 |
|------|------|
| `README.md` | 安装 CLI、登录、额度、隐私（提示词与图经 Google 账号订阅通路）、ToS 提醒 |
| `.env.example` | 可选 `ANTIGRAVITY_CLI` 路径覆盖；**不写**强制 API Key |

### 4.5 样式

通常无需新 UI 组件（复用 ModelControls）。若「未配置」文案过长，沿用现有 `runtime-warning`。

---

## 5. 分阶段里程碑

### Phase 0 — POC（0.5–1 天，阻塞）

- [ ] 本机安装 `agy`，Pro 账号登录  
- [ ] 完成 P0–P8，写入 `antigravity-poc-notes.md`  
- [ ] 决策：是否支持真·喂图；模型列表来源；output-format flag  

**出口评审**：POC 笔记 + 是否继续 Phase 1。

### Phase 1 — Provider 核心（1–2 天）

- [ ] 实现 `antigravity-provider.mjs`  
  - resolve 命令（`ANTIGRAVITY_CLI` / PATH / 常见安装路径）  
  - `getAntigravityStatus` / `getAntigravityModels`  
  - 隔离目录 + skill 全量预载  
  - `runAntigravityRefine`（timeout、abort、validate JSON）  
- [ ] 单元测试  
- [ ] 用 `node` 脚本直调 refine 冒烟（可不经 UI）

### Phase 2 — Bridge + 前端接线（0.5–1 天）

- [ ] `codex-bridge.mjs` 全部分支  
- [ ] `FlowCanvas.tsx` provider 枚举与迁移逻辑修正  
- [ ] 任务阶段文案  
- [ ] `rendered-html` / provider 测试更新  
- [ ] README

### Phase 3 — 端到端验收（0.5 天）

- [ ] `npm run dev`：选 Antigravity → 生成带图任务  
- [ ] 无 CLI / 未登录 UI  
- [ ] 取消任务  
- [ ] skill 缺失失败  
- [ ] 与 Codex/OpenRouter/Grok 切换不串会话  

### Phase 4 — 加固（可选，按 POC 痛点）

- [ ] 模型目录缓存与强制刷新  
- [ ] 额度用尽友好文案  
- [ ] 图片：若 CLI 支持，规范化附件传法  
- [ ] 若官方补 ACP，再评估替换 spawn 实现（接口保持 `runAntigravityRefine`）

---

## 6. 任务拆解（实施顺序）

```text
T0  POC 笔记（人工）
T1  antigravity-provider.mjs 骨架 + status/models
T2  runAntigravityRefine + 隔离 skill + JSON 校验
T3  tests/antigravity-provider.test.mjs
T4  codex-bridge 接入 executeRefine/health/models/thread
T5  FlowCanvas provider 枚举与旧迁移逻辑反转
T6  rendered-html + README + .env.example
T7  端到端手测清单勾选
```

依赖：`T0 → T1 → T2 → T3 → T4/T5 可并行 → T6 → T7`。

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| CLI flag 与文档不一致 | 卡死 T2 | T0 POC 锁定真实 CLI 版本与参数 |
| 不支持多模态图 | 参考图流程不完整 | UI 警告；有图任务建议 Codex/Grok；后续换 API |
| 订阅额度紧 / 429 | 任务失败 | 明确错误；并发默认勿对 Antigravity 开太高 |
| Agent 乱改文件 | 安全事故 | 隔离 cwd + prompt 禁工具 + 尽可能 headless 单回合 |
| ToS：自动化 OAuth | 账号风险 | 仅本机用户已登录 CLI；文档声明勿多账号轮询/转发 |
| 旧画布 antigravity→codex 逻辑 | 用户困惑 | 发版说明：恢复为正式供应商 |
| Python SDK 与 Node 混用 | 复杂度 | Phase 1 不用 SDK，只 spawn `agy` |

---

## 8. 明确不做的「假接入」

- 用 comfly/中转冒充 Antigravity  
- 用未官方支持的第三方「订阅转 API」工具  
- 在未完成 POC 前合并主路径代码  

---

## 9. 工作量粗估

| 阶段 | 估时 |
|------|------|
| Phase 0 POC | 0.5–1 人日 |
| Phase 1 Provider | 1–2 人日 |
| Phase 2 接线 | 0.5–1 人日 |
| Phase 3 验收 | 0.5 人日 |
| **合计** | **约 2.5–4.5 人日**（POC 失败则止于 1 日） |

---

## 10. 确认问题（开始写代码前请拍板）

1. **图片硬要求**：若 `agy` 不能稳定喂图，是否仍上线「仅文本 + @图片N 编号约定」？  
2. **默认模型**：POC 后定一个默认（如平台默认 Gemini）；是否暴露多模型下拉？  
3. **旧节点**：已存画布里被迁成 Codex 的节点，是否需要一键「改回 Antigravity」？默认：不自动改回，用户手动选供应商。  
4. **是否现在就做 Phase 0 POC**（需你本机已装 `agy` 并登录 Pro）？

---

## 11. 建议的下一步

1. 你确认第 10 节选项。  
2. 执行 **Phase 0 POC**（可我在本机探测 `agy` 是否存在并跑只读命令）。  
3. POC 通过后按 T1→T7 实现，每阶段保持 `npm test` 绿。

---

*本计划对齐现有 `grok-build-provider.mjs` / `codex-bridge.mjs` / `FlowCanvas` Provider 模型，刻意避免 OpenRouter Agent SDK 路径。*
