// Host test of the sketch's pure C++ parts: sequencer.h and servo_out.h's edge plan.
// Build and run (scripts/test.sh does this):
//   g++ -std=c++11 -Wall -Wextra -Werror -I servo-strummer/sketch tests/cpp/sequencer_test.cpp -o /tmp/seq && /tmp/seq tests/bar_vectors.json
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "sequencer.h"
#include "servo_out.h"

static int failures = 0;
#define CHECK(cond)                                                    \
  do {                                                                 \
    if (!(cond)) {                                                     \
      std::fprintf(stderr, "%s:%d: CHECK(%s)\n", __FILE__, __LINE__, #cond); \
      failures++;                                                      \
    }                                                                  \
  } while (0)

static seq::Bar bar(const char* text) {
  seq::Bar b;
  bool ok = seq::parseBar(text, b);
  if (!ok) std::fprintf(stderr, "could not parse %s\n", text);
  CHECK(ok);
  return b;
}

// Frames until the next bar starts (barStarted), collecting what step() plucks.
static std::vector<std::pair<int, int>> run(seq::Sequencer& s, int frames) {
  std::vector<std::pair<int, int>> out;
  for (int f = 0; f < frames; f++) {
    int m = s.step();
    if (m) out.push_back(std::make_pair(f, m));
  }
  return out;
}

// ---------- golden vectors (tests/bar_vectors.json, written by tests/python/bar_vectors.py) ----------

// The file has one vector per line: {"pattern":..,"chord":..,"bpm":N,"frames":N,"bar":"..","plucks":[[f,m],..]}
static bool field(const std::string& line, const char* key, std::string& out) {
  std::string k = std::string("\"") + key + "\":";
  size_t p = line.find(k);
  if (p == std::string::npos) return false;
  p += k.size();
  if (line[p] == '"') {
    size_t e = line.find('"', p + 1);
    out = line.substr(p + 1, e - p - 1);
  } else if (line[p] == '[') {
    int depth = 0;
    size_t e = p;
    for (; e < line.size(); e++) {
      if (line[e] == '[') depth++;
      if (line[e] == ']' && --depth == 0) break;
    }
    out = line.substr(p, e - p + 1);
  } else {
    size_t e = line.find_first_of(",}", p);
    out = line.substr(p, e - p);
  }
  return true;
}

static std::vector<std::pair<int, int>> pairs(const std::string& s) {
  std::vector<std::pair<int, int>> out;
  const char* p = s.c_str();
  while ((p = std::strchr(p, '[')) != nullptr) {
    p++;
    if (*p == '[') continue;
    char* e;
    long a = std::strtol(p, &e, 10);
    if (*e != ',') continue;
    long b = std::strtol(e + 1, &e, 10);
    out.push_back(std::make_pair((int)a, (int)b));
    p = e;
  }
  return out;
}

static void goldenVectors(const char* path) {
  std::ifstream in(path);
  CHECK(in.good());
  std::string line;
  int n = 0;
  while (std::getline(in, line)) {
    if (line.find("\"bar\":") == std::string::npos) continue;
    std::string name, chord, bpmS, framesS, text, plucksS;
    CHECK(field(line, "pattern", name) && field(line, "chord", chord) && field(line, "bpm", bpmS) &&
          field(line, "frames", framesS) && field(line, "bar", text) && field(line, "plucks", plucksS));
    seq::Sequencer s;
    s.queue(bar(text.c_str()));
    CHECK(s.start((uint16_t)std::atoi(bpmS.c_str())));
    std::vector<std::pair<int, int>> got = run(s, std::atoi(framesS.c_str()));
    std::vector<std::pair<int, int>> want = pairs(plucksS);
    if (got != want) {
      std::fprintf(stderr, "vector %s / %s @ %s BPM: %d plucks, want %d\n", name.c_str(), chord.c_str(),
                   bpmS.c_str(), (int)got.size(), (int)want.size());
      failures++;
    }
    n++;
  }
  CHECK(n >= 100);
  std::printf("  %d golden vectors\n", n);
}

// ---------- hand-written cases ----------

static void parser() {
  seq::Bar b;
  CHECK(seq::parseBar("96;0:127,24:191,48:3", b));
  CHECK(b.len == 96 && b.n == 3);
  CHECK(b.ev[1].tick == 24 && b.ev[1].mask == 191);
  CHECK(seq::parseBar("96;", b) && b.n == 0);  // a bar of rests
  seq::Bar keep = bar("96;0:1");
  const char* bad[] = {"", ";0:1", "0;0:1", "96", "96;0", "96;0:", "96;96:1", "96;24:1,0:2", "96;0:0",
                       "96;0:192", "96;0:1,", "96;0:1;", "96;0:256", "96;x:1", "9999;0:1"};
  for (const char* t : bad) {
    seq::Bar out = keep;
    bool ok = seq::parseBar(t, out);
    if (ok) std::fprintf(stderr, "parsed bad bar \"%s\"\n", t);
    CHECK(!ok);
    CHECK(out.len == 96 && out.n == 1);  // untouched
  }
  std::string many = "96;";
  for (int i = 0; i <= seq::MAX_EVENTS; i++) many += std::to_string(i) + ":1,";
  many.pop_back();
  CHECK(!seq::parseBar(many.c_str(), b));
}

static void startAndStop() {
  seq::Sequencer s;
  CHECK(!s.start(90));  // nothing queued
  CHECK(s.step() == 0);
  s.queue(bar("96;0:1"));
  CHECK(!s.start(0));
  CHECK(s.start(90) && s.running && s.barNo == 0 && s.barStarted);
  CHECK(s.step() == 1);
  s.stop();
  CHECK(!s.running && s.step() == 0);
}

// 120 BPM: a beat is 25 frames, a bar 100. Pluck on every beat.
static void loopsUntilQueued() {
  seq::Sequencer s;
  s.queue(bar("96;0:1,24:1,48:1,72:1"));
  s.start(120);
  std::vector<std::pair<int, int>> got = run(s, 300);
  CHECK(got.size() == 12);  // keeps looping with nobody talking to it
  for (size_t i = 0; i < got.size(); i++) CHECK(got[i].first == (int)i * 25);
  CHECK(s.barNo == 2);
}

static void swapsAtTheBarLine() {
  seq::Sequencer s;
  s.queue(bar("96;0:1"));
  s.start(120);
  s.barStarted = false;
  CHECK(s.step() == 1);
  s.queue(bar("96;0:2"));
  s.queue(bar("96;0:4,48:8"));  // a re-queue replaces the waiting bar
  for (int f = 1; f < 100; f++) CHECK(s.step() == 0 && !s.barStarted);
  CHECK(s.step() == 4 && s.barStarted && s.barNo == 1);  // frame 100: the new bar, on time
  for (int f = 101; f < 150; f++) CHECK(s.step() == 0);
  CHECK(s.step() == 8);
  CHECK(!s.hasNext);
}

static void strumRipples() {
  seq::Sequencer s;
  s.queue(bar("96;0:127,48:191"));  // down all six, then up all six
  s.start(120);
  std::vector<std::pair<int, int>> got = run(s, 60);
  int want[][2] = {{0, 1}, {1, 2}, {2, 4}, {3, 8}, {4, 16}, {5, 32}, {50, 32}, {51, 16}, {52, 8}, {53, 4}, {54, 2}, {55, 1}};
  CHECK(got.size() == 12);
  for (size_t i = 0; i < got.size() && i < 12; i++) CHECK(got[i].first == want[i][0] && got[i].second == want[i][1]);
  seq::Sequencer one;
  one.queue(bar("96;0:72,24:9"));  // a strum of one string is a pluck; no kind bit = a pinch
  one.start(120);
  CHECK(one.step() == 8);
  for (int f = 1; f < 25; f++) CHECK(one.step() == 0);
  CHECK(one.step() == 9);
}

static void tempoWaitsForTheBeat() {
  seq::Sequencer s;
  s.queue(bar("96;0:1,24:2,48:4,72:8"));
  s.start(120);  // a beat = 3000 sub-ticks = 25 frames at 120
  for (int f = 0; f < 10; f++) s.step();
  s.setTempo(60);
  for (int f = 10; f < 24; f++) {
    s.step();
    CHECK(s.bpm == 120);
  }
  s.step();
  CHECK(s.bpm == 60);  // frame 24's advance crosses beat 1
  std::vector<std::pair<int, int>> got = run(s, 50);
  CHECK(got.size() == 1 && got[0].first == 0 && got[0].second == 2);  // beat 2 arrives now, then 50 frames
  CHECK(s.step() == 4);
}

static void zeroTempoStopsAtTheBeat() {
  seq::Sequencer s;
  s.queue(bar("96;0:1,24:2,48:4,72:8"));
  s.start(120);
  for (int f = 0; f < 5; f++) s.step();
  s.setTempo(0);
  int f = 5;
  while (s.running && f < 100) {
    s.step();
    f++;
  }
  CHECK(!s.running && s.stoppedByTempo && f == 25);
}

static void edgePlan() {
  servo_out::Group g[6];
  uint32_t w[] = {1500, 1000, 1005, 2400, 1012, 544};
  int n = servo_out::planEdges(w, 6, g);
  CHECK(n == 5);
  CHECK(g[0].at == 544 && g[0].pins == 1 << 5);
  CHECK(g[1].at == 1000 && g[1].end == 1005 && g[1].pins == ((1 << 1) | (1 << 2)));  // 1012 is > 10 us after 1000
  CHECK(g[2].at == 1012 && g[2].pins == 1 << 4);
  CHECK(g[3].at == 1500 && g[4].at == 2400);
  uint32_t same[] = {1500, 1500, 1500, 1500, 1500, 1500};
  CHECK(servo_out::planEdges(same, 6, g) == 1 && g[0].pins == 63);
  // every pin falls in exactly one group, and no group is longer than GROUP_US
  uint32_t r[] = {700, 2300, 1203, 1209, 1214, 900};
  n = servo_out::planEdges(r, 6, g);
  int all = 0;
  for (int i = 0; i < n; i++) {
    CHECK((all & g[i].pins) == 0);
    all |= g[i].pins;
    CHECK(g[i].end - g[i].at <= servo_out::GROUP_US);
    if (i) CHECK(g[i].at > g[i - 1].end);
  }
  CHECK(all == 63);
}

int main(int argc, char** argv) {
  parser();
  startAndStop();
  loopsUntilQueued();
  swapsAtTheBarLine();
  strumRipples();
  tempoWaitsForTheBeat();
  zeroTempoStopsAtTheBeat();
  edgePlan();
  goldenVectors(argc > 1 ? argv[1] : "tests/bar_vectors.json");
  if (failures) {
    std::fprintf(stderr, "sequencer_test: %d failure(s)\n", failures);
    return 1;
  }
  std::printf("sequencer_test: ok\n");
  return 0;
}
