# One-Tilt Web

**Browse any website with a tilt of your head. No hands, no mouse, no keyboard.**

wHACKiest 2026 · Track 2 (T-2): Beyond the Browser
Team Byte By Byte · Dayananda Sagar Academy of Technology and Management, Bengaluru
Deepankar Anand (Lead) · Juwariyah Anam

> **Status: ideathon blueprint.** In line with the ideathon's no-code rule, this repository holds the plan only. Code will be added during the hackathon build.

## The problem

The web assumes you have hands. Around 54 lakh Indians live with a movement disability (Census of India 2011), including people with cerebral palsy, spinal cord injury, stroke, ALS or severe tremor. Banking, government forms, jobs and classes are all online, so every click needs someone else's help.

Existing tools don't fit: eye trackers are imported and costly, switch scanning is slow and tiring, voice assistants fail on unclear speech and multi-step tasks, and screen readers are built for blind users rather than people who can't move.

## The solution

A low-cost sensor headband plus an AI browser agent. The AI turns any website into four big choices and reads them aloud. The user tilts their head to move, nods to pick, and the agent does the clicking and typing.

### Key features

- **Head-tilt control:** tilt to move, nod to select, look up to speak
- **AI page simplifier:** any page becomes four big choices, read aloud
- **Voice shortcut:** speak a command in Hindi or English (ElevenLabs)
- **Speak for me:** pick a phrase and hear it in the user's own cloned voice (ElevenLabs)
- **Help alert:** hold a look-up for 3 seconds to text family (Amazon SNS)
- **Buzz + backup switch:** a buzz confirms each pick; one-button mode if needed

## How it works

1. **Input:** the user tilts, nods or speaks.
2. **Headband:** an Arduino Nano reads an MPU6050 motion sensor and detects the gesture.
3. **Chrome extension:** reads the Nano over USB with the Web Serial API and sends the page and command to the backend.
4. **AWS backend:** Lambda calls an LLM on Amazon Bedrock, which returns four choices and the click or typing action.
5. **Output:** ElevenLabs reads the choices aloud, the extension acts on the website, and the headband buzzes to confirm.

## Tech stack

| Layer | Tools |
| --- | --- |
| Hardware | Arduino Nano, MPU6050, vibration motor, arcade button (under ₹600 in parts) |
| Firmware | Arduino C++ |
| Frontend | Chrome extension (Manifest V3, JavaScript), Web Serial API |
| Backend / cloud | AWS Lambda, Amazon API Gateway, Amazon SNS |
| AI | LLM on Amazon Bedrock |
| Voice | ElevenLabs Scribe (speech to text), text to speech, voice cloning |
| Data | Amazon DynamoDB, Chrome storage |
| Fallback | Chrome's built-in speech recognition and voice |

## Hackathon MVP (24 hours)

- Working headband with tilt, nod and look-up detection
- Chrome extension with the four-choice overlay
- AI agent completing real tasks on YouTube, Google Search and a simple form
- ElevenLabs voice in and out, Speak for me and the help alert

## Links

- Presentation: [add your Google Drive link]
- Video pitch: [add your YouTube link]
