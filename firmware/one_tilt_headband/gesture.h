// One-Tilt Web - gesture engine
// Turns head angles (degrees, relative to the user's calibrated neutral pose)
// into a small set of events. Pure C++ with no Arduino dependencies, so the
// same file runs on the Nano and in the host unit tests (firmware/test).
//
//   roll  > 0 : head tilted to the user's right
//   pitch < 0 : head tilted down (chin to chest)
//   pitch > 0 : head tilted up (looking at the ceiling)
//
// Events
//   RIGHT / LEFT : tilt held past the threshold for tiltHoldMs (move highlight)
//   NOD          : quick down-and-back within nodMaxMs (select)
//   UP           : look up, then come back (start voice input)
//   HELP         : keep looking up for helpHoldMs (help alert)
#ifndef ONE_TILT_GESTURE_H
#define ONE_TILT_GESTURE_H

#include <stdint.h>

enum GestureEvent : uint8_t { EV_NONE = 0, EV_LEFT, EV_RIGHT, EV_NOD, EV_UP, EV_HELP };

inline const char *gestureName(GestureEvent e) {
  switch (e) {
    case EV_LEFT: return "LEFT";
    case EV_RIGHT: return "RIGHT";
    case EV_NOD: return "NOD";
    case EV_UP: return "UP";
    case EV_HELP: return "HELP";
    default: return "NONE";
  }
}

struct GestureConfig {
  float tiltDeg;         // roll needed for LEFT/RIGHT
  float nodDeg;          // pitch down needed for NOD
  float lookDeg;         // pitch up needed for UP/HELP
  float rearmDeg;        // head must return within this to re-arm
  uint16_t tiltHoldMs;   // tilt must be held this long (filters twitches)
  uint16_t nodMinMs;     // nod shorter than this is treated as noise
  uint16_t nodMaxMs;     // nod must come back within this
  uint16_t lookMinMs;    // look-up must be held at least this long
  uint16_t helpHoldMs;   // look-up held this long = HELP
  uint16_t repeatMs;     // 0 = no auto-repeat while a tilt is held

  GestureConfig()
      : tiltDeg(18), nodDeg(12), lookDeg(15), rearmDeg(7), tiltHoldMs(120), nodMinMs(60),
        nodMaxMs(900), lookMinMs(250), helpHoldMs(3000), repeatMs(0) {}
};

class GestureEngine {
 public:
  GestureConfig cfg;

  GestureEngine() : state_(IDLE), t0_(0), lastFire_(0), fired_(false) {}

  void reset() { state_ = WAIT_NEUTRAL; fired_ = false; }

  // True when the head is resting near neutral (used for slow drift correction).
  bool isResting() const { return state_ == IDLE; }

  GestureEvent update(float roll, float pitch, uint32_t now) {
    const float ar = roll < 0 ? -roll : roll;
    const float ap = pitch < 0 ? -pitch : pitch;
    switch (state_) {
      case IDLE: {
        // Pick the axis that is furthest past its own threshold.
        float tiltExcess = ar - cfg.tiltDeg;
        float downExcess = -pitch - cfg.nodDeg;
        float upExcess = pitch - cfg.lookDeg;
        if (tiltExcess <= 0 && downExcess <= 0 && upExcess <= 0) return EV_NONE;
        t0_ = now;
        fired_ = false;
        if (tiltExcess >= downExcess && tiltExcess >= upExcess) {
          state_ = roll > 0 ? TILT_RIGHT : TILT_LEFT;
        } else if (downExcess >= upExcess) {
          state_ = NOD_DOWN;
        } else {
          state_ = LOOK_UP;
        }
        return EV_NONE;
      }

      case TILT_LEFT:
      case TILT_RIGHT: {
        const bool right = state_ == TILT_RIGHT;
        const bool held = right ? roll > cfg.tiltDeg - 3 : roll < -(cfg.tiltDeg - 3);
        if (held) {
          if (!fired_ && now - t0_ >= cfg.tiltHoldMs) {
            fired_ = true;
            lastFire_ = now;
            return right ? EV_RIGHT : EV_LEFT;
          }
          if (fired_ && cfg.repeatMs && now - lastFire_ >= cfg.repeatMs) {
            lastFire_ = now;
            return right ? EV_RIGHT : EV_LEFT;
          }
          return EV_NONE;
        }
        if (ar < cfg.rearmDeg && ap < cfg.rearmDeg) state_ = IDLE;
        else state_ = WAIT_NEUTRAL;
        return EV_NONE;
      }

      case NOD_DOWN: {
        const uint32_t dt = now - t0_;
        if (pitch > -cfg.rearmDeg) {  // came back up
          state_ = (ar < cfg.rearmDeg) ? IDLE : WAIT_NEUTRAL;
          if (dt >= cfg.nodMinMs && dt <= cfg.nodMaxMs) return EV_NOD;
          return EV_NONE;
        }
        if (dt > cfg.nodMaxMs) state_ = WAIT_NEUTRAL;  // resting chin down, not a nod
        return EV_NONE;
      }

      case LOOK_UP: {
        const uint32_t dt = now - t0_;
        if (pitch > cfg.lookDeg - 3) {
          if (!fired_ && dt >= cfg.helpHoldMs) {
            fired_ = true;
            return EV_HELP;
          }
          return EV_NONE;
        }
        if (pitch < cfg.rearmDeg) {  // came back
          state_ = (ar < cfg.rearmDeg) ? IDLE : WAIT_NEUTRAL;
          if (!fired_ && dt >= cfg.lookMinMs) return EV_UP;
          return EV_NONE;
        }
        return EV_NONE;  // in between: keep waiting
      }

      case WAIT_NEUTRAL:
      default:
        if (ar < cfg.rearmDeg && ap < cfg.rearmDeg) state_ = IDLE;
        return EV_NONE;
    }
  }

 private:
  enum State : uint8_t { IDLE, TILT_LEFT, TILT_RIGHT, NOD_DOWN, LOOK_UP, WAIT_NEUTRAL };
  State state_;
  uint32_t t0_, lastFire_;
  bool fired_;
};

#endif
