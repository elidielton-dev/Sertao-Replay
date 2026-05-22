param()

$ErrorActionPreference = "Continue"
$appDir = Join-Path $env:USERPROFILE "SertaoReplayFakeCamera"
$pidPath = Join-Path $appDir "camera-fake-pids.json"

if (Test-Path -LiteralPath $pidPath) {
  try {
    $state = Get-Content -LiteralPath $pidPath -Raw | ConvertFrom-Json
    foreach ($id in @($state.ffmpeg, $state.mediamtx)) {
      if ([int]$id -gt 0) {
        Stop-Process -Id ([int]$id) -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {
    Write-Warning $_.Exception.Message
  }
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

Write-Host "Camera fake parada."
