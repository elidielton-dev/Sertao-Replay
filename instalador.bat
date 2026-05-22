@echo off
setlocal
title Instalador - Sertao Replay Capture

cd /d "%~dp0"

if not exist "scripts\install-client.ps1" (
  echo Arquivo scripts\install-client.ps1 nao encontrado.
  echo Execute este instalador na pasta raiz do projeto Sertao Replay.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-client.ps1"
set EXITCODE=%ERRORLEVEL%

if not "%EXITCODE%"=="0" (
  echo.
  echo Instalacao finalizada com erro. Codigo: %EXITCODE%
  pause
  exit /b %EXITCODE%
)

echo.
echo Instalacao finalizada.
pause
