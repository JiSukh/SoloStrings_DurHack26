#include <Arduino_RouterBridge.h>

const int SERVO_PINS[] = {2, 4, 7, 8, 12, 13};
const int N = sizeof(SERVO_PINS) / sizeof(SERVO_PINS[0]);
const int REST = 10;        // full 0/180 pushes SG90s into their end stops
const int HIT = 170;
const int TRAVEL_MS = 500;  // SG90 needs ~0.3 s for 160°; margin for load

// Cortex-M cycle counter: keeps counting with interrupts off, unlike micros().
volatile uint32_t* const DEMCR      = (volatile uint32_t*)0xE000EDFC;
volatile uint32_t* const DWT_CTRL   = (volatile uint32_t*)0xE0001000;
volatile uint32_t* const DWT_CYCCNT = (volatile uint32_t*)0xE0001004;
const uint32_t CYCLES_PER_US = 160;  // 160 MHz core clock; checked in setup()

void waitUntil(uint32_t start, uint32_t us) {
  while (*DWT_CYCCNT - start < us * CYCLES_PER_US) {}
}

// Drive all servos to the angle for ms. Pulses are made here instead of with the Servo
// library: its software timer gets delayed by other interrupts, which stretches pulses
// (twitching). All pins rise and fall in the same frame, so the six move in sync.
// Between calls no pulses are sent: gears hold position, no jitter, almost no current.
void hold(int angle, int ms) {
  uint32_t width = map(angle, 0, 180, 544, 2400);  // same pulse range as the Servo library
  for (int frames = ms / 20; frames > 0; frames--) {
    uint32_t start = *DWT_CYCCNT;
    noInterrupts();  // nothing may stretch the pulse
    for (int i = 0; i < N; i++) digitalWrite(SERVO_PINS[i], HIGH);
    waitUntil(start, width);
    for (int i = 0; i < N; i++) digitalWrite(SERVO_PINS[i], LOW);
    interrupts();
    waitUntil(start, 20000);  // servos expect one pulse every 20 ms
  }
}

// Called by the web page through the Bridge. Runs to completion before replying, so the
// Linux side can't send more messages while interrupts are paused for a pulse.
bool strum() {
  hold(HIT, TRAVEL_MS);
  hold(REST, TRAVEL_MS);
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
  hold(REST, TRAVEL_MS);

  Bridge.begin();
  Bridge.provide("strum", strum);
}

void loop() {}
