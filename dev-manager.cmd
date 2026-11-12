@echo off
setlocal
cd /d "%~dp0"
node scripts\dev-manager.mjs
if errorlevel 1 (
  echo.
  echo Vivarqo Dev Manager terminato con errori.
  pause
)
