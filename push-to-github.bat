@echo off
chcp 65001 >nul
title Gemini-Antigravity Bridge - 一键 GitHub 推送
cd /d "%~dp0"

echo =======================================================
echo     Gemini-Antigravity Bridge - 一键 GitHub 推送
echo =======================================================
echo.

git --version >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Git 环境，请先安装 Git 并配置到环境变量 PATH 中！
    echo.
    pause
    exit /b 1
)

:: 动态获取当前分支名（默认 main）
set CURRENT_BRANCH=main
for /f "tokens=*" %%i in ('git branch --show-current 2^>nul') do set CURRENT_BRANCH=%%i

echo [当前目录] %CD%
echo [当前分支] %CURRENT_BRANCH%
echo.

echo [1/3] 正在扫描并暂存变更文件 (git add .)...
git add .
echo.

echo [当前待提交状态清单]:
git status -s
echo.

set "MSG="
set /p "MSG=请输入提交说明 (直接回车默认使用自动时间戳): "
if "%MSG%"=="" set "MSG=auto update %date:~0,10% %time:~0,8%"

echo.
echo [2/3] 正在提交本地版本: "%MSG%"
git commit -m "%MSG%"
if errorlevel 1 (
    echo [提示] 工作区无新修改或已是最新提交，继续执行远程推送...
)

echo.
echo [3/3] 正在推送到远程 GitHub (git push origin %CURRENT_BRANCH%)...
git push origin %CURRENT_BRANCH%

if errorlevel 1 (
    echo.
    echo =======================================================
    echo   [!] 推送失败！
    echo   常见原因与解决建议：
    echo   1. 账号权限问题：如果提示 403 denied to xxx，请在 Windows 凭据管理器中更新 GitHub 账号凭据或 Token
    echo   2. 远程仓库有新更新：可先执行 git pull --rebase origin %CURRENT_BRANCH%
    echo   3. 网络代理/超时：请检查 GitHub 网络连接与梯子设置
    echo =======================================================
) else (
    echo.
    echo =======================================================
    echo   [OK] 恭喜！代码已成功推送到 GitHub 远程仓库！
    echo   仓库地址: https://github.com/ai919/Gemini-Antigravity-Bridge
    echo =======================================================
)

echo.
pause
