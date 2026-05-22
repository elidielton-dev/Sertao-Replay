# Sertao Replay Setup

Instalador grafico Windows em CustomTkinter para vincular a maquina do cliente a uma empresa criada no Super Admin.

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
2. O instalador busca cliente e cameras no Render.
3. Confirma a camera cadastrada no admin.
4. Instala em `C:\SertaoReplay`.
5. Cria/atualiza tarefa agendada `Sertao Replay Capture`.
6. O mesmo executavel roda em modo `--capture` para manter o servidor local ativo.
