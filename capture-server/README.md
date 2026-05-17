# Capture Server

Rode este processo no servidor local da arena, na mesma rede da camera RTSP.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python capture_server.py
```

O `.env` local guarda a URL RTSP e nunca deve ir para Git:

```env
BACKEND_API_URL=https://URL-DO-BACKEND.onrender.com/api
OPERATOR_TOKEN=token_seguro
CAMERA_ID=campo-01
LOCAL_RTSP_URL=rtsp://usuario:senha@192.168.0.6:554/onvif1
DEFAULT_REPLAY_SECONDS=15
FAST_REPLAY_COPY=true
SEGMENT_TIME_SECONDS=1
POLL_INTERVAL_SECONDS=1
```

O backend recebe apenas status, logs e uploads MP4. Ele nao recebe a URL RTSP.
