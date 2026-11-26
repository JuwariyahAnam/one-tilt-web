<p align="center"><img src="docs/images/banner.png" alt="One-Tilt Web: browse any website with a tilt of your head"></p>

<p align="center">
  <a href="#try-it-in-2-minutes-no-headband-needed"><b>Try it in 2 minutes</b></a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="docs/hardware.md">Build the headband</a> ·
  <a href="#aws-backend">AWS backend</a> ·
  <a href="https://github.com/JuwariyahAnam/one-tilt-web/archive/refs/heads/main.zip">Download</a>
</p>

<p align="center">
  <a href="https://github.com/JuwariyahAnam/one-tilt-web/actions/workflows/tests.yml"><img src="https://github.com/JuwariyahAnam/one-tilt-web/actions/workflows/tests.yml/badge.svg" alt="tests"></a>
  <img src="https://img.shields.io/badge/wHACKiest_2026-Track_2:_Beyond_the_Browser-F28C28" alt="wHACKiest 2026 Track 2">
  <img src="https://img.shields.io/badge/AWS-Bedrock_·_Lambda_·_SNS_·_DynamoDB-3B2A80" alt="AWS">
  <img src="https://img.shields.io/badge/ElevenLabs-Scribe_·_TTS_·_Voice_cloning-3B2A80" alt="ElevenLabs">
  <img src="https://img.shields.io/badge/license-MIT-555" alt="MIT license">
</p>

**Team Byte By Byte** · Dayananda Sagar Academy of Technology and Management, Bengaluru · Deepankar Anand (Lead) · Juwariyah Anam

## The problem

The web assumes you have hands. About **54 lakh Indians** live with a movement disability (Census of India 2011): cerebral palsy, spinal cord injury, stroke, ALS, severe tremor. Banking, government forms, jobs and classes have all moved online, so every click needs someone else's help. Eye trackers cost ₹1 lakh or more, switch scanning is slow and tiring, voice assistants fail on unclear speech, and screen readers are built for blind users, not for people who can't move.

## Our approach: no cursor, just four big choices

One-Tilt Web is a **₹600 sensor headband** plus a **Chrome extension** that turns **any website into four big choices**. Tilt your head to move between them, nod to choose, look up to speak, and keep looking up for 3 seconds to call for help.

<p align="center"><img src="docs/images/demo.gif" width="880" alt="Demo: booking an appointment hands-free, then playing a song on YouTube with a Hindi voice command"></p>
<p align="center"><sub>Recorded by our automated end-to-end test in Chrome. The Google and YouTube scenes use offline copies of those pages.</sub></p>

### What makes it different

- **No cursor.** Head-mouse tools make users steer a pointer onto tiny targets. One-Tilt removes the pointer: every page becomes four big targets.
- **Any website, no changes needed.** It reads the page as it is. YouTube and Google get extra-smart choices.
- **Works without internet services.** The core runs on-device; Amazon Bedrock and ElevenLabs make it smarter and more natural, not possible.
- **Safe by design.** Submit, pay, send or delete need a second nod. The help alert gives 5 seconds to cancel and sends at most one text a minute.
- **Affordable.** About ₹600 in parts against ₹1 lakh+ for eye trackers.

## Status: working MVP

| Part | What works now | Proof |
| --- | --- | --- |
| **Headband firmware** (Arduino Nano + MPU6050) | Written and tested in software: tilt / nod / look-up / help detection, calibration, drift correction, haptic buzz, backup button, settings saved in EEPROM. The headband itself is not assembled yet. | 18 gesture-engine tests |
| **Chrome extension** | Four-choice overlay on any site, smarter choices on YouTube and Google, forms filled by voice, dropdowns as big choices, confirm before submit, voice commands in English and Hindi, "Speak for me", help alert, read page aloud | 33 end-to-end checks in real Chrome |
| **Side panel** | USB headband connection (Web Serial), live head-position view, calibration and sensitivity, gesture simulator, all settings | Screenshot below |
| **AWS backend** | API Gateway + Lambda (SAM template), Amazon Bedrock ranks choices and understands commands, DynamoDB settings, SNS help texts, ElevenLabs speech, Scribe and voice cloning | 13 handler tests (AWS and ElevenLabs mocked) |

