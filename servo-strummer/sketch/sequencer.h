// Bar sequencer: pure C++ (no Arduino headers), so tests/cpp/sequencer_test.cpp runs it on a PC.
//
// Python sends one bar at a time as text:  "96;0:127,24:63,48:191"
//   96     bar length in ticks (1 tick = 1/24 beat, so 4/4 = 96; covers 8ths, 16ths, triplets, 32nds)
//   t:m    an event at tick t; m = 6 string bits (bit 0 = low E) | KIND_DOWN or KIND_UP for a strum.
//          No kind bit = pluck those strings together. Rests are just gaps between events.
//
// Timing: one call to step() per 20 ms servo frame. The position is counted in sub-ticks
// (1/125 tick), so a frame advances exactly `bpm` sub-ticks (20 ms * bpm / 2.5 s per tick).
// An event fires on the frame nearest to it; a strum's remaining strings follow one per frame
// (the existing 20 ms ripple). Tempo changes wait for the next beat; a tempo of 0 stops.
// The bar loops until a queued bar replaces it at the bar line, so if Linux goes quiet the
// robot keeps playing the current bar.
//
// The same algorithm is in Python (strummer/music.py: simulate) and both are checked against
// tests/bar_vectors.json.
#pragma once
#include <stdint.h>

namespace seq {

const uint8_t STRINGS = 0x3F;
const uint8_t KIND_DOWN = 0x40;  // strum low E -> high e
const uint8_t KIND_UP = 0x80;    // strum high e -> low E
const int MAX_EVENTS = 48;       // a 32nd-note bar has 32
const uint32_t SUB_PER_TICK = 125;
const uint32_t TICKS_PER_BEAT = 24;
const uint32_t SUB_PER_BEAT = SUB_PER_TICK * TICKS_PER_BEAT;
const uint16_t MAX_TICKS = 24 * 16;  // 4 bars of 4/4 at most
const int RIPPLE = 6;

struct Event {
  uint16_t tick;
  uint8_t mask;
};

struct Bar {
  uint16_t len = 0;  // ticks; 0 = empty
  uint8_t n = 0;
  Event ev[MAX_EVENTS];
};

// Reads an unsigned decimal; false if there is none or it exceeds max.
inline bool readNum(const char*& p, uint32_t max, uint32_t& out) {
  if (*p < '0' || *p > '9') return false;
  uint32_t v = 0;
  while (*p >= '0' && *p <= '9') {
    v = v * 10 + (uint32_t)(*p++ - '0');
    if (v > max) return false;
  }
  out = v;
  return true;
}

// Parses "len;t:m,t:m". Ticks must not decrease and must be inside the bar. On any error it
// returns false and leaves `out` untouched (a bad message never replaces a good bar).
inline bool parseBar(const char* p, Bar& out) {
  Bar b;
  uint32_t v;
  if (!readNum(p, MAX_TICKS, v) || v == 0 || *p++ != ';') return false;
  b.len = (uint16_t)v;
  uint32_t last = 0;
  while (*p) {
    uint32_t t, m;
    if (b.n >= MAX_EVENTS) return false;
    if (!readNum(p, b.len - 1, t) || *p++ != ':' || !readNum(p, 0xFF, m)) return false;
    if (t < last || (m & STRINGS) == 0 || (m & KIND_DOWN && m & KIND_UP)) return false;
    b.ev[b.n].tick = (uint16_t)t;
    b.ev[b.n].mask = (uint8_t)m;
    b.n++;
    last = t;
    if (*p == ',') {
      if (!*++p) return false;  // a trailing comma means something got cut off
    } else if (*p) {
      return false;
    }
  }
  out = b;
  return true;
}

class Sequencer {
 public:
  Bar cur, next;
  bool hasNext = false;
  bool running = false;
  uint16_t bpm = 0, target = 0;
  int32_t barNo = -1;
  bool barStarted = false;    // set when a bar begins; the sketch clears it after notifying
  bool stoppedByTempo = false;  // set when a tempo of 0 stopped it

  // Next bar to play: replaces any bar already queued, swapped in at the next bar line.
  void queue(const Bar& b) {
    next = b;
    hasNext = true;
  }

  // Starts from the queued bar (or the last one) at tick 0. False if there is nothing to play.
  bool start(uint16_t tempo) {
    if (hasNext) {
      cur = next;
      hasNext = false;
    }
    if (cur.len == 0 || tempo == 0) return false;
    bpm = target = tempo;
    pos = 0;
    idx = 0;
    for (int i = 0; i < RIPPLE; i++) ripple[i] = 0;
    barNo = 0;
    barStarted = true;
    stoppedByTempo = false;
    running = true;
    return true;
  }

  void stop() { running = false; }

  // New tempo, applied at the next beat. 0 stops there.
  void setTempo(uint16_t tempo) { target = tempo; }

  // One 20 ms frame: the strings to pluck (flip) now.
  uint8_t step() {
    if (!running) return 0;
    uint8_t m = ripple[0];
    for (int i = 0; i < RIPPLE - 1; i++) ripple[i] = ripple[i + 1];
    ripple[RIPPLE - 1] = 0;
    for (;;) {
      while (idx < cur.n && 2 * (int32_t)(cur.ev[idx].tick * SUB_PER_TICK) < 2 * pos + bpm) m |= fire(cur.ev[idx++].mask);
      int32_t len = (int32_t)(cur.len * SUB_PER_TICK);
      if (2 * pos + bpm <= 2 * len) break;
      // This frame is nearest the bar line: the next bar starts here (pos can go slightly
      // negative: the frame may come just before the line).
      pos -= len;
      idx = 0;
      if (hasNext) {
        cur = next;
        hasNext = false;
      }
      barNo++;
      barStarted = true;
    }
    int32_t before = pos;
    pos += bpm;
    if (target != bpm && beatOf(pos) != beatOf(before)) {
      if (target == 0) {
        running = false;
        stoppedByTempo = true;
      } else {
        bpm = target;
      }
    }
    return m;
  }

  int32_t position() const { return pos; }  // sub-ticks into the current bar

 private:
  int32_t pos = 0;
  uint8_t idx = 0;
  uint8_t ripple[RIPPLE] = {0};  // ripple[k] = strings to pluck k+1 frames from now

  static int32_t beatOf(int32_t p) {  // floor division: a slightly negative pos is the last beat
    int32_t b = (int32_t)SUB_PER_BEAT;
    return p >= 0 ? p / b : -((-p + b - 1) / b);
  }

  uint8_t fire(uint8_t mask) {
    uint8_t strings = mask & STRINGS;
    uint8_t kind = mask & (KIND_DOWN | KIND_UP);
    int order[6], n = 0;
    for (int s = 0; s < 6; s++)
      if (strings & (1 << s)) order[n++] = s;
    if (!kind || n <= 1) return strings;  // pluck together
    if (kind == KIND_UP)
      for (int i = 0; i < n / 2; i++) {
        int t = order[i];
        order[i] = order[n - 1 - i];
        order[n - 1 - i] = t;
      }
    for (int k = 1; k < n; k++) ripple[k - 1] |= (uint8_t)(1 << order[k]);
    return (uint8_t)(1 << order[0]);
  }
};

}  // namespace seq
