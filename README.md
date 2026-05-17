# Sertao Replay

Sistema MVP de replay esportivo com frontend na Vercel, backend no Render e captura de video no servidor local da arena.

```text
Camera RTSP -> Servidor local -> capture-server -> Backend Render -> Frontend Vercel
```

O ponto mais importante: o operador nao grava o video diretamente. Ele cria uma solicitacao no frontend. Quem corta os ultimos segundos e envia o MP4 e o `capture-server` rodando no computador local da arena.

## Links principais

```text
Home publica:      https://sports-replay-mvp.vercel.app/
Tela do operador: https://sports-replay-mvp.vercel.app/teste
Painel admin:     https://sports-replay-mvp.vercel.app/admin
Backend API:      https://sertao-replay.onrender.com/api
Health check:     https://sertao-replay.onrender.com/api/health
```

## Manual completo

O passo a passo de integracao esta em:

- [Manual em PDF](docs/manual-integracao-sertao-replay.pdf)
- [Manual editavel em Markdown](docs/manual-integracao-sertao-replay.md)

O manual cobre cadastro de camera, configuracao do servidor local, inicializacao, teste de replay, logs e solucao de problemas.

## Estrutura do projeto

```text
frontend/        Aplicacao Vite/React publicada na Vercel
backend/         API FastAPI publicada no Render
capture-server/ Processo local que acessa RTSP, mantem buffer e envia MP4
docs/            Documentacao, arquitetura, hardware e manual
scripts/         Scripts auxiliares de instalacao, inicializacao e testes
storage/         Pastas locais de logs/replays quando usado em desenvolvimento
```

## Como iniciar na arena

No computador Windows que fica na mesma rede da camera:

1. Configure `capture-server\.env`.
2. Clique duas vezes em `iniciar-sistema.bat`.
3. Aguarde a validacao do backend e do FFmpeg.
4. Deixe aberta a janela `Sertao Replay - capture-server`.
5. Use a tela do operador em `/teste`.

O arquivo `iniciar-sistema.bat` chama `scripts/start_system.ps1`, que:

- verifica FFmpeg;
- cria `.venv`, se faltar;
- instala dependencias Python;
- testa o backend;
- evita duplicar o `capture-server`;
- inicia o `capture-server`;
- abre a tela do operador.

## Configuracao do capture-server

Crie ou edite `capture-server\.env`:

```env
BACKEND_API_URL=https://sertao-replay.onrender.com/api
OPERATOR_TOKEN=cole_o_token_aqui
CAMERA_ID=campo-01
LOCAL_RTSP_URL=rtsp://usuario:senha@192.168.0.6:554/onvif1
OPERATOR_URL=https://sports-replay-mvp.vercel.app/teste
RTSP_TRANSPORT=tcp
BUFFER_VIDEO_CODEC=libx264
BUFFER_FPS=30
DEFAULT_REPLAY_SECONDS=15
REPLAY_VIDEO_CODEC=libx264
SEGMENT_TIME_SECONDS=2
SEGMENT_WRAP_COUNT=120
POLL_INTERVAL_SECONDS=3
```

`CAMERA_ID` precisa bater com o ID cadastrado no admin. A URL RTSP e o token ficam somente no servidor local.

## Como adicionar camera

1. Abra `https://sports-replay-mvp.vercel.app/admin`.
2. Informe o token de operador e clique em `Salvar token`.
3. Preencha o formulario da camera:
   - `ID`: exemplo `campo-01`;
   - `Nome`: exemplo `Campo 01`;
   - `URL RTSP`: URL RTSP da camera, se quiser guardar no backend;
   - `Camera ativa`: marcado.
4. Clique em `Salvar`.
5. Inicie ou reinicie o `capture-server`.

Tambem e possivel manter a URL RTSP apenas no `capture-server\.env` usando `LOCAL_RTSP_URL`.

## Fluxo de replay

