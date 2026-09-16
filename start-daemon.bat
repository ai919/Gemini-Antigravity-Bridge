@echo off
title Gemini-Antigravity Local Daemon
echo =======================================================
echo    Starting Gemini-Antigravity Local Workspace Daemon
echo    Workspace: %CD%
echo =======================================================
cd daemon
node server.js
pause
