#include <Arduino_RouterBridge.h>
#include <Wire.h>
#include <Arduino_LED_Matrix.h>  // only for matrixBegin/matrixWrite, built into the core

const int SERVO_PINS[] = {2, 4, 7, 8, 12, 13};
const int N = sizeof(SERVO_PINS) / sizeof(SERVO_PINS[0]);
// Each pluck swings a string's pick from one side to the other. Angles per string,
// low E first; tune to where the picks sit. A small swing is fast enough for quick patterns.
const int SIDE_A[] = {55, 55, 55, 55, 55, 55};
const int SIDE_B[] = {125, 125, 125, 125, 125, 125};
const int SETTLE_MS = 300;  // time to reach start position at power-up

bool onSideB[N];  // which side each pick is on now

// Modulino Knob on the Qwiic connector (Wire1), talked to directly: the Arduino_Modulino
// library pulls in sensor drivers the board can't download without internet.
uint8_t knobAddr = 0;         // 0 = no knob found
bool knobSetNegated = false;  // some knob firmware stores set() values negated (as in Arduino_Modulino)
const int KNOB_MAX = 40;      // Python maps knob 0..40 to 0..200 BPM (0 = stop)
const int KNOB_START = 18;    // 90 BPM
bool knobDown = false;        // button state at the last read
// Presses are kept until Python asks, so short ones aren't missed. Two presses within
// DOUBLE_MS are a double tap; a lone press counts once DOUBLE_MS passes with no second one.
const uint32_t DOUBLE_MS = 400;
uint32_t lastPressMs = 0;
bool singlePending = false;
int knobGesture = 0;          // 1 = single press, -1 = double tap, 0 = nothing yet

bool knobRead(int16_t& pos) {
  Wire1.requestFrom(knobAddr, (uint8_t)4);  // pinstrap address, position lo, hi, pressed
  if (Wire1.available() < 4) {
    while (Wire1.available()) Wire1.read();
    return false;
  }
  Wire1.read();
  uint8_t lo = Wire1.read(), hi = Wire1.read();
  bool down = Wire1.read() != 0;
  if (down && !knobDown) {
    uint32_t now = millis();
    if (singlePending && now - lastPressMs < DOUBLE_MS) { knobGesture = -1; singlePending = false; }
    else { singlePending = true; lastPressMs = now; }
  }
  knobDown = down;
  pos = (int16_t)(lo | (hi << 8));
  return true;
}

void knobWrite(int16_t v) {
  if (knobSetNegated) v = -v;
  Wire1.beginTransmission(knobAddr);
  Wire1.write(v & 0xFF);
  Wire1.write((v >> 8) & 0xFF);
  Wire1.write(0);
  Wire1.write(0);
  Wire1.endTransmission();
}

bool knobBegin() {
  for (uint8_t a : {0x74 / 2, 0x76 / 2}) {  // the knob's two possible addresses
    Wire1.beginTransmission(a);
    if (Wire1.endTransmission() == 0) { knobAddr = a; break; }
  }
  if (!knobAddr) return false;
  int16_t v;
  knobWrite(100);
  if (knobRead(v) && v != 100) knobSetNegated = true;
  return true;
}

// Cortex-M cycle counter: keeps counting with interrupts off, unlike micros().
volatile uint32_t* const DEMCR      = (volatile uint32_t*)0xE000EDFC;
volatile uint32_t* const DWT_CTRL   = (volatile uint32_t*)0xE0001000;
volatile uint32_t* const DWT_CYCCNT = (volatile uint32_t*)0xE0001004;
const uint32_t CYCLES_PER_US = 160;  // 160 MHz core clock; checked in setup()

void waitUntil(uint32_t start, uint32_t us) {
  while (*DWT_CYCCNT - start < us * CYCLES_PER_US) {}
}

uint32_t widthUs(int i) {  // same pulse range as the Servo library
  return map(onSideB[i] ? SIDE_B[i] : SIDE_A[i], 0, 180, 544, 2400);
}