1. O `capture-server` abre a camera RTSP com FFmpeg.
2. Ele mantem um buffer circular local em `capture-server\storage\buffer`.
3. O operador clica em `Replay 15s` na tela `/teste` ou aperta o botao fisico do Arduino.
4. O frontend cria uma solicitacao no backend sem pedir token.
5. O `capture-server` consulta `/api/replay-requests/pending`.
6. Ele corta o MP4 localmente.
7. Ele envia o arquivo para `/api/replays/upload`.
8. O backend registra o replay.
9. A Home publica mostra o video para assistir e baixar.

## Responsabilidades

### Frontend - Vercel

- Home publica em `/`.
- Tela do operador em `/teste`.
- Painel admin em `/admin`.
- Consome apenas a API publica do backend.
- Nao acessa RTSP e nao conhece usuario/senha da camera.

Variavel obrigatoria:

```env
VITE_API_BASE_URL=https://sertao-replay.onrender.com/api
```

### Backend - Render

- API FastAPI.
- Cadastro de cameras.
- Fila de solicitacoes de replay.
- Recebimento de uploads MP4.
- Registro de replays, eventos e logs.
- PostgreSQL em producao.

Variaveis recomendadas:

```env
APP_ENV=production
DATABASE_URL=postgresql://...
CORS_ORIGINS=https://sports-replay-mvp.vercel.app
OPERATOR_TOKEN=token_seguro
REPLAY_ROOT=./storage/replays
LOG_ROOT=./storage/logs
```

### Capture-server - arena

- Roda no computador que enxerga a camera RTSP.
- Mantem buffer circular com FFmpeg.
- Gera MP4 dos ultimos segundos.
- Envia replay para o backend.
- Atualiza status da camera.
- Envia logs.
- Reconecta FFmpeg quando a captura cai.

## Rodar em desenvolvimento

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

## Endpoints principais

```text
GET  /api/health
GET  /api/cameras
GET  /api/cameras/admin
POST /api/cameras
GET  /api/cameras/{camera_id}/config
POST /api/cameras/{camera_id}/status
GET  /api/replays
GET  /api/replays/file/{filename}
POST /api/replay-requests
GET  /api/replay-requests/pending
POST /api/replay-requests/{request_id}/fail
POST /api/replays/upload
GET  /api/logs
POST /api/logs
```

## Logs e pastas uteis

```text
capture-server\capture-server.err.log
capture-server\storage\logs\ffmpeg_campo-01.log
capture-server\storage\buffer\campo-01\
capture-server\storage\replays\
```

Se o replay nao aparece, comece olhando o status da camera no admin e os arquivos acima.

## Solucao rapida de problemas

Cliquei em replay e nao salvou:

1. Confirme que o `capture-server` esta aberto.
2. Confirme que a camera esta `recording`.
3. Verifique se existem segmentos `.ts` com tamanho maior que zero em `capture-server\storage\buffer`.
4. Veja `capture-server\capture-server.err.log`.
5. Veja `capture-server\storage\logs\ffmpeg_campo-01.log`.

Camera fica `connecting`:

1. Verifique a URL RTSP.
2. Verifique usuario e senha da camera.
3. Confirme que o servidor local esta na mesma rede da camera.
4. Teste `RTSP_TRANSPORT=tcp`.

Link de monitoramento `apsess_...` caiu:

- Esse tipo de link costuma ser temporario.
- Se retornar `404 NOT FOUND`, gere um novo link no painel de monitoramento.
- Isso nao significa necessariamente que o sistema de replay caiu.

## Deploy

- Vercel: publique `frontend/` ou use o `vercel.json` da raiz. Configure `VITE_API_BASE_URL`.
- Render: use `render.yaml` ou crie um Web Service com root `backend`.
- Banco: use PostgreSQL no Render e configure `DATABASE_URL`.
- Arena: instale FFmpeg e rode `iniciar-sistema.bat` no servidor local.

## Seguranca

- Nao publique URL RTSP.
- Nao compartilhe `OPERATOR_TOKEN`.
- Nao envie `capture-server\.env`.
- Use senha forte na camera.
- Mantenha o servidor local protegido.
- Baixe replays importantes depois do evento.
