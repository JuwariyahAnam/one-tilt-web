// One-Tilt Web - side panel (caregiver control centre)
// Owns the USB headband connection, the microphone and ElevenLabs audio, and
// forwards gestures to the background worker, which routes them to the page.
(async function () {
  const $ = (id) => document.getElementById(id);
  let settings = await OneTiltSettings.load();
  let port = null;
  let audio = null;
  let recognition = null;
  let recorder = null;
  const pending = new Map();

  // ---------- log ----------
  function log(text, level = '') {
    const li = document.createElement('li');
    li.className = level;
    const t = new Date();
    li.innerHTML = `<time>${t.toTimeString().slice(0, 8)}</time><span></span>`;
    li.lastChild.textContent = text;
    $('log').prepend(li);
    while ($('log').children.length > 60) $('log').lastChild.remove();
  }

  // ---------- link to the background worker ----------
  function connectPort() {
    port = chrome.runtime.connect({ name: 'sidepanel' });
    port.onMessage.addListener(onPortMessage);
    port.onDisconnect.addListener(() => { port = null; setTimeout(connectPort, 400); });
    port.postMessage({ type: 'headband', connected: headband.connected });
  }
  const post = (msg) => { if (port) port.postMessage(msg); };
  setInterval(() => post({ type: 'ping' }), 20000);  // keeps the worker awake while the panel is open

  function callApi(path, body, method = 'POST') {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      pending.set(id, resolve);
      post({ type: 'api', id, path, body, method });
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ ok: false, error: 'Timed out' }); } }, 30000);
    });
  }

  function onPortMessage(msg) {
    switch (msg.type) {
      case 'buzz': headband.write(msg.pattern || 'B1'); break;
      case 'listen': listen(msg.lang); break;
      case 'listen-cancel': stopListening(); break;
      case 'speak': speakEleven(msg); break;
      case 'stop-audio': if (audio) audio.pause(); break;
      case 'api-result': { const r = pending.get(msg.id); if (r) { pending.delete(msg.id); r(msg.res); } break; }
      case 'log': log(msg.text, msg.level); break;
      case 'gesture-result':
        if (!msg.ok) log(`${msg.name}: this tab can't be controlled (try a normal web page)`, 'warn');
        break;
      default: break;
    }
  }

  // ---------- gestures ----------
  function sendGesture(name, source) {
    post({ type: 'gesture', name, source });
    const b = document.querySelector(`.sim button[data-g="${name}"]`);
    if (b) { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 220); }
    const dot = $('headDot');
    dot.classList.add('flash');
    setTimeout(() => dot.classList.remove('flash'), 200);
    log(`${name.charAt(0) + name.slice(1).toLowerCase()} (${source})`);
  }
  document.querySelectorAll('.sim button').forEach((b) => b.addEventListener('click', () => sendGesture(b.dataset.g, 'simulator')));

  // ---------- headband ----------
  const headband = new HeadbandSerial({
    onLine: handleLine,
    onState: (on) => {
      $('hbStatus').textContent = on ? 'Connected' : 'Not connected';
      $('hbStatus').className = 'pill' + (on ? ' ok' : '');
      $('btnConnect').textContent = on ? 'Disconnect' : 'Connect headband';
      $('btnCalibrate').disabled = !on;
      $('btnBuzz').disabled = !on;
      post({ type: 'headband', connected: on });
      log(on ? 'Headband connected' : 'Headband disconnected', on ? 'ok' : 'warn');
      if (on) setTimeout(() => { headband.write('V1'); headband.write('?'); }, 2200);  // Nano resets when the port opens
      else moveDot(0, 0);
    },
  });

  function handleLine(line) {
    const m = line.match(/^(LEFT|RIGHT|NOD|UP|HELP)\b/);
    if (m) { sendGesture(m[1], /BTN/.test(line) ? 'button' : 'headband'); return; }
    if (line.startsWith('A,')) {
      const [, r, p] = line.split(',');
      moveDot(parseFloat(r), parseFloat(p));
      return;
    }
    if (line.startsWith('CFG')) {
      const get = (k) => (line.match(new RegExp(k + '=([\\d.]+)')) || [])[1];
      if (get('tilt')) { setSlider('Tilt', get('tilt')); setSlider('Nod', get('nod')); setSlider('Look', get('look')); }
      $('oSwap').checked = get('swap') === '1';
      $('oInvR').checked = get('invRoll') === '1';
      $('oInvP').checked = get('invPitch') === '1';
    }
    if (line.startsWith('HELLO')) log(`Headband ready (${line.slice(6)}) - calibrating, keep still`, 'ok');
    else if (line.startsWith('ERR')) log(line.slice(4), 'err');
    else if (line.startsWith('OK')) log(line.slice(3), 'ok');
  }

  function moveDot(roll, pitch) {
    const c = (v) => Math.max(-40, Math.min(40, v || 0)) * 2;
    $('headDot').setAttribute('cx', 90 + c(roll));
    $('headDot').setAttribute('cy', 90 - c(pitch));
  }

  function drawThresholds() {
    const t = +$('sTilt').value * 2;
    const n = +$('sNod').value * 2;
    const l = +$('sLook').value * 2;
    $('thrL').setAttribute('x1', 90 - t); $('thrL').setAttribute('x2', 90 - t);
    $('thrR').setAttribute('x1', 90 + t); $('thrR').setAttribute('x2', 90 + t);
    $('thrU').setAttribute('y1', 90 - l); $('thrU').setAttribute('y2', 90 - l);
    $('thrD').setAttribute('y1', 90 + n); $('thrD').setAttribute('y2', 90 + n);
  }
  function setSlider(name, v) { $('s' + name).value = Math.round(v); $('v' + name).textContent = Math.round(v); drawThresholds(); }

  ['Tilt', 'Nod', 'Look'].forEach((n) => $('s' + n).addEventListener('input', () => {
    $('v' + n).textContent = $('s' + n).value;
    drawThresholds();
  }));
  ['Tilt', 'Nod', 'Look'].forEach((n) => $('s' + n).addEventListener('change', () => {
    headband.write(`S,${$('sTilt').value},${$('sNod').value},${$('sLook').value}`);
  }));
  ['oSwap', 'oInvR', 'oInvP'].forEach((id) => $(id).addEventListener('change', () => {
    headband.write(`O,${+$('oSwap').checked},${+$('oInvR').checked},${+$('oInvP').checked}`);
  }));
  drawThresholds();

  if (!headband.supported) {
    $('btnConnect').disabled = true;
    $('serialNote').textContent = 'This browser has no Web Serial. Use desktop Chrome or Edge.';
  }
  $('btnConnect').addEventListener('click', async () => {
    if (headband.connected) { await headband.close(); return; }
    try { await headband.request(); } catch (e) { if (e.name !== 'NotFoundError') log(`Could not connect: ${e.message}`, 'err'); }
  });
  $('btnCalibrate').addEventListener('click', () => { headband.write('C'); log('Calibrating - keep your head still and straight'); });
  $('btnBuzz').addEventListener('click', () => headband.write('B2'));

  // ---------- voice input ----------
  function sendTranscript(t) { post(Object.assign({ type: 'transcript' }, t)); }

  async function listen(lang) {
    stopListening();
    document.body.classList.add('listening');
    if (settings.speechInput === 'elevenlabs' && settings.backendUrl) return listenScribe(lang);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { sendTranscript({ error: 'Speech recognition is not available in this browser' }); return; }
    const rec = new SR();
    recognition = rec;
    rec.lang = lang || settings.lang;
    rec.interimResults = true;
    let finalSent = false;
    rec.onresult = (e) => {
      const r = e.results[e.results.length - 1];
      if (r.isFinal) { finalSent = true; sendTranscript({ text: r[0].transcript }); log(`Heard: “${r[0].transcript}”`); }
      else sendTranscript({ text: r[0].transcript, interim: true });
    };
    rec.onerror = (e) => {
      finalSent = true;
      const msg = e.error === 'not-allowed' ? 'Microphone not allowed yet - click “Allow microphone” in the One-Tilt panel'
        : e.error === 'no-speech' ? 'Didn’t hear anything' : `Voice error: ${e.error}`;
      sendTranscript({ error: msg });
      log(msg, 'warn');
    };
    rec.onend = () => { document.body.classList.remove('listening'); if (!finalSent) sendTranscript({ text: '' }); recognition = null; };
    try { rec.start(); } catch (e) { sendTranscript({ error: 'Microphone busy' }); }
  }

  // Record a short clip (stops on silence) and transcribe it with ElevenLabs Scribe.
  async function listenScribe(lang) {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) {
      sendTranscript({ error: 'Microphone not allowed yet - click “Allow microphone” in the One-Tilt panel' });
      document.body.classList.remove('listening');
      return;
    }
    const chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let heard = false;
    let quietSince = performance.now();
    const started = performance.now();
    const vad = setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += (v - 128) * (v - 128);
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (rms > 6) { heard = true; quietSince = now; }
      if ((heard && now - quietSince > 1100) || now - started > 8000 || (!heard && now - started > 5000)) recorder.stop();
    }, 80);
    recorder.onstop = async () => {
      clearInterval(vad);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
      recorder = null;
      document.body.classList.remove('listening');
      if (!heard) { sendTranscript({ text: '' }); return; }
      sendTranscript({ text: 'Transcribing…', interim: true });
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const data = await blobToBase64(blob);
      const res = await callApi('/transcribe', { audio: data, mime: 'audio/webm', lang });
      if (res.ok) { sendTranscript({ text: res.data.text || '' }); log(`Heard (Scribe): “${res.data.text}”`); } else sendTranscript({ error: res.error });
    };
    recorder.start();
  }

  function stopListening() {
    if (recognition) { try { recognition.abort(); } catch (e) { /* ignore */ } recognition = null; }
    if (recorder && recorder.state === 'recording') { recorder.onstop = null; recorder.stop(); recorder.stream.getTracks().forEach((t) => t.stop()); recorder = null; }
    document.body.classList.remove('listening');
  }

  function blobToBase64(blob) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.readAsDataURL(blob);
    });
  }

  // ---------- voice output (ElevenLabs) ----------
  async function speakEleven(msg) {
    const res = await callApi('/speak', { text: msg.text, voiceId: msg.voiceId || '', lang: msg.lang });
    if (res.ok && res.data.audio) {
      if (audio) audio.pause();
      audio = new Audio(`data:${res.data.mime || 'audio/mpeg'};base64,${res.data.audio}`);
      audio.play().catch(() => chrome.tts.speak(msg.text, { lang: msg.lang }));
    } else {
      chrome.tts.speak(msg.text, { lang: msg.lang, rate: Number(settings.speechRate) || 1 });
      if (msg.kind === 'phrase') log(`ElevenLabs unavailable, used Chrome voice (${res.error})`, 'warn');
    }
  }

  // ---------- settings form ----------
  document.querySelectorAll('[data-key]').forEach((el) => {
    const key = el.dataset.key;
    const v = settings[key];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (key === 'phrases') el.value = (v || []).join('\n');
    else el.value = v == null ? '' : v;
    el.addEventListener('change', () => {
      let value = el.type === 'checkbox' ? el.checked : el.value;
      if (key === 'phrases') value = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
      if (key === 'helpCountdown') value = Math.max(3, Math.min(15, Number(value) || 5));
      if (key === 'backendUrl') value = String(value).trim().replace(/\/+$/, '');
      chrome.storage.sync.set({ [key]: value });
    });
  });
  chrome.storage.onChanged.addListener((changes) => {
    for (const k in changes) settings[k] = changes[k].newValue;
    if (changes.active) document.querySelector('[data-key="active"]').checked = !!settings.active;
    if (changes.backendUrl) $('beStatus').textContent = settings.backendUrl ? 'Not tested' : 'Off';
  });
  $('beStatus').textContent = settings.backendUrl ? 'Not tested' : 'Off';

  $('btnTest').addEventListener('click', async () => {
    $('beStatus').textContent = 'Testing…';
    $('beStatus').className = 'pill';
    const res = await callApi('/health', null, 'GET');
    if (res.ok) {
      const d = res.data;
      $('beStatus').textContent = 'Connected';
      $('beStatus').className = 'pill ok';
      $('beDetail').textContent = `Bedrock: ${d.bedrock} · ElevenLabs: ${d.elevenlabs} · SMS alerts: ${d.sns} · Settings DB: ${d.dynamodb}`;
      log('Backend connected', 'ok');
    } else {
      $('beStatus').textContent = 'Failed';
      $('beStatus').className = 'pill warn';
      $('beDetail').textContent = res.error;
    }
  });

  $('btnClone').addEventListener('click', async () => {
    const files = Array.from($('cloneFiles').files || []);
    if (!files.length) { $('cloneStatus').textContent = 'Choose 1–3 audio files first.'; return; }
    $('cloneStatus').textContent = 'Uploading…';
    const payload = await Promise.all(files.slice(0, 3).map(async (f) => ({ name: f.name, mime: f.type || 'audio/mpeg', data: await blobToBase64(f) })));
    const res = await callApi('/voice/clone', { name: $('cloneName').value || 'One-Tilt user', files: payload });
    if (res.ok && res.data.voiceId) {
      chrome.storage.sync.set({ cloneVoiceId: res.data.voiceId });
      $('cloneStatus').textContent = 'Voice ready. “Speak for me” now uses it.';
      log('Personal voice created', 'ok');
    } else {
      $('cloneStatus').textContent = `Could not create the voice: ${res.error}`;
    }
  });

  $('btnPractice').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('pages/practice.html') }));
  $('btnMic').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('pages/mic.html') }));

  // ---------- start ----------
  connectPort();
  if (settings.cloneVoiceId) $('cloneStatus').textContent = 'A personal voice is set up.';
  log('Panel ready. Use the buttons above or connect the headband.');
  headband.autoConnect().catch(() => {});
})();
