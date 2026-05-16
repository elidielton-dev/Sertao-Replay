$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$captureDir = Join-Path $root "capture-server"
$captureEnv = Join-Path $captureDir ".env"
$captureScript = Join-Path $captureDir "capture_server.py"
$capturePython = Join-Path $captureDir ".venv\Scripts\python.exe"
$captureRequirements = Join-Path $captureDir "requirements.txt"
$captureLog = Join-Path $captureDir "capture-server.err.log"
$defaultOperatorUrl = "https://sports-replay-mvp.vercel.app/teste"

function Write-Section($text) {
    Write-Host ""
    Write-Host "============================================================"
    Write-Host "  $text"
    Write-Host "============================================================"
    Write-Host ""
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

function Test-CommandAvailable($command) {
    try {
        Get-Command $command -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Get-CaptureProcesses {
    Get-CimInstance Win32_Process -Filter "name='python.exe'" |
        Where-Object { $_.CommandLine -like "*capture_server.py*" }
}

Write-Section "SERTAO REPLAY - INICIAR SISTEMA"

if (-not (Test-Path $captureScript)) {
    throw "Pasta capture-server nao encontrada em: $captureDir"
}

if (-not (Test-Path $captureEnv)) {
    throw "Arquivo capture-server\.env nao encontrado. Configure BACKEND_API_URL, OPERATOR_TOKEN, CAMERA_ID e LOCAL_RTSP_URL."
}

$envValues = Read-DotEnv $captureEnv
$backendApiUrl = ""
if ($envValues.ContainsKey("BACKEND_API_URL")) {
    $backendApiUrl = $envValues["BACKEND_API_URL"].TrimEnd("/")
}
$operatorUrl = $envValues["OPERATOR_URL"]
if ([string]::IsNullOrWhiteSpace($operatorUrl)) {
    $operatorUrl = $defaultOperatorUrl
}

$ffmpegBin = $envValues["FFMPEG_BIN"]
if ([string]::IsNullOrWhiteSpace($ffmpegBin)) {
    $ffmpegBin = "ffmpeg"
}

if (-not (Test-CommandAvailable $ffmpegBin)) {
    throw "FFmpeg nao encontrado. Instale o FFmpeg ou ajuste FFMPEG_BIN no capture-server\.env."
}

if (-not (Test-Path $capturePython)) {
    Write-Host "[INFO] Ambiente Python nao encontrado. Criando .venv..."
    Push-Location $captureDir
    try {
        python -m venv ".venv"
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path $capturePython)) {
    throw "Nao foi possivel criar o ambiente Python em capture-server\.venv."
}

Write-Host "[INFO] Instalando/atualizando dependencias do capture-server..."
& $capturePython -m pip install -r $captureRequirements
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao instalar dependencias Python."
}

if (-not [string]::IsNullOrWhiteSpace($backendApiUrl)) {
    Write-Host "[INFO] Validando backend configurado..."
    try {
        Invoke-RestMethod -Uri "$backendApiUrl/health" -TimeoutSec 20 | Out-Null
        Write-Host "[OK] Backend online: $backendApiUrl"
    } catch {
        Write-Host "[AVISO] Backend nao respondeu agora: $($_.Exception.Message)"
    }
} else {
    Write-Host "[AVISO] BACKEND_API_URL nao encontrado no capture-server\.env."
}

$runningCapture = Get-CaptureProcesses
if ($runningCapture) {
    Write-Host "[OK] capture-server ja esta rodando."
} else {
    Write-Host "[INFO] Iniciando capture-server em nova janela..."
    $cmd = "cd /d `"$captureDir`" && `".venv\Scripts\python.exe`" capture_server.py"
    Start-Process -FilePath "cmd.exe" -ArgumentList "/k", $cmd -WorkingDirectory $captureDir

    Write-Host "[INFO] Aguardando o buffer da camera iniciar..."
    Start-Sleep -Seconds 8
}

if (Test-Path $captureLog) {
    Write-Host ""
    Write-Host "Ultimas linhas do log:"
    Get-Content $captureLog -Tail 12
}

Write-Host ""
Write-Host "[INFO] Abrindo tela do operador:"
Write-Host $operatorUrl
Start-Process $operatorUrl

Write-Host ""
Write-Host "Sistema iniciado."
Write-Host "Deixe a janela 'Sertao Replay - capture-server' aberta enquanto usar o replay."
Write-Host ""
