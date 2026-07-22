# Agent Canvas × Codex 插件实施计划

## 目标

让 Agent Canvas 成为 Codex 可以直接调用的本地创作工具：Codex 根据自然语言要求搭建节点、连接流程、配置供应商和模型，并在用户明确要求后执行提示词、图片或视频任务。浏览器仍是可视化编辑与监控界面，但不再是自动化的唯一入口。

## 核心原则

- 画布服务端是持久状态的权威写入口；MCP、CLI 和前端共用同一项目与任务中心。
- MCP 只传递语义化、小体积数据；API Key 与媒体 Base64 不进入模型上下文。
- 所有图修改按事务执行：先完整验证，再一次原子保存；失败不产生半成品。
- 使用 `revision`/`expectedRevision` 防止覆盖浏览器未保存修改，使用 `transactionId` 保证重试幂等。
- 图片/视频生成可能收费，默认只做 dry-run；只有用户明确要求产出时才执行。
- 第一版逐节点执行，依赖顺序由 Codex显式编排；后续再加入整图调度器。

## 架构

```text
Codex 对话
  └─ Agent Canvas Skill
       └─ agent_canvas MCP（stdio，自包含）
            └─ 127.0.0.1:4317 automation HTTP
                 ├─ CanvasProjectStore（锁、revision、原子写、事件）
                 ├─ Canvas domain（节点、连线、预设、校验、任务编译）
                 ├─ 现有任务队列 / Provider runners
                 └─ Project SSE → 已打开的 React 画板

CLI ────────────────────────────────┘
```

## 阶段 1：可用闭环（本次已完成）

- [x] 抽出服务端画布领域模块：节点工厂、预设、连接矩阵、图校验、分组/解组、布局。
- [x] 建立项目存储层：每项目串行锁、唯一临时文件、原子替换、schemaVersion、revision/CAS。
- [x] 建立原子事务：dry-run、幂等 transactionId、整批回滚、变更摘要。
- [x] 建立紧凑 inspect/output/task 响应，剥离 Data URL 与大型 Base64。
- [x] 服务端按节点编译四类任务：编辑改写、编辑提示词、图片生成、视频生成。
- [x] 自动化任务完成后服务端写回输出节点；浏览器关闭也不丢结果。
- [x] 增加项目 SSE；已保存画布自动同步，存在本地编辑时提示冲突。
- [x] 增加本地 CLI，作为调试、脚本和无 MCP 环境的后备入口。
- [x] 创建仓库内 Codex 插件、Skill、MCP server 和本地 marketplace。
- [x] 增加纯本地测试，禁止在测试中调用真实付费 Provider。

### 第一版 automation API

- `GET /automation/status`
- `GET /automation/capabilities`
- `GET /automation/projects`
- `POST /automation/projects`
- `GET /automation/projects/:id/inspect`
- `POST /automation/projects/:id/transactions`
- `POST /automation/projects/:id/media`
- `POST /automation/projects/:id/nodes/:nodeId/run`
- `GET /automation/projects/:id/outputs`
- `GET /automation/models?kind=...&provider=...`
- `GET /automation/tasks/:id`
- `GET /projects/events`

## 阶段 2：资产引用与存储瘦身

现有旧项目把图片/视频 Data URL 同时写在媒体节点、生成结果和任务记录中，少量节点即可形成几十 MB JSON。MCP 已避免返回这些内容，但磁盘模型仍需迁移。

- [ ] 引入 `assetId` 与项目资产目录，节点只保存文件引用、MIME、尺寸和哈希。
- [ ] 对旧 Data URL 做一次可回滚迁移，保留原项目备份和 schema migration 日志。
- [ ] 任务历史只存 `savedPath`/assetId，不再重复保存生成 Base64。
- [ ] 项目事件只传 revision 与变更摘要，媒体预览继续走 `/media-file` Range。
- [ ] 增加资产去重、孤儿清理和项目导出时的可移植打包。

验收：现有 10–20 节点项目 JSON 降到 KB/低 MB 级；任务 SSE 不再包含大型媒体；旧画布无损打开。

## 阶段 3：工作流调度、持久撤销与成本护栏

- [ ] 增加 `canvas.run_workflow`：拓扑排序、上游输出等待、失败短路和从指定节点续跑。
- [ ] 执行前返回计划：将运行哪些节点、供应商、模型、预计任务数与可能计费项。
- [ ] 对多次图片/视频调用要求一次明确批量确认，并支持最大任务数/预算上限。
- [ ] 增加服务端事务日志和 `canvas.undo(transactionId)`，与前端 Ctrl+Z 的本地历史协调。
- [ ] 增加任务事件 ID、项目过滤、断点续传和更长历史的分页查询。
- [ ] 节点执行时记录输入 revision；输出节点被删除或语义已改变时，将结果保存在任务/资产库而不覆盖新内容。

验收：可安全执行有依赖的提示词→图片→视频流程；中途失败可定位、可续跑，且不会重复收费或覆盖新编辑。

## 阶段 4：跨项目与分发

- [ ] 把 Agent Canvas 数据目录从应用仓库解耦，支持每个 Codex 工作区的 `.agent-canvas/` 或用户自定义位置。
- [ ] 增加本机实例发现与可选授权令牌，避免未来开放非本机监听时出现未授权写入。
- [ ] 插件提供“启动/打开画板”能力，并处理端口占用与多实例选择。
- [ ] 完成插件图标、截图、版本与升级/缓存刷新流程。
- [ ] 增加 Windows/macOS/Linux 启动脚本和 CI 端到端测试。

验收：任意 Codex 项目都能选择独立或共享画布空间；插件可安装、升级、卸载，不依赖当前仓库绝对路径。

## 当前限制

- Agent Canvas 服务需要先运行在 `127.0.0.1:4317`；MCP 不会在协议 stdout 中启动 npm 子进程。
- 自动化执行一次只运行一个处理节点，尚不自动遍历整张图。
- 媒体已经从 MCP 响应中剥离，但旧项目/任务文件仍可能很大。
- repo marketplace 的插件变更需要重启 Codex App，并在新对话中测试新 Skill/MCP 工具。

## 验证清单

- [x] 预设图与连接规则测试。
- [x] 操作原子性与输入不变测试。
- [x] group/ungroup 坐标保持测试。
- [x] compact inspect 不含 Base64 测试。
- [x] 四类任务中的图片生成编译与服务端结果投影测试。
- [x] revision 冲突、幂等事务、并发写与临时文件清理测试。
- [x] MCP initialize/tools-list 协议测试。
- [ ] 假 Provider 的完整 HTTP 队列与任务落盘集成测试。
- [ ] 浏览器端多窗口冲突和自动同步交互测试。
- [ ] 资产迁移、恢复与大项目性能测试。
