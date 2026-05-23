param(
  [string]$VideoPath = "C:\Users\elidi\Downloads\Ronaldinho Was Truly Unstoppable in His Prime! - ArtSoccer (720p, h264, youtube).mp4",
  [string]$ApiUrl = "https://sertao-replay.onrender.com/api",
  [string]$FrontendUrl = "https://sertaoreplay.vercel.app",
  [string]$OperatorToken = "sertao_replay_operador_2026",
  [string]$ClientSlug = "demo-ronaldinho",
  [string]$ClientName = "Demo Ronaldinho",
  [string]$AdminEmail = "admin@demo-ronaldinho.test",
  [string]$AdminPassword = "Demo@Replay2026",
  [string]$CameraId = "campo-01-camera-01",
  [string]$CameraName = "Campo 1 - Camera Ronaldinho",
  [int]$ReplaySeconds = 10
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$toolsDir = Join-Path $root "tools"
$demoDir = Join-Path $toolsDir "demo-camera"
$captureDir = Join-Path $demoDir "capture"
$storageDir = Join-Path $demoDir "storage"
$logDir = Join-Path $demoDir "logs"
$pidPath = Join-Path $demoDir "pids.json"
$mediamtxExe = Join-Path $toolsDir "mediamtx\mediamtx.exe"
$mediamtxConfig = Join-Path $demoDir "mediamtx-demo.yml"
$rtspPath = "ronaldinho-demo"
$rtspUrl = "rtsp://127.0.0.1:8554/$rtspPath"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Invoke-ApiJson {
  param(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null,
    [hashtable]$Headers = @{}
  )

  $uri = "$($ApiUrl.TrimEnd('/'))$Path"
  $finalHeaders = @{ "X-Operator-Token" = $OperatorToken }
  foreach ($key in $Headers.Keys) {
    $finalHeaders[$key] = $Headers[$key]
  }

  $params = @{
    Method = $Method
    Uri = $uri
    Headers = $finalHeaders
    TimeoutSec = 60
  }
  if ($null -ne $Body) {
    $params.ContentType = "application/json"
    $params.Body = ($Body | ConvertTo-Json -Depth 8)
  }

  Invoke-RestMethod @params
}

function Wait-Until {
  param(
    [scriptblock]$Probe,
    [int]$TimeoutSeconds = 60,
    [string]$WaitingMessage = "Aguardando..."
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $result = & $Probe
    if ($result) {
      return $result
    }
    Write-Host $WaitingMessage
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  throw "Timeout: $WaitingMessage"
}

if (!(Test-Path -LiteralPath $VideoPath)) {
  throw "Video nao encontrado: $VideoPath"
}
if (!(Test-Path -LiteralPath $mediamtxExe)) {
  throw "MediaMTX nao encontrado: $mediamtxExe"
}
if (!(Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  throw "FFmpeg nao encontrado no PATH."
}
if (!(Get-Command python -ErrorAction SilentlyContinue)) {
  throw "Python nao encontrado no PATH."
}

New-Item -ItemType Directory -Force -Path $demoDir, $captureDir, $storageDir, $logDir | Out-Null

Write-Step "Parando demo anterior"
& (Join-Path $PSScriptRoot "stop-demo-camera.ps1") -Quiet

Write-Step "Configurando MediaMTX local"
@"
logLevel: info
rtspAddress: :8554
protocols: [tcp]
hls: no
webrtc: no
paths:
  all:
    source: publisher
"@ | Set-Content -LiteralPath $mediamtxConfig -Encoding Ascii

$rtspListener = Get-NetTCPConnection -LocalPort 8554 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($rtspListener) {
  Write-Host "Porta RTSP 8554 ja esta aberta. Reutilizando MediaMTX existente."
  $mediamtx = [pscustomobject]@{ Id = 0; HasExited = $false }
} else {
  $mediamtx = Start-Process -FilePath $mediamtxExe -ArgumentList @($mediamtxConfig) -WorkingDirectory (Split-Path -Parent $mediamtxExe) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir "mediamtx.out.log") -RedirectStandardError (Join-Path $logDir "mediamtx.err.log")
  Start-Sleep -Seconds 2
  if ($mediamtx.HasExited) {
    throw "MediaMTX encerrou ao iniciar. Veja logs em $logDir."
  }
}

Write-Step "Publicando MP4 como camera RTSP"
$ffmpegArgs = "-hide_banner -loglevel warning -re -stream_loop -1 -fflags +genpts -avoid_negative_ts make_zero -i `"$VideoPath`" -map 0:v:0 -map 0:a:0? -vf `"scale=1280:-2,fps=30`" -af `"aresample=async=1:first_pts=0,asetpts=N/SR/TB`" -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p -c:a aac -ar 48000 -b:a 128k -f rtsp -rtsp_transport tcp `"$rtspUrl`""
$ffmpeg = Start-Process -FilePath "ffmpeg" -ArgumentList $ffmpegArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir "ffmpeg-camera.out.log") -RedirectStandardError (Join-Path $logDir "ffmpeg-camera.err.log")
Start-Sleep -Seconds 4
if ($ffmpeg.HasExited) {
  throw "FFmpeg da camera simulada encerrou. Veja logs em $logDir."
}

Write-Step "Criando/atualizando cliente e camera no backend"
$clients = Invoke-ApiJson -Method "GET" -Path "/super-admin/clients"
$client = $clients | Where-Object { $_.slug -eq $ClientSlug } | Select-Object -First 1
if (!$client) {
  $client = Invoke-ApiJson -Method "POST" -Path "/super-admin/clients" -Body @{
    name = $ClientName
    slug = $ClientSlug
    plan = "demo"
    logo_url = "/assets/logo-sertao-replay-nav.png"
    company_email = $AdminEmail
    company_phone = ""
    document = "DEMO"
    address = "Camera simulada por video local"
    admin_name = "Admin Demo"
    admin_email = $AdminEmail
    admin_password = $AdminPassword
    is_active = $true
  }
} else {
  $client = Invoke-ApiJson -Method "PATCH" -Path "/super-admin/clients/$($client.id)" -Body @{
    is_active = $true
    admin_name = "Admin Demo"
    admin_email = $AdminEmail
    admin_password = $AdminPassword
  }
}

$camera = Invoke-ApiJson -Method "POST" -Path "/cameras" -Headers @{ "X-Client-Slug" = $ClientSlug } -Body @{
  id = $CameraId
  name = $CameraName
  slug = $CameraId
  rtsp_url = $rtspUrl
  enabled = $true
  notes = "Camera simulada com MP4 em loop para reuniao."
}

Write-Step "Iniciando capture-server da demo"
@"
BACKEND_API_URL=$ApiUrl
OPERATOR_TOKEN=$OperatorToken
CLIENT_ID=$($client.id)
CLIENT_SLUG=$ClientSlug
CAMERA_ID=$CameraId
CAMERA_NAME=$CameraName
LOCAL_RTSP_URL=$rtspUrl
RTSP_TRANSPORT=tcp
BUFFER_VIDEO_CODEC=libx264
BUFFER_FPS=30
REPLAY_VIDEO_CODEC=libx264
REPLAY_AUDIO_CODEC=aac
ENABLE_REPLAY_AUDIO=true
FAST_REPLAY_COPY=false
SEGMENT_TIME_SECONDS=2
SEGMENT_WRAP_COUNT=120
POLL_INTERVAL_SECONDS=1
SNAPSHOT_INTERVAL_SECONDS=2
STORAGE_ROOT=$($storageDir.Replace('\','/'))
"@ | Set-Content -LiteralPath (Join-Path $captureDir ".env") -Encoding UTF8

$captureScript = Join-Path $root "capture-server\capture_server.py"
$capture = Start-Process -FilePath "python" -ArgumentList @($captureScript) -WorkingDirectory $captureDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir "capture.out.log") -RedirectStandardError (Join-Path $logDir "capture.err.log")
Start-Sleep -Seconds 4
if ($capture.HasExited) {
  throw "Capture-server encerrou ao iniciar. Veja logs em $logDir."
}

@{
  mediamtx = $mediamtx.Id
  ffmpeg = $ffmpeg.Id
  capture = $capture.Id
  client_slug = $ClientSlug
  camera_id = $CameraId
  rtsp_url = $rtspUrl
  started_at = (Get-Date).ToString("s")
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $pidPath -Encoding UTF8

Write-Step "Validando live"
Wait-Until -TimeoutSeconds 90 -WaitingMessage "Aguardando capture-server gravar buffer..." -Probe {
  $cameras = Invoke-RestMethod -Uri "$ApiUrl/public/clients/$ClientSlug/cameras" -TimeoutSec 30
  $current = $cameras | Where-Object { $_.id -eq $CameraId } | Select-Object -First 1
  if ($current -and $current.status -eq "recording") { return $current }
  return $null
} | Out-Null

Start-Sleep -Seconds ([Math]::Max(14, $ReplaySeconds + 4))

Write-Step "Validando replay"
$request = Invoke-RestMethod -Method Post -Uri "$ApiUrl/public/clients/$ClientSlug/replay-requests" -ContentType "application/json" -Body (@{
  camera_id = $CameraId
  seconds = $ReplaySeconds
  label = "Demo Ronaldinho"
} | ConvertTo-Json) -TimeoutSec 60

$readyReplay = Wait-Until -TimeoutSeconds 120 -WaitingMessage "Aguardando replay ficar pronto..." -Probe {
  $replays = Invoke-RestMethod -Uri "$ApiUrl/public/clients/$ClientSlug/replays?camera_slug=$CameraId" -TimeoutSec 30
  $match = $replays | Where-Object { $_.status -eq "ready" -and $_.video_url } | Select-Object -First 1
  if ($match) { return $match }
  return $null
}

Write-Step "Demo pronta"
Write-Host "Cliente:       $ClientName"
Write-Host "Admin:         $AdminEmail"
Write-Host "Senha:         $AdminPassword"
Write-Host "Camera RTSP:   $rtspUrl"
Write-Host "Home:          $FrontendUrl/$ClientSlug"
Write-Host "Campo/cameras: $FrontendUrl/$ClientSlug/campo1"
Write-Host "Camera:        $FrontendUrl/$ClientSlug/campo1/camera1"
Write-Host "Streaming:     $FrontendUrl/$ClientSlug/streaming"
Write-Host "Replay:        $FrontendUrl$($readyReplay.video_url)"
Write-Host ""
Write-Host "Para parar depois da reuniao:"
Write-Host "powershell -ExecutionPolicy Bypass -File scripts\\stop-demo-camera.ps1"
