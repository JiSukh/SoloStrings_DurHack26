// Servo pulses with short interrupt pauses.
//
// One 20 ms frame: every pin rises together, each falls after its own width (544..2400 us).
// The old pulseFrame() kept interrupts off for the whole 2.4 ms, so a UART byte from Linux
// (one every 87 us at 115200 baud) could be lost mid-pulse. Now interrupts stay ON while we
// busy-wait, and go off only from GUARD_US before an edge group until its last edge is placed
// (about GUARD_US + GROUP_US = 25 us, well under one UART byte). An interrupt that lands in the
// open window just delays the busy-wait, not the edge, unless it runs past GUARD_US: then the
// edge is late, and lateEdges / maxLateUs in stats() say so.
//
// planEdges() is pure C++ (tested on a PC by tests/cpp/sequencer_test.cpp); pulseFrame() is
// the hardware part and only builds on the board.
#pragma once
#include <stdint.h>

namespace servo_out {

const uint32_t GUARD_US = 15;  // interrupts go off this long before an edge group
const uint32_t GROUP_US = 10;  // edges this close together are placed in one pause
const int MAX_PINS = 6;

struct Group {
  uint32_t at;   // first edge, us after the rise
  uint32_t end;  // last edge
  uint8_t pins;  // bit i = pin i falls in this group
};

// Falling edges, sorted by time and merged into groups of edges within GROUP_US of the
// group's first edge. Returns the number of groups (1..n).
inline int planEdges(const uint32_t* width, int n, Group* groups) {
  int order[MAX_PINS];
  for (int i = 0; i < n; i++) order[i] = i;
  for (int i = 1; i < n; i++)  // insertion sort: n is 6
    for (int j = i; j > 0 && width[order[j]] < width[order[j - 1]]; j--) {
      int t = order[j];
      order[j] = order[j - 1];
      order[j - 1] = t;
    }
  int g = -1;
  for (int k = 0; k < n; k++) {
    int i = order[k];
    if (g < 0 || width[i] - groups[g].at > GROUP_US) {
      g++;
      groups[g].at = groups[g].end = width[i];
      groups[g].pins = 0;
    }
    groups[g].pins |= (uint8_t)(1 << i);
    groups[g].end = width[i];
  }
  return g + 1;
}

}  // namespace servo_out

#ifdef ARDUINO
#include <Arduino.h>

// Without this, a higher-priority thread (the Bridge's) could run in the interrupts-on window
// and stretch a pulse. Locking the scheduler stops thread switches but leaves interrupts
// (the UART) running. Set SERVO_SCHED_LOCK to 0 if this core's sketches can't link k_sched_lock.
#ifndef SERVO_SCHED_LOCK
#define SERVO_SCHED_LOCK 1
#endif
#if SERVO_SCHED_LOCK
#include <zephyr/kernel.h>
#define SERVO_LOCK() k_sched_lock()
#define SERVO_UNLOCK() k_sched_unlock()
#else
#define SERVO_LOCK()
#define SERVO_UNLOCK()
#endif

namespace servo_out {

volatile uint32_t* const CYCCNT = (volatile uint32_t*)0xE0001004;  // Cortex-M cycle counter
const uint32_t CYCLES_PER_US = 160;                                // 160 MHz; checked in setup()

uint32_t lateEdges = 0;  // edges placed more than 5 us late since start-up
uint32_t maxLateUs = 0;

inline uint32_t usSince(uint32_t start) { return (*CYCCNT - start) / CYCLES_PER_US; }

// One frame of pulses on `pins`, widths in us.
inline void pulseFrame(const int* pins, const uint32_t* width, int n) {
  Group groups[MAX_PINS];
  int ng = planEdges(width, n, groups);
  SERVO_LOCK();
  noInterrupts();
  uint32_t start = *CYCCNT;
  for (int i = 0; i < n; i++) digitalWrite(pins[i], HIGH);
  interrupts();
  for (int g = 0; g < ng; g++) {
    while (usSince(start) + GUARD_US < groups[g].at) {}  // interrupts on
    noInterrupts();
    uint32_t now = usSince(start);
    if (now > groups[g].at + 5) {
      lateEdges++;
      if (now - groups[g].at > maxLateUs) maxLateUs = now - groups[g].at;
    }
    uint8_t left = groups[g].pins;
    while (left) {
      now = usSince(start);
      for (int i = 0; i < n; i++)
        if ((left & (1 << i)) && now >= width[i]) {
          digitalWrite(pins[i], LOW);
          left &= (uint8_t)~(1 << i);
        }
    }
    interrupts();
  }
  SERVO_UNLOCK();
}

}  // namespace servo_out
#endif
