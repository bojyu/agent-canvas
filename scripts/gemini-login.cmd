@echo off
chcp 65001 >nul
title Agent Canvas · Gemini / Antigravity 登录
cd /d "%~dp0.."
echo.
echo ========================================
echo  Agent Canvas · Gemini / Antigravity 登录
echo ========================================
echo.
echo 1. 下面会启动 gemini 交互界面
echo 2. 若提示打开浏览器，请用 Google 账号完成登录
echo 3. 登录成功后输入 /quit 退出，然后刷新画板
echo 4. 改写节点供应商选择 Antigravity
echo.
echo 可执行文件:
where gemini 2>nul
if errorlevel 1 (
  echo [错误] 未找到 gemini。请先运行: npm i -g @google/gemini-cli
  pause
  exit /b 1
)
echo.
gemini --version
echo.
echo 正在启动 gemini ...
echo.
gemini
echo.
echo 登录流程已结束。请刷新画板 http://127.0.0.1:4173
pause
