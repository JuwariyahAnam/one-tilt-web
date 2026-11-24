// Host-side tests for the gesture engine (no Arduino needed).
//   g++ -std=c++11 -Wall -Wextra -o gesture_test firmware/test/gesture_test.cpp && ./gesture_test
#include <cstdio>
#include <string>
#include <vector>
#include "../one_tilt_headband/gesture.h"

struct Step { float roll, pitch; uint32_t ms; };  // hold this pose for ms

static std::vector<std::string> run(const std::vector<Step> &steps, GestureConfig cfg = GestureConfig()) {
  GestureEngine g;
  g.cfg = cfg;
  std::vector<std::string> out;
  uint32_t t = 0;
  for (const Step &s : steps) {
    for (uint32_t i = 0; i < s.ms; i += 5, t += 5) {  // 200 Hz like the firmware
      GestureEvent e = g.update(s.roll, s.pitch, t);
      if (e != EV_NONE) out.push_back(gestureName(e));
    }
  }
  return out;
}

static int failures = 0;
static void expect(const char *name, const std::vector<std::string> &got, const std::vector<std::string> &want) {
  bool ok = got == want;
  std::string g, w;
  for (auto &s : got) g += s + " ";
  for (auto &s : want) w += s + " ";
  std::printf("%s %-42s got [%s] want [%s]\n", ok ? "PASS" : "FAIL", name, g.c_str(), w.c_str());
  if (!ok) failures++;
}

int main() {
  expect("still head does nothing", run({{0, 0, 3000}, {3, -2, 2000}}), {});
  expect("tilt right then back = RIGHT", run({{0, 0, 200}, {25, 0, 300}, {0, 0, 300}}), {"RIGHT"});
  expect("tilt left then back = LEFT", run({{0, 0, 200}, {-25, 0, 300}, {0, 0, 300}}), {"LEFT"});
  expect("holding a tilt fires once (no repeat)", run({{25, 0, 3000}, {0, 0, 200}}), {"RIGHT"});
  GestureConfig rep; rep.repeatMs = 700;
  expect("repeat mode fires while held", run({{25, 0, 1600}, {0, 0, 200}}, rep), {"RIGHT", "RIGHT", "RIGHT"});
  expect("twitch shorter than hold time ignored", run({{25, 0, 80}, {0, 0, 300}}), {});
  expect("two tilts = two events", run({{25, 0, 300}, {0, 0, 200}, {25, 0, 300}, {0, 0, 200}}), {"RIGHT", "RIGHT"});
  expect("must re-centre before next tilt", run({{25, 0, 300}, {12, 0, 300}, {25, 0, 300}, {0, 0, 100}}), {"RIGHT"});
  expect("quick nod = NOD", run({{0, 0, 200}, {0, -20, 250}, {0, 0, 300}}), {"NOD"});
  expect("chin resting down is not a nod", run({{0, -20, 2000}, {0, 0, 300}}), {});
  expect("look up and back = UP", run({{0, 0, 100}, {0, 22, 600}, {0, 0, 300}}), {"UP"});
  expect("glance up too short ignored", run({{0, 22, 100}, {0, 0, 300}}), {});
  expect("look up held 3 s = HELP only", run({{0, 22, 3500}, {0, 0, 300}}), {"HELP"});
  expect("diagonal picks stronger axis (tilt)", run({{30, -14, 300}, {0, 0, 300}}), {"RIGHT"});
  expect("diagonal picks stronger axis (nod)", run({{19, -30, 200}, {0, 0, 300}}), {"NOD"});
  expect("full sequence", run({{25, 0, 250}, {0, 0, 200}, {25, 0, 250}, {0, 0, 200}, {-25, 0, 250}, {0, 0, 200},
                               {0, -20, 200}, {0, 0, 300}, {0, 22, 500}, {0, 0, 300}}),
         {"RIGHT", "RIGHT", "LEFT", "NOD", "UP"});
  GestureConfig gentle; gentle.tiltDeg = 10;
  expect("lower threshold for limited movement", run({{13, 0, 300}, {0, 0, 300}}, gentle), {"RIGHT"});
  expect("default threshold ignores small tilt", run({{13, 0, 300}, {0, 0, 300}}), {});

  std::printf("\n%s (%d failed)\n", failures ? "SOME TESTS FAILED" : "ALL TESTS PASSED", failures);
  return failures ? 1 : 0;
}
