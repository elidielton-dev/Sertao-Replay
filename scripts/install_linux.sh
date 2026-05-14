#!/usr/bin/env bash
set -e

cd ../backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

if [ ! -f ".env" ]; then
  cp ../config/.env.example .env
fi

python -c "from app.db.init_db import init_db; init_db()"

echo "Instalacao concluida."
echo "Inicie o backend e cadastre as cameras pelo painel /admin/."
