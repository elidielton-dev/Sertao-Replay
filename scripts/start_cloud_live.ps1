param(
    [string]$CloudRtspUrl = "rtsp://54.207.185.74:8554/camera1",
    [string]$BackendApiUrl = "",
    [string]$OperatorToken = "",
    [string]$CameraId = "",
    [string]$CameraName = ""
)

$ErrorActionPreference = "Stop"

$rootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$captureDir = Join-Path $rootDir "capture-server"
$captureEnv = Join-Path $captureDir ".env"
$captureScript = Join-Path $captureDir "capture_server.py"
$capturePython = Join-Path $captureDir ".venv\Scripts\python.exe"
$captureRequirements = Join-Path $captureDir "requirements.txt"
$runDir = Join-Path $rootDir "tools\run"
$logDir = Join-Path $rootDir "tools\cloud-live"
$publisherPid = Join-Path $runDir "ffmpeg-cloud-publisher.pid"
$capturePid = Join-Path $runDir "capture-server.pid"
$publisherErrLog = Join-Path $logDir "ffmpeg-cloud-publisher.err.log"
$publisherOutLog = Join-Path $logDir "ffmpeg-cloud-publisher.out.log"
$captureErrLog = Join-Path $logDir "capture-server.err.log"
$captureOutLog = Join-Path $logDir "capture-server.out.log"

function Write-Step($message) {
    Write-Host ""
    Write-Host "==> $message"
}

function Write-Ok($message) {
    Write-Host "[OK] $message"
}

function Write-Warn($message) {
    Write-Host "[AVISO] $message"
}

function Redact-SensitiveText([string]$text) {
    return ($text -replace 'rtsp://[^/@\s]+@', 'rtsp://***@')
}

function Write-SafeLogTail([string]$path, [int]$lines = 20) {
    if (-not (Test-Path $path)) {
        return
    }

    Get-Content $path -Tail $lines | ForEach-Object {
        Write-Host (Redact-SensitiveText $_)
    }
}

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
        "CAMERA_NAME",
        "CAMERA_SOURCE_RTSP_URL",
        "CAMERA_SOURCE_RTSP_TRANSPORT",
        "LOCAL_RTSP_URL",
        "RTSP_TRANSPORT",
        "BUFFER_VIDEO_CODEC",
        "BUFFER_FPS",
        "DEFAULT_REPLAY_SECONDS",
        "REPLAY_VIDEO_CODEC",
        "FAST_REPLAY_COPY",
        "SEGMENT_TIME_SECONDS",
        "SEGMENT_WRAP_COUNT",
        "POLL_INTERVAL_SECONDS",
        "SNAPSHOT_INTERVAL_SECONDS",
        "OPERATOR_URL"
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

    Set-Content -Path $path -Value $lines -Encoding ascii
}

function Get-EnvValue($values, $key, $default = "") {
    if ($values.ContainsKey($key) -and -not [string]::IsNullOrWhiteSpace($values[$key])) {
        return $values[$key]
    }

    return $default
}

function Stop-PidFile($path) {
    if (-not (Test-Path $path)) {
        return
    }

    $pidValue = Get-Content $path -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pidValue -match "^\d+$") {
        Stop-Process -Id ([int]$pidValue) -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $path -Force -ErrorAction SilentlyContinue
}

function Invoke-BackendJson($method, $url, $operatorToken, $body) {
    $headers = @{}
    if ($operatorToken) {
        $headers["X-Operator-Token"] = $operatorToken
    }

    Invoke-RestMethod -Method $method -Uri $url -Headers $headers -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 5) -TimeoutSec 30
}

New-Item -ItemType Directory -Force $runDir, $logDir | Out-Null

Write-Step "Sertao Replay - live em servidor publico"

if (-not (Test-Path $captureEnv)) {
    throw "Arquivo capture-server\.env nao encontrado. Crie a partir de capture-server\.env.example."
}

$envValues = Read-DotEnv $captureEnv
$BackendApiUrl = if ($BackendApiUrl) { $BackendApiUrl } else { Get-EnvValue $envValues "BACKEND_API_URL" }
$OperatorToken = if ($OperatorToken) { $OperatorToken } else { Get-EnvValue $envValues "OPERATOR_TOKEN" }
$CameraId = if ($CameraId) { $CameraId } else { Get-EnvValue $envValues "CAMERA_ID" "campo-01" }
$CameraName = if ($CameraName) { $CameraName } else { Get-EnvValue $envValues "CAMERA_NAME" "Campo 01" }
$cameraSourceRtspUrl = Get-EnvValue $envValues "CAMERA_SOURCE_RTSP_URL"
$cameraSourceTransport = Get-EnvValue $envValues "CAMERA_SOURCE_RTSP_TRANSPORT" "udp"

if ([string]::IsNullOrWhiteSpace($BackendApiUrl)) {
    throw "BACKEND_API_URL nao configurado em capture-server\.env."
}
if ([string]::IsNullOrWhiteSpace($OperatorToken)) {
    throw "OPERATOR_TOKEN nao configurado em capture-server\.env."
}
if ([string]::IsNullOrWhiteSpace($cameraSourceRtspUrl) -or -not $cameraSourceRtspUrl.StartsWith("rtsp://")) {
    throw "CAMERA_SOURCE_RTSP_URL precisa apontar para a camera real."
}
if ($cameraSourceTransport -notin @("udp", "tcp")) {
    throw "CAMERA_SOURCE_RTSP_TRANSPORT precisa ser 'udp' ou 'tcp'."
}

