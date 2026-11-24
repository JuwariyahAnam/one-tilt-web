// One-Tilt Web - the four-choice overlay
// Receives gestures (from the headband via the side panel, the simulator or keyboard
// shortcuts), shows four big choices, and carries out the chosen action on the page.
(function () {
  if (window.__oneTiltLoaded) return;
  window.__oneTiltLoaded = true;

  const E = window.OneTiltEngine;
  const PER_PAGE = 4;

  // ---------- icons (inline SVG, no external assets) ----------
  const P = {
    play: '<path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>',
    next: '<path d="M5 4l10 8-10 8z" fill="currentColor" stroke="none"/><path d="M19 4v16"/>',
    skip: '<path d="M3 5l8 7-8 7zM12 5l8 7-8 7z" fill="currentColor" stroke="none"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>',
    check: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 12.5l3 3 5-6"/>',
    tap: '<path d="M6 3l13 7.5-5.5 1.8L11 18z"/><path d="M13.5 12.3L19 19"/>',
    link: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    down: '<path d="M12 4v16M5 13l7 7 7-7"/>',
    up: '<path d="M12 20V4M5 11l7-7 7 7"/>',
    back: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>',
    speak: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    like: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    logo: '<circle cx="12" cy="13" r="7.5"/><path d="M3.5 9.5L20.5 5" stroke-width="2.6"/><circle cx="9.5" cy="13" r=".9" fill="currentColor"/><circle cx="14.5" cy="13" r=".9" fill="currentColor"/><path d="M9.5 16.2c1.4 1 3.6 1 5 0"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.tap}</svg>`;

  // ---------- state ----------
  let settings = Object.assign({}, window.OneTiltSettings.DEFAULTS);
  const state = {
    mode: 'choices',          // choices | list | confirm | listening | help | busy
    items: [], index: 0, title: '', source: 'device', moved: false,
    list: null,               // { title, items, index, from }
    confirm: null, listen: null, help: null, seq: 0, headband: false, lastUrl: location.href,
  };
  let myTabId = null;         // set only on extension pages (practice page)

  // ---------- messaging ----------
  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => { void chrome.runtime.lastError; resolve(res); });
      } catch (e) { resolve(null); }
    });
  }
  const say = (text, kind = 'ui') => send({ type: 'say', text, kind, lang: settings.lang });
  const buzz = (pattern) => send({ type: 'buzz', pattern });

  // ---------- UI ----------
  const host = document.createElement('div');
  host.id = 'onetilt-root';
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <link rel="stylesheet" href="${chrome.runtime.getURL('content/overlay.css')}">
    <div class="ot-wrap">
      <div class="ot-spot"></div>
      <div class="ot-pill" title="Show One-Tilt">${icon('logo')}<span>One-Tilt · tilt to start</span></div>
      <div class="ot-modal-bg"><div class="ot-modal"></div></div>
      <div class="ot-panel ot-hidden" role="region" aria-label="One-Tilt Web choices">
        <div class="ot-toast" role="status" aria-live="polite"></div>
        <div class="ot-top">
          <div class="ot-brand">${icon('logo')}One-Tilt</div>
          <div class="ot-title"></div>
          <div class="ot-badge">On-device</div>
          <div class="ot-dots"></div>
          <button class="ot-min" title="Hide (any gesture brings it back)">&#8211;</button>
        </div>
        <div class="ot-cards">${[1, 2, 3, 4].map((n) => `
          <button class="ot-card" data-slot="${n - 1}"><div class="ot-card-head"><span class="ot-num">${n}</span><span class="ot-ic"></span></div>
          <div class="ot-label"></div><div class="ot-hint"></div></button>`).join('')}
        </div>
        <div class="ot-foot">
          <span><b>Tilt</b> left / right to move</span><span><b>Nod</b> to choose</span>
          <span><b>Look up</b> to speak</span><span><b>Hold up 3 s</b> for help</span>
          <span class="ot-dev"><i class="ot-led"></i><span class="ot-devtxt">Headband not connected · keys Alt+Shift+Arrows</span></span>
        </div>
      </div>
    </div>`;
  const $ = (s) => shadow.querySelector(s);
  const ui = {
    panel: $('.ot-panel'), title: $('.ot-title'), badge: $('.ot-badge'), dots: $('.ot-dots'),
    cards: Array.from(shadow.querySelectorAll('.ot-card')), toast: $('.ot-toast'), spot: $('.ot-spot'),
    pill: $('.ot-pill'), modalBg: $('.ot-modal-bg'), modal: $('.ot-modal'), led: $('.ot-led'), devtxt: $('.ot-devtxt'),
  };
  (document.body || document.documentElement).appendChild(host);

  ui.cards.forEach((card) => card.addEventListener('click', () => {
    const v = view();
    const i = Math.floor(v.index / PER_PAGE) * PER_PAGE + Number(card.dataset.slot);
    if (i < v.items.length) { v.setIndex(i); render(); choose(); }
  }));
  $('.ot-min').addEventListener('click', () => setActive(false));
  ui.pill.addEventListener('click', () => setActive(true));

  // The list currently shown: the main choices or a sub-list (phrases, options...)
  function view() {
    if (state.mode === 'list' && state.list) {
      return { items: state.list.items, index: state.list.index, title: state.list.title, setIndex: (i) => { state.list.index = i; } };
    }
    return { items: state.items, index: state.index, title: state.title, setIndex: (i) => { state.index = i; } };
  }

  function render() {
    const v = view();
    const start = Math.floor(v.index / PER_PAGE) * PER_PAGE;
    ui.title.textContent = v.title || '';
    ui.badge.textContent = state.source === 'ai' ? 'AI · Amazon Bedrock' : 'On-device';
    ui.badge.classList.toggle('ai', state.source === 'ai');
    const pages = Math.max(1, Math.ceil(v.items.length / PER_PAGE));
    const cur = Math.floor(v.index / PER_PAGE);
    ui.dots.innerHTML = pages > 1 ? Array.from({ length: Math.min(pages, 12) }, (_, i) => `<i class="${i === Math.min(cur, 11) ? 'on' : ''}"></i>`).join('') : '';
    ui.cards.forEach((card, slot) => {
      const item = v.items[start + slot];
      card.classList.toggle('empty', !item);
      card.classList.toggle('on', !!item && start + slot === v.index);
      if (!item) return;
      card.querySelector('.ot-ic').innerHTML = icon(item.icon);
      card.querySelector('.ot-label').textContent = item.label;
      card.querySelector('.ot-hint').textContent = item.hint || '';
      let tag = card.querySelector('.ot-tag');
      if (item.ai && !tag) { tag = document.createElement('span'); tag.className = 'ot-tag'; card.appendChild(tag); }
      if (tag) { tag.textContent = item.ai ? 'AI pick' : ''; tag.style.display = item.ai ? '' : 'none'; }
      card.setAttribute('aria-label', `${slot + 1}. ${item.label}. ${item.hint || ''}`);
    });
    spotlight(v.items[v.index]);
  }

  function spotlight(item, scrolled) {
    const el = item && item.el;
    if (!el || !el.isConnected || state.mode === 'help') { ui.spot.classList.remove('show'); return; }
    const r = el.getBoundingClientRect();
    const panelTop = ui.panel.getBoundingClientRect().top || innerHeight;
    if (!scrolled && (r.bottom < 0 || r.top > panelTop - 10)) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => { if (view().items[view().index] === item) spotlight(item, true); }, 450);
    }
    const pad = 6;
    Object.assign(ui.spot.style, {
      left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
    });
    ui.spot.classList.add('show');
  }
  addEventListener('scroll', () => { if (settings.active) spotlight(view().items[view().index], true); }, { passive: true });
  addEventListener('resize', () => { if (settings.active) spotlight(view().items[view().index], true); });

  let toastTimer = null;
  function toast(text, ms = 2600) {
    ui.toast.textContent = text;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), ms);
  }

  function modal(html, danger = false) {
    if (!html) { ui.modalBg.classList.remove('show'); return; }
    ui.modal.className = 'ot-modal' + (danger ? ' danger' : '');
    ui.modal.innerHTML = html;
    ui.modalBg.classList.add('show');
  }

  function setActive(on) {
    settings.active = on;
    chrome.storage.sync.set({ active: on });
    applyActive();
  }

  function applyActive() {
    ui.panel.classList.toggle('ot-hidden', !settings.active);
    ui.pill.classList.toggle('show', !settings.active);
    if (!settings.active) { ui.spot.classList.remove('show'); modal(null); state.mode = 'choices'; return; }
    refresh(true);
  }

  function setHeadband(on) {
    state.headband = on;
    ui.led.classList.toggle('ok', on);
    ui.devtxt.textContent = on ? 'Headband connected' : 'Headband not connected · keys Alt+Shift+Arrows';
  }

  // ---------- choices ----------
  function refresh(announce) {
    if (!settings.active) return;
    if (state.mode !== 'choices' && state.mode !== 'list') return;
    state.items = E.buildChoices();
    state.index = 0;
    state.moved = false;
    state.source = 'device';
    state.title = document.title ? `${document.title}` : location.hostname;
    state.mode = 'choices';
    state.list = null;
    render();
    if (announce && settings.readAloud && state.items[0]) say(state.items[0].label);
    refineWithAI(++state.seq);
  }

  // What the AI may see about a choice: its label and type, never what is typed or selected in it.
  const aiElement = (c, id) => ({ id, kind: c.kind, label: c.label, hint: c.kind === 'link' || c.kind === 'button' ? c.hint : '' });

  // Let Amazon Bedrock re-rank the on-device list (if a backend is configured).
  async function refineWithAI(seq) {
    if (!settings.useAI || !settings.backendUrl) return;
    const cands = state.items.filter((c) => c.el).slice(0, 40);
    if (cands.length < 2) return;
    const payload = {
      url: location.href, title: document.title, lang: settings.lang,
      elements: cands.map(aiElement),
    };
    const res = await send({ type: 'ai-choices', payload });
    if (!res || !res.ok || res.data.source !== 'bedrock' || seq !== state.seq || state.moved || state.mode !== 'choices') return;
    const picked = (res.data.choices || [])
      .filter((x) => cands[x.id])
      .slice(0, 3)
      .map((x) => Object.assign({}, cands[x.id], { label: x.label || cands[x.id].label, ai: true }));
    if (!picked.length) return;
    const rest = state.items.filter((c) => !picked.some((p) => p.el && p.el === c.el));
    const firstUtil = rest.findIndex((c) => c.kind === 'util');
    const util = firstUtil >= 0 ? rest.splice(firstUtil, 1) : [];
    state.items = picked.concat(util, rest);
    state.source = 'ai';
    if (res.data.summary) state.title = res.data.summary;
    render();
    if (settings.readAloud) say(state.items[0].label);
  }

  function move(delta) {
    const v = view();
    if (!v.items.length) return;
    v.setIndex((v.index + delta + v.items.length) % v.items.length);
    state.moved = true;
    render();
    const item = view().items[view().index];
    if (settings.readAloud && item) say(item.label);
  }

  // ---------- actions ----------
  function choose() {
    const v = view();
    const item = v.items[v.index];
    if (!item) return;
    buzz('B1');
    run(item);
  }

  function run(item) {
    switch (item.act) {
      case 'click':
        if (item.risky) return askConfirm(item);
        return clickEl(item);
      case 'type': return startListening({ purpose: item.kind === 'search' ? 'search' : 'type', item });
      case 'select': return openSelect(item);
      case 'video': return toggleVideo(item);
      case 'scroll-down': scrollPage(1); return;
      case 'scroll-up': scrollPage(-1); return;
      case 'back': say('Going back'); history.back(); return;
      case 'read': { const t = E.pageSummaryText(); toast('Reading the page… move your head to stop', 4000); say(t, 'read'); return; }
      case 'phrases': return openPhrases();
      case 'say-phrase': toast(`Speaking: “${item.label}”`); say(item.label, 'phrase'); return;
      case 'web-search': return startListening({ purpose: 'search' });
      case 'voice': return startListening({ purpose: 'command' });
      case 'list-back': state.mode = 'choices'; state.list = null; render(); return;
      case 'option': return pickOption(item);
      default: return clickEl(item);
    }
  }

  function clickEl(item) {
    const el = item.el;
    if (!el || !el.isConnected) { toast('That item is gone - refreshing'); refresh(); return; }
    const verb = item.kind === 'checkbox' ? (el.checked ? 'Unticked' : 'Ticked') : item.kind === 'radio' ? 'Chose' : 'Opening';
    toast(`${verb}: ${item.label}`);
    if (settings.readAloud) say(`${verb} ${item.label}`);
    const before = location.href;
    el.focus({ preventScroll: true });
    if (el.tagName === 'A' && el.target === '_blank' && el.href) location.assign(el.href); // stay in this tab
    else el.click();
    setTimeout(() => { if (location.href === before) refresh(); }, 900);
  }

  function askConfirm(item) {
    state.mode = 'confirm';
    state.confirm = item;
    buzz('B2');
    modal(`<div class="ot-modal-ic">${icon('alert')}</div><h2>${esc(item.label)}?</h2>
      <p>This might send or change something.</p>
      <div class="ot-keys"><span>Nod again = Yes</span><span>Tilt = No</span></div>`);
    say(`${item.label}. Nod again to confirm, or tilt to cancel.`);
  }

  function toggleVideo(item) {
    const v = item.el;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); toast('Playing'); } else { v.pause(); toast('Paused'); }
    item.label = v.paused ? 'Play video' : 'Pause video';
    item.icon = v.paused ? 'play' : 'pause';
    render();
  }

  function scrollPage(dir) {
    scrollBy({ top: dir * innerHeight * 0.75, behavior: 'smooth' });
    toast(dir > 0 ? 'Scrolled down' : 'Scrolled up', 1200);
    setTimeout(() => refresh(), 700);
  }

  function openList(title, items, from) {
    state.mode = 'list';
    state.list = { title, items: [{ act: 'list-back', label: 'Back', icon: 'back', hint: 'Return to choices' }].concat(items), index: Math.min(1, items.length), from };
    state.moved = true;
    render();
    const it = state.list.items[state.list.index];
    if (settings.readAloud && it) say(`${title}. ${it.label}`);
  }

  function openPhrases() {
    openList('Speak for me', settings.phrases.filter(Boolean).map((p) => ({ act: 'say-phrase', label: p, icon: 'speak', hint: settings.cloneVoiceId ? 'In my own voice' : 'Spoken aloud' })));
  }

  function openSelect(item) {
    const sel = item.el;
    const opts = Array.from(sel.options).filter((o) => !o.disabled && o.value !== '').map((o) => ({
      act: 'option', label: o.text.trim(), icon: o.selected ? 'check' : 'list', hint: o.selected ? 'Chosen now' : '', option: o, select: sel,
    }));
    openList(item.label, opts);
  }

  function pickOption(item) {
    const sel = item.select;
    sel.value = item.option.value;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    toast(`Chose: ${item.label}`);
    say(`Chose ${item.label}`);
    state.mode = 'choices';
    state.list = null;
    refreshKeeping(sel);
  }

  // Rebuild choices but keep the highlight next to the element we just used.
  function refreshKeeping(el) {
    state.items = E.buildChoices();
    const i = state.items.findIndex((c) => c.el === el);
    state.index = i >= 0 ? Math.min(i + 1, state.items.length - 1) : 0;
    state.source = 'device';
    render();
  }

  function setValue(el, text) {
    el.focus();
    if (el.isContentEditable) {
      el.textContent = text;
    } else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, text);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function searchFor(query, opts = {}) {
    const q = encodeURIComponent(query);
    const host = location.hostname;
    const el = opts.item && opts.item.el;
    toast(`Searching: ${query}`);
    say(`Searching ${query}`);
    if (/youtube\.com$/.test(host) || opts.youtube) {
      location.assign(`https://www.youtube.com/results?search_query=${q}${opts.play ? '&onetilt=play' : ''}`);
    } else if (/(^|\.)google\./.test(host) || !el) {
      location.assign(`https://www.google.com/search?q=${q}`);
    } else {
      setValue(el, query);
      const form = el.form || el.closest('form');
      if (form && form.requestSubmit) form.requestSubmit();
      else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }
  }

  // ---------- voice ----------
  async function startListening(listen) {
    state.mode = 'listening';
    state.listen = listen;
    buzz('B1');
    const what = listen.purpose === 'type' ? `Say what to type in “${esc(listen.item.label)}”`
      : listen.purpose === 'search' ? 'Say what to search for' : 'Say a command';
    modal(`<div class="ot-modal-ic pulse">${icon('mic')}</div><h2>Listening…</h2><p>${what}</p>
      <div class="ot-heard"></div>
      ${listen.purpose === 'command' ? '<div class="ot-ex">Try: “scroll down”, “play Arijit Singh songs”, “open sign in”, “go back”, “Arijit Singh ke gaane bajao”</div>' : ''}
      <div class="ot-keys"><span>Any head move = cancel</span></div>`);
    clearTimeout(state.listenTimer);
    state.listenTimer = setTimeout(() => { if (state.mode === 'listening') endListening('Didn’t hear anything'); }, 15000);
    const res = await send({ type: 'listen', lang: settings.lang });
    if (state.mode !== 'listening') return;
    if (!res || !res.ok) localRecognition();
  }

  // Fallback when the side panel isn't open: Chrome speech recognition on this page.
  function localRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { endListening('Voice needs the One-Tilt side panel open'); return; }
    const rec = new SR();
    rec.lang = settings.lang;
    rec.interimResults = true;
    rec.onresult = (e) => {
      const r = e.results[e.results.length - 1];
      if (r.isFinal) onTranscript({ text: r[0].transcript });
      else onTranscript({ text: r[0].transcript, interim: true });
    };
    rec.onerror = (e) => onTranscript({ error: e.error === 'not-allowed' ? 'Microphone blocked - allow it for this site' : 'Could not hear you' });
    state.localRec = rec;
    try { rec.start(); } catch (e) { endListening('Microphone busy'); }
  }

  function endListening(message) {
    clearTimeout(state.listenTimer);
    if (state.localRec) { try { state.localRec.abort(); } catch (e) { /* ignore */ } state.localRec = null; }
    send({ type: 'listen-cancel' });
    state.mode = 'choices';
    state.listen = null;
    modal(null);
    if (message) { toast(message); say(message); }
    render();
  }

  function onTranscript(msg) {
    if (state.mode !== 'listening' || !state.listen) return;
    const heard = ui.modal.querySelector('.ot-heard');
    if (msg.error) { endListening(msg.error); return; }
    if (msg.interim) { if (heard) heard.textContent = `“${msg.text}”`; return; }
    const text = (msg.text || '').trim();
    const listen = state.listen;
    clearTimeout(state.listenTimer);
    state.localRec = null;
    state.mode = 'choices';
    state.listen = null;
    modal(null);
    if (!text) { toast('Didn’t catch that'); say('Sorry, I did not catch that'); render(); return; }
    toast(`Heard: “${text}”`, 3200);
    if (listen.purpose === 'type') {
      setValue(listen.item.el, text);
      say(`Typed ${text}`);
      refreshKeeping(listen.item.el);
    } else if (listen.purpose === 'search') {
      searchFor(text, { item: listen.item });
    } else {
      runCommand(text);
    }
  }

  async function runCommand(text) {
    const cmd = E.parseCommand(text);
    if (!cmd) return;
    switch (cmd.type) {
      case 'stop': send({ type: 'stop-speaking' }); return;
      case 'help': startHelp(); return;
      case 'scroll-down': scrollPage(1); return;
      case 'scroll-up': scrollPage(-1); return;
      case 'back': say('Going back'); history.back(); return;
      case 'read': run({ act: 'read' }); return;
      case 'phrases': openPhrases(); return;
      case 'say': say(cmd.text, 'phrase'); toast(`Speaking: “${cmd.text}”`); return;
      case 'play': searchFor(cmd.query, { youtube: true, play: true }); return;
      case 'search': searchFor(cmd.query, { item: state.items.find((c) => c.kind === 'search') }); return;
      case 'type': {
        const target = state.items.find((c) => c.kind === 'input' || c.kind === 'search');
        if (target) { setValue(target.el, cmd.text); say(`Typed ${cmd.text}`); refreshKeeping(target.el); }
        return;
      }
      case 'pick': {
        const start = Math.floor(state.index / PER_PAGE) * PER_PAGE;
        const item = state.items[start + cmd.n - 1];
        if (item) { state.index = start + cmd.n - 1; render(); run(item); }
        return;
      }
      case 'open': {
        const i = E.bestMatch(state.items, cmd.target);
        if (i !== null) { state.index = i; render(); run(state.items[i]); return; }
        break; // fall through to AI
      }
      default: break;
    }
    // Not understood on-device: ask the AI agent if available.
    if (settings.backendUrl) {
      toast('Thinking…');
      const cands = state.items.filter((c) => c.el).slice(0, 40);
      const res = await send({
        type: 'ai-command',
        payload: { command: text, url: location.href, title: document.title, lang: settings.lang, elements: cands.map(aiElement) },
      });
      if (res && res.ok && res.data && res.data.action) {
        const a = res.data.action;
        if (res.data.reply) say(res.data.reply);
        if (a.type === 'click' && cands[a.id]) { const i = state.items.indexOf(cands[a.id]); state.index = Math.max(0, i); render(); run(cands[a.id]); return; }
        if (a.type === 'type' && cands[a.id]) { setValue(cands[a.id].el, a.text || ''); refreshKeeping(cands[a.id].el); return; }
        if (a.type === 'search') { searchFor(a.text || text, { youtube: !!a.youtube, play: !!a.play }); return; }
        if (a.type === 'scroll_down') { scrollPage(1); return; }
        if (a.type === 'scroll_up') { scrollPage(-1); return; }
        if (a.type === 'back') { history.back(); return; }
        if (a.type === 'say') { say(a.text || '', 'phrase'); return; }
      }
    }
    const i = E.bestMatch(state.items, text);
    if (i !== null) { state.index = i; render(); toast(`Did you mean “${state.items[i].label}”? Nod to choose`); say(`${state.items[i].label}? Nod to choose.`); return; }
    toast(`Sorry, I didn’t understand “${text}”`);
    say('Sorry, I did not understand');
  }

  // ---------- help alert ----------
  function startHelp() {
    if (state.mode === 'help') return;
    if (state.mode === 'listening') endListening();
    state.mode = 'help';
    let left = Number(settings.helpCountdown) || 5;
    buzz('B3');
    const draw = () => modal(`<div class="ot-modal-ic">${icon('alert')}</div><h2>Sending a help alert to ${esc(settings.contactName)}</h2>
      <div class="ot-big">${left}</div><div class="ot-keys"><span>Tilt or nod to cancel</span></div>`, true);
    draw();
    say(`Sending a help alert in ${left} seconds. Move your head to cancel.`);
    state.help = setInterval(() => {
      left -= 1;
      if (left > 0) { draw(); return; }
      clearInterval(state.help);
      sendHelp();
    }, 1000);
  }

  function cancelHelp() {
    clearInterval(state.help);
    state.mode = 'choices';
    modal(null);
    toast('Help alert cancelled');
    say('Help alert cancelled');
    render();
  }

  async function sendHelp() {
    state.mode = 'busy';
    modal(`<div class="ot-modal-ic">${icon('alert')}</div><h2>Sending help alert…</h2>`, true);
    const res = await send({ type: 'help', payload: { url: location.href, title: document.title } });
    if (res && res.ok) {
      modal(`<div class="ot-modal-ic">${icon('check')}</div><h2>Help alert sent</h2><p>${esc(settings.contactName)} got a text message. Help is on the way.</p>`, true);
      say(`Help alert sent to ${settings.contactName}. Help is on the way.`);
    } else {
      modal(`<div class="ot-modal-ic">${icon('sound')}</div><h2>Calling for help out loud</h2><p>${esc((res && res.error) || 'Text alerts need the AWS backend (see side panel).')}</p>`, true);
      say('I need help. Please come. I need help. Please come.', 'phrase');
    }
    setTimeout(() => { if (state.mode === 'busy') { state.mode = 'choices'; modal(null); render(); } }, 7000);
  }

  // ---------- gestures ----------
  function onGesture(name) {
    if (!settings.active) { setActive(true); toast('One-Tilt is on'); return; }
    send({ type: 'stop-speaking' });
    switch (state.mode) {
      case 'help': if (name !== 'HELP') cancelHelp(); return;
      case 'listening': endListening('Cancelled'); return;
      case 'busy': state.mode = 'choices'; modal(null); render(); return;
      case 'confirm': {
        const item = state.confirm;
        state.mode = 'choices';
        state.confirm = null;
        modal(null);
        if (name === 'NOD' && item) clickEl(item);
        else { toast('Cancelled'); say('Cancelled'); render(); }
        return;
      }
      default: break;
    }
    if (name === 'RIGHT') move(1);
    else if (name === 'LEFT') move(-1);
    else if (name === 'NOD') choose();
    else if (name === 'UP') startListening({ purpose: 'command' });
    else if (name === 'HELP') startHelp();
  }

  // ---------- wiring ----------
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg) return;
    // On the practice page (an extension page) only accept messages addressed to this tab.
    if (location.protocol === 'chrome-extension:' && (msg.__tabId == null || msg.__tabId !== myTabId)) return;
    if (msg.type === 'gesture') { onGesture(msg.name); reply({ ok: true }); }
    else if (msg.type === 'transcript') { onTranscript(msg); reply({ ok: true }); }
    else if (msg.type === 'headband') { setHeadband(!!msg.connected); reply({ ok: true }); }
    else if (msg.type === 'ping') { reply({ ok: true, url: location.href }); }
  });

  chrome.storage.onChanged.addListener((changes) => {
    const before = settings.active;
    for (const k in changes) settings[k] = changes[k].newValue;
    if (changes.active && settings.active !== before) applyActive();
  });

  // Single-page apps (YouTube) change the URL without reloading.
  function onUrlChange() {
    state.lastUrl = location.href;
    if (state.mode === 'listening' || state.mode === 'help') return;
    state.mode = 'choices';
    modal(null);
    setTimeout(() => refresh(true), 900);
    autoPlay();
  }
  setInterval(() => { if (location.href !== state.lastUrl) onUrlChange(); }, 500);

  // "play <song>" lands on YouTube results with ?onetilt=play - start the first video.
  function autoPlay() {
    if (!/youtube\.com$/.test(location.hostname) || location.pathname !== '/results') return;
    if (new URLSearchParams(location.search).get('onetilt') !== 'play') return;
    let tries = 0;
    const timer = setInterval(() => {
      const first = Array.from(document.querySelectorAll('ytd-video-renderer a#video-title, a#video-title[href*="/watch"], a[href*="/watch?v="]')).find(E.isVisible);
      if (first || ++tries > 40) {
        clearInterval(timer);
        if (first) { toast('Playing the top result'); first.click(); }
      }
    }, 250);
  }

  // Pages that render late: retry until something shows up.
  function warmUp() {
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (!settings.active) return;
      const pageItems = state.items.filter((c) => c.kind !== 'util').length;
      if (pageItems >= 3 || tries > 12 || state.moved) { clearInterval(timer); return; }
      if (state.mode === 'choices') refresh(false);
    }, 800);
  }

  function esc(s) { return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  async function init() {
    settings = await window.OneTiltSettings.load();
    if (location.protocol === 'chrome-extension:' && chrome.tabs && chrome.tabs.getCurrent) {
      myTabId = await new Promise((r) => chrome.tabs.getCurrent((t) => r(t ? t.id : null)));
    }
    applyActive();
    warmUp();
    autoPlay();
    const st = await send({ type: 'status' });
    if (st && st.headband) setHeadband(true);
  }

  window.OneTilt = { gesture: onGesture, refresh, state }; // handy for testing in DevTools
  init();
})();
