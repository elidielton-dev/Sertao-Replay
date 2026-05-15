@echo off
setlocal

cd /d "%~dp0capture-server"

if not exist ".venv\Scripts\python.exe" (
  echo Ambiente Python nao encontrado.
  echo Rode uma vez:
  echo   cd capture-server
  echo   python -m venv .venv
  echo   .venv\Scripts\python.exe -m pip install -r requirements.txt
  pause
  exit /b 1
)

if not exist ".env" (
  echo Arquivo capture-server\.env nao encontrado.
  echo Configure a camera antes de iniciar.
  pause
  exit /b 1
)

echo Iniciando capture-server da camera...
echo Backend: https://sertao-replay.onrender.com/api
echo.

".venv\Scripts\python.exe" capture_server.py

echo.
echo Capture-server encerrado.
pause
