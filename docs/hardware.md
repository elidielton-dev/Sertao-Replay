# Hardware

## Controlador físico

Placa usada:

```text
Arduino Leonardo
```

Motivo:

- funciona como teclado USB HID;
- permite enviar F13, F14, F15 etc.;
- é barato;
- é fácil de programar;
- é suficiente para o MVP.

## Botões sugeridos

- 3 botões arcade para replay;
- 1 botão para salvar lance;
- 1 botão para trocar câmera.

## Ligação

Cada botão:

```text
Pino digital do Leonardo ---- Botão ---- GND
```

No código usamos:

```cpp
INPUT_PULLUP
```

Isso significa:

- botão solto = HIGH;
- botão pressionado = LOW.

## Mapeamento

| Botão | Pino | Tecla |
|---|---:|---|
| Replay 10s | 2 | F13 |
| Replay 15s | 3 | F14 |
| Replay 30s | 4 | F15 |
| Salvar lance | 5 | F16 |
| Trocar câmera | 6 | F17 |