Write-Step "Testando servidor publico RTSP"
$cloudUri = [Uri]$CloudRtspUrl
$tcp = Test-NetConnection $cloudUri.Host -Port $cloudUri.Port -WarningAction SilentlyContinue
if (-not $tcp.TcpTestSucceeded) {
    throw "Nao consegui conectar no servidor publico $($cloudUri.Host):$($cloudUri.Port)."
}
Write-Ok "Servidor publico RTSP acessivel em $($cloudUri.Host):$($cloudUri.Port)."

Write-Step "Reiniciando processos locais"
Stop-PidFile $publisherPid
Stop-PidFile $capturePid
Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -eq "ffmpeg.exe" -and (
            $_.CommandLine -like "*$CloudRtspUrl*" -or
            $_.CommandLine -like "*$cameraSourceRtspUrl*"
        )
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$envValues["BACKEND_API_URL"] = $BackendApiUrl
$envValues["OPERATOR_TOKEN"] = $OperatorToken
$envValues["CAMERA_ID"] = $CameraId
$envValues["CAMERA_NAME"] = $CameraName
$envValues["CAMERA_SOURCE_RTSP_URL"] = $cameraSourceRtspUrl
$envValues["CAMERA_SOURCE_RTSP_TRANSPORT"] = $cameraSourceTransport
$envValues["LOCAL_RTSP_URL"] = $CloudRtspUrl
$envValues["RTSP_TRANSPORT"] = "tcp"
$envValues["OPERATOR_URL"] = "https://sports-replay-mvp.vercel.app/operador"
Save-DotEnv $captureEnv $envValues

Write-Step "Publicando camera no servidor publico"
$publisherArgs = @(
    "-hide_banner",
    "-loglevel", "info",
    "-rtsp_transport", $cameraSourceTransport,
    "-fflags", "+genpts+discardcorrupt",
    "-err_detect", "ignore_err",
    "-use_wallclock_as_timestamps", "1",
    "-i", $cameraSourceRtspUrl,
    "-an",
    "-vf", "scale=1280:-2,fps=15,setpts=N/(15*TB)",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "zerolatency",
    "-pix_fmt", "yuv420p",
    "-g", "30",
    "-b:v", "1600k",
    "-maxrate", "1600k",
    "-bufsize", "3200k",
    "-f", "rtsp",
    "-rtsp_transport", "tcp",
    $CloudRtspUrl
)
$publisherProcess = Start-Process -FilePath "ffmpeg" -ArgumentList $publisherArgs -WorkingDirectory $rootDir -RedirectStandardOutput $publisherOutLog -RedirectStandardError $publisherErrLog -WindowStyle Hidden -PassThru
$publisherProcess.Id | Set-Content -Encoding ascii $publisherPid
Start-Sleep -Seconds 8

if ($publisherProcess.HasExited) {
    Write-Warn "FFmpeg publicador encerrou. Ultimas linhas:"
    Write-SafeLogTail $publisherErrLog 25
    throw "Nao foi possivel publicar a camera no servidor publico."
}
Write-Ok "Camera publicada no servidor publico."

Write-Step "Preparando capture-server"
if (-not (Test-Path $capturePython)) {
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
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao instalar dependencias do capture-server."
}

Write-Step "Registrando camera no backend"
try {
    $cameraPayload = @{
        id = $CameraId
        name = $CameraName
        rtsp_url = $CloudRtspUrl
        enabled = $true
        notes = "Live em servidor publico RTSP/HLS. HLS proxy: /api/cameras/$CameraId/hls/index.m3u8"
    }
    Invoke-BackendJson "Post" "$BackendApiUrl/cameras" $OperatorToken $cameraPayload | Out-Null
    Write-Ok "Camera '$CameraId' cadastrada/atualizada no backend."
} catch {
    Write-Warn "Backend nao respondeu ou recusou o cadastro agora: $($_.Exception.Message)"
}

Write-Step "Iniciando capture-server"
$captureProcess = Start-Process -FilePath $capturePython -ArgumentList "`"$captureScript`"" -WorkingDirectory $captureDir -RedirectStandardOutput $captureOutLog -RedirectStandardError $captureErrLog -WindowStyle Hidden -PassThru
$captureProcess.Id | Set-Content -Encoding ascii $capturePid
Start-Sleep -Seconds 8

if ($captureProcess.HasExited) {
    Write-Warn "capture-server encerrou. Ultimas linhas:"
    Write-SafeLogTail $captureErrLog 25
    throw "Nao foi possivel manter o capture-server rodando."
}
Write-Ok "Capture-server rodando para camera '$CameraId'."

Write-Step "Validacao"
try {
    $hls = Invoke-WebRequest -UseBasicParsing -Uri "http://54.207.185.74:8888/camera1/" -TimeoutSec 15
    Write-Ok "HLS publico respondeu HTTP $($hls.StatusCode)."
} catch {
    Write-Warn "HLS publico ainda nao respondeu: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "============================================================"
Write-Host "LIVE CLOUD INICIADA"
Write-Host "Site:       https://sports-replay-mvp.vercel.app/streaming"
Write-Host "RTSP cloud: $CloudRtspUrl"
Write-Host "HLS proxy:  $BackendApiUrl/cameras/$CameraId/hls/index.m3u8"
Write-Host "Logs:"
Write-Host "  $publisherErrLog"
Write-Host "  $captureErrLog"
Write-Host "============================================================"
