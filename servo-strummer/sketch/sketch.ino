#include <Arduino_RouterBridge.h>
#include <Wire.h>
#include <Arduino_LED_Matrix.h>  // only for matrixBegin/matrixWrite, built into the core
#include "sequencer.h"   // bar parsing, timing, ripple, double buffer (pure C++, host-tested)
#include "servo_out.h"   // pulses with short interrupt pauses (edge plan host-tested)

// Threads: the loop thread is the only one that drives the servo pins and the knob's I2C, so a
// pulse and an I2C read never overlap. Bridge handlers run on the Bridge's thread: they only
// set variables (with interrupts off for the few microseconds that takes), or hand work that
// moves servos to the loop thread and wait for it (see onLoopThread).

const int SERVO_PINS[] = {2, 4, 7, 8, 12, 13};
const int N = sizeof(SERVO_PINS) / sizeof(SERVO_PINS[0]);
// Each pluck swings a string's pick from one side to the other. Angles per string,
// low E first; tune to where the picks sit. A small swing is fast enough for quick patterns.
// Defaults; the web page's calibration sliders change them per string (see setAngles).
int SIDE_A[] = {60, 60, 60, 60, 60, 60};
int SIDE_B[] = {120, 120, 120, 120, 120, 120};
const int SETTLE_MS = 300;  // time to reach start position at power-up

bool onSideB[N];  // which side each pick is on now

// Modulino Knob on the Qwiic connector (Wire1), talked to directly: the Arduino_Modulino
// library pulls in sensor drivers the board can't download without internet.
uint8_t knobAddr = 0;         // 0 = no knob found
bool knobSetNegated = false;  // some knob firmware stores set() values negated (as in Arduino_Modulino)
const int KNOB_MAX = 40;      // knob 0..40 = 0..200 BPM (0 = stop)
const int KNOB_START = 18;    // 90 BPM
const int KNOB_BPM_STEP = 5;  // same as Python
bool knobDown = false;        // button state at the last read
// Presses are kept until asked for, so short ones aren't missed. Two presses within
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
    noInterrupts();  // knobClick() runs on the Bridge thread too
    if (singlePending && now - lastPressMs < DOUBLE_MS) { knobGesture = -1; singlePending = false; }
    else { singlePending = true; lastPressMs = now; }
    interrupts();
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

// Knob position for the tempo, kept within 0..KNOB_MAX. Read on the loop thread only; the
// Bridge's "knob" call gets the last value.
volatile int knobPos = -1;

void pollKnob() {
  int16_t pos;
  if (!knobAddr || !knobRead(pos)) return;
  if (pos < 0 || pos > KNOB_MAX) {  // stop at the ends so turning back responds at once
    pos = constrain(pos, 0, KNOB_MAX);
    knobWrite(pos);
  }
  knobPos = pos;
}

// -1 when no knob is plugged in.
int readKnob() { return knobAddr ? knobPos : -1; }

// 1 = pressed (next pattern), -1 = double-tapped (previous), 0 = nothing; each reported once.
int knobClick() {
  noInterrupts();
  if (singlePending && millis() - lastPressMs >= DOUBLE_MS) { singlePending = false; knobGesture = 1; }
  int g = knobGesture;
  knobGesture = 0;
  interrupts();
  return g;
}

// Cortex-M cycle counter: keeps counting with interrupts off, unlike micros().
volatile uint32_t* const DEMCR      = (volatile uint32_t*)0xE000EDFC;
volatile uint32_t* const DWT_CTRL   = (volatile uint32_t*)0xE0001000;
volatile uint32_t* const DWT_CYCCNT = (volatile uint32_t*)0xE0001004;
const uint32_t CYCLES_PER_US = servo_out::CYCLES_PER_US;  // 160 MHz core clock; checked in setup()

void waitUntil(uint32_t start, uint32_t us) {
  while (*DWT_CYCCNT - start < us * CYCLES_PER_US) {}
}

uint32_t widthUs(int i) {  // same pulse range as the Servo library
  return map(onSideB[i] ? SIDE_B[i] : SIDE_A[i], 0, 180, 544, 2400);
}

// One servo frame: every pin at its current side. Pulses are made here instead of with the
// Servo library: its software timer gets delayed by other interrupts, which stretches pulses
// (twitching). Loop thread only.
void pulseFrame() {
  uint32_t width[N];
  for (int i = 0; i < N; i++) width[i] = widthUs(i);
  servo_out::pulseFrame(SERVO_PINS, width, N);
}

