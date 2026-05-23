$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$captureDir = Join-Path $root "capture-server"
$envPath = Join-Path $captureDir ".env"
$pythonExe = Join-Path $captureDir ".venv\Scripts\python.exe"
$captureScript = Join-Path $captureDir "capture_server.py"
$logDir = Join-Path $root "tools\mediamtx"
New-Item -ItemType Directory -Force $logDir | Out-Null

$cameraSource = "rtsp://admin:sertao2026@192.168.0.9:554/onvif1"
$cloudTarget = "rtsp://54.207.185.74:8554/camera1"

if (-not (Test-Path $envPath)) {
  throw "Arquivo capture-server/.env nao encontrado."
}

# Final state expected by capture-server in cloud mode.
$content = Get-Content $envPath -Raw
$content = $content -replace '(?m)^CLIENT_ID=.*$', 'CLIENT_ID=arenabeachwmcustodia'
$content = $content -replace '(?m)^CLIENT_SLUG=.*$', 'CLIENT_SLUG=arenabeachwmcustodia'
$content = $content -replace '(?m)^CAMERA_ID=.*$', 'CAMERA_ID=campo-01-camera-01'
$content = $content -replace '(?m)^CAMERA_NAME=.*$', 'CAMERA_NAME=Campo 1 - Camera 1'
$content = $content -replace '(?m)^LOCAL_RTSP_URL=.*$', "LOCAL_RTSP_URL=$cloudTarget"
$content = $content -replace '(?m)^RTSP_TRANSPORT=.*$', 'RTSP_TRANSPORT=tcp'
$content = $content -replace '(?m)^CAMERA_SOURCE_RTSP_URL=.*$', "CAMERA_SOURCE_RTSP_URL=$cameraSource"
$content = $content -replace '(?m)^CAMERA_SOURCE_RTSP_TRANSPORT=.*$', 'CAMERA_SOURCE_RTSP_TRANSPORT=udp'
Set-Content -LiteralPath $envPath -Value $content -Encoding ascii

# Stop old publishers / capture instances to avoid duplicates.
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "ffmpeg.exe" -or $_.CommandLine -match "capture_server.py|auto_sync_runner.py|54.207.185.74:8554/camera1" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 1

# Publish real camera to cloud RTSP (same line user was using).
$ffmpegArgs = @(
  "-rtsp_transport", "udp",
  "-fflags", "+genpts+discardcorrupt",
  "-err_detect", "ignore_err",
  "-use_wallclock_as_timestamps", "1",
  "-i", $cameraSource,
  "-map", "0:v:0",
  "-map", "0:a:0?",
  "-vf", "scale=1280:-2,fps=24",
  "-c:v", "libx264",
  "-preset", "ultrafast",
  "-tune", "zerolatency",
  "-pix_fmt", "yuv420p",
  "-c:a", "aac",
  "-ar", "48000",
  "-b:a", "128k",
  "-g", "48",
  "-b:v", "3000k",
  "-maxrate", "3000k",
  "-bufsize", "6000k",
  "-f", "rtsp",
  "-rtsp_transport", "tcp",
  $cloudTarget
)

Start-Process -FilePath "ffmpeg" `
  -ArgumentList $ffmpegArgs `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir "ffmpeg-real-cloud.out.log") `
  -RedirectStandardError (Join-Path $logDir "ffmpeg-real-cloud.err.log") | Out-Null

Start-Sleep -Seconds 2

if (-not (Test-Path $pythonExe)) {
  throw "Python da venv nao encontrado em $pythonExe"
}

Start-Process -FilePath $pythonExe `
  -ArgumentList $captureScript `
  -WorkingDirectory $captureDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $captureDir "capture-server.out.log") `
  -RedirectStandardError (Join-Path $captureDir "capture-server.err.log") | Out-Null

Write-Host "[OK] Modo cloud iniciado."
Write-Host "Origem camera: $cameraSource"
Write-Host "RTSP cloud:    $cloudTarget"
Write-Host "Logs ffmpeg:   $(Join-Path $logDir 'ffmpeg-real-cloud.err.log')"
Write-Host "Logs capture:  $(Join-Path $captureDir 'capture-server.err.log')"
