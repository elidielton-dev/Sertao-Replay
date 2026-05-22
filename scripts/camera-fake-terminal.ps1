param(
  [string]$MachineIp = "",
  [string]$VideoPath = "",
  [string]$RtspPath = "ronaldinho-demo",
  [int]$RtspPort = 8554
)

$ErrorActionPreference = "Stop"

$appDir = Join-Path $env:USERPROFILE "SertaoReplayFakeCamera"
$toolsDir = Join-Path $appDir "tools"
$logDir = Join-Path $appDir "logs"
$pidPath = Join-Path $appDir "camera-fake-pids.json"
$mediamtxDir = Join-Path $toolsDir "mediamtx"
$mediamtxExe = Join-Path $mediamtxDir "mediamtx.exe"
$mediamtxConfig = Join-Path $appDir "mediamtx.yml"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
  Write-Host "[AVISO] $Message" -ForegroundColor Yellow
}

function Stop-PreviousFakeCamera {
  if (!(Test-Path -LiteralPath $pidPath)) {
    return
  }

  try {
    $state = Get-Content -LiteralPath $pidPath -Raw | ConvertFrom-Json
    foreach ($id in @($state.ffmpeg, $state.mediamtx)) {
      if ([int]$id -gt 0) {
        Stop-Process -Id ([int]$id) -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {
    Write-Warn $_.Exception.Message
  }

  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

function Get-DefaultIPv4 {
  $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and
      $_.IPAddress -notlike "169.254.*" -and
      $_.PrefixOrigin -ne "WellKnown"
    } |
    Select-Object -ExpandProperty IPAddress

  return $addresses | Select-Object -First 1
}

function Ensure-Ffmpeg {
  $command = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  Write-Step "Instalando FFmpeg"
  Write-Warn "FFmpeg nao foi encontrado. Vou instalar pelo winget."
  winget install --id Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements

  $paths = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages",
    "$env:ProgramFiles",
    "${env:ProgramFiles(x86)}"
  )
  foreach ($root in $paths) {
    if (!$root -or !(Test-Path -LiteralPath $root)) {
      continue
    }
    $found = Get-ChildItem -Path $root -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) {
      return $found.FullName
    }
  }

  $command = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  throw "FFmpeg nao foi encontrado depois da instalacao. Feche e abra o PowerShell, ou instale FFmpeg manualmente."
}

function Get-FfprobePath([string]$FfmpegPath) {
  $command = Get-Command ffprobe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $nearFfmpeg = Join-Path (Split-Path -Parent $FfmpegPath) "ffprobe.exe"
  if (Test-Path -LiteralPath $nearFfmpeg) {
    return $nearFfmpeg
  }

  return ""
}

function Open-FirewallPort([int]$Port) {
  try {
    $ruleName = "Sertao Replay Fake Camera RTSP $Port"
    $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if (!$existing) {
      New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port | Out-Null
    }
    Write-Ok "Firewall liberado para TCP $Port."
  } catch {
    Write-Warn "Nao consegui abrir o firewall automaticamente. Se outro computador for acessar, libere TCP $Port no Windows Firewall."
  }
}

function Test-RtspUrl([string]$FfprobePath, [string]$Url) {
  if (!$FfprobePath) {
    Write-Warn "ffprobe nao encontrado; nao vou validar a URL $Url."
    return
  }

  $result = & $FfprobePath -v error -rtsp_transport tcp -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 $Url 2>&1
  if ($LASTEXITCODE -eq 0 -and $result) {
    Write-Ok "RTSP validado: $Url"
    return
  }

  Write-Warn "Nao consegui validar $Url. Se estiver em outro computador, confirme IP e firewall."
}

function Ensure-MediaMtx {
  if (Test-Path -LiteralPath $mediamtxExe) {
    return $mediamtxExe
  }

  Write-Step "Baixando MediaMTX"
  New-Item -ItemType Directory -Force -Path $mediamtxDir | Out-Null
  $zipPath = Join-Path $toolsDir "mediamtx.zip"
  $url = "https://github.com/bluenviron/mediamtx/releases/download/v1.18.2/mediamtx_v1.18.2_windows_amd64.zip"
  Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
  Expand-Archive -LiteralPath $zipPath -DestinationPath $mediamtxDir -Force
  Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue

  if (!(Test-Path -LiteralPath $mediamtxExe)) {
    throw "MediaMTX nao foi extraido corretamente em $mediamtxExe."
  }

  return $mediamtxExe
}

function Ask-Required([string]$CurrentValue, [string]$Prompt, [string]$DefaultValue = "") {
  if ($CurrentValue) {
    return $CurrentValue
  }

  $suffix = if ($DefaultValue) { " [$DefaultValue]" } else { "" }
  do {
    $value = Read-Host "$Prompt$suffix"
    if (!$value -and $DefaultValue) {
      $value = $DefaultValue
    }
  } while (!$value)

  return $value
}

New-Item -ItemType Directory -Force -Path $appDir, $toolsDir, $logDir | Out-Null

$defaultIp = Get-DefaultIPv4
$MachineIp = Ask-Required $MachineIp "Digite o IP da maquina que vai aparecer na rede" $defaultIp
$VideoPath = Ask-Required $VideoPath "Digite o caminho completo do video MP4"
$VideoPath = [System.IO.Path]::GetFullPath($VideoPath.Trim('"'))
$RtspPath = ($RtspPath -replace "[^A-Za-z0-9_-]", "").Trim()
if (!$RtspPath) {
  $RtspPath = "ronaldinho-demo"
}

if (!(Test-Path -LiteralPath $VideoPath)) {
  throw "Video nao encontrado: $VideoPath"
}

Write-Step "Preparando camera fake"
Stop-PreviousFakeCamera
$ffmpegExe = Ensure-Ffmpeg
$ffprobeExe = Get-FfprobePath $ffmpegExe
$mediamtxExe = Ensure-MediaMtx

@"
logLevel: info
rtspAddress: :$RtspPort
rtspTransports: [tcp]
rtmp: no
hls: no
webrtc: no
srt: no
paths:
  all:
    source: publisher
"@ | Set-Content -LiteralPath $mediamtxConfig -Encoding Ascii

$listener = Get-NetTCPConnection -LocalPort $RtspPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  Write-Warn "A porta $RtspPort ja esta aberta. Vou tentar usar o servidor RTSP que ja esta rodando."
  $mediamtx = [pscustomobject]@{ Id = 0; HasExited = $false }
} else {
  $mediamtx = Start-Process -FilePath $mediamtxExe `
    -ArgumentList @($mediamtxConfig) `
    -WorkingDirectory $mediamtxDir `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput (Join-Path $logDir "mediamtx.out.log") `
    -RedirectStandardError (Join-Path $logDir "mediamtx.err.log")
  Start-Sleep -Seconds 2
  if ($mediamtx.HasExited) {
    throw "MediaMTX nao iniciou. Veja os logs em $logDir."
  }
}
Open-FirewallPort $RtspPort

