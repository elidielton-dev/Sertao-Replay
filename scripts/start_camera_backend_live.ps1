param(
    [string]$BackendApiUrl = "",
    [string]$OperatorToken = "",
    [string]$CameraId = "",
    [string]$CameraName = "",
    [string]$CameraSourceRtspUrl = "",
    [string]$CameraSourceTransport = "",
    [string]$PublicWebrtcHost = "",
    [string]$LocalIp = "",
    [string]$FrontendStreamingUrl = "https://sports-replay-mvp.vercel.app/streaming",
    [switch]$NoFirewall,
    [switch]$NoUpnp,
    [switch]$StopOnly
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$captureDir = Join-Path $root "capture-server"
$captureEnv = Join-Path $captureDir ".env"
$capturePython = Join-Path $captureDir ".venv\Scripts\python.exe"
$captureScript = Join-Path $captureDir "capture_server.py"
$captureRequirements = Join-Path $captureDir "requirements.txt"
$captureErrLog = Join-Path $captureDir "capture-server.err.log"
$captureOutLog = Join-Path $captureDir "capture-server.out.log"

$toolsDir = Join-Path $root "tools"
$mediaMtxDir = Join-Path $toolsDir "mediamtx"
$mediaMtxExe = Join-Path $mediaMtxDir "mediamtx.exe"
$mediaMtxConfig = Join-Path $mediaMtxDir "mediamtx-local.yml"
$mediaMtxOutLog = Join-Path $mediaMtxDir "mediamtx-local.out.log"
$mediaMtxErrLog = Join-Path $mediaMtxDir "mediamtx-local.err.log"
$mediaMtxZipUrl = "https://github.com/bluenviron/mediamtx/releases/download/v1.18.2/mediamtx_v1.18.2_windows_amd64.zip"
$mediaMtxZip = Join-Path $toolsDir "mediamtx_v1.18.2_windows_amd64.zip"

$pidDir = Join-Path $toolsDir "run"
$mediaMtxPid = Join-Path $pidDir "mediamtx.pid"
$capturePid = Join-Path $pidDir "capture-server.pid"
$transcodePid = Join-Path $pidDir "ffmpeg-live-transcode.pid"
$transcodeOutLog = Join-Path $mediaMtxDir "ffmpeg-live-transcode.out.log"
$transcodeErrLog = Join-Path $mediaMtxDir "ffmpeg-live-transcode.err.log"
$scriptRunLog = Join-Path $pidDir "start_camera_backend_live.log"

$rtspPort = 8554
$hlsPort = 8888
$webrtcHttpPort = 8889
$webrtcIcePort = 8189
$cameraRtspPath = "campo-01"
$liveRtspPath = "campo-01-live"

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
        "PUBLIC_WEBRTC_HOST",
        "LOCAL_IP",
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

    $lines | Set-Content -Encoding ascii $path
}

function Get-EnvValue($values, $key, $fallback = "") {
    if ($values.ContainsKey($key) -and -not [string]::IsNullOrWhiteSpace($values[$key])) {
        return $values[$key]
    }
    return $fallback
}

function Get-PrimaryLocalIp {
    $candidate = Get-NetIPConfiguration |
        Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address.IPAddress } |
        Select-Object -ExpandProperty IPv4Address |
        Select-Object -First 1

    if ($candidate) {
        return $candidate.IPAddress
    }

    return "127.0.0.1"
}

function Get-PublicIp {
    try {
        return (Invoke-RestMethod -Uri "https://api.ipify.org" -TimeoutSec 10).Trim()
    } catch {
        return ""
    }
}

function Stop-PidFile($path) {
    if (-not (Test-Path $path)) {
        return
    }

    $pidValue = Get-Content $path -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pidValue) {
        Stop-Process -Id ([int]$pidValue) -Force -ErrorAction SilentlyContinue
    }

    Remove-Item $path -Force -ErrorAction SilentlyContinue
}

