#!/usr/bin/env bash
set -e

cd ../backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

if [ ! -f ".env" ]; then
  cp ../config/.env.example .env
fi

echo "Instalação concluída."
echo "Edite config/cameras.json com o RTSP da câmera."