Everything works **on-device with no API keys**. The AWS backend makes the choices smarter and adds natural voices and SMS alerts. Until the headband is assembled, the side panel's simulator buttons and keyboard shortcuts send exactly the same gestures. Next: assemble the headband (about ₹600 of parts) and connect our live AWS and ElevenLabs accounts.

## Try it in 2 minutes (no headband needed)

1. [**Download this repo as a ZIP**](https://github.com/JuwariyahAnam/one-tilt-web/archive/refs/heads/main.zip) and unzip it.
2. In Chrome, open `chrome://extensions`, switch on **Developer mode**, click **Load unpacked** and pick the `extension` folder inside it.
3. A practice page opens. Click the One-Tilt icon in the toolbar (pin it from the puzzle-piece menu) to open the side panel.
4. Move with the **Try it without the headband** buttons, or the keyboard:
   `Alt+Shift+→` next · `Alt+Shift+←` previous · `Alt+Shift+↓` nod (choose) · `Alt+Shift+↑` look up (speak)
5. Book the appointment hands-free, then go to YouTube or Google. Click **Allow microphone** in the side panel once, then "look up" and say *"play Arijit Singh songs"* or *"Arijit Singh ke gaane bajao"*.

With the headband: plug the Nano in, click **Connect headband** in the side panel, keep your head still for a second while it calibrates, and you're in.

| | |
| --- | --- |
| ![YouTube](docs/screenshots/youtube-watch.png) **YouTube:** play/pause, next video and up-next titles as choices | ![Google](docs/screenshots/google-results.png) **Google:** result titles as choices, no menus or legal links |
| ![Listening](docs/screenshots/listening.png) **Look up to speak:** type into fields or give commands | ![Confirm](docs/screenshots/confirm.png) **Safety:** submit, pay, send or delete need a second nod |
| ![Help](docs/screenshots/help.png) **Help alert:** keep looking up for 3 s, with 5 s to cancel | ![Side panel](docs/screenshots/side-panel.png) **Side panel:** headband, live head view, simulator, settings |

## How it works

```mermaid
flowchart LR
  U([User]) -->|tilt, nod, look up| H[Headband<br>Arduino Nano + MPU6050]
  H -->|USB Web Serial| SP[Side panel]
  SP -->|gesture| SW[Service worker]
  SW --> OV[Overlay on the page<br>4 big choices]
  OV -->|click, type, scroll| W[(Any website)]
  SW -->|HTTPS| API[API Gateway + Lambda]
  API --> BR[Amazon Bedrock<br>rank choices, understand commands]
  API --> DB[(DynamoDB<br>user settings)]
  API --> SNS[Amazon SNS<br>help SMS]
  API --> EL[ElevenLabs<br>Scribe, TTS, voice cloning]
  SP -->|buzz| H
```

1. **Headband:** the Nano reads the MPU6050 at 200 Hz, fuses accelerometer and gyroscope into head angles, and a small state machine turns them into `LEFT`, `RIGHT`, `NOD`, `UP` or `HELP`. A gesture only counts if it is held long enough and the head comes back to rest, so shaking or slumping doesn't fire actions.
2. **Side panel:** reads those lines over USB with the Web Serial API and forwards them. It also owns the microphone and ElevenLabs audio.
3. **Overlay:** reads the page (links, buttons, fields, videos), scores them (main content up, menus/ads/legal down) and shows the best four at a time. Every fourth slot is *Scroll down*, *Go back* or *Speak for me*, so those are never far away. A glowing outline shows exactly what will be clicked.
4. **AI (optional):** the labels go to Lambda, where Amazon Bedrock (Converse API with a forced tool call, so the output is always valid JSON) picks the three most useful actions and writes short labels. It also turns spoken commands the on-device rules don't understand into one action.
5. **Output:** the extension clicks, types or scrolls, reads the choice aloud (Chrome voice or ElevenLabs) and the headband buzzes.

## Gestures and voice

| Do this | It does |
| --- | --- |
| Tilt right / left | Next / previous choice |
| Nod | Choose |
| Look up (and back) | Listen for a command, or for text to type |
| Keep looking up 3 s | Help alert countdown (any move cancels) |

Voice commands (English or Hindi): *scroll down / neeche*, *go back / peeche jao*, *play … / … bajao*, *search … / … khojo*, *open …*, *number two*, *read this page / padho*, *say …*, *help / madad*, *stop / ruko*. Anything else goes to Amazon Bedrock when the backend is set up.

## Hardware

About ₹600: Arduino Nano, MPU6050, coin vibration motor, transistor, arcade button and a headband. The firmware needs no extra libraries. Parts list, mounting and flashing steps are in [docs/hardware.md](docs/hardware.md).

<p align="center"><img src="docs/images/wiring.png" width="820" alt="Wiring: MPU6050 to Nano 5V, GND, A4, A5; motor via 2N2222 on D3; button on D2"></p>

## AWS backend

```bash
cd backend
sam build
sam deploy --guided      # asks for ApiKey, ElevenLabsApiKey, BedrockModelId, AlertPhone
```

Then paste the `ApiUrl` output and your API key into the side panel (**AI backend**) and click **Test connection**.

- **Amazon Bedrock:** enable model access for the model you choose (default Claude 3 Haiku) in your region first.
- **Amazon SNS:** add family phone numbers or emails as subscribers to the `HelpTopic`. In India, SMS needs a registered sender, so an email subscription is the quickest way to test.
- **Amazon DynamoDB:** stores each user's settings (thresholds, language, phrases, cloned voice).
- **ElevenLabs:** natural read-out voice (Flash v2.5, Hindi and English), Scribe speech-to-text, and instant voice cloning for "Speak for me". Voice cloning needs a paid ElevenLabs plan.

Run it locally instead: `cd backend && npm start`, then use `http://localhost:8787` as the API URL. Without AWS credentials it uses simple rules instead of Bedrock.

| Endpoint | Service |
| --- | --- |
| `GET /health` | What is configured |
| `POST /choices` | Bedrock ranks the page's choices |
| `POST /command` | Bedrock turns a spoken command into one action |
| `POST /speak` | ElevenLabs text to speech |
| `POST /transcribe` | ElevenLabs Scribe |
| `POST /voice/clone` | ElevenLabs instant voice clone |
| `POST /help` | SNS help alert |
| `GET/PUT /settings` | DynamoDB settings |

## Tests

```bash
# Firmware gesture engine, compiled for your computer (18 checks)
g++ -std=c++11 -o gesture_test firmware/test/gesture_test.cpp && ./gesture_test

# Backend: routes, auth, Bedrock tool output, ElevenLabs and SNS calls (13 tests, no keys needed)
cd backend && npm test

# End to end: loads the extension in Chrome and drives it with gestures (33 checks)
cd tests/e2e && npm install && node run.mjs   # needs Chrome for Testing or Chromium; uses port 443
```

The end-to-end test fills the whole practice form hands-free, uses voice commands, "Speak for me" and the help alert, opens a video on a YouTube-like page, plays a song from a Hindi voice command on a Google-like page, and checks the backend round trip. The screenshots in this README come from that run.

## Privacy

- Only the page address, its title and the **labels** of links, buttons and fields go to the AI, and only when a backend is set up. What the user types or selects, passwords and the page's text are never sent.
- The microphone listens only after the user looks up (or presses *Look up*).
- API keys for AWS and ElevenLabs live in the backend, never in the extension.

## Project structure

```
firmware/one_tilt_headband/   Arduino sketch + gesture engine (gesture.h)
firmware/test/                Host tests for the gesture engine
extension/                    Chrome extension (Manifest V3)
  content/                    Page engine + four-choice overlay
  sidepanel/                  Headband (Web Serial), voice, settings
  pages/                      Practice page, microphone permission
backend/                      AWS SAM app: Lambda handler, Bedrock, ElevenLabs, SNS, DynamoDB
tests/e2e/                    Real-Chrome tests with YouTube/Google-like pages
docs/                         Hardware guide, wiring diagram, demo GIF, screenshots
```

## Roadmap

- Wireless headband (ESP32 + Bluetooth) and an Android app
- More Indian languages (Kannada, Tamil, Bengali)
- Site helpers for banking, government forms and online classes
- Pilots with rehab centres and special schools in Bengaluru

## Team

- **Deepankar Anand** (Lead)
- **Juwariyah Anam**

Licensed under the [MIT License](LICENSE).