$localRtspUrl = "rtsp://127.0.0.1:$RtspPort/$RtspPath"
$networkRtspUrl = "rtsp://$MachineIp`:$RtspPort/$RtspPath"

$ffmpegArgs = "-hide_banner -loglevel warning -re -stream_loop -1 -i `"$VideoPath`" -an -vf `"scale=1280:-2,fps=30`" -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p -f rtsp -rtsp_transport tcp `"$localRtspUrl`""
$ffmpeg = Start-Process -FilePath $ffmpegExe `
  -ArgumentList $ffmpegArgs `
  -WindowStyle Hidden `
  -PassThru `
  -RedirectStandardOutput (Join-Path $logDir "ffmpeg.out.log") `
  -RedirectStandardError (Join-Path $logDir "ffmpeg.err.log")

Start-Sleep -Seconds 4
if ($ffmpeg.HasExited) {
  throw "FFmpeg encerrou ao publicar o video. Veja os logs em $logDir."
}

Test-RtspUrl $ffprobeExe $localRtspUrl
if ($MachineIp -ne "127.0.0.1") {
  Test-RtspUrl $ffprobeExe $networkRtspUrl
}

@{
  mediamtx = $mediamtx.Id
  ffmpeg = $ffmpeg.Id
  machine_ip = $MachineIp
  rtsp_url = $networkRtspUrl
  local_rtsp_url = $localRtspUrl
  video_path = $VideoPath
  started_at = (Get-Date).ToString("s")
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $pidPath -Encoding UTF8

Write-Step "Camera fake rodando"
Write-Ok "Use esta URL se o sistema estiver no mesmo notebook:"
Write-Host $localRtspUrl -ForegroundColor White
Write-Host ""
Write-Ok "Use esta URL se outro computador for acessar pela rede:"
Write-Host $networkRtspUrl -ForegroundColor White
Write-Host ""
Write-Host "No cadastro por IP, tente primeiro:" -ForegroundColor Cyan
Write-Host "$MachineIp`:$RtspPort" -ForegroundColor White
Write-Host ""
Write-Host "Se o cadastro por IP nao detectar o caminho, use a URL completa:" -ForegroundColor Cyan
Write-Host $networkRtspUrl -ForegroundColor White
Write-Host ""
Write-Host "Logs e estado ficam em: $appDir"
Write-Host "Para parar: feche esta janela ou rode camera-fake-stop.ps1."

try {
  while ($true) {
    Start-Sleep -Seconds 3
    if ($ffmpeg.HasExited) {
      throw "FFmpeg parou. Veja $logDir\ffmpeg.err.log"
    }
    if ($mediamtx.Id -and $mediamtx.HasExited) {
      throw "MediaMTX parou. Veja $logDir\mediamtx.err.log"
    }
  }
} finally {
  Stop-PreviousFakeCamera
}
