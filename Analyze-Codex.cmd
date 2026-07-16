@echo off
setlocal
chcp 65001 >nul
title Codex Windows Read-Only Analysis

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Optimize-Codex.ps1" -Mode Analyze
set "exitCode=%errorlevel%"

echo.
if not "%exitCode%"=="0" echo Analysis did not finish. See docs\TROUBLESHOOTING.md.
pause
exit /b %exitCode%
