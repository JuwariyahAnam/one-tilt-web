// One-Tilt Web - headband firmware
// Board : Arduino Nano (ATmega328P)          Sensor : MPU6050 (I2C)
//
// Wiring
//   MPU6050 VCC -> 5V      GND -> GND      SDA -> A4      SCL -> A5
//   Vibration motor via NPN transistor (2N2222 + 1k base resistor + flyback diode) -> D3
//   Arcade button (backup switch) -> D2 and GND (internal pull-up)
//
// Serial protocol, 115200 baud, one line per message
//   Device -> browser : HELLO OneTilt <version>
//                       LEFT | RIGHT | NOD | UP | HELP   (optionally followed by " BTN")
//                       A,<roll>,<pitch>                  (live angles when streaming is on)
//                       OK <what> | ERR <why> | CFG ...
//   Browser -> device : C            calibrate neutral pose (keep head still ~1 s)
//                       B1 | B2 | B3 buzz: short tick, double, long
//                       V1 | V0      live angle stream on/off
//                       S,<tilt>,<nod>,<look>   thresholds in degrees
//                       O,<swap>,<invRoll>,<invPitch>  how the sensor is mounted (0/1 each)
//                       P            ping (answers PONG)       ?  print config
//
// Settings are kept in EEPROM, so a caregiver only has to tune them once.

#include <Wire.h>
#include <EEPROM.h>
#include <math.h>
#include "gesture.h"

#define FW_VERSION "1.0"

const uint8_t MPU_ADDR = 0x68;
const uint8_t PIN_BUTTON = 2;
const uint8_t PIN_MOTOR = 3;
const uint8_t PIN_LED = 13;

const uint16_t SAMPLE_US = 5000;        // 200 Hz
const float GYRO_WEIGHT = 0.96f;         // complementary filter
const float RAD2DEG = 57.2957795f;
const uint16_t LONG_PRESS_MS = 600;

struct Settings {
  uint8_t magic;
  float tiltDeg, nodDeg, lookDeg;
  uint8_t swapAxes, invRoll, invPitch;
};
const uint8_t SETTINGS_MAGIC = 0x5A;

Settings settings;
GestureEngine engine;

float roll = 0, pitch = 0;               // filtered absolute angles
float neutralRoll = 0, neutralPitch = 0;
float gyroBiasX = 0, gyroBiasY = 0;
bool streamAngles = false;
bool sensorOk = false;
uint32_t lastSampleUs = 0, lastStreamMs = 0;

// ---------- MPU6050 ----------
void mpuWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}

uint8_t mpuReadByte(uint8_t reg) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return 0xFF;
  if (Wire.requestFrom(MPU_ADDR, (uint8_t)1) != 1) return 0xFF;
  return Wire.read();
}

// Two separate statements so the high byte is always read first.
int16_t read16() {
  uint8_t hi = Wire.read();
  uint8_t lo = Wire.read();
  return (int16_t)(((uint16_t)hi << 8) | lo);
}

bool mpuReadRaw(int16_t &ax, int16_t &ay, int16_t &az, int16_t &gx, int16_t &gy) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU_ADDR, (uint8_t)14) != 14) return false;
  ax = read16();
  ay = read16();
  az = read16();
  read16();                              // temperature
  gx = read16();
  gy = read16();
  read16();                              // gz (unused)
  return true;
}

bool mpuInit() {
  mpuWrite(0x6B, 0x00);  // wake up
  delay(50);
  mpuWrite(0x1A, 0x03);  // digital low-pass filter ~44 Hz
  mpuWrite(0x1B, 0x00);  // gyro +-250 deg/s  (131 LSB per deg/s)
  mpuWrite(0x1C, 0x00);  // accel +-2 g
  uint8_t who = mpuReadByte(0x75);
  // Genuine parts answer 0x68; common clones answer 0x70, 0x72 or 0x98.
  return who == 0x68 || who == 0x70 || who == 0x72 || who == 0x98;
}

// Accelerometer-only angles. Recommended mounting: module flat on top of the band,
// chip side up, the printed X arrow pointing forward (towards the face). Then
//   roll  > 0 when the right ear goes down, pitch < 0 when the chin goes down.
// Other mountings are fixed from the side panel (swap / flip), no re-flashing.
void accelAngles(int16_t ax, int16_t ay, int16_t az, float &r, float &p) {
  r = atan2((float)ay, (float)az) * RAD2DEG;
  p = atan2((float)ax, sqrt((float)ay * ay + (float)az * az)) * RAD2DEG;
}

