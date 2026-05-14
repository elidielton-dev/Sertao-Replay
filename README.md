# Sertão Replay

Primeira versão do sistema de replay esportivo.

## Arquitetura da versão 1

```text
Câmera IP / RTSP
        ↓
GStreamer
        ↓
Preview / teste de baixa latência
        ↓
FFmpeg
        ↓
Buffer contínuo em segmentos
        ↓
FastAPI
        ↓
Interface Web
        ↓
SQLite
        ↓
Arduino Leonardo / botões físicos
```

## O que já vem pronto

- Backend FastAPI
- Interface web simples
- Cadastro de câmera via arquivo JSON
- Serviço de gravação contínua com FFmpeg
- Geração de replay dos últimos segundos
- Registro de eventos no SQLite
- Estrutura para GStreamer
- Firmware base para Arduino Leonardo
- Scripts de instalação e execução

## Requisitos

Instale no computador:

- Python 3.11+
- FFmpeg
- GStreamer
- VLC, opcional para teste manual
- Arduino IDE, para gravar o Leonardo

## Instalação rápida

Entre na pasta do backend:

```bash
cd backend
python -m venv .venv
```

No Windows:

```bash
.venv\Scripts\activate
pip install -r requirements.txt
```

No Linux:

```bash
source .venv/bin/activate
pip install -r requirements.txt
```

Copie o arquivo de ambiente:

```bash
copy ..\config\.env.example .env
```

No Linux:

```bash
cp ../config/.env.example .env
```

Crie o arquivo:

```text
config/cameras.json
```

Exemplo:

```json
[
  {
    "id": "cam1",
    "name": "Câmera Campo 1",
    "rtsp_url": "rtsp://usuario:senha@192.168.0.100:554/stream1",
    "enabled": true
  }
]
```

## Camera via MediaMTX na VPS

Neste setup, o MediaMTX roda na VPS e recebe o stream publicado pelo seu Windows.

- URL para o backend gravar/replay: `rtsp://54.207.185.74:8554/camera1`
- URL para assistir no navegador via HLS/WebRTC: `http://54.207.185.74:8888/camera1/`

No PowerShell do Windows, publique a camera local para a VPS:

```powershell
.\scripts\push_camera_to_mediamtx.ps1 -LocalCameraUrl "rtsp://usuario:senha@IP_DA_CAMERA:554/stream1"
```

Comando FFmpeg equivalente:

```powershell
ffmpeg -rtsp_transport tcp -i "rtsp://usuario:senha@IP_DA_CAMERA:554/stream1" -an -c:v copy -f rtsp -rtsp_transport tcp "rtsp://54.207.185.74:8554/camera1"
```

## Rodar o backend

```bash
cd backend
uvicorn app.main:app --reload
```

Acesse:

```text
http://127.0.0.1:8000
```

## Fluxo de teste

1. Teste a câmera no VLC.
2. Coloque o link RTSP em `config/cameras.json`.
3. Abra o backend.
4. Clique em `Iniciar gravação`.
5. Aguarde alguns segundos.
6. Clique em `Replay 15s`.
7. Veja o arquivo gerado em `backend/storage/replays`.

## Observação importante

Essa versão é a base inicial. Ela não é o produto final ainda. O objetivo é validar:

- câmera RTSP funcionando;
- buffer contínuo;
- comando de replay;
- interface web;
- controle físico pelo Leonardo.
