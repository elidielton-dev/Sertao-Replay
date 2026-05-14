# Arquitetura do Sertao Replay

```text
Camera RTSP -> servidor local da arena -> capture-server -> backend Render -> frontend Vercel
```

## Camera RTSP

A camera fica na rede local da arena. A URL RTSP, usuario e senha existem apenas no `.env` do `capture-server`.

## Capture-server local

Processo Python que roda no servidor da arena:

- abre o RTSP com FFmpeg;
- mantem buffer circular em segmentos locais;
- consulta a fila de replay no backend;
- gera o MP4 dos ultimos segundos;
- envia upload para o backend;
- atualiza status da camera e envia logs;
- reinicia FFmpeg quando a captura cai.

## Backend Render

API FastAPI sem acesso a RTSP:

- cameras;
- replays;
- uploads de MP4;
- solicitacoes de replay;
- logs;
- PostgreSQL em producao.

O backend nao tenta acessar IPs locais como `192.168.x.x`.

## Frontend Vercel

Aplicacao Vite/React:

- `/`: Home do cliente para assistir e baixar replays;
- `/teste`: tela do operador para criar solicitacao `Replay 15s`.

O frontend consome `VITE_API_BASE_URL` e nao fala com camera.

## Fluxo

1. Capture-server registra/atualiza a camera no backend.
2. Operador clica em `Replay 15s` no frontend.
3. Backend salva a solicitacao como `pending`.
4. Capture-server pega a solicitacao e muda para `processing`.
5. Capture-server gera o MP4 e faz upload.
6. Backend marca a solicitacao como `completed`.
7. Home busca `/api/replays` periodicamente e exibe o novo video.
