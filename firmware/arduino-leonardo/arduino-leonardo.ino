#include <Keyboard.h>

/*
  Controlador fisico para Sertao Replay
  Placa: Arduino Leonardo

  Ligacao:
  - Um lado de cada botao no GND
  - Outro lado nos pinos definidos abaixo
  - Usar INPUT_PULLUP

  Comandos enviados:
  - Botao Replay 10s    -> Ctrl+Alt+1
  - Botao Replay 15s    -> Ctrl+Alt+2
  - Botao Replay 30s    -> Ctrl+Alt+3
  - Botao Salvar lance  -> Ctrl+Alt+R
  - Botao Trocar camera -> Ctrl+Alt+N
*/

const int BTN_REPLAY_10 = 2;
const int BTN_REPLAY_15 = 3;
const int BTN_REPLAY_30 = 4;
const int BTN_SAVE = 5;
const int BTN_CAMERA = 6;

const unsigned long DEBOUNCE_MS = 180;

unsigned long lastPressReplay10 = 0;
unsigned long lastPressReplay15 = 0;
unsigned long lastPressReplay30 = 0;
unsigned long lastPressSave = 0;
unsigned long lastPressCamera = 0;

void setup() {
  pinMode(BTN_REPLAY_10, INPUT_PULLUP);
  pinMode(BTN_REPLAY_15, INPUT_PULLUP);
  pinMode(BTN_REPLAY_30, INPUT_PULLUP);
  pinMode(BTN_SAVE, INPUT_PULLUP);
  pinMode(BTN_CAMERA, INPUT_PULLUP);

  Keyboard.begin();
}

void sendShortcut(char key) {
  Keyboard.press(KEY_LEFT_CTRL);
  Keyboard.press(KEY_LEFT_ALT);
  Keyboard.press(key);
  delay(40);
  Keyboard.releaseAll();
}

bool pressed(int pin) {
  return digitalRead(pin) == LOW;
}

void loop() {
  unsigned long now = millis();

  if (pressed(BTN_REPLAY_10) && now - lastPressReplay10 > DEBOUNCE_MS) {
    sendShortcut('1');
    lastPressReplay10 = now;
  }

  if (pressed(BTN_REPLAY_15) && now - lastPressReplay15 > DEBOUNCE_MS) {
    sendShortcut('2');
    lastPressReplay15 = now;
  }

  if (pressed(BTN_REPLAY_30) && now - lastPressReplay30 > DEBOUNCE_MS) {
    sendShortcut('3');
    lastPressReplay30 = now;
  }

  if (pressed(BTN_SAVE) && now - lastPressSave > DEBOUNCE_MS) {
    sendShortcut('r');
    lastPressSave = now;
  }

  if (pressed(BTN_CAMERA) && now - lastPressCamera > DEBOUNCE_MS) {
    sendShortcut('n');
    lastPressCamera = now;
  }
}
