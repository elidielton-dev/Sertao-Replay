# Arquitetura do Sertão Replay

## Objetivo

Criar uma primeira versão funcional do sistema de replay esportivo.

O foco da versão 1 é provar:

- captura de câmera IP;
- gravação contínua;
- geração de replay;
- comando por botão;
- interface simples para operador.

## Camadas

### 1. Câmera

Entrada principal:

```text
Câmera IP via RTSP
```

Exemplo:

```text
rtsp://usuario:senha@192.168.0.100:554/stream1
```

### 2. GStreamer

Usado para:

- testar pipeline da câmera;
- preview de baixa latência;
- evolução futura para multi-câmera e processamento mais fino.

Na v1, a integração é por comando externo `gst-launch-1.0`.

### 3. FFmpeg

Usado para:

- receber stream RTSP;
- gravar em segmentos;
- manter buffer circular;
- gerar replay final em MP4.

### 4. Backend FastAPI

Responsável por:

- iniciar/parar gravação;
- receber comando de replay;
- listar câmeras;
- listar arquivos de replay;
- salvar eventos no banco.

### 5. Banco SQLite

Responsável por salvar:

- horário do replay;
- câmera;
- duração;
- status;
- caminho do arquivo gerado.

No futuro pode ser trocado por PostgreSQL.

### 6. Interface Web

Painel do operador com:

- status da API;
- câmeras;
- gravação;
- botões de replay;
- lista de vídeos gerados.

### 7. Arduino Leonardo

Controlador físico que funciona como teclado USB.

Botões:

- replay 10s;
- replay 15s;
- replay 30s;
- salvar lance;
- trocar câmera.

## Fluxo de replay

```text
1. FFmpeg grava a câmera em segmentos .ts
2. Operador clica Replay 15s
3. FastAPI recebe o comando
4. ReplayService pega os segmentos mais recentes
5. FFmpeg concatena os segmentos
6. Sistema gera arquivo MP4
7. Interface mostra o replay gerado
```

## Evoluções futuras

- WebSocket para status em tempo real;
- suporte multi-câmera;
- preview dentro da interface;
- hotkeys do Arduino lidas diretamente pelo Python;
- PostgreSQL;
- NDI;
- slow motion;
- replay com overlay;
- exportação automática de melhores momentos.
