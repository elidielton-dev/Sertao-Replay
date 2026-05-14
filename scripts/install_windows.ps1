Set-Location ../backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

if (!(Test-Path ".env")) {
  Copy-Item ..\config\.env.example .env
}

python -c "from app.db.init_db import init_db; init_db()"

Write-Host "Instalacao concluida."
Write-Host "Inicie o backend e cadastre as cameras pelo painel /admin/."
