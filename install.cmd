@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set "exit_code=%errorlevel%"
echo.
if not "%exit_code%"=="0" echo Installation did not complete.
pause
exit /b %exit_code%

