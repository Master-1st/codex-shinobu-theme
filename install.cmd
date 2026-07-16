@echo off
setlocal
chcp 65001 >nul
title Shinobu Theme - Windows Installer
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set "exit_code=%errorlevel%"
echo.
if not "%exit_code%"=="0" echo Installation did not complete. See docs\TROUBLESHOOTING.md.
pause
exit /b %exit_code%
