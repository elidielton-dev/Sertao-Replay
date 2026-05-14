# Arquitetura do Sertao Replay

## Objetivo

Entregar um fluxo funcional para cadastrar cameras, manter buffer de video,
gerar replays e exibir os lances na home do cliente.

## Camadas

### Camera RTSP

A camera e cadastrada pelo painel `/admin/` e persistida no banco. A URL RTSP
fica no backend e nao aparece na home do cliente.

### FFmpeg

O backend usa FFmpeg para:

- testar conexao por snapshot;
- manter buffer circular em `backend/storage/buffer`;
- gerar MP4s em `backend/storage/replays`;
- tentar reconectar de forma controlada quando a camera cai.

### Backend FastAPI

Responsavel por:

- CRUD de cameras;
- status de camera e buffer;
- criacao de replay de 15s ou outros tempos permitidos pela API;
- download seguro dos arquivos MP4;
- logs com credenciais redigidas.

### Banco

O padrao e SQLite via `DATABASE_URL=sqlite:///./sports_replay.db`.

Tabelas principais:

- `cameras`;
- `replays`;
- `replay_events`.

Uma camera pode originar varios replays. O registro do replay tambem salva o
nome da camera para preservar historico mesmo se a camera for arquivada.

### Frontend

- `/admin/`: cadastro e operacao de cameras.
- `/teste/`: teste de conexao, buffer e envio de replay de 15s para a home.
- `/`: home do cliente com player e download dos replays prontos.

## Fluxo de replay

```text
1. Operador cadastra camera no /admin/
2. Operador testa a camera no /teste/
3. Operador inicia o buffer
4. FFmpeg grava segmentos no storage/buffer
5. Operador clica Gerar replay 15s
6. ReplayService junta os ultimos segmentos em MP4
7. Backend salva o registro em replays
8. Home carrega /api/replays e exibe o video
```

Se ainda nao houver segmentos, o backend tenta gravar um clipe direto da camera
como fallback.
