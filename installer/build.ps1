$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $PSScriptRoot "app\main.py"
$capture = Join-Path $root "capture-server\capture_server.py"
$logo = Join-Path $root "frontend\public\assets\logo-sertao-replay.png"
$icon = Join-Path $PSScriptRoot "assets\sertao-replay.ico"

python -m pip install pyinstaller customtkinter requests
if ($LASTEXITCODE -ne 0) {
  throw "Falha ao instalar dependencias do instalador."
}

Get-Process SertaoReplaySetup -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

python -m PyInstaller `
  --noconfirm `
  --onefile `
  --windowed `
  --name SertaoReplaySetup `
  --icon "$icon" `
  --distpath "$PSScriptRoot\dist" `
  --workpath "$PSScriptRoot\build" `
  --specpath "$PSScriptRoot" `
  --add-data "$capture;." `
  --add-data "$logo;." `
  --add-data "$icon;." `
  "$app"
if ($LASTEXITCODE -ne 0) {
  throw "Falha ao gerar o executavel do instalador."
}

Write-Host ""
Write-Host "Executavel gerado em:"
Write-Host (Join-Path $PSScriptRoot "dist\SertaoReplaySetup.exe")
