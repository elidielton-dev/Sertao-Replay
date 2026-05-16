# Manual de Integracao do Sertao Replay

Versao: 1.0  
Projeto: sports-replay-mvp  
Publico: instalador, operador e administrador do sistema

## Objetivo

Este manual mostra, passo a passo, como integrar o sistema Sertao Replay em uma arena: preparar camera, cadastrar camera, conectar servidor local, iniciar o capture-server, testar replay, acompanhar logs e resolver problemas comuns.

## Visao geral do sistema

O sistema tem quatro partes principais:

1. Camera IP com RTSP: envia o video pela rede local da arena.
2. Servidor local da arena: computador Windows que enxerga a camera e roda o capture-server.
3. Backend no Render: recebe solicitacoes, logs e uploads MP4.
4. Frontend na Vercel: telas para operador e publico.

Fluxo resumido:

```text
Camera RTSP -> Servidor local -> capture-server -> Backend Render -> Frontend Vercel
```

O backend e o frontend nao acessam a camera diretamente. A senha RTSP deve ficar somente no arquivo `.env` do `capture-server`.

## URLs padrao

Use estas URLs como referencia, ajustando se o deploy mudar:

```text
Home publica:      https://sports-replay-mvp.vercel.app/
Tela do operador: https://sports-replay-mvp.vercel.app/teste
Painel admin:     https://sports-replay-mvp.vercel.app/admin
Backend API:      https://sertao-replay.onrender.com/api
Health check:     https://sertao-replay.onrender.com/api/health
```

## Pre-requisitos

Antes de instalar, confirme:

- Camera IP ligada e acessivel na mesma rede do servidor local.
- URL RTSP da camera, por exemplo `rtsp://usuario:senha@192.168.0.6:554/onvif1`.
- Computador Windows que ficara ligado durante a partida.
- Python instalado.
- FFmpeg instalado e acessivel pelo PATH.
- Token de operador configurado no backend Render.
- Projeto `sports-replay-mvp` copiado para o servidor local.
- Internet no servidor local para falar com Render/Vercel.

## Papéis de cada tela

Home publica (`/`): lista replays prontos, permite assistir e baixar.

Tela do operador (`/teste`): botao `Replay 15s`, escolha da camera e campo de titulo opcional.

Painel admin (`/admin`): cadastro de cameras, status da camera e logs do sistema. Exige token de operador em producao.

## Como adicionar uma camera pelo painel admin

1. Abra `https://sports-replay-mvp.vercel.app/admin`.
2. No campo `Token de operador`, cole o token configurado no Render.
3. Clique em `Salvar token`.
4. No formulario `Camera`, preencha:
   - `ID`: identificador simples, por exemplo `campo-01`.
   - `Nome`: nome amigavel, por exemplo `Campo 01`.
   - `URL RTSP`: link RTSP da camera.
   - `Notas`: posicao, rede, usuario responsavel ou observacoes.
   - `Camera ativa`: marcado.
5. Clique em `Salvar`.
6. Confira se a camera aparece em `Cameras cadastradas`.

Observacao: se voce preferir nao salvar a URL RTSP no backend, deixe a URL apenas no `capture-server\.env`. Nesse modo, o capture-server registra a camera e usa a variavel local `LOCAL_RTSP_URL`.

## Como configurar o servidor local da arena

No computador Windows que enxerga a camera:

1. Copie a pasta do projeto para um local fixo, por exemplo:

```text
C:\SertaoReplay\sports-replay-mvp
```

2. Entre na pasta `capture-server`.
3. Crie ou edite o arquivo `.env`.
4. Use este modelo:

```env
BACKEND_API_URL=https://sertao-replay.onrender.com/api
OPERATOR_TOKEN=cole_o_token_aqui
CAMERA_ID=campo-01
LOCAL_RTSP_URL=rtsp://usuario:senha@192.168.0.6:554/onvif1
OPERATOR_URL=https://sports-replay-mvp.vercel.app/teste
RTSP_TRANSPORT=tcp
DEFAULT_REPLAY_SECONDS=15
REPLAY_VIDEO_CODEC=libx264
SEGMENT_TIME_SECONDS=2
SEGMENT_WRAP_COUNT=120
POLL_INTERVAL_SECONDS=3
```

5. Troque `CAMERA_ID` para o mesmo ID cadastrado no admin.
6. Troque `LOCAL_RTSP_URL` pela URL real da camera.
7. Troque `OPERATOR_TOKEN` pelo token real.
8. Salve o arquivo.

Nunca envie o `.env` para terceiros. Ele contem senha da camera e token do operador.

## Como iniciar tudo com um clique

Na raiz do projeto existe o arquivo:

```text
iniciar-sistema.bat
```

Depois de ligar o computador:

1. Abra a pasta do projeto.
2. Clique duas vezes em `iniciar-sistema.bat`.
3. Aguarde a validacao.
4. O script vai:
   - verificar FFmpeg;
   - criar `.venv`, se faltar;
   - instalar dependencias do capture-server;
   - testar o backend;
   - iniciar o capture-server;
   - abrir a tela do operador.
5. Deixe a janela `Sertao Replay - capture-server` aberta.

Se aparecer erro de FFmpeg, instale o FFmpeg ou configure `FFMPEG_BIN` no `.env`.

## Como conectar o capture-server ao backend

O capture-server conecta no backend usando:

```env
BACKEND_API_URL=https://sertao-replay.onrender.com/api
OPERATOR_TOKEN=token_seguro
CAMERA_ID=campo-01
```

Ao iniciar, ele:

