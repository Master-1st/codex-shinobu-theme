@echo off
setlocal
chcp 65001 >nul
title Codex Windows Optimizer

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Optimize-Codex.ps1" -Mode Optimize -Interactive -Restart
set "exitCode=%errorlevel%"

echo.
if not "%exitCode%"=="0" echo Optimization did not finish. Review the message above.
pause
exit /b %exitCode%
