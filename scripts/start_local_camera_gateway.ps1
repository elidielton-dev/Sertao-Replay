$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$captureDir = Join-Path $root "capture-server"
$captureEnv = Join-Path $captureDir ".env"
$capturePython = Join-Path $captureDir ".venv\Scripts\python.exe"
$captureScript = Join-Path $captureDir "capture_server.py"
$captureRequirements = Join-Path $captureDir "requirements.txt"
$captureLog = Join-Path $captureDir "capture-server.err.log"
$toolsDir = Join-Path $root "tools"
$mediaMtxDir = Join-Path $toolsDir "mediamtx"
$mediaMtxExe = Join-Path $mediaMtxDir "mediamtx.exe"
$mediaMtxConfig = Join-Path $mediaMtxDir "mediamtx-local.yml"
$mediaMtxOutLog = Join-Path $mediaMtxDir "mediamtx-local.out.log"
$mediaMtxErrLog = Join-Path $mediaMtxDir "mediamtx-local.err.log"
$pidDir = Join-Path $toolsDir "run"
$mediaMtxPid = Join-Path $pidDir "mediamtx.pid"
$capturePid = Join-Path $pidDir "capture-server.pid"
$transcodePid = Join-Path $pidDir "ffmpeg-live-transcode.pid"
$transcodeOutLog = Join-Path $mediaMtxDir "ffmpeg-live-transcode.out.log"
$transcodeErrLog = Join-Path $mediaMtxDir "ffmpeg-live-transcode.err.log"

$cameraId = "campo-01"
$rtspPath = "campo-01"
$liveRtspPath = "campo-01-live"
$publicIp = "187.19.251.46"
$localIp = "192.168.0.6"
$backendApiUrl = "https://sertao-replay.onrender.com/api"
$operatorToken = "sertao_replay_operador_2026"
$mediaMtxZipUrl = "https://github.com/bluenviron/mediamtx/releases/download/v1.18.2/mediamtx_v1.18.2_windows_amd64.zip"
$mediaMtxZip = Join-Path $toolsDir "mediamtx_v1.18.2_windows_amd64.zip"

function Read-DotEnv($path) {
    $values = @{}
    if (-not (Test-Path $path)) {
        return $values
    }

    Get-Content $path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
            return
        }

        $separator = $line.IndexOf("=")
        $key = $line.Substring(0, $separator).Trim()
        $value = $line.Substring($separator + 1).Trim().Trim('"').Trim("'")
        $values[$key] = $value
    }

    return $values
}

function Save-DotEnv($path, $values) {
    $orderedKeys = @(
        "BACKEND_API_URL",
        "OPERATOR_TOKEN",
        "CAMERA_ID",
        "CAMERA_SOURCE_RTSP_URL",
        "LOCAL_RTSP_URL",
        "RTSP_TRANSPORT",
        "BUFFER_VIDEO_CODEC",
        "BUFFER_FPS",
        "DEFAULT_REPLAY_SECONDS",
        "REPLAY_VIDEO_CODEC",
        "FAST_REPLAY_COPY",
        "SEGMENT_TIME_SECONDS",
        "SEGMENT_WRAP_COUNT",
        "POLL_INTERVAL_SECONDS"
    )

    $lines = @()
    foreach ($key in $orderedKeys) {
        if ($values.ContainsKey($key)) {
            $lines += "$key=$($values[$key])"
        }
    }

    foreach ($key in ($values.Keys | Sort-Object)) {
        if ($orderedKeys -notcontains $key) {
            $lines += "$key=$($values[$key])"
        }
    }

    $lines | Set-Content -Encoding ascii $path
}

