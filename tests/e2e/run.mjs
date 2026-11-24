// End-to-end test: loads the real extension in Chrome and drives it with gestures.
//
//   cd tests/e2e && npm install && node run.mjs
//   (env CHROME=/path/to/chrome to choose the browser; needs a Chrome that allows --load-extension,
//    e.g. Chrome for Testing or Chromium. Port 443 is used for the fake YouTube/Google pages,
//    so run as admin/root or set FIXTURE_PORT and keep the MAP rule below in sync.)
//
// What it checks
//   - practice page: fill a whole form hands-free (type by voice, pick options, radio, checkbox, confirm submit)
//   - voice commands, help alert (cancel + send), "Speak for me"
//   - YouTube-like and Google-like pages: the right four choices, open a video, "play ..." voice command
//   - the AWS backend round trip (local server)
// Screenshots go to docs/screenshots.
import { spawn, execFileSync } from 'node:child_process';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const ext = path.join(root, 'extension');
const shots = path.join(root, 'docs/screenshots');
fs.mkdirSync(shots, { recursive: true });
const PORT = Number(process.env.FIXTURE_PORT || 443);
const API_KEY = 'e2e-test-key-123456';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
  if (!ok) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- fake youtube.com / google.com over HTTPS ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'onetilt-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
  '-keyout', path.join(tmp, 'key.pem'), '-out', path.join(tmp, 'cert.pem')], { stdio: 'ignore' });
const fixture = (f) => fs.readFileSync(path.join(here, 'fixtures', f));
const server = https.createServer({ key: fs.readFileSync(path.join(tmp, 'key.pem')), cert: fs.readFileSync(path.join(tmp, 'cert.pem')) }, (req, res) => {
  const host = (req.headers.host || '').split(':')[0];
  const p = new URL(req.url, 'https://x').pathname;
  let file = null;
  if (host.endsWith('youtube.com')) file = p === '/watch' ? 'youtube-watch.html' : 'youtube-results.html';
  if (host.endsWith('google.com')) file = 'google-search.html';
  if (!file) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(fixture(file));
});
await new Promise((r) => server.listen(PORT, r));

// ---------- the backend, locally ----------
const BACKEND_PORT = String(18000 + Math.floor(Math.random() * 2000));
const backend = spawn(process.execPath, [path.join(root, 'backend/local-server.mjs')], {
  env: Object.assign({}, process.env, { PORT: BACKEND_PORT, API_KEY, AI_MODE: 'off' }), stdio: ['ignore', 'pipe', 'pipe'],
});
process.on('exit', () => backend.kill());
const backendLog = [];
backend.stdout.on('data', (d) => backendLog.push(...String(d).trim().split('\n')));
await sleep(600);

