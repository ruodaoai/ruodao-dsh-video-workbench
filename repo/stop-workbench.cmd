@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
node "%~dp0scripts\dsh-runner.mjs" video --stop
timeout /t 2 /nobreak >nul
exit /b 0
