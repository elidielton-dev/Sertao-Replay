param(
  [switch]$Quiet
)

$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot
$demoDir = Join-Path $root "tools\demo-camera"
$pidPath = Join-Path $demoDir "pids.json"

function Stop-DemoProcess([int]$ProcessId, [string]$Name) {
  if ($ProcessId -le 0) {
    return
  }

  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (!$process) {
    return
  }

  if (!$Quiet) {
    Write-Host "Parando $Name PID $ProcessId..."
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

if (Test-Path -LiteralPath $pidPath) {
  try {
    $state = Get-Content -LiteralPath $pidPath -Raw | ConvertFrom-Json
    Stop-DemoProcess -ProcessId ([int]$state.capture) -Name "capture-server"
    Stop-DemoProcess -ProcessId ([int]$state.ffmpeg) -Name "ffmpeg"
    Stop-DemoProcess -ProcessId ([int]$state.mediamtx) -Name "MediaMTX"
  } catch {
    if (!$Quiet) {
      Write-Warning $_.Exception.Message
    }
  }
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -like "*tools\\demo-camera*" -or
    $_.CommandLine -like "*ronaldinho-demo*"
  } |
  ForEach-Object {
    if (!$Quiet) {
      Write-Host "Parando processo residual PID $($_.ProcessId)..."
    }
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

if (!$Quiet) {
  Write-Host "Demo de camera simulada parada."
}
