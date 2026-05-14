# Sertao Replay

MVP de replay esportivo separado para deploy real: frontend na Vercel, backend no Render e captura de video no servidor local da arena.

```text
Camera RTSP
   ->
Servidor local da arena
   ->
capture-server
   ->
Backend no Render
   ->
Frontend na Vercel
```

## Responsabilidades

### `frontend/` - Vercel

- Home do cliente em `/`, com lista de replays, player de video e download.
- Tela do operador em `/teste`, com botao `Replay 15s`.
- Consome somente a API publica do backend.
- Nao acessa RTSP e nao conhece usuario/senha da camera.

Variavel obrigatoria na Vercel:

```env
VITE_API_BASE_URL=https://URL-DO-BACKEND.onrender.com/api
```

### `backend/` - Render

- API FastAPI.
- Cadastro de cameras sem URL RTSP.
- Fila de solicitacoes de replay.
- Recebimento de uploads MP4 do capture-server.
- Registro de replays, eventos e logs.
- PostgreSQL em producao.

Endpoints principais:

```text
GET    /api/health
GET    /api/cameras
POST   /api/cameras
GET    /api/replays
POST   /api/replays
POST   /api/replays/upload
GET    /api/logs
POST   /api/logs
POST   /api/replay-requests
GET    /api/replay-requests/pending
```

O backend no Render nao conecta em cameras locais `192.168.x.x`, nao mantem buffer FFmpeg e nao recebe senha RTSP.

Variaveis recomendadas no Render:

```env
APP_ENV=production
DATABASE_URL=postgresql://...
CORS_ORIGINS=https://URL-DO-FRONTEND.vercel.app
OPERATOR_TOKEN=token_seguro
REPLAY_ROOT=./storage/replays
LOG_ROOT=./storage/logs
```

### `capture-server/` - servidor local da arena

- Roda na maquina que enxerga a camera RTSP.
- Mantem buffer circular local com FFmpeg.
- Consulta solicitacoes pendentes no backend.
- Gera MP4 dos ultimos 15 segundos.
- Envia o MP4 para `/api/replays/upload`.
- Atualiza status da camera e envia logs.
- Reconecta automaticamente se o FFmpeg cair.

Exemplo:

```env
BACKEND_API_URL=https://URL-DO-BACKEND.onrender.com/api
OPERATOR_TOKEN=token_seguro
CAMERA_ID=campo-01
LOCAL_RTSP_URL=rtsp://usuario:senha@192.168.0.6:554/onvif1
DEFAULT_REPLAY_SECONDS=15
```

## Fluxo de replay

1. A camera fica conectada ao servidor local da arena.
2. O `capture-server` acessa a camera via RTSP e mantem o buffer.
3. O operador abre `/teste` na Vercel e clica em `Replay 15s`.
4. O frontend chama o backend no Render.
5. O backend cria uma solicitacao de replay.
6. O `capture-server` consulta `/api/replay-requests/pending`.
7. O `capture-server` corta os ultimos 15 segundos e envia o MP4.
8. O backend salva o replay no banco.
9. A Home atualiza automaticamente e mostra o video para assistir e baixar.

## Rodar localmente

Backend:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy ..\config\.env.example .env
uvicorn app.main:app --reload
```

Frontend:

```powershell
cd frontend
npm install
copy .env.example .env
npm run dev
```

Capture-server:

```powershell
cd capture-server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python capture_server.py
```

## Deploy

- Vercel: use o projeto `frontend/` ou o `vercel.json` da raiz. Configure `VITE_API_BASE_URL`.
- Render: use o `render.yaml` da raiz ou crie um Web Service com root `backend`, build `pip install -r requirements.txt` e start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
- Banco: use PostgreSQL no Render e configure `DATABASE_URL`.
- Arena: instale FFmpeg no servidor local e rode `capture-server/capture_server.py` como servico.

## Seguranca do MVP

- RTSP e senha da camera ficam somente no `.env` do `capture-server`.
- O frontend nunca recebe URL RTSP.
- Logs redigem credenciais RTSP, tokens e segredos de query string.
- Rotas de operador exigem `OPERATOR_TOKEN` quando `APP_ENV=production`.