// One servo frame: all pins rise together and each drops at its own width. Interrupts are
// off so nothing can stretch a pulse; only safe while play() runs, because a Bridge message
// arriving with interrupts off could be garbled (Python waits for play() to reply).
void pulseFrame() {
  uint32_t width[N];
  bool high[N];
  int left = N;
  for (int i = 0; i < N; i++) width[i] = widthUs(i);
  uint32_t start = *DWT_CYCCNT;
  noInterrupts();
  for (int i = 0; i < N; i++) { digitalWrite(SERVO_PINS[i], HIGH); high[i] = true; }
  while (left > 0) {
    uint32_t us = (*DWT_CYCCNT - start) / CYCLES_PER_US;
    for (int i = 0; i < N; i++) {
      if (high[i] && us >= width[i]) { digitalWrite(SERVO_PINS[i], LOW); high[i] = false; left--; }
    }
  }
  interrupts();
}

// Hold every servo at its current side for ms, with exact pulses. Pulses are made here
// instead of with the Servo library: its software timer gets delayed by other interrupts,
// which stretches pulses (twitching). Outside play() no pulses are sent at all, so nothing
// can fire between patterns.
void hold(int ms) {
  for (int frames = max(1, (ms + 10) / 20); frames > 0; frames--) {
    uint32_t start = *DWT_CYCCNT;
    pulseFrame();
    // Check the knob button every 40 ms (fast enough to see the gap in a double tap);
    // the read fits in the gap before the next pulse.
    if (knobAddr && frames % 2 == 0) { int16_t pos; knobRead(pos); }
    waitUntil(start, 20000);  // servos expect one pulse every 20 ms
  }
}

// Called from Python through the Bridge with steps "mask:ms,mask:ms,...": each step plucks
// the strings in the 6-bit mask (bit 0 = low E) by flipping their side, then holds for ms.
// Plays to completion before replying, so the Linux side can't send more messages while
// interrupts are paused for a pulse.
bool playSteps(const char* p);

volatile uint32_t playCount = 0;  // debug: shows whether the board re-runs commands by itself

// Debug: "uptime_ms plays". Uptime near zero means the MCU just reset (e.g. 5V brownout).
String stats() {
  return String(millis()) + " " + String(playCount);
}

// Knob position for the tempo, kept within 0..KNOB_MAX; -1 when no knob is plugged in.
// Only called between chunks (Python waits for each reply), so I2C never overlaps a pulse.
int readKnob() {
  int16_t pos;
  if (!knobAddr || !knobRead(pos)) return -1;
  if (pos < 0 || pos > KNOB_MAX) {  // stop at the ends so turning back responds at once
    pos = constrain(pos, 0, KNOB_MAX);
    knobWrite(pos);
  }
  return pos;
}

// 1 = pressed (next pattern), -1 = double-tapped (previous), 0 = nothing; each reported once.
// Python asks every bar.
int knobClick() {
  if (singlePending && millis() - lastPressMs >= DOUBLE_MS) { singlePending = false; knobGesture = 1; }
  int g = knobGesture;
  knobGesture = 0;
  return g;
}

// ---------- LED matrix (8 rows x 13 columns): shows the chord name ----------
// 5x7 font for the characters in chord names; bit 4 = leftmost column.
struct Glyph { char c; uint8_t rows[7]; };
const Glyph FONT[] = {
  {'A', {0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11}},
  {'B', {0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E}},
  {'C', {0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E}},
  {'D', {0x1E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1E}},
  {'E', {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F}},
  {'F', {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10}},
  {'G', {0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F}},
  {'m', {0x00, 0x00, 0x1A, 0x15, 0x15, 0x11, 0x11}},
  {'a', {0x00, 0x00, 0x0E, 0x01, 0x0F, 0x11, 0x0F}},
  {'j', {0x02, 0x00, 0x06, 0x02, 0x02, 0x12, 0x0C}},
  {'d', {0x01, 0x01, 0x0D, 0x13, 0x11, 0x11, 0x0F}},
  {'s', {0x00, 0x00, 0x0F, 0x10, 0x0E, 0x01, 0x1E}},
  {'u', {0x00, 0x00, 0x11, 0x11, 0x11, 0x13, 0x0D}},
  {'2', {0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F}},
  {'4', {0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02}},
  {'7', {0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08}},
  {'9', {0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C}},
  {'-', {0x00, 0x00, 0x00, 0x0E, 0x00, 0x00, 0x00}},
};

