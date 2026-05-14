# Sertao Replay

MVP de replay esportivo com FastAPI, SQLite, FFmpeg e uma home para o cliente assistir e baixar os lances gerados.

## Arquitetura atual

```text
Camera IP / RTSP
        -> FFmpeg
        -> buffer circular em segmentos
        -> FastAPI
        -> SQLite
        -> arquivos MP4 em storage/replays
        -> home do cliente
```

O banco agora persiste:

- cameras cadastradas;
- status da camera;
- eventos tecnicos;
- replays gerados, com camera de origem, duracao, status e URL do video.

O arquivo `config/cameras.json` continua existindo apenas como legado/fallback: se o banco estiver vazio, o backend importa essas cameras uma vez.

## Requisitos

- Python 3.11+
- FFmpeg instalado ou disponivel via `imageio-ffmpeg`
- Node.js 20+ para build/dev do frontend
- GStreamer opcional para testes manuais

## Configurar o banco

O padrao usa SQLite dentro da pasta `backend`:

```env
DATABASE_URL=sqlite:///./sports_replay.db
```

Para usar PostgreSQL, altere `DATABASE_URL` no arquivo `backend/.env` seguindo o formato SQLAlchemy.

Crie o ambiente do backend:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy ..\config\.env.example .env
python -c "from app.db.init_db import init_db; init_db()"
```

No Linux/macOS:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp ../config/.env.example .env
python -c "from app.db.init_db import init_db; init_db()"
```

## Rodar localmente

Backend:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload
```

Frontend em desenvolvimento:

```powershell
cd frontend
npm install
npm run dev
```

O Vite encaminha `/api` para `http://127.0.0.1:8000`.

Para servir tudo pelo FastAPI, gere o build:

```powershell
cd frontend
npm run build
cd ..\backend
uvicorn app.main:app --reload
```

Acesse:

- Home do cliente: `http://127.0.0.1:8000/`
- Teste de camera: `http://127.0.0.1:8000/teste/`
- Cadastro/admin: `http://127.0.0.1:8000/admin/`

## Cadastrar camera

1. Abra `/admin/`.
2. Informe `ID`, nome, URL RTSP, status ativo e observacoes se necessario.
3. Salve a camera.
4. Recarregue a pagina ou reinicie o servidor: a camera deve continuar no banco.

O backend valida campos, evita URL RTSP duplicada e redige credenciais em logs.

## Testar conexao da camera

1. Abra `/teste/`.
2. Selecione uma camera cadastrada.
3. Clique em `Testar conexao`.
4. O status exibira online, offline, conectando ou erro.

Se a camera estiver em rede local, rode o backend na mesma rede da camera.

## Gerar replay

1. Em `/teste/`, clique em `Iniciar buffer`.
2. Aguarde alguns segundos para o FFmpeg criar segmentos.
3. Clique em `Gerar replay 15s`.
4. O backend cria o MP4 em `backend/storage/replays` e salva o registro na tabela `replays`.

Se o buffer ainda nao tiver segmentos, o backend tenta gravar um clipe direto da camera como fallback.

## Visualizar e baixar na home

Abra `/`. A home lista apenas replays prontos, com:

- player de video na propria pagina;
- data e hora de criacao;
- camera de origem;
- duracao;
- botao de baixar video.

Ela atualiza automaticamente a lista periodicamente.

## Logs

Os logs ficam em:

```text
backend/storage/logs/app.log
```

Eventos registrados:

- conexao e falha de camera;
- inicio, queda e reconexao de buffer;
- criacao de replay;
- importacao de dados legados;
- erros de banco e operacoes importantes.

URLs RTSP com usuario/senha, tokens e segredos sao redigidos antes de aparecerem nos logs da aplicacao.