1. Registra ou atualiza a camera no backend.
2. Inicia FFmpeg para manter o buffer local.
3. Envia status da camera.
4. Consulta `/replay-requests/pending`.
5. Quando houver pedido de replay, corta o MP4.
6. Faz upload para `/replays/upload`.
7. Envia logs para `/logs`.

## Como testar se esta funcionando

1. Abra `https://sertao-replay.onrender.com/api/health`.
2. Deve aparecer algo parecido com:

```json
{"ok": true, "message": "Sertao Replay API online"}
```

3. Abra `https://sports-replay-mvp.vercel.app/teste`.
4. Confirme se a camera aparece como `recording`.
5. Digite um titulo opcional, por exemplo `teste instalacao`.
6. Clique em `Replay 15s`.
7. Aguarde alguns segundos.
8. Abra a Home `https://sports-replay-mvp.vercel.app/`.
9. O video deve aparecer na lista.

## Como usar no dia do jogo

Antes do jogo:

1. Ligue camera, roteador/switch e servidor local.
2. Clique em `iniciar-sistema.bat`.
3. Espere o status da camera ficar `recording`.
4. Abra a tela `/teste`.
5. Faca um replay de teste.
6. Confirme se aparece na Home.

Durante o jogo:

1. Mantenha a janela do capture-server aberta.
2. Quando acontecer um lance, clique em `Replay 15s`.
3. Se quiser, preencha um titulo antes de clicar.
4. Aguarde o video aparecer na Home.

Depois do jogo:

1. Baixe os replays desejados pela Home.
2. Feche a janela do capture-server.
3. Desligue o servidor local se necessario.

## Como monitorar status e logs

Pelo painel admin:

1. Abra `/admin`.
2. Informe o token de operador.
3. Clique em `Status`.
4. Veja `Cameras cadastradas` e `Logs`.

No servidor local:

```text
capture-server\capture-server.err.log
capture-server\storage\logs\ffmpeg_campo-01.log
capture-server\storage\buffer\campo-01\
capture-server\storage\replays\
```

O arquivo `ffmpeg_campo-01.log` ajuda a diagnosticar erro de RTSP, codec, timestamp e queda de camera.

## Links de monitoramento temporarios

Se voce usa um link de monitoramento externo parecido com:

```text
https://IP:PORTA/apsess_xxxxx/
```

trate esse link como temporario. Sessões `apsess` podem expirar quando o painel reinicia, quando o proxy troca a sessao, quando fica inativo ou quando o servidor recria a rota. Se retornar `404 NOT FOUND`, gere um novo link no painel de monitoramento. Isso nao significa, sozinho, que o replay caiu.

## Solucao de problemas

Problema: cliquei em replay e nada apareceu.

Verifique:

1. O capture-server esta aberto?
2. A camera esta `recording` no admin?
3. Existe internet no servidor local?
4. O backend `/api/health` responde?
5. O arquivo `capture-server.err.log` mostra erro?
6. Existem segmentos com tamanho maior que zero em `storage\buffer\campo-01`?

Problema: camera fica `connecting`.

Verifique:

1. URL RTSP esta correta?
2. Usuario e senha da camera estao corretos?
3. O servidor local esta na mesma rede da camera?
4. A camera permite RTSP?
5. Teste `RTSP_TRANSPORT=tcp` e, se necessario, `udp`.

Problema: FFmpeg nao encontrado.

Instale FFmpeg e confirme no Prompt:

```bat
ffmpeg -version
```

Se o comando nao funcionar, adicione o FFmpeg no PATH ou configure:

```env
FFMPEG_BIN=C:\caminho\para\ffmpeg.exe
```

Problema: token nao autorizado.

Verifique:

1. O `OPERATOR_TOKEN` do `.env` local e igual ao token do Render?
2. O token foi salvo corretamente no navegador?
3. O backend esta com `APP_ENV=production` e `OPERATOR_TOKEN` configurado?

Problema: replay local foi gerado, mas nao apareceu na Home.

Verifique:

1. Upload para `/replays/upload` falhou?
2. Internet caiu durante o upload?
3. Backend retornou erro nos logs?
4. Arquivo existe em `capture-server\storage\replays`?

## Checklist de instalacao

- [ ] Camera ligada e acessivel.
- [ ] URL RTSP testada.
- [ ] Backend no Render online.
- [ ] Frontend na Vercel online.
- [ ] Token de operador salvo.
- [ ] Camera cadastrada no admin.
- [ ] `.env` do capture-server configurado.
- [ ] FFmpeg instalado.
- [ ] `iniciar-sistema.bat` executado sem erro.
- [ ] Status da camera em `recording`.
- [ ] Replay de teste publicado na Home.

## Checklist diario

- [ ] Ligar camera e servidor local.
- [ ] Executar `iniciar-sistema.bat`.
- [ ] Conferir `recording`.
- [ ] Fazer replay de teste.
- [ ] Conferir video na Home.
- [ ] Manter janela do capture-server aberta.

## Seguranca

- Nao publique URL RTSP.
- Nao compartilhe `OPERATOR_TOKEN`.
- Nao envie o arquivo `.env`.
- Use senha forte na camera.
- Mantenha o servidor local protegido.
- Baixe replays importantes depois do evento.

## Referencia rapida de endpoints

```text
GET  /api/health
GET  /api/cameras
POST /api/cameras
GET  /api/replays
POST /api/replay-requests
GET  /api/replay-requests/pending
POST /api/replays/upload
GET  /api/logs
POST /api/logs
```

## Resumo final

Para o sistema funcionar 100%, o backend e o frontend precisam estar online, o servidor local precisa enxergar a camera RTSP, e o capture-server precisa ficar rodando. O operador nao grava o video diretamente; ele cria uma solicitacao. Quem corta e envia o MP4 e o capture-server local.
