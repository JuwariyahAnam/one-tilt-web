// Shared defaults for the background worker, side panel, content script and practice page.
(function (root) {
  const DEFAULTS = {
    active: true,            // show the four-choice overlay on web pages
    readAloud: true,         // speak each choice when it is highlighted
    lang: 'en-IN',           // speech language: en-IN or hi-IN
    speechRate: 1.05,
    voiceOutput: 'chrome',   // 'chrome' (built in) or 'elevenlabs' (via backend)
    speechInput: 'browser',  // 'browser' (Chrome speech) or 'elevenlabs' (Scribe via backend)
    backendUrl: '',          // e.g. https://abc123.execute-api.ap-south-1.amazonaws.com
    apiKey: '',
    useAI: true,             // ask Amazon Bedrock to rank choices when a backend is set
    cloneVoiceId: '',        // ElevenLabs voice id for "Speak for me"
    contactName: 'my family',
    helpCountdown: 5,
    userId: '',
    phrases: [
      'Yes',
      'No',
      'Thank you',
      'I need water',
      'I am in pain',
      'Please call my family',
      'Please adjust my position',
      'I want to rest now',
    ],
  };

  async function load() {
    const stored = await chrome.storage.sync.get(null);
    return Object.assign({}, DEFAULTS, stored);
  }

  root.OneTiltSettings = { DEFAULTS, load };
})(typeof self !== 'undefined' ? self : this);
