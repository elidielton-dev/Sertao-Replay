# Hardware

## Controlador fisico

Placa usada:

```text
Arduino Leonardo
```

Motivo:

- funciona como teclado USB HID;
- funciona como atalho de teclado para gerar replay;
- e barato;
- e facil de programar;
- e suficiente para o MVP.

## Botoes sugeridos

- 4 botoes arcade que podem gerar replay 15s;
- 1 botao para trocar camera.

## Ligacao

Cada botao:

```text
Pino digital do Leonardo ---- Botao ---- GND
```

No codigo usamos:

```cpp
INPUT_PULLUP
```

Isso significa:

- botao solto = HIGH;
- botao pressionado = LOW.

## Mapeamento

| Botao | Pino | Tecla |
|---|---:|---|
| Replay 15s | 2 | F14 |
| Replay 15s | 3 | F14 |
| Replay 15s | 4 | F14 |
| Replay 15s | 5 | F14 |
| Trocar camera | 6 | F17 |
