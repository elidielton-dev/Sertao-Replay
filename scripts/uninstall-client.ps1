param(
  [string]$InstallDir = $env:SERTAO_REPLAY_HOME,
  [string]$TaskName = $env:SERTAO_REPLAY_TASK_NAME,
  [string]$StartupName = $env:SERTAO_REPLAY_STARTUP_NAME
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  $InstallDir = "C:\SertaoReplay"
}

if ([string]::IsNullOrWhiteSpace($TaskName)) {
  $TaskName = "Sertao Replay Capture"
}

if ([string]::IsNullOrWhiteSpace($StartupName)) {
  $StartupName = "SertaoReplayCapture"
}

$resolvedInstallDir = $null
if (Test-Path -LiteralPath $InstallDir) {
  $resolvedInstallDir = (Resolve-Path -LiteralPath $InstallDir).Path
}

Write-Host "[INFO] Parando processos do Sertao Replay..."
Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -like "*SertaoReplay*--capture*" -or
    $_.CommandLine -like "*installer*app*main.py*--capture*" -or
    ($resolvedInstallDir -and $_.CommandLine -like "*$resolvedInstallDir*")
  } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Write-Host "[INFO] Removendo tarefa agendada..."
try {
  & schtasks /Delete /TN $TaskName /F *> $null
} catch {
  # A tarefa pode nao existir quando o instalador usou o fallback do Startup.
}

$startupLauncher = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\$StartupName.bat"
if (Test-Path -LiteralPath $startupLauncher) {
  Write-Host "[INFO] Removendo inicializador do Startup..."
  Remove-Item -LiteralPath $startupLauncher -Force
}

if ($resolvedInstallDir) {
  $allowedRoots = @(
    (Join-Path $env:SystemDrive "SertaoReplay"),
    (Join-Path $env:SystemDrive "SertaoReplay-E2E")
  )
  $allowed = $false
  foreach ($root in $allowedRoots) {
    if ($resolvedInstallDir.Equals($root, [System.StringComparison]::OrdinalIgnoreCase) -or
        $resolvedInstallDir.StartsWith($root + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
      $allowed = $true
      break
    }
  }

  if (-not $allowed) {
    throw "Diretorio fora da area esperada para uninstall: $resolvedInstallDir"
  }

  Write-Host "[INFO] Removendo pasta $resolvedInstallDir..."
  Remove-Item -LiteralPath $resolvedInstallDir -Recurse -Force
}

Write-Host "[OK] Sertao Replay desinstalado."
