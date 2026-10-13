/*!
 * SVG Scan UI
 * https://github.com/AtharvaLakhe/SVG_Scan
 * MIT License
 */
(function () {
  'use strict';

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const REPO = 'AtharvaLakhe/SVG_Scan';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- small utilities ---------- */

  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function baseName(name) { return (name || 'image').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'image'; }

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) { return null; }
  }

  function toast(html, ms) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = html;
    $('#toasts').appendChild(t);
    setTimeout(() => {
      t.classList.add('out');
      t.addEventListener('animationend', () => t.remove(), { once: true });
    }, ms || 2600);
  }

  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  const STAR = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z"/></svg>';

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall through */ }
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  function flashButton(btn, label) {
    const html = btn.dataset.html || (btn.dataset.html = btn.innerHTML);
    btn.innerHTML = CHECK + label;
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { btn.innerHTML = html; }, 1500);
  }

  function download(text, filename, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // One gentle nudge per browser, after the first useful export.
  function savedToast(filename) {
    toast(CHECK + 'Saved ' + esc(filename));
    if (store('svgscan-nudged')) return;
    store('svgscan-nudged', '1');
    setTimeout(() => toast(STAR + '<span>Did that save you time? A star helps other people find SVG Scan.</span><a href="https://github.com/' + REPO + '" target="_blank" rel="noopener">Star on GitHub</a>', 7000), 900);
  }

  function tweenNumber(el, to, format) {
    const from = +el.dataset.v || 0;
    el.dataset.v = to;
    if (reduceMotion || from === to) { el.textContent = format(to); return; }
    const t0 = performance.now(), dur = 420;
    cancelAnimationFrame(el._raf);
    (function tick(now) {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = format(from + (to - from) * e);
      if (k < 1) el._raf = requestAnimationFrame(tick);
    })(t0);
  }

  function moveInk(container, active, instant) {
    const ink = $('.ink', container);
    if (!ink || !active) return;
    if (instant) ink.style.transition = 'none';
    ink.style.setProperty('--x', active.offsetLeft + 'px');
    ink.style.setProperty('--w', active.offsetWidth + 'px');
    if (instant) { void ink.offsetWidth; ink.style.transition = ''; }
  }

  function arrowNav(list, e, pick) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const next = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
    next.focus();
    pick(next);
    e.preventDefault();
  }

  /* ---------- hero ---------- */

  const headline = $('#headline');
  let played = false;
  function playHeadline() { if (!played) { played = true; headline.classList.add('play'); } }
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(playHeadline);
  setTimeout(playHeadline, 1500);

  fetch('https://api.github.com/repos/' + REPO)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (!j || typeof j.stargazers_count !== 'number' || j.stargazers_count < 5) return;
      const n = j.stargazers_count;
      $('#starCount').textContent = n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : n;
      $('#starCount').hidden = false;
    })
    .catch(() => {});

  /* ---------- mode switching ---------- */

  const modebar = $('.modebar');
  const modeTabs = $$('.mode');
  const viewTrace = $('#view-trace'), viewCode = $('#view-code');
  let mode = 'trace';

  function setMode(m) {
    const tab = modeTabs.find((b) => b.dataset.mode === m);
    moveInk(modebar, tab);
    if (m === mode) return;
    mode = m;
    modeTabs.forEach((b) => {
      const on = b === tab;
      b.setAttribute('aria-selected', on);
      b.tabIndex = on ? 0 : -1;
    });
    viewTrace.hidden = m !== 'trace';
    viewCode.hidden = m !== 'code';
    const v = m === 'trace' ? viewTrace : viewCode;
    v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
    if (m === 'trace') layoutFrame();
    else {
      $('#useTraced').hidden = !T.result;
      moveInk($('#formats'), $('.fmt[aria-selected="true"]'), true);
    }
  }
  modeTabs.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  modebar.addEventListener('keydown', (e) => arrowNav(modeTabs, e, (b) => setMode(b.dataset.mode)));

  /* =========================================================
   * Image to SVG
   * ========================================================= */

  const stage = $('#stage'), empty = $('#empty'), viewport = $('#viewport'), frame = $('#frame');
  const raster = $('#raster'), vector = $('#vector'), stageBar = $('#stageBar'), statusEl = $('#status');
  const sliders = { colors: $('#colors'), detail: $('#detail'), smooth: $('#smooth'), noise: $('#noise') };

  const T = {
    name: 'image', url: null, natW: 0, natH: 0, data: null, result: null, blur: 0,
    hidden: new Set(), view: 'compare', split: 50, busy: false, pending: null, jobId: 0,
    first: true, started: 0, reveal: false
  };

  const PRESETS = {
    logo: { colors: 6, detail: 72, smooth: 55, noise: 22, blur: 0, majority: 0 },
    illustration: { colors: 14, detail: 60, smooth: 72, noise: 30, blur: 1, majority: 2 },
    photo: { colors: 20, detail: 45, smooth: 80, noise: 50, blur: 2, majority: 3 },
    lineart: { colors: 2, detail: 75, smooth: 62, noise: 26, blur: 0, majority: 0 }
  };

  function paintSlider(input) {
    const p = (input.value - input.min) / (input.max - input.min) * 100;
    input.style.setProperty('--p', p + '%');
    $('#' + input.id + 'Out').textContent = input.value;
  }

  function applyPreset(name, run) {
    const p = PRESETS[name];
    Object.keys(sliders).forEach((k) => { sliders[k].value = p[k]; paintSlider(sliders[k]); });
    T.blur = p.blur;
    T.majority = p.majority;
    $$('#presets .chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.preset === name));
    if (run) requestTrace(false);
  }

  function guessPreset(img) {
    const d = img.data, n = img.width * img.height, step = Math.max(1, Math.floor(n / 20000));
    const seen = new Set();
    let gray = 0, opaque = 0;
    for (let i = 0; i < n; i += step) {
      const j = i * 4;
      if (d[j + 3] < 128) continue;
      opaque++;
      seen.add((d[j] >> 3) << 10 | (d[j + 1] >> 3) << 5 | (d[j + 2] >> 3));
      if (Math.abs(d[j] - d[j + 1]) < 14 && Math.abs(d[j + 1] - d[j + 2]) < 14) gray++;
    }
    if (opaque && gray / opaque > 0.97 && seen.size < 60) return 'lineart';
    if (seen.size <= 40) return 'logo';
    if (seen.size < 900) return 'illustration';
    return 'photo';
  }

  function engineOpts() {
    const d = +sliders.detail.value, s = +sliders.smooth.value, n = +sliders.noise.value;
    const mp = T.data.width * T.data.height / 1e6;
    return {
      colors: +sliders.colors.value,
      tolerance: 0.25 + Math.pow(1 - d / 100, 1.5) * 3.2,
      smoothness: s / 100 * 1.3,
      corner: 42 + s * 0.28,
      noise: Math.max(1, Math.round(n * n / 12 * mp)),
      blur: T.blur,
      majority: T.majority,
      gradients: $('#optGradients').checked,
      merge: 6,
      precision: 1
    };
  }

  /* ---------- loading ---------- */

  async function loadFile(file, name) {
    if (!file) return;
    if (/svg/.test(file.type) || /\.svg$/i.test(file.name || '')) {
      setMode('code');
      setSvgInput(await file.text(), file.name);
      return;
    }
    if (!/^image\//.test(file.type)) {
      toast("That file isn't an image. Try a PNG, JPG or WebP.");
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      await loadImage(url, name || baseName(file.name));
    } catch (e) {
      URL.revokeObjectURL(url);
      toast("This browser can't read that image. Try a PNG, JPG or WebP.");
    }
  }

  async function loadImage(url, name) {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (T.url) URL.revokeObjectURL(T.url);
    setMode('trace');
    T.url = url; T.name = name || 'image';
    T.natW = img.naturalWidth; T.natH = img.naturalHeight;

    // Small images trace better upscaled; huge ones gain nothing past ~1400px.
    const long = Math.max(T.natW, T.natH);
    const scale = long < 900 ? Math.min(4, 900 / long) : long > 1400 ? 1400 / long : 1;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(T.natW * scale));
    c.height = Math.max(1, Math.round(T.natH * scale));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    T.data = g.getImageData(0, 0, c.width, c.height);

    T.result = null; T.first = true; T.hidden.clear();
    vector.innerHTML = '';
    raster.src = url;
    showWorkspace();
    setView('vector');
    applyPreset(guessPreset(T.data), false);
    requestTrace(true);
  }

  function showWorkspace() {
    if (!viewport.hidden) { layoutFrame(); return; }
    empty.classList.add('leave');
    setTimeout(() => { empty.hidden = true; empty.classList.remove('leave'); }, reduceMotion ? 0 : 320);
    viewport.hidden = false;
    stageBar.hidden = false;
    viewport.classList.remove('enter'); void viewport.offsetWidth; viewport.classList.add('enter');
    layoutFrame();
  }

  /* ---------- samples ---------- */

  function cropCanvas(c, pad) {
    const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < x0) return c;
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1 + pad * 2; out.height = y1 - y0 + 1 + pad * 2;
    out.getContext('2d').drawImage(c, pad - x0, pad - y0);
    return out;
  }

  function emojiSample(ch) {
    const S = 900, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.font = Math.round(S * 0.5) + 'px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ch, S / 2, S / 2 + S * 0.04);
    return cropCanvas(c, 20);
  }

  function sunsetSample() {
    const W = 960, H = 600, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d'), horizon = 400;
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#170b36'); sky.addColorStop(0.45, '#58206f'); sky.addColorStop(0.78, '#e2516f'); sky.addColorStop(1, '#ffb066');
    g.fillStyle = sky; g.fillRect(0, 0, W, horizon);
    g.fillStyle = '#f6e7ff';
    [[90, 60], [180, 120], [300, 40], [420, 95], [640, 50], [760, 130], [880, 70], [540, 150], [60, 170], [920, 190]].forEach(([x, y], i) => {
      g.beginPath(); g.arc(x, y, i % 3 ? 2.2 : 3.4, 0, 7); g.fill();
    });
    // retro striped sun on its own layer
    const s = document.createElement('canvas');
    s.width = W; s.height = H;
    const sg = s.getContext('2d'), sunG = sg.createLinearGradient(0, 210, 0, 400);
    sunG.addColorStop(0, '#fff3b0'); sunG.addColorStop(1, '#ff7a4d');
    sg.fillStyle = sunG; sg.beginPath(); sg.arc(480, 330, 150, 0, Math.PI * 2); sg.fill();
    for (let i = 0, y = 300; i < 6; i++) { const h = 4 + i * 3; sg.clearRect(0, y, W, h); y += h + 14 - i; }
    g.drawImage(s, 0, 0, W, horizon, 0, 0, W, horizon);
    const ridge = (color, pts) => { g.fillStyle = color; g.beginPath(); g.moveTo(0, horizon); pts.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(W, horizon); g.fill(); };
    ridge('#8a3373', [[0, 330], [110, 280], [210, 320], [330, 250], [430, 330], [560, 300], [690, 230], [800, 310], [960, 270]]);
    ridge('#4b1d5e', [[0, 360], [140, 310], [260, 370], [380, 330], [520, 380], [650, 320], [780, 370], [900, 330], [960, 350]]);
    const sea = g.createLinearGradient(0, horizon, 0, H);
    sea.addColorStop(0, '#2c1253'); sea.addColorStop(1, '#0c0620');
    g.fillStyle = sea; g.fillRect(0, horizon, W, H - horizon);
    g.fillStyle = '#ff9a5c';
    for (let i = 0; i < 9; i++) {
      const y = horizon + 14 + i * 20, w = 300 - i * 30;
      g.globalAlpha = 1 - i * 0.08;
      g.fillRect(480 - w / 2 + (i % 2 ? 14 : -10), y, w, 6);
    }
    g.globalAlpha = 1;
    // palm silhouette
    g.fillStyle = '#12081f';
    g.beginPath(); g.moveTo(150, 600); g.quadraticCurveTo(170, 420, 120, 300); g.lineTo(132, 298); g.quadraticCurveTo(190, 420, 172, 600); g.fill();
    [[-1, -0.2], [-0.8, 0.5], [1, -0.1], [0.7, 0.6], [0.1, -1]].forEach(([dx, dy]) => {
      g.beginPath(); g.moveTo(126, 300);
      g.quadraticCurveTo(126 + dx * 70, 300 + dy * 70 - 40, 126 + dx * 130, 300 + dy * 110);
      g.quadraticCurveTo(126 + dx * 60, 300 + dy * 60 - 10, 126, 306);
      g.fill();
    });
    return c;
  }

  const EMOJI_NAMES = { '🦊': 'fox', '🍉': 'watermelon', '🚀': 'rocket', '🌻': 'sunflower' };
  $$('.sample').forEach((b) => b.addEventListener('click', async () => {
    const key = b.dataset.sample;
    const canvas = key === 'sunset' ? sunsetSample() : emojiSample(key);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    await loadImage(URL.createObjectURL(blob), key === 'sunset' ? 'sunset' : EMOJI_NAMES[key] || 'sample');
  }));

  ['#fileInput', '#fileInput2'].forEach((id) => {
    $(id).addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
  });

  /* ---------- tracing (Web Worker, main-thread fallback) ---------- */

  let worker = null, mainThread = false;
  function ensureWorker() {
    if (worker || mainThread) return;
    try {
      worker = new Worker('tracer.js');
      worker.onmessage = (e) => onMessage(e.data);
      worker.onerror = (e) => {
        if (e.preventDefault) e.preventDefault();
        worker.terminate(); worker = null; mainThread = true;
        if (T.busy) { T.busy = false; requestTrace(T.reveal); }
      };
    } catch (e) { mainThread = true; }
  }

  function requestTrace(reveal) {
    if (!T.data) return;
    if (T.busy) { T.pending = { reveal: reveal || (T.pending && T.pending.reveal) }; return; }
    T.busy = true; T.reveal = reveal; T.started = performance.now();
    const id = ++T.jobId, opts = engineOpts();
    clearTimeout(T.busyTimer);
    T.busyTimer = setTimeout(() => setBusy(true), reveal ? 0 : 180);
    ensureWorker();
    if (worker) {
      const copy = new Uint8ClampedArray(T.data.data);
      worker.postMessage({ id, width: T.data.width, height: T.data.height, buffer: copy.buffer, opts }, [copy.buffer]);
    } else {
      setTimeout(() => {
        try { onMessage({ id, type: 'done', result: SVGScan.trace(T.data, opts) }); }
        catch (err) { onMessage({ id, type: 'error', message: err.message }); }
      }, 60);
    }
  }

  async function onMessage(m) {
    if (m.id !== T.jobId) return;
    if (m.type === 'progress') { setProgress(m.p, m.stage); return; }
    // Let the scan read as a scan on the first pass, even when tracing is instant.
    if (T.reveal && !reduceMotion) {
      const wait = 1100 - (performance.now() - T.started);
      if (wait > 0) { setProgress(0.96, 'Fitting curves'); await sleep(wait); }
    }
    T.busy = false;
    clearTimeout(T.busyTimer);
    if (m.type === 'error') { setBusy(false); toast('Tracing stopped: ' + esc(m.message)); }
    else onResult(m.result, T.reveal);
    if (T.pending) { const p = T.pending; T.pending = null; requestTrace(p.reveal); }
  }

  let statusTimer = 0;
  function showStatus(text, hint) {
    clearTimeout(statusTimer);
    $('#statusText').textContent = text;
    statusEl.classList.toggle('hint', !!hint);
    statusEl.classList.add('on');
    if (hint) statusTimer = setTimeout(hideStatus, 4200);
  }
  function hideStatus() { statusEl.classList.remove('on'); }
  function setBusy(on) {
    frame.classList.toggle('busy', on);
    if (on) showStatus('Reading colors'); else if (!statusEl.classList.contains('hint')) hideStatus();
  }
  function setProgress(p, stage) {
    if (!frame.classList.contains('busy')) return;
    $('#statusText').textContent = stage;
    statusEl.style.setProperty('--p', Math.round(p * 100) + '%');
    $('.status-bar i').style.width = Math.round(p * 100) + '%';
  }

  function onResult(res, reveal) {
    T.result = res;
    setBusy(false);
    renderVector(reveal);
    applyView();
    renderSwatches(reveal);
    updateStats();
    ['#download', '#copySvg', '#toCode'].forEach((id) => { $(id).disabled = false; });
  }

  function renderVector(reveal) {
    const r = T.result;
    const how = !reveal || reduceMotion ? 'fresh' : r.stats.nodes < 14000 ? 'draw' : 'wipe';
    const hair = (Math.max(r.width, r.height) / 360).toFixed(2);
    let html = '<svg viewBox="0 0 ' + r.width + ' ' + r.height + '" preserveAspectRatio="none" style="--hair:' + hair + 'px">', defs = '';
    r.layers.forEach((l, i) => {
      let fill = l.color;
      if (l.gradient) { defs += SVGScan.gradientDef('sg' + i, l.gradient); fill = 'url(#sg' + i + ')'; }
      html += '<path fill="' + fill + '" d="' + l.d + '"' + (how === 'draw' ? ' pathLength="1"' : '') +
        ' style="--i:' + i + '"' + (T.hidden.has(l.color) ? ' class="off"' : '') + '/>';
    });
    if (defs) html = html.replace('>', '><defs>' + defs + '</defs>');
    vector.className = 'vector';
    vector.innerHTML = html + '</svg>';
    void vector.offsetWidth;
    vector.classList.add(how);

    if (!reveal) return;
    let total = 1300;
    if (how === 'draw') {
      const n = r.layers.length, stagger = Math.min(120, 1200 / Math.max(1, n)), dd = 1150;
      vector.style.setProperty('--stagger', stagger + 'ms');
      vector.style.setProperty('--dd', dd + 'ms');
      total = (n - 1) * stagger + dd * 0.6 + 750;
    }
    clearTimeout(T.revealTimer);
    T.revealTimer = setTimeout(() => {
      vector.classList.remove('draw', 'wipe');
      if (T.first) {
        T.first = false;
        setView('compare');
        setTimeout(() => showStatus(matchMedia('(pointer: coarse)').matches ? 'Pinch to zoom in. The vector stays sharp.' : 'Scroll to zoom in. The vector stays sharp.', true), 700);
      }
    }, reduceMotion ? 0 : total);
  }

  function renderSwatches(animate) {
    const box = $('#swatches');
    box.innerHTML = '';
    box.classList.toggle('still', !animate);
    T.result.layers.forEach((l, i) => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.setProperty('--c', l.gradient ? 'linear-gradient(135deg,' + l.gradient.from + ',' + l.gradient.to + ')' : l.color);
      b.style.setProperty('--i', i);
      if (!animate) b.style.animation = 'none';
      b.setAttribute('aria-pressed', !T.hidden.has(l.color));
      const pct = l.coverage * 100;
      b.title = (l.gradient ? l.gradient.from + ' to ' + l.gradient.to + ' gradient' : l.color) + ', covers ' + (pct < 1 ? '<1' : Math.round(pct)) + '% of the image';
      b.setAttribute('aria-label', 'Color ' + l.color + (T.hidden.has(l.color) ? ', dropped' : ''));
      b.addEventListener('click', () => {
        if (T.hidden.has(l.color)) T.hidden.delete(l.color); else T.hidden.add(l.color);
        const off = T.hidden.has(l.color);
        b.setAttribute('aria-pressed', !off);
        b.setAttribute('aria-label', 'Color ' + l.color + (off ? ', dropped' : ''));
        const path = vector.querySelectorAll('path')[i];
        if (path) path.classList.toggle('off', off);
        updateStats();
      });
      box.appendChild(b);
    });
  }

  function exportSvg() {
    return SVGScan.toSVG(T.result, { hidden: T.hidden, width: T.natW, height: T.natH });
  }

  function updateStats() {
    const visible = T.result.layers.filter((l) => !T.hidden.has(l.color));
    const nodes = visible.reduce((a, l) => a + l.nodes, 0);
    const size = new Blob([exportSvg()]).size;
    tweenNumber($('#stPaths'), visible.length, (v) => Math.round(v));
    tweenNumber($('#stNodes'), nodes, (v) => Math.round(v).toLocaleString());
    tweenNumber($('#stSize'), size, (v) => fmtBytes(Math.round(v)));
    tweenNumber($('#stTime'), T.result.stats.ms, (v) => Math.round(v) + ' ms');
  }

  /* ---------- controls ---------- */

  let traceTimer = 0;
  Object.values(sliders).forEach((input) => {
    paintSlider(input);
    input.addEventListener('input', () => {
      paintSlider(input);
      $$('#presets .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      clearTimeout(traceTimer);
      traceTimer = setTimeout(() => requestTrace(false), 110);
    });
  });
  $$('#presets .chip').forEach((c) => c.addEventListener('click', () => applyPreset(c.dataset.preset, true)));
  $('#optGradients').addEventListener('change', () => requestTrace(false));

  $('#download').addEventListener('click', () => {
    const name = T.name + '.svg';
    download(exportSvg(), name, 'image/svg+xml');
    savedToast(name);
  });
  $('#copySvg').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (await copyText(exportSvg())) flashButton(btn, 'Copied');
    else toast('Your browser blocked the clipboard. Use Download SVG instead.');
  });
  $('#toCode').addEventListener('click', () => {
    setMode('code');
    $('#compName').value = SVG2Code.pascal(T.name);
    selectFormat($$('.fmt').find((b) => b.dataset.format === 'react'), false);
    setSvgInput(exportSvg());
  });

  /* ---------- view: compare, vector, outline ---------- */

  function setView(v) {
    T.view = v;
    $$('#viewSeg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === v));
    frame.classList.toggle('compare', v === 'compare');
    frame.classList.toggle('outline', v === 'outline');
    frame.style.setProperty('--split', (v === 'compare' ? T.split : 0) + '%');
    $('#tags').classList.toggle('off', v !== 'compare');
    $('#splitLine').setAttribute('aria-valuenow', Math.round(T.split));
  }
  $$('#viewSeg button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  function setSplitFromX(clientX) {
    const r = frame.getBoundingClientRect();
    T.split = clamp((clientX - r.left) / r.width * 100, 0, 100);
    frame.style.setProperty('--split', T.split + '%');
    $('#splitLine').setAttribute('aria-valuenow', Math.round(T.split));
  }

  $('#splitLine').addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 4;
    if (e.key === 'ArrowLeft') T.split = clamp(T.split - step, 0, 100);
    else if (e.key === 'ArrowRight') T.split = clamp(T.split + step, 0, 100);
    else return;
    e.preventDefault();
    setView('compare');
  });

  /* ---------- zoom and pan ---------- */

  const V = { s: 1, x: 0, y: 0, ts: 1, tx: 0, ty: 0, w: 0, h: 0, raf: 0 };

  function layoutFrame() {
    if (!T.natW || viewport.hidden) return;
    const r = viewport.getBoundingClientRect();
    if (!r.width) return;
    const pad = r.width < 600 ? 20 : 56, bar = 56;
    const k = Math.min((r.width - pad * 2) / T.natW, (r.height - pad * 2 - bar) / T.natH);
    V.w = T.natW * k; V.h = T.natH * k;
    frame.style.width = V.w + 'px';
    frame.style.height = V.h + 'px';
    V.ts = V.s = 1;
    centerTargets();
    V.x = V.tx; V.y = V.ty;
    applyView();
  }

  function centerTargets() {
    const r = viewport.getBoundingClientRect();
    V.tx = (r.width - V.w * V.ts) / 2;
    V.ty = (r.height - 56 - V.h * V.ts) / 2 + 6;
  }

  function clampPan() {
    if (V.ts <= 1.0001) { centerTargets(); return; }
    const r = viewport.getBoundingClientRect();
    V.tx = clamp(V.tx, r.width / 2 - V.w * V.ts, r.width / 2);
    V.ty = clamp(V.ty, r.height / 2 - V.h * V.ts, r.height / 2);
  }

  function applyView() {
    frame.style.transform = 'translate(' + V.x + 'px,' + V.y + 'px) scale(' + V.s + ')';
    frame.style.setProperty('--s', V.s);
    // Hairline outlines: one screen pixel, whatever the zoom.
    if (T.result) vector.style.setProperty('--ow', (1.25 * T.result.width / (V.w * V.s)).toFixed(4) + 'px');
    frame.classList.toggle('pixelated', V.w * V.s / T.natW > 1.6);
    viewport.classList.toggle('can-pan', V.ts > 1);
    $('#zoomFit').textContent = V.ts <= 1.0001 ? 'Fit' : Math.round(V.ts * 100) + '%';
  }

  function step() {
    V.raf = 0;
    const a = 0.22;
    V.s += (V.ts - V.s) * a; V.x += (V.tx - V.x) * a; V.y += (V.ty - V.y) * a;
    const done = Math.abs(V.ts - V.s) < 0.0005 && Math.abs(V.tx - V.x) < 0.2 && Math.abs(V.ty - V.y) < 0.2;
    if (done) { V.s = V.ts; V.x = V.tx; V.y = V.ty; } else V.raf = requestAnimationFrame(step);
    applyView();
  }
  function kick() {
    if (reduceMotion) { V.s = V.ts; V.x = V.tx; V.y = V.ty; applyView(); return; }
    if (!V.raf) V.raf = requestAnimationFrame(step);
  }

  function zoomTo(ns, cx, cy) {
    ns = clamp(ns, 1, 32);
    const k = ns / V.ts;
    V.tx = cx - (cx - V.tx) * k;
    V.ty = cy - (cy - V.ty) * k;
    V.ts = ns;
    clampPan();
    kick();
    if (ns > 1 && statusEl.classList.contains('hint')) hideStatus();
  }
  function zoomCenter(f) { const r = viewport.getBoundingClientRect(); zoomTo(V.ts * f, r.width / 2, (r.height - 56) / 2); }

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    zoomTo(V.ts * Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016)), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  viewport.addEventListener('dblclick', (e) => {
    const r = viewport.getBoundingClientRect();
    if (V.ts > 1) zoomTo(1, 0, 0); else zoomTo(4, e.clientX - r.left, e.clientY - r.top);
  });

  $('#zoomIn').addEventListener('click', () => zoomCenter(1.6));
  $('#zoomOut').addEventListener('click', () => zoomCenter(1 / 1.6));
  $('#zoomFit').addEventListener('click', () => zoomTo(1, 0, 0));

  let drag = null;
  const touches = new Map();
  let pinch = null;
  function pinchState() {
    const [a, b] = Array.from(touches.values()), r = viewport.getBoundingClientRect();
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
  }
  viewport.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        drag = null; frame.classList.remove('dragging');
        pinch = Object.assign(pinchState(), { s: V.ts });
        viewport.setPointerCapture(e.pointerId);
        return;
      }
    }
    if (e.button !== 0) return;
    const onSplit = !!e.target.closest('.split-line');
    if (onSplit || (V.ts <= 1 && T.view === 'compare' && e.target.closest('.frame'))) {
      drag = { kind: 'split' };
      frame.classList.add('dragging');
      setSplitFromX(e.clientX);
    } else if (V.ts > 1) {
      drag = { kind: 'pan', x: e.clientX, y: e.clientY, tx: V.tx, ty: V.ty };
      viewport.classList.add('panning');
    } else return;
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) {
      const p = pinchState();
      zoomTo(pinch.s * p.d / pinch.d, p.x, p.y);
      V.s = V.ts; V.x = V.tx; V.y = V.ty;
      applyView();
      return;
    }
    if (!drag) return;
    if (drag.kind === 'split') { setSplitFromX(e.clientX); return; }
    V.tx = drag.tx + e.clientX - drag.x;
    V.ty = drag.ty + e.clientY - drag.y;
    clampPan();
    V.x = V.tx; V.y = V.ty;
    applyView();
  });
  const endDrag = (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (!drag) return;
    drag = null;
    frame.classList.remove('dragging');
    viewport.classList.remove('panning');
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  new ResizeObserver(() => { if (mode === 'trace') layoutFrame(); }).observe(stage);

  /* =========================================================
   * SVG to code
   * ========================================================= */

  const svgInput = $('#svgInput'), codeEl = $('#code'), gutter = $('#gutter'), codeEmpty = $('#codeEmpty');
  const fmtTabs = $$('.fmt');
  let format = 'react', lastRes = null, convertTimer = 0;

  const SAMPLES = [
    { name: 'scan-icon', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff5d8f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n  <!-- Exported from a design tool -->\n  <path d="M3 7V5a2 2 0 0 1 2-2h2"/>\n  <path d="M17 3h2a2 2 0 0 1 2 2v2"/>\n  <path d="M21 17v2a2 2 0 0 1-2 2h-2"/>\n  <path d="M7 21H5a2 2 0 0 1-2-2v-2"/>\n  <path d="M7 12h10"/>\n</svg>\n' },
    { name: 'badge', svg: '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!-- Created with Inkscape (http://www.inkscape.org/) -->\n<svg\n   xmlns:dc="http://purl.org/dc/elements/1.1/"\n   xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"\n   xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"\n   xmlns="http://www.w3.org/2000/svg"\n   width="120.000000"\n   height="120.000000"\n   viewBox="0 0 120.000000 120.000000"\n   version="1.1"\n   sodipodi:docname="badge.svg"\n   inkscape:version="1.3 (0e150ed6c4, 2023-07-21)">\n  <sodipodi:namedview id="namedview7" pagecolor="#ffffff" bordercolor="#000000" inkscape:zoom="4.0000000" />\n  <defs id="defs2">\n    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">\n      <stop offset="0.000000" stop-color="#ff5d8f" />\n      <stop offset="1.000000" stop-color="#ffb36b" />\n    </linearGradient>\n  </defs>\n  <g inkscape:label="Layer 1" inkscape:groupmode="layer">\n    <circle cx="60.000000" cy="60.000000" r="54.000000" fill="url(#glow)" />\n    <polygon points="60.000000,26.000000 70.580000,47.440000 94.250000,50.880000 77.125000,67.570000 81.170000,91.120000 60.000000,80.000000 38.830000,91.120000 42.875000,67.570000 25.750000,50.880000 49.420000,47.440000" fill="#ffffff" fill-opacity="0.920000" />\n  </g>\n</svg>\n' }
  ];
  let sampleIndex = 0;

  function setSvgInput(text, filename) {
    svgInput.value = text;
    if (filename) $('#compName').value = SVG2Code.pascal(filename);
    convertNow(true);
  }

  const TOKEN = /(<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(<\/?[A-Za-z][\w:.-]*|\/?>)|([A-Za-z_][\w:.-]*)(?==)|\b(import|from|export|default|function|return|type)\b|([a-z-]+)(?=: )/g;
  function highlight(src) {
    let out = '', last = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(src))) {
      out += esc(src.slice(last, m.index));
      const cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 't' : m[5] ? 'k' : 'a';
      out += '<span class="tk-' + cls + '">' + esc(m[0]) + '</span>';
      last = TOKEN.lastIndex;
    }
    return out + esc(src.slice(last));
  }

  function renderCode(code, animate) {
    const body = codeEl.parentElement;
    const paint = () => {
      codeEl.innerHTML = code.length > 160000 ? esc(code) : highlight(code);
      const lines = code.replace(/\n$/, '').split('\n').length;
      gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
      codeEmpty.hidden = true;
      body.classList.remove('swap');
    };
    if (animate && !reduceMotion && codeEmpty.hidden) {
      body.classList.add('swap');
      clearTimeout(body._t);
      body._t = setTimeout(paint, 160);
    } else paint();
  }

  function showCodeMessage(title, text, isError) {
    codeEmpty.hidden = false;
    codeEmpty.classList.toggle('err', !!isError);
    codeEmpty.innerHTML = '<strong>' + esc(title) + '</strong><span>' + esc(text) + '</span>';
    $('#copyCode').disabled = $('#downloadCode').disabled = true;
  }

  function convertNow(animate) {
    const text = svgInput.value.trim();
    const meta = $('#srcMeta');
    if (!text) {
      lastRes = null;
      showCodeMessage('Your code appears here', 'Paste an SVG on the left, or trace an image first.');
      $('#srcPreview').innerHTML = '<p>Paste SVG markup below, open a file, or drop one anywhere on the page.</p>';
      meta.textContent = ''; meta.classList.remove('err');
      $('#outMeta').textContent = 'Seven formats, one paste.';
      return;
    }
    let res;
    try {
      res = SVG2Code.convert(text, format, {
        name: $('#compName').value, ts: $('#optTs').checked, currentColor: $('#optCurrent').checked, precision: $('#optPrec').value
      });
    } catch (e) {
      lastRes = null;
      showCodeMessage('Waiting for valid SVG', e.message, true);
      meta.textContent = e.message; meta.classList.add('err');
      return;
    }
    lastRes = res;
    renderCode(res.code, animate);
    $('#copyCode').disabled = $('#downloadCode').disabled = false;

    const src = 'data:image/svg+xml,' + encodeURIComponent(res.svg);
    const prev = $('#srcPreview img');
    if (!prev) $('#srcPreview').innerHTML = '<img alt="Preview of your SVG">';
    const img = $('#srcPreview img');
    if (img.getAttribute('src') !== src) img.src = src;

    meta.classList.remove('err');
    meta.textContent = Math.round(res.width) + ' × ' + Math.round(res.height) + ', ' + fmtBytes(res.inBytes);

    const saved = Math.round((1 - res.svgBytes / res.inBytes) * 100);
    $('#outMeta').innerHTML = format === 'svg'
      ? '<strong>' + fmtBytes(res.outBytes) + '</strong>' + (saved > 0 ? ', <span class="save">' + saved + '% smaller</span> than your input' : '')
      : '<strong>' + esc(res.filename) + '</strong>, ' + fmtBytes(res.outBytes);
  }

  function selectFormat(btn, run) {
    if (!btn) return;
    format = btn.dataset.format;
    fmtTabs.forEach((b) => {
      const on = b === btn;
      b.setAttribute('aria-selected', on);
      b.tabIndex = on ? 0 : -1;
    });
    moveInk($('#formats'), btn);
    const strip = $('#formats');
    if (strip.scrollWidth > strip.clientWidth) strip.scrollTo({ left: btn.offsetLeft - 40, behavior: reduceMotion ? 'auto' : 'smooth' });
    $$('.opt').forEach((o) => o.classList.toggle('off', o.dataset.for.split(' ').indexOf(format) < 0));
    if (run) convertNow(true);
  }
  fmtTabs.forEach((b) => b.addEventListener('click', () => selectFormat(b, true)));
  $('#formats').addEventListener('keydown', (e) => arrowNav(fmtTabs, e, (b) => selectFormat(b, true)));

  svgInput.addEventListener('input', () => { clearTimeout(convertTimer); convertTimer = setTimeout(() => convertNow(false), 160); });
  ['#compName'].forEach((id) => $(id).addEventListener('input', () => { clearTimeout(convertTimer); convertTimer = setTimeout(() => convertNow(false), 160); }));
  ['#optTs', '#optCurrent', '#optPrec'].forEach((id) => $(id).addEventListener('change', () => convertNow(true)));

  $('#sampleSvg').addEventListener('click', () => {
    const s = SAMPLES[sampleIndex++ % SAMPLES.length];
    setSvgInput(s.svg, s.name);
  });
  $('#useTraced').addEventListener('click', () => {
    if (!T.result) return;
    $('#compName').value = SVG2Code.pascal(T.name);
    setSvgInput(exportSvg());
  });
  $('#svgFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) setSvgInput(await f.text(), f.name);
  });

  $('#copyCode').addEventListener('click', async (e) => {
    if (!lastRes) return;
    const btn = e.currentTarget;
    if (await copyText(lastRes.code)) flashButton(btn, 'Copied');
    else toast('Your browser blocked the clipboard. Use Download instead.');
  });
  $('#downloadCode').addEventListener('click', () => {
    if (!lastRes) return;
    download(lastRes.code, lastRes.filename, format === 'svg' ? 'image/svg+xml' : 'text/plain');
    savedToast(lastRes.filename);
  });

  /* =========================================================
   * Page-wide: drop, paste, keys
   * ========================================================= */

  const veil = $('#dropveil');
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0;
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (dragDepth++ === 0) {
      $('div', veil).textContent = mode === 'code' ? 'Drop an SVG to convert it' : 'Drop to trace';
      veil.classList.add('on');
      stage.classList.add('dragover');
    }
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    if (--dragDepth <= 0) { dragDepth = 0; veil.classList.remove('on'); stage.classList.remove('dragover'); }
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    veil.classList.remove('on');
    stage.classList.remove('dragover');
    loadFile(e.dataTransfer.files[0]);
  });

  window.addEventListener('paste', (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const item = Array.from(cd.items || []).find((i) => i.kind === 'file' && /^image\//.test(i.type));
    if (item) { e.preventDefault(); loadFile(item.getAsFile(), 'pasted-image'); return; }
    if (e.target.closest && e.target.closest('textarea, input')) return;
    const text = cd.getData('text');
    if (/<svg[\s>]/i.test(text)) { e.preventDefault(); setMode('code'); setSvgInput(text); }
  });

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || mode !== 'trace' || !T.result) return;
    if (e.target.closest && e.target.closest('textarea, input, select')) return;
    const map = { 1: 'compare', 2: 'vector', 3: 'outline' };
    if (map[e.key]) setView(map[e.key]);
    else if (e.key === '0') zoomTo(1, 0, 0);
    else if (e.key === '+' || e.key === '=') zoomCenter(1.6);
    else if (e.key === '-') zoomCenter(1 / 1.6);
  });

  /* ---------- boot ---------- */

  applyPreset('illustration', false);
  selectFormat(fmtTabs[0], false);
  const settleInks = () => { moveInk(modebar, $('.mode[aria-selected="true"]'), true); moveInk($('#formats'), $('.fmt[aria-selected="true"]'), true); };
  settleInks();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(settleInks);
  window.addEventListener('resize', settleInks);
})();
