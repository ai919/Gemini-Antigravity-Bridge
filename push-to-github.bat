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

:: 账号选择交互（检测并支持多账号切换及唤起浏览器登录）
where gh >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo -------------------------------------------------------
    echo [GitHub 账号选择]
    echo   [1] ai919 (本仓库推荐主账号)
    echo   [2] ai717
    echo   [3] 唤起浏览器登录新账号 (Web Login)
    echo   [4] 保持当前默认，直接继续
    echo -------------------------------------------------------
    set "ACCOUNT_CHOICE="
    set /p "ACCOUNT_CHOICE=请选择推送使用的 GitHub 账号 [直接回车默认 1]: "
    if "%ACCOUNT_CHOICE%"=="" set "ACCOUNT_CHOICE=1"

    if "%ACCOUNT_CHOICE%"=="1" (
        echo [账号] 切换活跃账号为 ai919...
        gh auth switch --hostname github.com --user ai919 >nul 2>nul
    )
    if "%ACCOUNT_CHOICE%"=="2" (
        echo [账号] 切换活跃账号为 ai717...
        gh auth switch --hostname github.com --user ai717 >nul 2>nul
    )
    if "%ACCOUNT_CHOICE%"=="3" (
        echo [账号] 正在唤起浏览器授权登录...
        gh auth login -h github.com -w
    )
    echo.
)

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
    echo   [!] 推送遇到问题！
    echo   常见原因与解决建议：
    echo   1. 账号权限问题：请在上方菜单选择与仓库匹配的账号（如 ai919）
    echo   2. 远程仓库有新更新：可先执行 git pull --rebase origin %CURRENT_BRANCH%
    echo   3. 网络代理/超时：请检查 GitHub 网络连接与代理设置
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
