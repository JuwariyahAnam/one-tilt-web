// One-Tilt Web - page engine
// Reads the current page and turns it into a ranked list of big, simple choices.
// Runs fully on-device; the AI backend (Amazon Bedrock) can re-rank the same list.
(function (root) {
  if (root.OneTiltEngine) return;

  const CANDIDATES = [
    'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea', 'summary', 'video',
    '[role=button]', '[role=link]', '[role=tab]', '[role=menuitem]', '[role=checkbox]', '[role=switch]',
    '[role=searchbox]', '[role=combobox]', '[role=option]', '[contenteditable=true]',
  ].join(',');

  const JUNK = /\b(privacy|terms|cookies?|policy|policies|advertis\w*|feedback|report|sitemap|careers|copyright|skip to|skip navigation|accessibility statement|help center|send feedback|legal|imprint|press|investors)\b/i;
  const RISKY = /\b(submit|pay|payment|buy|order|checkout|purchase|delete|remove|send|confirm|book|transfer|sign out|log ?out|unsubscribe|place order)\b/i;

  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const cut = (t, n = 70) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.05) return false;
    if (el.closest('[aria-hidden="true"],[hidden],[inert],#onetilt-root')) return false;
    return true;
  }

  function textOf(id) {
    const n = id && document.getElementById(id);
    return n ? clean(n.innerText || n.textContent) : '';
  }

  // Text of a <label> without the text of the control inside it (e.g. a select's options).
  function labelText(label) {
    const copy = label.cloneNode(true);
    copy.querySelectorAll('select,input,textarea,button').forEach((n) => n.remove());
    return clean(copy.textContent);
  }

  function labelFor(el) {
    const aria = clean(el.getAttribute('aria-label'));
    const by = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(textOf).join(' ').trim();
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      const lab = el.labels && el.labels[0] ? labelText(el.labels[0]) : '';
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (['submit', 'button', 'reset'].includes(type)) return clean(el.value) || aria || 'Submit';
      return lab || aria || by || clean(el.getAttribute('placeholder')) || clean(el.title) || clean(el.name) || 'Text box';
    }
    if (el.isContentEditable) return aria || by || clean(el.getAttribute('data-placeholder') || el.getAttribute('placeholder')) || 'Text box';
    let txt = clean(el.innerText || el.textContent);
    if (!txt) {
      const img = el.querySelector('img[alt]');
      if (img) txt = clean(img.alt);
    }
    return aria || by || txt || clean(el.title) || '';
  }

  function kindOf(el) {
    const tag = el.tagName;
    const role = (el.getAttribute('role') || '').toLowerCase();
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (tag === 'VIDEO') return 'video';
    if (tag === 'SELECT') return 'select';
    if (tag === 'TEXTAREA' || el.isContentEditable || role === 'searchbox' || role === 'combobox') return isSearch(el) ? 'search' : 'input';
    if (tag === 'INPUT') {
      if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox' || type === 'radio') return type;
      if (['range', 'color', 'file'].includes(type)) return 'other';
      return isSearch(el) ? 'search' : 'input';
    }
    if (role === 'checkbox' || role === 'switch') return 'checkbox';
    if (tag === 'A' || role === 'link') return 'link';
    return 'button';
  }

  function isSearch(el) {
    const s = [el.getAttribute('type'), el.name, el.id, el.getAttribute('role'), el.getAttribute('placeholder'), el.getAttribute('aria-label')]
      .join(' ').toLowerCase();
    return /search|\bq\b|query|khoj/.test(s) || el.name === 'q';
  }

  function scoreOf(el, kind, label, rect) {
    const vh = innerHeight || 800;
    let s = { search: 95, input: 60, select: 55, video: 70, button: 45, link: 40, checkbox: 38, radio: 38 }[kind] || 10;
    const inView = rect.bottom > 0 && rect.top < vh;
    s += inView ? 40 : rect.top < 2 * vh && rect.top > 0 ? 8 : -12;
    if (rect.top > vh) s -= Math.min(30, ((rect.top - vh) / vh) * 6);
    s += Math.min(18, Math.sqrt(rect.width * rect.height) / 12);
    const n = label.length;
    if (n < 2) s -= 45;
    else if (n < 4) s -= 12;
    else if (n <= 80) s += 10;
    else s -= 6;
    if (JUNK.test(label)) s -= 50;
    if (el.closest('footer,[role=contentinfo]')) s -= 35;
    if (el.closest('nav,[role=navigation]')) s -= 10;
    if (el.closest('aside,[role=complementary]')) s -= 8;
    if (el.closest('main,[role=main],article')) s += 10;
    if (el.querySelector('h1,h2,h3,h4') || el.closest('h1,h2,h3,h4')) s += 25;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') s -= 60;
    return s;
  }

  const ICON_FOR = { link: 'link', button: 'tap', search: 'search', input: 'edit', select: 'list', checkbox: 'check', radio: 'check', video: 'play' };

  function hintFor(el, kind) {
    if (kind === 'link') {
      try {
        const u = new URL(el.href, location.href);
        if (u.host !== location.host) return u.host.replace(/^www\./, '');
      } catch (e) { /* ignore */ }
      return 'Open link';
    }
    return { button: 'Button', search: 'Search by voice', input: 'Type by voice', select: 'Pick an option', checkbox: 'Tick / untick', radio: 'Choose', video: 'Video' }[kind] || '';
  }

  function makeChoice(el, extra) {
    const rect = el.getBoundingClientRect();
    const kind = (extra && extra.kind) || kindOf(el);
    const label = cut((extra && extra.label) || labelFor(el));
    const base = {
      el, kind, label,
      icon: ICON_FOR[kind] || 'tap',
      hint: hintFor(el, kind),
      act: kind === 'search' || kind === 'input' ? 'type' : kind === 'select' ? 'select' : kind === 'video' ? 'video' : 'click',
      score: scoreOf(el, kind, label, rect),
      risky: (kind === 'button' || kind === 'link') && RISKY.test(label),
    };
    if (kind === 'checkbox' || kind === 'radio') {
      const on = el.checked || el.getAttribute('aria-checked') === 'true';
      base.hint = on ? 'Ticked - choose to untick' : 'Not ticked - choose to tick';
    }
    if (kind === 'select' && el.selectedOptions && el.selectedOptions[0]) base.hint = 'Now: ' + cut(clean(el.selectedOptions[0].text), 30);
    return Object.assign(base, extra || {});
  }

  // ---------- site adapters (better choices on the sites we demo) ----------
  function youtubeChoices() {
    const out = [];
    const isWatch = location.pathname === '/watch';
    const currentId = new URLSearchParams(location.search).get('v');
    const q = (sel) => Array.from(document.querySelectorAll(sel)).find(isVisible);

    const skip = q('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
    if (skip) out.push(makeChoice(skip, { label: 'Skip ad', icon: 'skip', hint: 'Ad is playing', score: 600 }));

    if (isWatch) {
      const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (video) {
        out.push(makeChoice(video, {
          kind: 'video', act: 'video', label: video.paused ? 'Play video' : 'Pause video',
          icon: video.paused ? 'play' : 'pause', hint: 'This video', score: 500,
        }));
      }
      const next = q('.ytp-next-button');
      if (next) out.push(makeChoice(next, { label: 'Next video', icon: 'next', hint: 'Skip to the next one', score: 450 }));
      const full = q('.ytp-fullscreen-button');
      if (full) out.push(makeChoice(full, { label: 'Full screen', icon: 'expand', hint: 'Bigger video', score: 300 }));
      const like = q('like-button-view-model button, #segmented-like-button button');
      if (like) out.push(makeChoice(like, { label: 'Like this video', icon: 'like', hint: 'Thumbs up', score: 150 }));
    }

    const seen = new Set(currentId ? [currentId] : []);
    let rank = 0;
    document.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]').forEach((a) => {
      if (rank >= 40 || !isVisible(a)) return;
      let id;
      try {
        const u = new URL(a.href, location.href);
        id = u.searchParams.get('v') || u.pathname.split('/shorts/')[1];
      } catch (e) { return; }
      if (!id || seen.has(id)) return;
      let title = clean(a.getAttribute('title')) || clean(a.innerText);
      if (!title || title.length < 6) {
        const aria = clean(a.getAttribute('aria-label'));
        title = aria.split(/ by | \d[\d,.]* views| - /)[0];
      }
      if (!title || title.length < 6 || /^\d+:\d+/.test(title)) return;
      seen.add(id);
      const choice = makeChoice(a, { label: cut(title), icon: 'play', hint: isWatch ? 'Up next' : 'Play video', kind: 'link' });
      choice.score = (isWatch ? 260 : 320) + (choice.score > 80 ? 30 : 0) - rank * 4;
      out.push(choice);
      rank++;
    });

    const search = document.querySelector('input[name="search_query"]');
    if (search) out.push(makeChoice(search, { kind: 'search', act: 'type', label: 'Search YouTube by voice', icon: 'search', hint: 'Say what to find', score: isWatch ? 200 : 330 }));
    return out;
  }

  function googleChoices() {
    const out = [];
    let rank = 0;
    document.querySelectorAll('#search a h3, #rso a h3, #botstuff a h3').forEach((h3) => {
      const a = h3.closest('a');
      if (!a || !isVisible(a) || rank >= 15) return;
      let host = '';
      try { host = new URL(a.href).host.replace(/^www\./, ''); } catch (e) { /* ignore */ }
      out.push(makeChoice(a, { label: cut(clean(h3.innerText)), icon: 'link', hint: host || 'Result', kind: 'link', score: 300 - rank * 5 }));
      rank++;
    });
    const box = document.querySelector('textarea[name="q"], input[name="q"]');
    if (box) out.push(makeChoice(box, { kind: 'search', act: 'type', label: rank ? 'New search by voice' : 'Search Google by voice', icon: 'search', hint: 'Say what to find', score: rank ? 240 : 400 }));
    const next = document.getElementById('pnnext');
    if (next) out.push(makeChoice(next, { label: 'More results', icon: 'next', hint: 'Next page', score: 120 }));
    return out;
  }

  // ---------- main entry ----------
  function pageChoices() {
    const host = location.hostname;
    let special = [];
    if (/(^|\.)youtube\.com$/.test(host)) special = youtubeChoices();
    else if (/(^|\.)google\.[a-z.]+$/.test(host) && location.pathname.startsWith('/search')) special = googleChoices();
    else if (/(^|\.)google\.[a-z.]+$/.test(host)) special = googleChoices();

    const taken = new Set(special.map((c) => c.el));
    const generic = [];
    const nodes = document.querySelectorAll(CANDIDATES);
    const limit = Math.min(nodes.length, 2500);
    for (let i = 0; i < limit; i++) {
      const el = nodes[i];
      if (taken.has(el) || !isVisible(el)) continue;
      // Skip an element nested inside another candidate with the same purpose (e.g. span inside a link).
      const parent = el.parentElement && el.parentElement.closest(CANDIDATES);
      if (parent && parent.tagName !== 'VIDEO' && !taken.has(parent) && isVisible(parent) && kindOf(el) === 'button' && el.tagName !== 'BUTTON') continue;
      const kind = kindOf(el);
      if (kind === 'other') continue;
      if (kind === 'radio' && el.name) {
        // Radios: one choice per option, labelled with the group question when available.
        const fs = el.closest('fieldset');
        const q = fs && fs.querySelector('legend') ? clean(fs.querySelector('legend').innerText) : '';
        const c = makeChoice(el);
        if (q) c.hint = cut(q, 34);
        generic.push(c);
        taken.add(el);
        continue;
      }
      const c = makeChoice(el);
      if (!c.label) continue;
      c.score -= i * 0.002;  // ties keep page order (forms read top to bottom)
      generic.push(c);
      taken.add(el);
    }

    // De-duplicate by label + destination, keep the best-scored.
    const best = new Map();
    for (const c of special.concat(generic)) {
      const key = c.label.toLowerCase() + '|' + (c.el.href || c.el.name || c.kind);
      const prev = best.get(key);
      if (!prev || c.score > prev.score) best.set(key, c);
    }
    return Array.from(best.values()).sort((a, b) => b.score - a.score);
  }

  function utilityChoices(hasSearch) {
    const doc = document.scrollingElement || document.documentElement;
    const atBottom = innerHeight + scrollY >= doc.scrollHeight - 40;
    const list = [];
    if (!atBottom) list.push({ kind: 'util', act: 'scroll-down', label: 'Scroll down', icon: 'down', hint: 'See more of this page' });
    if (history.length > 1) list.push({ kind: 'util', act: 'back', label: 'Go back', icon: 'back', hint: 'Previous page' });
    list.push({ kind: 'util', act: 'phrases', label: 'Speak for me', icon: 'speak', hint: 'Say a phrase out loud' });
    list.push({ kind: 'util', act: 'read', label: 'Read this page', icon: 'sound', hint: 'Listen to the page' });
    if (scrollY > 100) list.push({ kind: 'util', act: 'scroll-up', label: 'Scroll up', icon: 'up', hint: 'Back up the page' });
    if (!hasSearch) list.push({ kind: 'util', act: 'web-search', label: 'Search the web', icon: 'search', hint: 'Say what to find' });
    list.push({ kind: 'util', act: 'voice', label: 'Speak a command', icon: 'mic', hint: 'Or just look up' });
    return list;
  }

  // Interleave: every group of four = three page choices + one utility,
  // so "Scroll down", "Go back" and "Speak for me" are always close by.
  function buildChoices() {
    const page = pageChoices();
    const utils = utilityChoices(page.some((c) => c.kind === 'search'));
    const out = [];
    let p = 0;
    let u = 0;
    while (p < page.length || u < utils.length) {
      for (let k = 0; k < 3 && p < page.length; k++) out.push(page[p++]);
      if (u < utils.length) out.push(utils[u++]);
      if (out.length > 64) break;
    }
    return out;
  }

  // ---------- read-aloud text ----------
  function pageSummaryText() {
    const main = document.querySelector('main,[role=main],article') || document.body;
    const parts = [];
    main.querySelectorAll('h1,h2,h3,p,li').forEach((n) => {
      if (parts.join(' ').length > 900 || !isVisible(n) || n.closest('nav,footer,#onetilt-root')) return;
      const t = clean(n.innerText);
      if (t.length > 2) parts.push(t);
    });
    return clean(document.title) + '. ' + parts.join('. ').slice(0, 900);
  }

  // ---------- voice commands (English + simple Hindi) ----------
  const NUM = { one: 1, two: 2, three: 3, four: 4, ek: 1, do: 2, teen: 3, char: 4, chaar: 4, first: 1, second: 2, third: 3, fourth: 4 };

  function parseCommand(raw) {
    const t = clean(raw).toLowerCase().replace(/[.!?,]+$/g, '');
    if (!t) return null;
    let m;
    if (/^(stop|cancel|ruko|bas|band karo)$/.test(t)) return { type: 'stop' };
    if (/^(help|madad|bachao|emergency)( me| karo)?$/.test(t)) return { type: 'help' };
    if (/^(scroll )?(down|neeche|niche|aage)( scroll| karo)?$/.test(t)) return { type: 'scroll-down' };
    if (/^(scroll )?(up|upar|oopar)( scroll| karo)?$/.test(t)) return { type: 'scroll-up' };
    if (/^(go )?back$|^(peeche|wapas|piche)( jao)?$/.test(t)) return { type: 'back' };
    if (/^(read|padho|read (this|the) page|page padho)/.test(t)) return { type: 'read' };
    if (/^(speak for me|phrases|bolo)$/.test(t)) return { type: 'phrases' };
    if ((m = t.match(/^(?:say|bolo|speak)\s+(.+)/))) return { type: 'say', text: m[1] };
    if ((m = t.match(/^(?:play|watch|bajao|chalao|lagao)\s+(.+)/)) || (m = t.match(/^(.+?)\s+(?:ke gaane |ka gaana |ka video |ki video )?(?:bajao|chalao|lagao)$/))) return { type: 'play', query: m[1] };
    if ((m = t.match(/^(?:search(?: for)?|find|google|look up|khojo|dhundo)\s+(.+)/)) || (m = t.match(/^(.+?)\s+(?:khojo|dhundo|search karo)$/))) return { type: 'search', query: m[1] };
    if ((m = t.match(/^(?:type|write|likho)\s+(.+)/))) return { type: 'type', text: raw.replace(/^\s*(type|write|likho)\s+/i, '').trim() };
    if ((m = t.match(/^(?:open|click|choose|select|press|kholo|dabao)\s+(?:number\s+|option\s+)?(.+)/))) {
      const n = NUM[m[1]] || parseInt(m[1], 10);
      if (n >= 1 && n <= 4) return { type: 'pick', n };
      return { type: 'open', target: m[1] };
    }
    if ((m = t.match(/^(?:number|option|choice)\s+(\w+)$/)) || (m = t.match(/^(one|two|three|four|ek|do|teen|char|chaar)$/))) {
      const n = NUM[m[1]] || parseInt(m[1], 10);
      if (n >= 1 && n <= 4) return { type: 'pick', n };
    }
    return { type: 'unknown', text: t };
  }

  // Simple fuzzy match: share of query words found in the label.
  function bestMatch(choices, query) {
    const words = clean(query).toLowerCase().split(' ').filter((w) => w.length > 1);
    if (!words.length) return null;
    let best = null;
    let bestScore = 0;
    choices.forEach((c, i) => {
      const label = (c.label || '').toLowerCase();
      let hits = 0;
      words.forEach((w) => { if (label.includes(w)) hits++; });
      const score = hits / words.length + (label.startsWith(words[0]) ? 0.1 : 0);
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return bestScore >= 0.5 ? best : null;
  }

  root.OneTiltEngine = { buildChoices, pageChoices, parseCommand, bestMatch, pageSummaryText, labelFor, kindOf, isVisible, RISKY };
})(typeof window !== 'undefined' ? window : this);
