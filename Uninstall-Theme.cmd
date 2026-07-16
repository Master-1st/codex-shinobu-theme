@echo off
setlocal
chcp 65001 >nul
title Shinobu Theme - Windows Uninstaller

echo [K] Remove theme and keep imported artwork
echo [P] Remove theme and purge imported artwork
echo [C] Cancel
choice /C KPC /N /M "Choose K, P, or C: "
set "selection=%errorlevel%"

if "%selection%"=="3" exit /b 0
if "%selection%"=="2" (
  "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& '%~dp0uninstall.ps1' -PurgeData -Confirm:$false"
) else (
  "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& '%~dp0uninstall.ps1' -Confirm:$false"
)
set "exitCode=%errorlevel%"

echo.
if not "%exitCode%"=="0" echo Uninstall did not finish. See docs\TROUBLESHOOTING.md.
pause
exit /b %exitCode%
