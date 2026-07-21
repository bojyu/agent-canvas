@echo off
chcp 65001 >nul
setlocal EnableExtensions
title Agent Canvas · Antigravity 验证方案
cd /d "%~dp0.."

echo.
echo ============================================================
echo  Agent Canvas · Antigravity 本机验证（不走 Gemini CLI 订阅）
echo ============================================================
echo.
echo  背景：2026-06-18 起，个人/Pro/Ultra 订阅的 Gemini CLI 已停服，
echo        官方要求改用 Antigravity CLI（命令名 agy）。
echo        桌面 IDE「Antigravity」≠ headless 的 agy，两者都要确认。
echo.
echo  本脚本只做检测与引导，不会自动改你的 Google 账号。
echo ============================================================
echo.

set "STEP=0"

echo [步骤 1/6] 检查 agy（Antigravity CLI）
where agy >nul 2>&1
if errorlevel 1 (
  echo   [X] PATH 中未找到 agy
  echo.
  echo   请先安装官方 Antigravity CLI（Windows PowerShell）：
  echo.
  echo     irm https://antigravity.google/cli/install.ps1 ^| iex
  echo.
  echo   或 CMD：
  echo     curl -fsSL https://antigravity.google/cli/install.cmd -o %%TEMP%%\agy-install.cmd
  echo     %%TEMP%%\agy-install.cmd
  echo.
  echo   装完后关闭本窗口，重新打开终端再运行本脚本。
  echo   文档：https://antigravity.google/product/antigravity-cli
  echo         https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/
  goto :end
) else (
  echo   [OK] 已找到 agy：
  where agy
  for /f "delims=" %%V in ('agy --version 2^>^&1') do echo        %%V
)

echo.
echo [步骤 2/6] 检查桌面 Antigravity IDE（可选，用于对照登录）
if exist "%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe" (
  echo   [OK] 已安装桌面 Antigravity
  echo        %LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe
) else (
  echo   [--] 未检测到桌面 Antigravity（可忽略，CLI 才是画板需要的）
)

echo.
echo [步骤 3/6] 检查本机 Gemini CLI（仅供对照，Pro 订阅通常已不可用）
where gemini >nul 2>&1
if errorlevel 1 (
  echo   [--] 未安装 gemini（可忽略）
) else (
  echo   [!!] 仍装有 gemini，但个人/Pro/Ultra 订阅从 2026-06-18 起应改用 agy
  where gemini
)

echo.
echo [步骤 4/6] 交互登录 agy（若已登录会直接进 TUI）
echo   说明：
echo   - 选择 Google OAuth / Google 登录
echo   - 浏览器授权后，若要求粘贴 code，粘贴回终端
echo   - 登录成功后输入 /quit 或 exit 退出 TUI，再回到本脚本
echo.
echo   按任意键启动：agy
pause >nul
agy
echo.
echo   已从 agy 返回。若刚才未成功登录，后面的 headless 探测会失败。

echo.
echo [步骤 5/6] Headless 探测（画板实际调用形态）
echo   命令: agy -p "Reply with exactly OK and nothing else."
echo.
agy -p "Reply with exactly OK and nothing else." 1>"%TEMP%\agy-probe-out.txt" 2>"%TEMP%\agy-probe-err.txt"
set "PROBE_EXIT=%ERRORLEVEL%"
echo   --- stdout ---
type "%TEMP%\agy-probe-out.txt"
echo   --- stderr ---
type "%TEMP%\agy-probe-err.txt"
echo   --- exit=%PROBE_EXIT% ---
if not "%PROBE_EXIT%"=="0" (
  echo.
  echo   [X] Headless 失败。常见原因：
  echo       1^) 未完成 OAuth
  echo       2^) 账号额度/风控/ToS 禁用
  echo       3^) agy 版本过旧或未装完整
  echo   请把上面 stdout/stderr 原文保留，便于排查。
  goto :end
)

findstr /i /c:"OK" "%TEMP%\agy-probe-out.txt" >nul
if errorlevel 1 (
  echo   [!!] 进程成功但输出里没有 OK，仍可能可用；请人工看 stdout。
) else (
  echo   [OK] Headless 返回含 OK
)

echo.
echo   可选再测 JSON 输出（若你的 agy 支持 --output-format）：
echo     agy -p "Return JSON {\"ok\":true}" --output-format json
echo   按任意键跳过或你自行在新终端试。
echo.

echo [步骤 6/6] 对接画板
echo   1. 在项目 .env.local 增加（路径按 where agy 结果改）：
echo.
echo      ANTIGRAVITY_CLI=你的agy完整路径
echo.
echo   2. 重启画板：npm run dev
echo   3. 浏览器打开 http://127.0.0.1:4173
echo   4. 改写节点供应商选 Antigravity，应显示已配置 + 模型列表
echo   5. 或命令行验证 bridge：
echo.
echo      curl http://127.0.0.1:4317/models?provider=antigravity
echo      curl http://127.0.0.1:4317/health
echo.
echo   期望 health.providers.antigravity.ready = true
echo.

if exist ".env.local" (
  findstr /i "ANTIGRAVITY_CLI" ".env.local" >nul 2>&1
  if errorlevel 1 (
    echo   提示：当前 .env.local 尚未写 ANTIGRAVITY_CLI。
  ) else (
    echo   提示：.env.local 已包含 ANTIGRAVITY_CLI。
  )
)

echo.
echo ============================================================
echo  验证结论填写（自行勾选）
echo ============================================================
echo  [ ] agy 已安装且 --version 正常
echo  [ ] agy 交互登录成功（Google 账号）
echo  [ ] agy -p headless 返回正常
echo  [ ] 画板 Antigravity 显示已配置
echo  [ ] 一次带图/不带图改写任务 completed
echo ============================================================
echo.

:end
echo.
pause
endlocal
