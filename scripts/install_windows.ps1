Set-Location ../backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

if (!(Test-Path ".env")) {
  Copy-Item ..\config\.env.example .env
}

Write-Host "Instalação concluída."
Write-Host "Edite config/cameras.json com o RTSP da câmera."
