$ErrorActionPreference = "Stop"

function Read-Value($Prompt, $Default = "") {
  if ($Default) {
    $value = Read-Host "$Prompt [$Default]"
    if ([string]::IsNullOrWhiteSpace($value)) {
      return $Default
    }
    return $value.Trim()
  }

  do {
    $value = Read-Host $Prompt
  } while ([string]::IsNullOrWhiteSpace($value))

  return $value.Trim()
}

function Test-Command($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

$root = Split-Path -Parent $PSScriptRoot
$captureDir = Join-Path $root "capture-server"
$envPath = Join-Path $captureDir ".env"
$startBatPath = Join-Path $root "iniciar-capture-cliente.bat"

if (!(Test-Path -LiteralPath $captureDir)) {
  throw "Pasta capture-server nao encontrada. Execute na raiz do projeto."
}

Write-Host ""
Write-Host "==============================================="
Write-Host " Instalador do servidor local - Sertao Replay"
Write-Host "==============================================="
Write-Host ""
Write-Host "Este instalador vincula esta maquina a uma empresa criada no Super Admin."
Write-Host ""

$apiUrl = "https://sertao-replay.onrender.com/api"
$installKey = (Read-Value "Chave de instalacao da empresa").ToUpperInvariant()

Write-Host ""
Write-Host "API Render: $apiUrl"
Write-Host "Validando chave no backend..."

$resolveUrl = "$apiUrl/install/resolve"
$body = @{ install_key = $installKey } | ConvertTo-Json

try {
  $resolved = Invoke-RestMethod -Method Post -Uri $resolveUrl -ContentType "application/json" -Body $body -TimeoutSec 30
} catch {
  throw "Nao foi possivel validar a chave. Confira a internet, a URL da API e a chave informada. Detalhe: $($_.Exception.Message)"
}

if (!$resolved.ok) {
  throw "Backend recusou a chave de instalacao."
}

$client = $resolved.client
$capture = $resolved.capture

Write-Host ""
Write-Host "Empresa encontrada:"
Write-Host "  Nome:      $($client.name)"
Write-Host "  Slug:      $($client.slug)"
Write-Host "  Admin:     $($client.admin_email)"
Write-Host "  Site:      $($client.public_url)"
Write-Host "  Painel:    $($client.admin_url)"
Write-Host ""

if ([string]::IsNullOrWhiteSpace($capture.operator_token)) {
  Write-Host "AVISO: a API nao retornou OPERATOR_TOKEN. Configure OPERATOR_TOKEN manualmente no capture-server\.env." -ForegroundColor Yellow
}

$cameraId = Read-Value "ID da camera" $capture.camera_id
$cameraName = Read-Value "Nome da camera" "Campo 01"
$rtspUrl = Read-Host "URL RTSP da camera (ex: rtsp://usuario:senha@192.168.0.10:554/onvif1). Pode deixar vazio se ja cadastrou no admin"
$rtspUrl = $rtspUrl.Trim()
$rtspTransport = Read-Value "Transporte RTSP" "tcp"
$replaySeconds = Read-Value "Tempo padrao do replay em segundos" "15"

$envLines = @(
  "BACKEND_API_URL=$apiUrl",
  "OPERATOR_TOKEN=$($capture.operator_token)",
  "CLIENT_ID=$($capture.client_id)",
  "CLIENT_SLUG=$($capture.client_slug)",
  "CAMERA_ID=$cameraId",
  "CAMERA_NAME=$cameraName",
  "LOCAL_RTSP_URL=$rtspUrl",
  "OPERATOR_URL=$($capture.operator_url)",
  "RTSP_TRANSPORT=$rtspTransport",
  "BUFFER_VIDEO_CODEC=libx264",
  "BUFFER_FPS=30",
  "DEFAULT_REPLAY_SECONDS=$replaySeconds",
  "REPLAY_VIDEO_CODEC=libx264",
  "FAST_REPLAY_COPY=true",
  "SEGMENT_TIME_SECONDS=1",
  "SEGMENT_WRAP_COUNT=120",
  "POLL_INTERVAL_SECONDS=1",
  "SNAPSHOT_INTERVAL_SECONDS=2"
)

Set-Content -LiteralPath $envPath -Value $envLines -Encoding UTF8

Write-Host ""
Write-Host ".env criado em: $envPath"

if (!(Test-Command "python")) {
  throw "Python nao encontrado no PATH. Instale Python 3.11+ e rode o instalador novamente."
}

Write-Host ""
Write-Host "Instalando dependencias Python do capture-server..."
Push-Location $captureDir
try {
  python -m pip install --upgrade pip
  python -m pip install requests
} finally {
  Pop-Location
}

if (!(Test-Command "ffmpeg")) {
  Write-Host ""
  Write-Host "AVISO: FFmpeg nao foi encontrado no PATH." -ForegroundColor Yellow
  Write-Host "Instale o FFmpeg antes de iniciar o capture-server."
} else {
  Write-Host "FFmpeg encontrado."
}

$startBat = @"
@echo off
title Sertao Replay - Capture Server
cd /d "%~dp0capture-server"
python capture_server.py
pause
"@
Set-Content -LiteralPath $startBatPath -Value $startBat -Encoding ASCII

Write-Host ""
Write-Host "Atalho de inicializacao criado:"
Write-Host "  $startBatPath"

$createTask = Read-Host "Criar tarefa do Windows para iniciar ao fazer login? (S/N)"
if ($createTask.Trim().ToUpperInvariant() -eq "S") {
  $taskName = "Sertao Replay Capture - $($client.slug)"
  $taskCommand = "`"$startBatPath`""
  schtasks /Create /TN $taskName /TR $taskCommand /SC ONLOGON /RL HIGHEST /F | Out-Host
  Write-Host "Tarefa criada: $taskName"
}

Write-Host ""
Write-Host "Resumo:"
Write-Host "  Cliente:   $($client.name)"
Write-Host "  Chave:     $installKey"
Write-Host "  Camera:    $cameraId"
Write-Host "  Site:      $($client.public_url)"
Write-Host "  Admin:     $($client.admin_url)"
Write-Host ""

$runNow = Read-Host "Iniciar o capture-server agora? (S/N)"
if ($runNow.Trim().ToUpperInvariant() -eq "S") {
  Start-Process -FilePath $startBatPath -WorkingDirectory $root
  Write-Host "Capture-server iniciado em uma nova janela."
}