// ---------- Chrome with the extension ----------
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'onetilt-profile-')), {
  executablePath: process.env.CHROME || undefined,
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: [
    '--headless=new', '--no-sandbox', '--ignore-certificate-errors', '--no-proxy-server',
    `--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
    `--host-resolver-rules=MAP www.youtube.com 127.0.0.1:${PORT}, MAP www.google.com 127.0.0.1:${PORT}`,
  ],
});
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
const extId = sw.url().split('/')[2];
await sleep(1200);

// A stand-in for the side panel (so voice requests have somewhere to go).
const panel = await ctx.newPage();
await panel.goto(`chrome-extension://${extId}/pages/mic.html`);
await panel.evaluate(() => { window.__port = chrome.runtime.connect({ name: 'sidepanel' }); });

let page = ctx.pages().find((p) => p.url().includes('practice.html'));
if (!page) { page = await ctx.newPage(); await page.goto(`chrome-extension://${extId}/pages/practice.html`); }
const pageErrors = [];
const watch = (p) => p.on('pageerror', (e) => pageErrors.push(e.message));
watch(page);
await page.bringToFront();
await sleep(1200);

// ---------- helpers ----------
const ui = (p = page) => p.evaluate(() => {
  const r = document.getElementById('onetilt-root');
  if (!r) return null;
  const s = r.shadowRoot;
  const cards = Array.from(s.querySelectorAll('.ot-card')).filter((c) => !c.classList.contains('empty'));
  return {
    cards: cards.map((c) => c.querySelector('.ot-label').textContent),
    on: (cards.find((c) => c.classList.contains('on')) || { querySelector: () => ({ textContent: '' }) }).querySelector('.ot-label').textContent,
    modal: s.querySelector('.ot-modal-bg').classList.contains('show') ? s.querySelector('.ot-modal').innerText : '',
    toast: s.querySelector('.ot-toast').textContent,
    badge: s.querySelector('.ot-badge').textContent,
  };
});
const gesture = async (name, wait = 350) => { await sw.evaluate((n) => gesture(n, 'test'), name); await sleep(wait); };
const say = async (text, wait = 600) => {
  await sw.evaluate(async (t) => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return sendToTab(tab, { type: 'transcript', text: t });
  }, text);
  await sleep(wait);
};
// Tilt right until the highlighted choice is `label` (exact, or containing it when partial).
async function goTo(label, partial = false, p = page) {
  for (let i = 0; i < 40; i++) {
    const s = await ui(p);
    const on = s ? s.on.toLowerCase() : '';
    if (partial ? on.includes(label.toLowerCase()) : on === label.toLowerCase()) return true;
    await gesture('RIGHT', 120);
  }
  return false;
}

// ---------- 1. practice page: a whole form, hands-free ----------
let s = await ui();
check('overlay shows four choices on the practice page', s && s.cards.length === 4, JSON.stringify(s && s.cards));
check('first choice is the first form field', s && s.on === 'Your name', s && s.on);
await page.screenshot({ path: path.join(shots, 'practice-overlay.png') });

await gesture('NOD');
s = await ui();
check('nod on a text field starts listening', /Listening/.test(s.modal), s.modal.slice(0, 40));
await page.screenshot({ path: path.join(shots, 'listening.png') });
await say('Ravi Kumar');
check('spoken text is typed into the field', (await page.inputValue('input[name=name]')) === 'Ravi Kumar');
s = await ui();
check('highlight moves on to the next field', s.on === 'Phone number', s.on);
await gesture('NOD');
await say('98765 43210');
check('phone typed by voice', (await page.inputValue('input[name=phone]')) === '98765 43210');

check('reach the Doctor dropdown', await goTo('Doctor'));
await gesture('NOD');
s = await ui();
check('dropdown opens as big choices', s.cards[0] === 'Back' && s.cards.some((c) => c.includes('Asha Rao')), JSON.stringify(s.cards));
await gesture('RIGHT');
await gesture('NOD');
check('option picked with a nod', (await page.inputValue('select[name=doctor]')).includes('Imran Khan'));

check('reach the Day dropdown', await goTo('Day'));
await gesture('NOD'); await gesture('RIGHT'); await gesture('NOD');
check('day picked', (await page.inputValue('select[name=day]')) === 'Tomorrow');

check('reach the Morning option', await goTo('Morning'));
await gesture('NOD');
check('radio button chosen', await page.isChecked('input[value=Morning]'));

check('reach the SMS checkbox', await goTo('SMS reminder', true));
await gesture('NOD');
check('checkbox ticked', await page.isChecked('input[name=sms]'));

check('reach the Book button', await goTo('Book appointment'));
await gesture('NOD');
s = await ui();
check('submitting asks for a second nod', /Nod again/.test(s.modal), s.modal.slice(0, 60));
await page.screenshot({ path: path.join(shots, 'confirm.png') });
await gesture('NOD', 700);
const done = await page.textContent('#done');
check('form submitted after confirming', /Ravi Kumar/.test(done) && /Imran Khan/.test(done) && /tomorrow/.test(done), done);
await page.screenshot({ path: path.join(shots, 'practice-booked.png') });

// ---------- 2. voice command, speak for me, help ----------
await page.evaluate(() => scrollTo(0, 0));
await gesture('UP');
await say('scroll down', 1100);
check('voice command “scroll down” scrolls the page', (await page.evaluate(() => scrollY)) > 100);

check('reach Speak for me', await goTo('Speak for me'));
await gesture('NOD');
s = await ui();
check('phrase board opens', s.cards.includes('Yes') || s.cards.includes('No'), JSON.stringify(s.cards));
await gesture('NOD', 400);
s = await ui();
check('phrase is spoken', /Speaking/.test(s.toast), s.toast);
await gesture('LEFT'); await gesture('NOD');

await gesture('HELP', 600);
s = await ui();
check('looking up for 3 s starts a help countdown', /help alert/i.test(s.modal), s.modal.slice(0, 50));
await page.screenshot({ path: path.join(shots, 'help.png') });
await gesture('RIGHT', 500);
s = await ui();
check('any head move cancels the alert', s.modal === '' && /cancelled/i.test(s.toast), s.toast);

// ---------- 3. YouTube-like page ----------
const yt = await ctx.newPage();
watch(yt);
await yt.goto('https://www.youtube.com/results?search_query=arijit+singh+songs');
await sleep(1800);
s = await ui(yt);
check('YouTube results: videos come first', s && /Tum Hi Ho/.test(s.cards[0]), JSON.stringify(s && s.cards));
check('YouTube results: no sign-in or privacy junk in first four', s && !s.cards.some((c) => /privacy|sign in|terms/i.test(c)));
await yt.screenshot({ path: path.join(shots, 'youtube-results.png') });
await gesture('NOD', 2200);
check('nod opens the video', yt.url().includes('/watch?v=aaa111'), yt.url());
s = await ui(yt);
check('watch page offers play/pause and next video', s && /Play video|Pause video/.test(s.cards[0]) && s.cards.includes('Next video'), JSON.stringify(s && s.cards));
await yt.screenshot({ path: path.join(shots, 'youtube-watch.png') });

// ---------- 4. Google-like page + "play ..." command ----------
const gg = await ctx.newPage();
watch(gg);
await gg.goto('https://www.google.com/search?q=weather+bengaluru');
await sleep(1800);
s = await ui(gg);
check('Google results: result titles are the choices', s && /AccuWeather/.test(s.cards[0]) && !s.cards.some((c) => /Privacy|feedback/i.test(c)), JSON.stringify(s && s.cards));
await gg.screenshot({ path: path.join(shots, 'google-results.png') });
await gesture('UP');
await say('arijit singh ke gaane bajao', 3500);
check('Hindi voice command plays a song on YouTube', gg.url().includes('/watch?v=aaa111'), gg.url());

// ---------- 5. AWS backend round trip (local) ----------
await sw.evaluate(async ([key, port]) => chrome.storage.sync.set({ backendUrl: `http://localhost:${port}`, apiKey: key }), [API_KEY, BACKEND_PORT]);
await gg.goto('https://www.google.com/search?q=weather+bengaluru');
await sleep(2000);
check('page choices are sent to the backend for AI ranking', backendLog.some((l) => /POST \/choices -> 200/.test(l)), backendLog.join(' | '));
await gesture('HELP', 300);
await sleep(5600);
s = await ui(gg);
check('help alert goes to the backend, falls back to calling out loud', backendLog.some((l) => /POST \/help -> 503/.test(l)) && /help out loud/i.test(s.modal), s.modal.slice(0, 60));

// ---------- 6. side panel screenshot ----------
const sp = await ctx.newPage();
await sp.setViewportSize({ width: 400, height: 1000 });
await sp.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);
await sleep(800);
await sp.screenshot({ path: path.join(shots, 'side-panel.png') });

check('no JavaScript errors on any page', pageErrors.length === 0, pageErrors.join(' | '));
console.log(`\n${failures ? failures + ' FAILED' : 'ALL E2E CHECKS PASSED'}`);
await ctx.close();
backend.kill();
server.close();
process.exit(failures ? 1 : 0);
