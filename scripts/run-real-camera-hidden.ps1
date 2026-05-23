$ErrorActionPreference = "Stop"

$logDir = Join-Path $PSScriptRoot "..\tools\mediamtx"
New-Item -ItemType Directory -Force $logDir | Out-Null

$source = "rtsp://admin:sertao2026@192.168.0.9:554/onvif1"
$target = "rtsp://54.207.185.74:8554/camera1"

$args = @(
  "-rtsp_transport", "udp",
  "-fflags", "+genpts+discardcorrupt",
  "-err_detect", "ignore_err",
  "-use_wallclock_as_timestamps", "1",
  "-i", $source,
  "-an",
  "-vf", "scale=1280:-2,fps=24",
  "-c:v", "libx264",
  "-preset", "ultrafast",
  "-tune", "zerolatency",
  "-pix_fmt", "yuv420p",
  "-g", "48",
  "-b:v", "3000k",
  "-maxrate", "3000k",
  "-bufsize", "6000k",
  "-f", "rtsp",
  "-rtsp_transport", "tcp",
  $target
)

Start-Process -FilePath "ffmpeg" `
  -ArgumentList $args `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir "ffmpeg-real-cloud.out.log") `
  -RedirectStandardError (Join-Path $logDir "ffmpeg-real-cloud.err.log") | Out-Null

Write-Host "[OK] FFmpeg iniciado oculto."
Write-Host "Origem: $source"
Write-Host "Destino: $target"
Write-Host "Log: $(Join-Path $logDir 'ffmpeg-real-cloud.err.log')"
