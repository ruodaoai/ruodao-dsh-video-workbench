@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
REM Auto-hide black CMD window: delegate immediately to silent WScript daemon launcher!
if exist "%~dp0start-workbench.vbs" (
  start "" wscript.exe //nologo "%~dp0start-workbench.vbs"
  exit /b 0
)
node "%~dp0scripts\dsh-runner.mjs" video --keep-alive --open --daemon
exit /b 0