// Hold every servo at its current side for ms, with exact pulses (string test, reset,
// calibration). Outside these and the sequencer no pulses are sent at all, so nothing can
// fire between patterns. Loop thread only.
void hold(int ms) {
  for (int frames = max(1, (ms + 10) / 20); frames > 0; frames--) {
    uint32_t start = *DWT_CYCCNT;
    pulseFrame();
    // Check the knob every 40 ms (fast enough to see the gap in a double tap);
    // the read fits in the gap before the next pulse.
    if (knobAddr && frames % 2 == 0) pollKnob();
    waitUntil(start, 20000);  // servos expect one pulse every 20 ms
  }
}

seq::Sequencer sequencer;  // shared with the Bridge thread: touch it only with interrupts off
volatile uint32_t playCount = 0;   // debug: shows whether the board re-runs commands by itself
volatile uint32_t barsPlayed = 0;

// Debug: "uptime_ms plays bars late_edges max_late_us". Uptime near zero means the MCU just
// reset (e.g. 5V brownout); late edges are pulse edges an interrupt delayed by more than 5 us.
String stats() {
  return String(millis()) + " " + String(playCount) + " " + String(barsPlayed) + " " +
         String(servo_out::lateEdges) + " " + String(servo_out::maxLateUs);
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

// "" shows "-" (all strings). Safe while a bar plays.
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

// Centred if it fits (C, Am, B7), scrolling if not (Fmaj7, Cadd9). Loop thread.
void drawChord() {
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
}

// ---------- work the Bridge thread hands to the loop thread ----------
// Calls that move servos outside the sequencer put a request here and wait for the loop
// thread to finish it, so Python still gets its reply only once the servos are done.
enum Request : uint8_t { REQ_NONE, REQ_PLAY, REQ_SETTLE };
volatile uint8_t request = REQ_NONE;
volatile bool requestResult = false;
char requestSteps[260];

bool onLoopThread(uint8_t r) {
  request = r;
  while (request != REQ_NONE) delay(1);
  return requestResult;
}

bool seqRunning() {
  noInterrupts();
  bool r = sequencer.running;
  interrupts();
  return r;
}

// Calibration: new end angles for one string's pick. Holds briefly so it moves there now;
// while a bar plays, the next pulses simply use them.
bool setAngles(int i, int a, int b) {
  if (i < 0 || i >= N || a < 10 || b > 170 || b - a < 10) return false;
  SIDE_A[i] = a;
  SIDE_B[i] = b;
  if (!seqRunning()) onLoopThread(REQ_SETTLE);
  return true;
}

// Every pick back to its start side (A), as at power-up. Not while a bar plays.
bool resetPicks() {
  if (seqRunning()) return false;
  for (int i = 0; i < N; i++) onSideB[i] = false;
  return onLoopThread(REQ_SETTLE);
}

// Steps "mask:ms,mask:ms,...": each step plucks the strings in the 6-bit mask (bit 0 = low E)
// by flipping their side, then holds for ms. For the string test, and for the old chunk path
// (SEQUENCER = False in player.py). Not while a bar plays.
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

bool play(String steps) {
  if (seqRunning() || steps.length() >= sizeof(requestSteps)) return false;
  playCount++;
  strcpy(requestSteps, steps.c_str());
  return onLoopThread(REQ_PLAY);
}

// ---------- sequencer (bar format: see sequencer.h) ----------

// The bar to play after the current one (or the first one, before start). Replaces any bar
// already queued. bpm is Python's tempo, used only when no knob is plugged in (0 = keep).
bool queueBar(String text, int bpm) {
  seq::Bar bar;
  if (!seq::parseBar(text.c_str(), bar)) return false;
  noInterrupts();
  sequencer.queue(bar);
  if (!knobAddr && bpm > 0 && bpm <= 255) sequencer.setTempo(bpm);
  interrupts();
  return true;
}

volatile uint32_t gestureCount = 0;  // for Python's polling fallback: goes up on every gesture
volatile int lastGesture = 0;

// Plays the queued bar from tick 0, looping it until another is queued. The knob's tempo wins
// over bpm when a knob is plugged in.
bool startBars(int bpm) {
  int pos = knobPos;
  int tempo = knobAddr && pos >= 0 ? pos * KNOB_BPM_STEP : bpm;
  if (tempo <= 0 || tempo > 255) return false;
  knobClick();  // a press from before Play is stale
  noInterrupts();
  bool ok = sequencer.start(tempo);
  interrupts();
  return ok;
}

bool stopBars() {
  noInterrupts();
  sequencer.stop();
  interrupts();
  return true;
}

// For when notifications don't reach Python: "running bar bpm gesture_count last_gesture".
String seqState() {
  noInterrupts();
  bool running = sequencer.running;
  int32_t bar = sequencer.barNo;
  int bpm = sequencer.bpm;
  interrupts();
  return String(running ? 1 : 0) + " " + String(bar) + " " + String(bpm) + " " +
         String(gestureCount) + " " + String(lastGesture);
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
  if (knobBegin()) { knobWrite(KNOB_START); pollKnob(); }

  Bridge.begin();
  Bridge.provide("play", play);
  Bridge.provide("stats", stats);
  Bridge.provide("knob", readKnob);
  Bridge.provide("knob_click", knobClick);
  Bridge.provide("show", show);
  Bridge.provide("reset", resetPicks);
  Bridge.provide("angles", setAngles);
  Bridge.provide("queue", queueBar);
  Bridge.provide("start", startBars);
  Bridge.provide("stop", stopBars);
  Bridge.provide("seq", seqState);
}

const int TAIL_FRAMES = 15;  // after a stop, 300 ms of exact pulses so the last plucks finish swinging
const uint32_t SLEEP_MARGIN_US = 3000;  // stop sleeping this long before the next frame

// One 20 ms frame per call: the sequencer's plucks and the pulse, then the knob, notifications
// and the matrix in the gap before the next pulse.
void loop() {
  static uint32_t frameStart = *DWT_CYCCNT;
  static uint32_t frame = 0;
  static int tail = 0;

  if (request != REQ_NONE) {  // string test / reset / calibration, from the Bridge thread
    requestResult = request == REQ_PLAY ? playSteps(requestSteps) : (hold(SETTLE_MS), true);
    request = REQ_NONE;
    frameStart = *DWT_CYCCNT;
    return;
  }

  noInterrupts();
  bool wasRunning = sequencer.running;
  uint8_t flip = sequencer.step();
  bool running = sequencer.running, stoppedByTempo = sequencer.stoppedByTempo;
  bool barStarted = sequencer.barStarted;
  int32_t barNo = sequencer.barNo;
  int bpm = sequencer.bpm;
  sequencer.barStarted = false;
  sequencer.stoppedByTempo = false;
  interrupts();

  for (int i = 0; i < N; i++) if (flip & (1 << i)) onSideB[i] = !onSideB[i];
  if (wasRunning) tail = TAIL_FRAMES;
  if (wasRunning || tail > 0) {
    pulseFrame();
    if (!running) tail--;
  }

  if (barStarted) {
    barsPlayed++;
    Bridge.notify("bar", (int)barNo, bpm);
  }
  if (stoppedByTempo) Bridge.notify("stopped", 0);

  if (knobAddr && frame % 2 == 0) {  // every 40 ms: fast enough to see the gap in a double tap
    pollKnob();
    if (running) {
      int pos = knobPos;
      noInterrupts();
      sequencer.setTempo(pos * KNOB_BPM_STEP);  // from the next beat; 0 stops there
      interrupts();
      int g = knobClick();  // while idle, gestures wait for Python's knob_click instead
      if (g) {
        lastGesture = g;
        gestureCount++;
        Bridge.notify("knob", g);
      }
    }
  }
  drawChord();
  frame++;

  // Sleep through most of the frame so the Bridge thread gets the CPU (1 ms at a time, in case
  // the kernel tick is coarse), then busy-wait the rest. The cadence is absolute: a frame that
  // starts a little late is followed by a shorter one, so the tempo doesn't drift.
  if ((*DWT_CYCCNT - frameStart) / CYCLES_PER_US > 40000) {  // fell far behind: restart from now
    frameStart = *DWT_CYCCNT;
    return;
  }
  while ((*DWT_CYCCNT - frameStart) / CYCLES_PER_US + SLEEP_MARGIN_US < 20000) delay(1);
  waitUntil(frameStart, 20000);
  frameStart += 20000 * CYCLES_PER_US;
}