function Stop-PidFile($path) {
    if (-not (Test-Path $path)) {
        return
    }

    $pidValue = (Get-Content $path -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($pidValue) {
        Stop-Process -Id ([int]$pidValue) -Force -ErrorAction SilentlyContinue
    }

    Remove-Item $path -Force -ErrorAction SilentlyContinue
}

function Stop-CaptureProcesses {
    Get-CimInstance Win32_Process -Filter "name='python.exe'" |
        Where-Object { $_.CommandLine -like "*capture_server.py*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

    Get-CimInstance Win32_Process -Filter "name='python3.13.exe'" |
        Where-Object { $_.CommandLine -like "*capture_server.py*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Open-FirewallPort($name, $protocol, $port) {
    try {
        if (-not (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol $protocol -LocalPort $port | Out-Null
        }
        Write-Host "[OK] Firewall Windows liberado: $protocol/$port"
    } catch {
        Write-Host "[AVISO] Nao consegui abrir Firewall Windows para $protocol/$port. Execute PowerShell como Administrador se precisar."
    }
}

New-Item -ItemType Directory -Force $toolsDir, $mediaMtxDir, $pidDir | Out-Null

if (-not (Test-Path $mediaMtxExe)) {
    Write-Host "[INFO] Baixando MediaMTX..."
    Remove-Item $mediaMtxZip -Force -ErrorAction SilentlyContinue
    Invoke-WebRequest -UseBasicParsing $mediaMtxZipUrl -OutFile $mediaMtxZip
    Expand-Archive -Force $mediaMtxZip $mediaMtxDir
}

if (-not (Test-Path $captureEnv)) {
    throw "Arquivo capture-server\.env nao encontrado."
}

$envValues = Read-DotEnv $captureEnv
$cameraSourceRtsp = $envValues["CAMERA_SOURCE_RTSP_URL"]
if ([string]::IsNullOrWhiteSpace($cameraSourceRtsp)) {
    $cameraSourceRtsp = $envValues["LOCAL_RTSP_URL"]
}

if ([string]::IsNullOrWhiteSpace($cameraSourceRtsp) -or -not $cameraSourceRtsp.StartsWith("rtsp://")) {
    throw "URL RTSP real da camera nao encontrada. Configure CAMERA_SOURCE_RTSP_URL no capture-server\.env."
}

$envValues["BACKEND_API_URL"] = $backendApiUrl
$envValues["OPERATOR_TOKEN"] = $operatorToken
$envValues["CAMERA_ID"] = $cameraId
$envValues["CAMERA_SOURCE_RTSP_URL"] = $cameraSourceRtsp
$envValues["LOCAL_RTSP_URL"] = "rtsp://127.0.0.1:8554/$rtspPath"
$envValues["RTSP_TRANSPORT"] = "tcp"
Save-DotEnv $captureEnv $envValues

@"
logLevel: info

rtsp: true
rtspAddress: :8554

hls: true
hlsAddress: :8888
hlsAllowOrigins: ['*']
hlsVariant: lowLatency

webrtc: true
webrtcAddress: :8889
webrtcAllowOrigins: ['*']
webrtcLocalUDPAddress: :8189
webrtcLocalTCPAddress: :8189
webrtcIPsFromInterfaces: true
webrtcAdditionalHosts: [$publicIp, $localIp]
webrtcICEServers2:
  - url: stun:stun.l.google.com:19302

paths:
  ${rtspPath}:
    source: $cameraSourceRtsp
    rtspTransport: udp
    sourceOnDemand: false
  all_others:
"@ | Set-Content -Encoding ascii $mediaMtxConfig

Open-FirewallPort "Sertao Replay MediaMTX RTSP 8554" "TCP" 8554
Open-FirewallPort "Sertao Replay MediaMTX HLS 8888" "TCP" 8888
Open-FirewallPort "Sertao Replay MediaMTX WebRTC HTTP 8889" "TCP" 8889
Open-FirewallPort "Sertao Replay MediaMTX WebRTC ICE TCP 8189" "TCP" 8189
Open-FirewallPort "Sertao Replay MediaMTX WebRTC ICE UDP 8189" "UDP" 8189

Stop-CaptureProcesses
Stop-PidFile $capturePid
Stop-PidFile $transcodePid
Stop-PidFile $mediaMtxPid
Get-Process ffmpeg -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "[INFO] Iniciando MediaMTX local..."
$mediaMtxProcess = Start-Process -FilePath $mediaMtxExe -ArgumentList "`"$mediaMtxConfig`"" -WorkingDirectory $mediaMtxDir -RedirectStandardOutput $mediaMtxOutLog -RedirectStandardError $mediaMtxErrLog -WindowStyle Hidden -PassThru
$mediaMtxProcess.Id | Set-Content -Encoding ascii $mediaMtxPid
Start-Sleep -Seconds 6

Write-Host "[INFO] Publicando live H264 para WebRTC..."
$transcodeArgs = @(
    "-hide_banner",
    "-loglevel", "info",
    "-rtsp_transport", "tcp",
    "-fflags", "+genpts+discardcorrupt",
    "-err_detect", "ignore_err",
    "-i", "rtsp://127.0.0.1:8554/$rtspPath",
    "-an",
    "-vf", "scale=1280:-2,fps=15",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "zerolatency",
    "-pix_fmt", "yuv420p",
    "-g", "30",
    "-b:v", "2500k",
    "-maxrate", "2500k",
    "-bufsize", "5000k",
    "-f", "rtsp",
    "-rtsp_transport", "tcp",
    "rtsp://127.0.0.1:8554/$liveRtspPath"
)
$transcodeProcess = Start-Process -FilePath "ffmpeg" -ArgumentList $transcodeArgs -WorkingDirectory $mediaMtxDir -RedirectStandardOutput $transcodeOutLog -RedirectStandardError $transcodeErrLog -WindowStyle Hidden -PassThru
$transcodeProcess.Id | Set-Content -Encoding ascii $transcodePid
Start-Sleep -Seconds 6

if (-not (Test-Path $capturePython)) {
    Write-Host "[INFO] Criando ambiente Python do capture-server..."
    Push-Location $captureDir
    try {
        python -m venv ".venv"
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path $capturePython)) {
    throw "Nao foi possivel criar capture-server\.venv."
}

& $capturePython -m pip install -r $captureRequirements | Out-Null

Write-Host "[INFO] Iniciando capture-server conectado ao MediaMTX local..."
$captureProcess = Start-Process -FilePath $capturePython -ArgumentList "`"$captureScript`"" -WorkingDirectory $captureDir -RedirectStandardOutput (Join-Path $captureDir "capture-server.out.log") -RedirectStandardError $captureLog -WindowStyle Hidden -PassThru
$captureProcess.Id | Set-Content -Encoding ascii $capturePid
Start-Sleep -Seconds 8

Write-Host ""
Write-Host "[OK] Gateway local da camera iniciado."
Write-Host "Site no ar:     https://sports-replay-mvp.vercel.app/streaming"
Write-Host "Backend no ar:  $backendApiUrl"
Write-Host "WHEP local:     http://127.0.0.1:8889/$liveRtspPath/whep"
Write-Host "WHEP publico:   http://${publicIp}:8889/$liveRtspPath/whep"
Write-Host "Teste local:    http://127.0.0.1:8889/$liveRtspPath/"
Write-Host ""
Write-Host "No roteador/provedor, encaminhe para ${localIp}: TCP 8889 e UDP 8189."
