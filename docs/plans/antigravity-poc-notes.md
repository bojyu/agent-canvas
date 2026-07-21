# Antigravity POC 实录（本机 Windows）

日期：2026-07-17

## 发现

| 项 | 结果 |
|----|------|
| `agy` | **未安装** |
| `antigravity` | 已装 **1.107.0 桌面 IDE**（Electron/VS Code 形态），`--help` 为打开文件/窗口，**不是** headless agent |
| `@google/gemini-cli` | 全局已装 **0.37.0**，支持 `-p` headless、`-o text/json`、`--approval-mode plan`、`--acp` |
| 登录状态 | `google_accounts.json` active=null；headless 探测报 `FatalAuthenticationError` / exit 41，需交互登录 |
| 多模态图 | 未在已登录环境实测；Phase 1 将文件拷入隔离 `media/` 并在 prompt 声明路径 |

## 接入决策

- Provider id：`antigravity`
- CLI 解析顺序：`ANTIGRAVITY_CLI` → `GEMINI_CLI` → `agy` → `gemini`
- 调用：`stdin + "-"` 长 prompt，`--approval-mode plan`，`-o text`，全量 Seedance 预载
- 模型列表：登录成功后使用内置 fallback 目录（gemini-2.5-pro/flash 等）

## 用户操作

```powershell
npm i -g @google/gemini-cli
gemini
# 完成 Google OAuth 后
# 重启画板，选择 Antigravity
```
