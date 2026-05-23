@echo off
setlocal

cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Ambiente Python nao encontrado.
  echo Rode:
  echo   python -m venv .venv
  echo   .venv\Scripts\python.exe -m pip install -r requirements.txt
  pause
  exit /b 1
)

if not exist ".env" (
  echo Arquivo .env nao encontrado.
  echo Configure a camera antes de iniciar.
  pause
  exit /b 1
)

echo Iniciando capture-server da camera em segundo plano...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process -FilePath '%cd%\.venv\Scripts\python.exe' -ArgumentList '%cd%\capture_server.py' -WorkingDirectory '%cd%' -WindowStyle Hidden -RedirectStandardOutput '%cd%\capture-server.out.log' -RedirectStandardError '%cd%\capture-server.err.log'"

if errorlevel 1 (
  echo Falha ao iniciar capture-server em segundo plano.
  pause
  exit /b 1
)

echo [OK] Capture-server iniciado em background.
echo Logs: %cd%\capture-server.err.log
timeout /t 2 >nul