// ---------- buzzer (non-blocking) ----------
uint8_t buzzSteps = 0;      // remaining on/off steps
uint16_t buzzOnMs = 0, buzzOffMs = 0;
uint32_t buzzNextMs = 0;
bool buzzOn = false;

void buzz(uint8_t pulses, uint16_t onMs, uint16_t offMs) {
  buzzSteps = pulses * 2;
  buzzOnMs = onMs;
  buzzOffMs = offMs;
  buzzNextMs = millis();
}

void serviceBuzzer() {
  if (!buzzSteps || (int32_t)(millis() - buzzNextMs) < 0) return;
  buzzOn = !buzzOn;
  digitalWrite(PIN_MOTOR, buzzOn ? HIGH : LOW);
  digitalWrite(PIN_LED, buzzOn ? HIGH : LOW);
  buzzNextMs = millis() + (buzzOn ? buzzOnMs : buzzOffMs);
  buzzSteps--;
  if (!buzzSteps) {
    buzzOn = false;
    digitalWrite(PIN_MOTOR, LOW);
    digitalWrite(PIN_LED, LOW);
  }
}

// ---------- settings ----------
void applySettings() {
  engine.cfg.tiltDeg = settings.tiltDeg;
  engine.cfg.nodDeg = settings.nodDeg;
  engine.cfg.lookDeg = settings.lookDeg;
}

void loadSettings() {
  EEPROM.get(0, settings);
  if (settings.magic != SETTINGS_MAGIC || !(settings.tiltDeg > 3 && settings.tiltDeg < 60)) {
    settings.magic = SETTINGS_MAGIC;
    settings.tiltDeg = 18;
    settings.nodDeg = 12;
    settings.lookDeg = 15;
    settings.swapAxes = 0;
    settings.invRoll = 0;
    settings.invPitch = 0;
  }
  applySettings();
}

void saveSettings() { EEPROM.put(0, settings); }

void printConfig() {
  Serial.print(F("CFG tilt=")); Serial.print(settings.tiltDeg, 1);
  Serial.print(F(" nod=")); Serial.print(settings.nodDeg, 1);
  Serial.print(F(" look=")); Serial.print(settings.lookDeg, 1);
  Serial.print(F(" swap=")); Serial.print(settings.swapAxes);
  Serial.print(F(" invRoll=")); Serial.print(settings.invRoll);
  Serial.print(F(" invPitch=")); Serial.print(settings.invPitch);
  Serial.print(F(" sensor=")); Serial.println(sensorOk ? F("ok") : F("missing"));
}

// ---------- calibration ----------
void calibrate() {
  if (!sensorOk) { Serial.println(F("ERR sensor not found")); return; }
  const uint16_t N = 200;
  float sumR = 0, sumP = 0, sumGx = 0, sumGy = 0;
  uint16_t got = 0;
  for (uint16_t i = 0; i < N; i++) {
    int16_t ax, ay, az, gx, gy;
    if (mpuReadRaw(ax, ay, az, gx, gy)) {
      float r, p;
      accelAngles(ax, ay, az, r, p);
      sumR += r; sumP += p; sumGx += gx; sumGy += gy;
      got++;
    }
    delay(4);
  }
  if (!got) { Serial.println(F("ERR calibration read failed")); return; }
  roll = sumR / got;
  pitch = sumP / got;
  gyroBiasX = sumGx / got;
  gyroBiasY = sumGy / got;
  neutralRoll = roll;
  neutralPitch = pitch;
  engine.reset();
  Serial.println(F("OK calibrated"));
  buzz(2, 60, 80);
}

// ---------- serial commands ----------
char lineBuf[40];
uint8_t lineLen = 0;

void handleCommand(char *cmd) {
  switch (cmd[0]) {
    case 'C': calibrate(); break;
    case 'B':
      if (cmd[1] == '2') buzz(2, 70, 90);
      else if (cmd[1] == '3') buzz(1, 450, 0);
      else buzz(1, 60, 0);
      break;
    case 'V': streamAngles = cmd[1] == '1'; Serial.println(streamAngles ? F("OK stream on") : F("OK stream off")); break;
    case 'S': {
      float t, n, l;
      char *p = cmd + 2;
      t = atof(p); p = strchr(p, ','); if (!p) break;
      n = atof(++p); p = strchr(p, ','); if (!p) break;
      l = atof(++p);
      if (t < 5 || t > 45 || n < 5 || n > 45 || l < 5 || l > 45) { Serial.println(F("ERR range 5-45")); break; }
      settings.tiltDeg = t; settings.nodDeg = n; settings.lookDeg = l;
      applySettings(); saveSettings(); printConfig();
      break;
    }
    case 'O': {
      // O,<swap>,<invRoll>,<invPitch>
      if (strlen(cmd) < 7) { Serial.println(F("ERR use O,s,r,p")); break; }
      settings.swapAxes = cmd[2] == '1';
      settings.invRoll = cmd[4] == '1';
      settings.invPitch = cmd[6] == '1';
      saveSettings(); printConfig();
      break;
    }
    case 'P': Serial.println(F("PONG")); break;
    case '?': printConfig(); break;
    default: Serial.println(F("ERR unknown command"));
  }
}

void readSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (lineLen) { lineBuf[lineLen] = 0; handleCommand(lineBuf); lineLen = 0; }
    } else if (lineLen < sizeof(lineBuf) - 1) {
      lineBuf[lineLen++] = c;
    }
  }
}

// ---------- backup button ----------
bool btnDown = false, btnLongSent = false;
uint32_t btnSince = 0, btnChangeMs = 0;

void serviceButton() {
  bool pressed = digitalRead(PIN_BUTTON) == LOW;
  uint32_t now = millis();
  if (pressed != btnDown && now - btnChangeMs > 25) {  // debounce
    btnChangeMs = now;
    btnDown = pressed;
    if (pressed) { btnSince = now; btnLongSent = false; }
    else if (!btnLongSent) { Serial.println(F("RIGHT BTN")); buzz(1, 30, 0); }  // short press = next
  }
  if (btnDown && !btnLongSent && now - btnSince >= LONG_PRESS_MS) {
    btnLongSent = true;
    Serial.println(F("NOD BTN"));                                               // long press = select
    buzz(1, 30, 0);
  }
}

// ---------- main ----------
void setup() {
  pinMode(PIN_MOTOR, OUTPUT);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  Serial.begin(115200);
  Wire.begin();
  Wire.setClock(400000);
#if defined(WIRE_HAS_TIMEOUT)
  Wire.setWireTimeout(3000, true);  // never hang if a wire comes loose
#endif
  loadSettings();
  sensorOk = mpuInit();
  Serial.print(F("HELLO OneTilt ")); Serial.println(F(FW_VERSION));
  if (!sensorOk) Serial.println(F("ERR MPU6050 not found - check SDA/A4 and SCL/A5"));
  calibrate();
  lastSampleUs = micros();
}

void loop() {
  readSerial();
  serviceButton();
  serviceBuzzer();
  if (!sensorOk) return;

  uint32_t nowUs = micros();
  if (nowUs - lastSampleUs < SAMPLE_US) return;
  float dt = (nowUs - lastSampleUs) * 1e-6f;
  lastSampleUs = nowUs;

  int16_t ax, ay, az, gx, gy;
  if (!mpuReadRaw(ax, ay, az, gx, gy)) return;

  float accRoll, accPitch;
  accelAngles(ax, ay, az, accRoll, accPitch);
  float rateRoll = (gx - gyroBiasX) / 131.0f;
  float ratePitch = -(gy - gyroBiasY) / 131.0f;  // same sign as the accelerometer pitch
  roll = GYRO_WEIGHT * (roll + rateRoll * dt) + (1 - GYRO_WEIGHT) * accRoll;
  pitch = GYRO_WEIGHT * (pitch + ratePitch * dt) + (1 - GYRO_WEIGHT) * accPitch;

  float r = roll - neutralRoll;
  float p = pitch - neutralPitch;
  if (settings.swapAxes) { float t = r; r = p; p = t; }
  if (settings.invRoll) r = -r;
  if (settings.invPitch) p = -p;

  // Very slow re-centring while the head rests, so sensor drift and slumping
  // over a long session don't trigger gestures on their own.
  if (engine.isResting() && fabs(r) < engine.cfg.rearmDeg && fabs(p) < engine.cfg.rearmDeg) {
    neutralRoll += (roll - neutralRoll) * 0.0005f;
    neutralPitch += (pitch - neutralPitch) * 0.0005f;
  }

  uint32_t now = millis();
  GestureEvent ev = engine.update(r, p, now);
  if (ev != EV_NONE) {
    Serial.println(gestureName(ev));
    if (ev == EV_HELP) buzz(3, 120, 100);
    else buzz(1, 25, 0);  // tiny tick so the user feels the gesture registered
  }

  if (streamAngles && now - lastStreamMs >= 50) {
    lastStreamMs = now;
    Serial.print(F("A,")); Serial.print(r, 1); Serial.print(','); Serial.println(p, 1);
  }
}
