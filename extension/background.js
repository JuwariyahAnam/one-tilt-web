// One-Tilt Web - background service worker
// Routes gestures to the active tab, speaks text, and talks to the AWS backend.
importScripts('shared/settings.js');

const CONTENT_FILES = ['shared/settings.js', 'content/engine.js', 'content/overlay.js'];
const GESTURE_FOR_COMMAND = { 'tilt-left': 'LEFT', 'tilt-right': 'RIGHT', nod: 'NOD', 'look-up': 'UP' };

let panelPort = null;   // the side panel (owns the USB headband, microphone and ElevenLabs audio)
let headband = false;
let listenTab = null;   // tab waiting for a voice transcript

// ---------- install ----------
chrome.runtime.onInstalled.addListener(async (details) => {
  const s = await chrome.storage.sync.get(null);
  if (!s.userId) await chrome.storage.sync.set({ userId: 'u-' + crypto.randomUUID().slice(0, 8) });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // Make tabs that were already open work without a reload.
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const t of tabs) inject(t.id);
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('pages/practice.html') });
});

async function inject(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
    return true;
  } catch (e) {
    return false;  // chrome:// pages, the Web Store, PDFs... can't be scripted
  }
}

// ---------- routing ----------
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

const isOwnPage = (url) => !!url && url.startsWith(chrome.runtime.getURL(''));

async function sendToTab(tab, msg) {
  if (!tab) return false;
  if (isOwnPage(tab.url)) {
    // Our practice page is an extension page: it listens for addressed broadcasts.
    chrome.runtime.sendMessage(Object.assign({}, msg, { __tabId: tab.id })).catch(() => {});
    return true;
  }
  try {
    return (await chrome.tabs.sendMessage(tab.id, msg)) || true;
  } catch (e) {
    if (tab.url && /^https?:/.test(tab.url) && (await inject(tab.id))) {
      await new Promise((r) => setTimeout(r, 300));
      try { return (await chrome.tabs.sendMessage(tab.id, msg)) || true; } catch (e2) { /* fall through */ }
    }
    return false;
  }
}

async function gesture(name, source) {
  const tab = await activeTab();
  const ok = await sendToTab(tab, { type: 'gesture', name, source });
  panelPost({ type: 'gesture-result', name, source, ok: !!ok, title: tab && tab.title });
  return !!ok;
}

function panelPost(msg) {
  if (!panelPort) return false;
  try { panelPort.postMessage(msg); return true; } catch (e) { panelPort = null; return false; }
}

chrome.commands.onCommand.addListener((command) => {
  const name = GESTURE_FOR_COMMAND[command];
  if (name) gesture(name, 'keyboard');
});

// ---------- speech ----------
async function speak({ text, kind, lang }) {
  if (!text) return;
  const s = await OneTiltSettings.load();
  const wantEleven = s.backendUrl && (s.voiceOutput === 'elevenlabs' || (kind === 'phrase' && s.cloneVoiceId));
  if (wantEleven && panelPost({ type: 'speak', text, kind, voiceId: kind === 'phrase' ? s.cloneVoiceId : '', lang: lang || s.lang })) return;
  chrome.tts.speak(text, { lang: lang || s.lang, rate: Number(s.speechRate) || 1, enqueue: false });
}

// ---------- backend ----------
async function api(path, body, method = 'POST') {
  const s = await OneTiltSettings.load();
  if (!s.backendUrl) return { ok: false, error: 'No backend set up yet (side panel → AI backend).' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), path === '/choices' ? 7000 : 15000);
  try {
    const res = await fetch(s.backendUrl.replace(/\/+$/, '') + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-api-key': s.apiKey || '' },
      body: method === 'GET' ? undefined : JSON.stringify(Object.assign({ userId: s.userId }, body)),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `Backend error ${res.status}` };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Backend timed out' : 'Backend unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

async function sendHelp(payload) {
  const s = await OneTiltSettings.load();
  const res = await api('/help', Object.assign({ contactName: s.contactName }, payload));
  panelPost({ type: 'log', level: res.ok ? 'ok' : 'warn', text: res.ok ? 'Help alert sent by SMS' : `Help alert not sent: ${res.error}` });
  return res;
}

// ---------- messages from pages ----------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.__tabId) return;  // ignore our own addressed broadcasts
  switch (msg.type) {
    case 'say': speak(msg); reply({ ok: true }); return;
    case 'stop-speaking': chrome.tts.stop(); panelPost({ type: 'stop-audio' }); reply({ ok: true }); return;
    case 'buzz': reply({ ok: panelPost({ type: 'buzz', pattern: msg.pattern }) }); return;
    case 'listen':
      if (panelPost({ type: 'listen', lang: msg.lang })) { listenTab = sender.tab; reply({ ok: true }); } else reply({ ok: false });
      return;
    case 'listen-cancel': panelPost({ type: 'listen-cancel' }); listenTab = null; reply({ ok: true }); return;
    case 'status': reply({ headband, panel: !!panelPort }); return;
    case 'gesture': gesture(msg.name, msg.source || 'page').then((ok) => reply({ ok })); return true;
    case 'ai-choices': api('/choices', msg.payload).then(reply); return true;
    case 'ai-command': api('/command', msg.payload).then(reply); return true;
    case 'help': sendHelp(msg.payload).then(reply); return true;
    default: return;
  }
});

// ---------- the side panel ----------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;
  panelPort = port;
  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'gesture') gesture(msg.name, msg.source);
    else if (msg.type === 'transcript') {
      if (listenTab) sendToTab(listenTab, { type: 'transcript', text: msg.text, interim: msg.interim, error: msg.error });
      if (!msg.interim) listenTab = null;
    } else if (msg.type === 'headband') {
      headband = !!msg.connected;
      const tab = await activeTab();
      sendToTab(tab, { type: 'headband', connected: headband });
    } else if (msg.type === 'api') {
      const res = await api(msg.path, msg.body, msg.method);
      panelPost({ type: 'api-result', id: msg.id, res });
    }
  });
  port.onDisconnect.addListener(() => {
    if (panelPort === port) { panelPort = null; headband = false; }
  });
});

// Tell newly focused tabs whether the headband is connected.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!headband) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) sendToTab(tab, { type: 'headband', connected: true });
});