function Stop-OldProcesses {
    Stop-PidFile $capturePid
    Stop-PidFile $transcodePid
    Stop-PidFile $mediaMtxPid

    Get-Process mediamtx -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -like "$mediaMtxDir*" } |
        ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }

    Get-CimInstance Win32_Process -Filter "name='python.exe'" |
        Where-Object { $_.CommandLine -like "*capture_server.py*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

    Get-CimInstance Win32_Process -Filter "name='python3.13.exe'" |
        Where-Object { $_.CommandLine -like "*capture_server.py*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

    Get-Process ffmpeg -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

    $deadline = (Get-Date).AddSeconds(12)
    while ((Get-Date) -lt $deadline) {
        $busyPort = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
            Where-Object { $_.LocalPort -in @($rtspPort, $hlsPort, $webrtcHttpPort, $webrtcIcePort) } |
            Select-Object -First 1
        if (-not $busyPort) {
            return
        }
        Start-Sleep -Milliseconds 500
    }
}

function Open-FirewallPort($name, $protocol, $port) {
    if ($NoFirewall) {
        return
    }

    try {
        if (-not (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol $protocol -LocalPort $port | Out-Null
        }
        Write-Ok "Firewall Windows liberado: $protocol/$port"
    } catch {
        Write-Warn "Nao consegui abrir o Firewall Windows para $protocol/$port. Rode o PowerShell como Administrador se essa porta ficar bloqueada."
    }
}

function Add-UpnpPortMapping($port, $protocol, $localIp, $description) {
    if ($NoUpnp) {
        return
    }

    try {
        $nat = New-Object -ComObject HNetCfg.NATUPnP
        $mappings = $nat.StaticPortMappingCollection
        if (-not $mappings) {
            Write-Warn "Roteador nao expôs UPnP para mapear $protocol/$port automaticamente."
            return
        }

        try {
            $mappings.Add($port, $protocol, $port, $localIp, $true, $description) | Out-Null
            Write-Ok "UPnP mapeado no roteador: $protocol/$port -> ${localIp}:$port"
        } catch {
            $message = $_.Exception.Message
            if ($message -match "conflict|already|existe|mapeamento") {
                Write-Ok "UPnP ja tem mapeamento para $protocol/$port."
            } else {
                Write-Warn "Nao consegui criar UPnP ${protocol}/${port}: $message"
            }
        }
    } catch {
        Write-Warn "UPnP indisponivel neste Windows/roteador: $($_.Exception.Message)"
    }
}

function Test-CommandAvailable($command) {
    try {
        Get-Command $command -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Wait-Port($port, $label) {
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
        $listener = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
            Where-Object { $_.LocalPort -eq $port } |
            Select-Object -First 1
        if ($listener) {
            Write-Ok "$label escutando na porta $port"
            return $true
        }
        Start-Sleep -Seconds 1
    }

    Write-Warn "$label nao abriu a porta $port dentro do tempo esperado."
    return $false
}

function Wait-RtspPath($url, $label) {
    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
        $result = cmd.exe /c "ffprobe -v error -rtsp_transport tcp -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 `"$url`" 2>nul"
        $exitCode = $LASTEXITCODE
        if ($exitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($result)) {
            Write-Ok "$label online ($result)"
            return $true
        }
        Start-Sleep -Seconds 2
    }

    Write-Warn "$label nao ficou disponivel em $url dentro do tempo esperado."
    return $false
}

function Invoke-BackendJson($method, $url, $token, $body = $null) {
    $headers = @{ "X-Operator-Token" = $token }
    if ($body) {
        return Invoke-RestMethod -Method $method -Uri $url -Headers $headers -Body ($body | ConvertTo-Json -Depth 5) -ContentType "application/json" -TimeoutSec 30
    }

    return Invoke-RestMethod -Method $method -Uri $url -Headers $headers -TimeoutSec 30
}

function Register-BackendCamera($backendApiUrl, $operatorToken, $cameraId, $cameraName, $rtspUrl, $whepUrl) {
    Invoke-RestMethod -Uri "$backendApiUrl/health" -TimeoutSec 30 | Out-Null
    $cameraPayload = @{
        id = $cameraId
        name = $cameraName
        rtsp_url = $rtspUrl
        enabled = $true
        notes = "Gateway local ativo. WHEP publico esperado: $whepUrl"
    }
    Invoke-BackendJson "Post" "$backendApiUrl/cameras" $operatorToken $cameraPayload | Out-Null
}

New-Item -ItemType Directory -Force $pidDir | Out-Null
try {
    Start-Transcript -Path $scriptRunLog -Force | Out-Null
} catch {
}

Write-Step "Sertao Replay - camera, backend e live WebRTC"

if (-not (Test-Path $captureEnv)) {
    throw "Arquivo capture-server\.env nao encontrado. Crie a partir de capture-server\.env.example."
}

$envValues = Read-DotEnv $captureEnv
$BackendApiUrl = if ($BackendApiUrl) { $BackendApiUrl } else { Get-EnvValue $envValues "BACKEND_API_URL" }
$OperatorToken = if ($OperatorToken) { $OperatorToken } else { Get-EnvValue $envValues "OPERATOR_TOKEN" }
$CameraId = if ($CameraId) { $CameraId } else { Get-EnvValue $envValues "CAMERA_ID" "campo-01" }
$CameraName = if ($CameraName) { $CameraName } else { Get-EnvValue $envValues "CAMERA_NAME" "Campo 01" }
$CameraSourceRtspUrl = if ($CameraSourceRtspUrl) { $CameraSourceRtspUrl } else { Get-EnvValue $envValues "CAMERA_SOURCE_RTSP_URL" }
$CameraSourceTransport = if ($CameraSourceTransport) { $CameraSourceTransport } else { Get-EnvValue $envValues "CAMERA_SOURCE_RTSP_TRANSPORT" "udp" }
$PublicWebrtcHost = if ($PublicWebrtcHost) { $PublicWebrtcHost } else { Get-EnvValue $envValues "PUBLIC_WEBRTC_HOST" }
$LocalIp = if ($LocalIp) { $LocalIp } else { Get-EnvValue $envValues "LOCAL_IP" }

if ([string]::IsNullOrWhiteSpace($BackendApiUrl)) {
    throw "BACKEND_API_URL nao configurado em capture-server\.env."
}
if ([string]::IsNullOrWhiteSpace($OperatorToken)) {
    throw "OPERATOR_TOKEN nao configurado em capture-server\.env."
}
if ([string]::IsNullOrWhiteSpace($CameraSourceRtspUrl) -or -not $CameraSourceRtspUrl.StartsWith("rtsp://")) {
    throw "CAMERA_SOURCE_RTSP_URL precisa ser uma URL RTSP valida da camera real."
}
if ($CameraSourceRtspUrl -match "127\.0\.0\.1:$rtspPort/$liveRtspPath") {
    throw "CAMERA_SOURCE_RTSP_URL deve apontar para a camera real, nao para a live local."
}
if ($CameraSourceTransport -notin @("udp", "tcp")) {
    throw "CAMERA_SOURCE_RTSP_TRANSPORT precisa ser 'udp' ou 'tcp'."
}

$BackendApiUrl = $BackendApiUrl.TrimEnd("/")
if ([string]::IsNullOrWhiteSpace($LocalIp)) {
    $LocalIp = Get-PrimaryLocalIp
}
if ([string]::IsNullOrWhiteSpace($PublicWebrtcHost)) {
    $PublicWebrtcHost = Get-PublicIp
}
if ([string]::IsNullOrWhiteSpace($PublicWebrtcHost)) {
    $PublicWebrtcHost = $LocalIp
    Write-Warn "Nao consegui descobrir o IP publico. Usando IP local no anuncio WebRTC: $LocalIp"
}

$whepPublicUrl = "http://${PublicWebrtcHost}:${webrtcHttpPort}/${liveRtspPath}/whep"

if ($StopOnly) {
    Write-Step "Parando processos antigos"
    Stop-OldProcesses
    Write-Ok "Processos parados."
    exit 0
}

if (-not (Test-CommandAvailable "ffmpeg")) {
    throw "FFmpeg nao encontrado no PATH."
}
if (-not (Test-CommandAvailable "ffprobe")) {
    Write-Warn "ffprobe nao encontrado no PATH. Replays ainda podem funcionar, mas a validacao de duracao fica limitada."
}

New-Item -ItemType Directory -Force $toolsDir, $mediaMtxDir, $pidDir | Out-Null

Write-Step "Preparando MediaMTX"
if (-not (Test-Path $mediaMtxExe)) {
    Write-Host "Baixando MediaMTX..."
    Remove-Item $mediaMtxZip -Force -ErrorAction SilentlyContinue
    Invoke-WebRequest -UseBasicParsing $mediaMtxZipUrl -OutFile $mediaMtxZip
    Expand-Archive -Force $mediaMtxZip $mediaMtxDir
}

@"
logLevel: info

rtsp: true
rtspAddress: :$rtspPort

hls: true
hlsAddress: :$hlsPort
hlsAllowOrigins: ['*']
hlsVariant: lowLatency

webrtc: true
webrtcAddress: :$webrtcHttpPort
webrtcAllowOrigins: ['*']
webrtcLocalUDPAddress: :$webrtcIcePort
webrtcLocalTCPAddress: :$webrtcIcePort
webrtcIPsFromInterfaces: true
webrtcAdditionalHosts: [$PublicWebrtcHost, $LocalIp]
webrtcICEServers2:
  - url: stun:stun.l.google.com:19302

paths:
  ${liveRtspPath}:
    source: publisher
  all_others:
"@ | Set-Content -Encoding ascii $mediaMtxConfig

Write-Step "Abrindo portas locais"
Open-FirewallPort "Sertao Replay MediaMTX RTSP $rtspPort" "TCP" $rtspPort
Open-FirewallPort "Sertao Replay MediaMTX HLS $hlsPort" "TCP" $hlsPort
Open-FirewallPort "Sertao Replay MediaMTX WebRTC HTTP $webrtcHttpPort" "TCP" $webrtcHttpPort
Open-FirewallPort "Sertao Replay MediaMTX WebRTC ICE TCP $webrtcIcePort" "TCP" $webrtcIcePort
Open-FirewallPort "Sertao Replay MediaMTX WebRTC ICE UDP $webrtcIcePort" "UDP" $webrtcIcePort
Add-UpnpPortMapping $webrtcHttpPort "TCP" $LocalIp "Sertao Replay WebRTC WHEP"
Add-UpnpPortMapping $webrtcIcePort "TCP" $LocalIp "Sertao Replay WebRTC ICE TCP"
Add-UpnpPortMapping $webrtcIcePort "UDP" $LocalIp "Sertao Replay WebRTC ICE UDP"

Write-Step "Reiniciando processos da camera"
Stop-OldProcesses

$envValues["BACKEND_API_URL"] = $BackendApiUrl
$envValues["OPERATOR_TOKEN"] = $OperatorToken
$envValues["CAMERA_ID"] = $CameraId
$envValues["CAMERA_NAME"] = $CameraName
$envValues["CAMERA_SOURCE_RTSP_URL"] = $CameraSourceRtspUrl
$envValues["CAMERA_SOURCE_RTSP_TRANSPORT"] = $CameraSourceTransport
$envValues["LOCAL_RTSP_URL"] = "rtsp://127.0.0.1:$rtspPort/$liveRtspPath"
$envValues["RTSP_TRANSPORT"] = "tcp"
$envValues["PUBLIC_WEBRTC_HOST"] = $PublicWebrtcHost
$envValues["LOCAL_IP"] = $LocalIp
$envValues["OPERATOR_URL"] = $FrontendStreamingUrl
Save-DotEnv $captureEnv $envValues

Write-Host "Iniciando MediaMTX..."
$mediaMtxProcess = Start-Process -FilePath $mediaMtxExe -ArgumentList "`"$mediaMtxConfig`"" -WorkingDirectory $mediaMtxDir -RedirectStandardOutput $mediaMtxOutLog -RedirectStandardError $mediaMtxErrLog -WindowStyle Hidden -PassThru
$mediaMtxProcess.Id | Set-Content -Encoding ascii $mediaMtxPid
Wait-Port $rtspPort "MediaMTX RTSP" | Out-Null
Wait-Port $webrtcHttpPort "MediaMTX WebRTC/WHEP" | Out-Null

Write-Host "Publicando live H264 para WebRTC..."
$transcodeArgs = @(
    "-hide_banner",
    "-loglevel", "info",
    "-rtsp_transport", $CameraSourceTransport,
    "-fflags", "+genpts+discardcorrupt",
    "-err_detect", "ignore_err",
    "-use_wallclock_as_timestamps", "1",
    "-i", $CameraSourceRtspUrl,
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
    "rtsp://127.0.0.1:$rtspPort/$liveRtspPath"
)
$transcodeProcess = Start-Process -FilePath "ffmpeg" -ArgumentList $transcodeArgs -WorkingDirectory $mediaMtxDir -RedirectStandardOutput $transcodeOutLog -RedirectStandardError $transcodeErrLog -WindowStyle Hidden -PassThru
$transcodeProcess.Id | Set-Content -Encoding ascii $transcodePid
Start-Sleep -Seconds 8

if ($transcodeProcess.HasExited) {
    Write-Warn "FFmpeg da live encerrou. Ultimas linhas:"
    Write-SafeLogTail $transcodeErrLog 20
    throw "Nao foi possivel publicar a live H264. Verifique a URL RTSP da camera."
}
Write-Ok "Live H264 publicada em rtsp://127.0.0.1:$rtspPort/$liveRtspPath"

Write-Step "Registrando camera no backend"
try {
    Register-BackendCamera $BackendApiUrl $OperatorToken $CameraId $CameraName "rtsp://127.0.0.1:$rtspPort/$liveRtspPath" $whepPublicUrl
    Write-Ok "Camera '$CameraId' cadastrada/atualizada no backend."
} catch {
    Write-Warn "Backend nao respondeu ou recusou o cadastro agora: $($_.Exception.Message)"
}

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

Write-Host "Iniciando capture-server..."
$captureProcess = Start-Process -FilePath $capturePython -ArgumentList "`"$captureScript`"" -WorkingDirectory $captureDir -RedirectStandardOutput $captureOutLog -RedirectStandardError $captureErrLog -WindowStyle Hidden -PassThru
$captureProcess.Id | Set-Content -Encoding ascii $capturePid
Start-Sleep -Seconds 8

if ($captureProcess.HasExited) {
    Write-Warn "capture-server encerrou. Ultimas linhas:"
    Write-SafeLogTail $captureErrLog 25
    throw "Nao foi possivel manter o capture-server rodando."
}
Write-Ok "Capture-server rodando para camera '$CameraId'."

try {
    Register-BackendCamera $BackendApiUrl $OperatorToken $CameraId $CameraName "rtsp://127.0.0.1:$rtspPort/$liveRtspPath" $whepPublicUrl
    Write-Ok "Cadastro final da camera confirmado no backend."
} catch {
    Write-Warn "Nao consegui confirmar o cadastro final no backend: $($_.Exception.Message)"
}

Write-Step "Validacao final"
try {
    $localPage = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$webrtcHttpPort/$liveRtspPath/" -TimeoutSec 10
    Write-Ok "Pagina local do WebRTC respondeu HTTP $($localPage.StatusCode)."
} catch {
    Write-Warn "Nao consegui abrir a pagina local do WebRTC: $($_.Exception.Message)"
}

try {
    $tcp = Test-NetConnection $PublicWebrtcHost -Port $webrtcHttpPort -WarningAction SilentlyContinue
    if ($tcp.TcpTestSucceeded) {
        Write-Ok "Porta publica TCP/$webrtcHttpPort responde em $PublicWebrtcHost."
    } else {
        Write-Warn "Porta publica TCP/$webrtcHttpPort nao respondeu. No roteador/provedor, encaminhe TCP $webrtcHttpPort para ${LocalIp}:$webrtcHttpPort."
    }
} catch {
    Write-Warn "Nao consegui testar a porta publica TCP/$webrtcHttpPort."
}

Write-Host ""
Write-Host "============================================================"
Write-Host "LIVE INICIADA"
Write-Host "Camera:        $CameraId"
Write-Host "Backend:       $BackendApiUrl"
Write-Host "Site:          $FrontendStreamingUrl"
Write-Host "WHEP local:    http://127.0.0.1:$webrtcHttpPort/$liveRtspPath/whep"
Write-Host "WHEP publico:  $whepPublicUrl"
Write-Host "Logs:"
Write-Host "  $mediaMtxOutLog"
Write-Host "  $transcodeErrLog"
Write-Host "  $captureErrLog"
Write-Host "============================================================"
Write-Host ""
Write-Host "Importante: se a live publica nao abrir fora da rede, faltam redirecionamentos no roteador/provedor:"
Write-Host "  TCP $webrtcHttpPort -> ${LocalIp}:$webrtcHttpPort"
Write-Host "  UDP $webrtcIcePort -> ${LocalIp}:$webrtcIcePort"
Write-Host "  TCP $webrtcIcePort -> ${LocalIp}:$webrtcIcePort"

try {
    Stop-Transcript | Out-Null
} catch {
}
