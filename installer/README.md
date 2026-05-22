# Sertao Replay Setup

Instalador grafico Windows em CustomTkinter para vincular a maquina do cliente a uma empresa criada no Super Admin. Cada etapa abre em uma janela propria e fecha ao concluir.

## Build

```powershell
cd installer
.\build.ps1
```

Saida:

```text
installer/dist/SertaoReplaySetup.exe
```

## Fluxo

1. Informa a chave da empresa.
2. Valida no Render e abre a janela de confirmacao.
3. Confirma a camera cadastrada no admin, ja com RTSP puxado pelo backend.
4. Instala em `C:\SertaoReplay`.
5. Cria/atualiza tarefa agendada `Sertao Replay Capture`.
6. Inicia o servidor local automaticamente.
7. Abre a tela final de controle local para iniciar/parar, consultar status, abrir logs, site publico e admin.