char shown[12] = "-";              // set from the Bridge thread, drawn by loop()
volatile bool shownChanged = true;

// Called from Python between chunks (never mid-pulse); "" shows "-" (all strings).
bool show(String name) {
  noInterrupts();  // no thread switch while loop() might be copying it
  strncpy(shown, name.length() ? name.c_str() : "-", sizeof(shown) - 1);
  shown[sizeof(shown) - 1] = 0;
  shownChanged = true;
  interrupts();
  return true;
}

// Text with its left edge at column x (negative while scrolling off the left).
void drawText(const char* text, int x) {
  uint32_t frame[4] = {0};  // pixel (row, col) is bit row*13+col
  for (; *text; text++, x += 6) {
    const uint8_t* rows = nullptr;
    for (const Glyph& g : FONT) if (g.c == *text) rows = g.rows;
    if (!rows) continue;
    for (int r = 0; r < 7; r++)
      for (int c = 0; c < 5; c++)
        if (((rows[r] >> (4 - c)) & 1) && x + c >= 0 && x + c < 13) {
          int i = (r + 1) * 13 + x + c;  // row 0 left blank: 7-row font centred in 8
          frame[i / 32] |= 1u << (i % 32);
        }
  }
  matrixWrite(frame);
}

bool play(String steps) {
  playCount++;
  return playSteps(steps.c_str());
}

bool playSteps(const char* p) {
  while (*p) {
    char* end;
    long mask = strtol(p, &end, 10);
    if (*end != ':') return false;  // malformed: stop rather than guess
    long ms = strtol(end + 1, &end, 10);
    if (ms <= 0 || ms > 10000 || mask < 0 || mask > 63) return false;
    for (int i = 0; i < N; i++) if (mask & (1 << i)) onSideB[i] = !onSideB[i];
    hold(ms);
    p = (*end == ',') ? end + 1 : end;
  }
  return true;
}

void setup() {
  *DEMCR |= 1 << 24;  // enable the debug/trace block that holds the cycle counter
  *DWT_CTRL |= 1;     // start the cycle counter

  // Self-check: wrong clock or a stopped counter would send garbage pulses, so blink instead.
  uint32_t before = *DWT_CYCCNT;
  delay(10);
  uint32_t us = (*DWT_CYCCNT - before) / CYCLES_PER_US;
  if (us < 8000 || us > 12000) {
    pinMode(LED_BUILTIN, OUTPUT);
    while (true) { digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN)); delay(100); }
  }

  for (int i = 0; i < N; i++) pinMode(SERVO_PINS[i], OUTPUT);
  hold(SETTLE_MS);  // all picks to side A

  matrixBegin();

  Wire1.begin();  // Qwiic connector
  Wire1.setClock(100000);
  if (knobBegin()) knobWrite(KNOB_START);

  Bridge.begin();
  Bridge.provide("play", play);
  Bridge.provide("stats", stats);
  Bridge.provide("knob", readKnob);
  Bridge.provide("knob_click", knobClick);
  Bridge.provide("show", show);
}

// Draws the chord: centred if it fits (C, Am, B7), scrolling if not (Fmaj7, Cadd9).
void loop() {
  static char text[12];
  static int width = 0, offset = 0;
  static uint32_t lastStep = 0;
  if (shownChanged) {
    noInterrupts();
    memcpy(text, shown, sizeof(text));
    shownChanged = false;
    interrupts();
    width = strlen(text) * 6 - 1;
    offset = 13;  // scrolling starts with the text at the left edge
    if (width <= 13) drawText(text, (13 - width) / 2);
  }
  if (width > 13 && millis() - lastStep >= 120) {
    lastStep = millis();
    drawText(text, 13 - offset);
    offset = (offset + 1) % (width + 14);
  }
  delay(10);  // sleep, so this thread doesn't compete with play()
}
