// Tabs + health + links + balances + storage browser (no secrets here).
const $ = (s) => document.querySelector(s);

document.querySelectorAll('.tabbtn').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.tabbtn').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.tab').forEach((x) => x.classList.add('hidden'));
    b.classList.add('active');
    document.querySelector('#tab-' + b.dataset.tab).classList.remove('hidden');
  });
});
document.querySelector('[data-tab="projects"]').classList.add('active');

async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  if (r.status === 401) throw new Error('Access login required (Cloudflare Access). Sign in in the browser first.');
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}

(async () => {
  try {
    const h = await api('/api/health');
    $('#healthBadge').textContent = 'worker ok · ' + (h.version || '?') + ' · db:' + (h.bindings.db ? 'yes' : 'no') + ' r2:' + (h.bindings.r2 ? 'yes' : 'no');
  } catch (e) { $('#healthBadge').textContent = String(e.message); }
  let appUrls = {};
  try {
    const { links } = await api('/api/links');
    (links || []).forEach((l) => { if (l.kind === 'app') appUrls[l.id] = l.url; });
  } catch (e) { $('#appCards').innerHTML = '<div class="card">' + String(e.message) + '</div>'; }
  renderAppCards(appUrls);
  loadBalanceStrip(false);
  loadBalances(false);
})();

// Seven-segment LED renderer (green-on-black, $0.00 uniform format).
const SEG_MAP = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abfgcd' };
function ledHtml(amount) {
  const s = '$' + Number(amount).toFixed(2);
  let h = '';
  for (const ch of s) {
    if (ch === '$') { h += '<span class="led-dollar">$</span>'; continue; }
    if (ch === '.') { h += '<span class="led-dot">.</span>'; continue; }
    if (ch === '-') { h += '<span class="dseg"><i class="sg g on"></i></span>'; continue; }
    const on = SEG_MAP[ch] || '';
    h += '<span class="dseg">' + ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((g) =>
      '<i class="sg ' + g + (on.indexOf(g) >= 0 ? ' on' : '') + '"></i>').join('') + '</span>';
  }
  return h;
}
function ledError(el, msg) {
  el.querySelector('.led-value').innerHTML = '<span class="led-err">--.--</span>';
  el.querySelector('.led-sub').textContent = msg;
}
async function loadBalanceStrip(refresh) {
  const set = async (id, provider, pick) => {
    const el = document.querySelector(id);
    try {
      const j = await api('/api/balance/' + provider + (refresh ? '?refresh=1' : ''));
      const v = pick(j);
      if (v == null || !isFinite(Number(v))) { ledError(el, j.error || j.hint || j.note || 'unavailable'); return; }
      el.querySelector('.led-value').innerHTML = ledHtml(v);
      el.querySelector('.led-sub').textContent = j.cached ? 'cached' : 'live · ' + new Date(j.asOf || Date.now()).toLocaleTimeString();
    } catch (e) { ledError(el, String(e.message).slice(0, 60)); }
  };
  await Promise.all([
    set('#led-muapi', 'muapi', (j) => j.balance),
    set('#led-wavespeed', 'wavespeed', (j) => j.balance),
    set('#led-runpod', 'runpod', (j) => j.spend30d),
  ]);
}

const APP_CARDS = [
  {
    id: 'muapi', name: 'MuAPI', tag: 'VIDEO · LARGEST SELECTION',
    bullets: [
      '<b>683 models</b> live-counted: 361 video (175 I2V · 106 T2V · 80 V2V), 146 image, 17 LoRA-support, plus training / 3D / audio',
      'Cloud picker — R2 uploads auto re-hosted for image, video &amp; audio reference inputs',
      'Shared D1 history + ratings feed the prompt-enhancer templates',
    ],
    use: 'Use for <b>video</b> — the largest video-model selection in the stack (Hailuo H3, Veo, Kling, Wan, Seedance…).',
  },
  {
    id: 'wavespeed', name: 'WaveSpeed', tag: 'WIDEST CATALOG · CHEAP BULK',
    bullets: [
      '<b>1,035 models / 16 categories</b> synced to D1 with full param schemas + cost estimator',
      'R2 autosave on every run; presigned-URL cloud references',
      'Live-tested: Z-Image Turbo ≈ <b>$0.005/run</b>',
    ],
    use: 'Use for <b>cheap bulk experimentation</b> across the widest catalog — preview cost before you run.',
  },
  {
    id: 'replicate', name: 'Replicate', tag: 'IMAGE + CUSTOM LORAS',
    bullets: [
      '<b>16 hand-pinned models</b>: AZNTEN Flux LoRA (dev/schnell), FLUX.1-dev standalone, Krea 2, Qwen-Image, Wan 2.1/2.2, MiniMax H3',
      '<b>6 personal HF LoRAs</b> (D33pStateTech) + <b>20+ curated NSFW adapters</b> with one-click Fill into LoRA slots',
      'Schema-driven params with clamps, LoRA-strength sliders &amp; trigger-word hints',
    ],
    use: 'Use for <b>image + LoRA work</b> — cheapest, most controllable image generation with your custom LoRAs.',
  },
];
function renderAppCards(urls) {
  $('#appCards').innerHTML = APP_CARDS.map((a) =>
    '<div class="card app-card"><div class="app-tag">' + a.tag + '</div>' +
    '<div class="app-name">' + a.name + '</div>' +
    '<ul class="app-bullets">' + a.bullets.map((b) => '<li>' + b + '</li>').join('') + '</ul>' +
    '<div class="app-use">' + a.use + '</div>' +
    '<a class="btn app-open" href="' + (urls[a.id] || '#') + '" target="_blank" rel="noopener">Open app <i class="fa-solid fa-arrow-up-right-from-square text-xs"></i></a></div>'
  ).join('');
}

function card(p, body) {
  return '<div class="card"><div class="flex items-center gap-2 font-semibold">' + p +
    '</div><div class="mt-2 text-sm">' + body + '</div></div>';
}
function manualForm(provider, cur) {
  return '<div class="mt-2 flex gap-2 text-xs">' +
    '<input data-mval="' + provider + '" type="number" step="any" placeholder="manual value" value="' + (cur && cur.value != null ? cur.value : '') + '" class="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 w-32" />' +
    '<button data-msave="' + provider + '" class="btn text-xs">Save manual</button></div>';
}

async function loadBalances(refresh) {
  const grid = $('#balancesGrid');
  grid.innerHTML = '<div class="card">loading…</div>';
  try {
    const { balances } = await api('/api/balance' + (refresh ? '?refresh=1' : ''));
    let html = '';
    const mu = balances.muapi || {};
    html += card('muAPI <span class="badge ' + (mu.balance != null ? 'live' : 'error') + '">' + (mu.source || '') + '</span>',
      (mu.balance != null ? 'Balance: <b>' + mu.balance + '</b>' : 'Balance unavailable' + (mu.error ? ' — ' + mu.error : '') + (mu.hint ? ' (' + mu.hint + ')' : '')));
    const w = balances.wavespeed || {};
    html += card('WaveSpeed <span class="badge ' + (w.balance != null ? 'live' : 'error') + '">' + (w.source || '') + '</span>',
      (w.balance != null ? 'Balance: <b>$' + w.balance + '</b>' : 'Balance unavailable' + (w.error ? ' — ' + w.error : '')));
    const r = balances.runpod || {};
    html += card('RunPod <span class="badge live">' + (r.source || '') + '</span>',
      '30d spend: <b>' + (r.spend30d != null ? '$' + r.spend30d : 'n/a') + '</b><br/>pods: ' + (r.podCount ?? 'n/a') +
      ' · endpoints: ' + (r.endpointCount ?? 'n/a') + '<br/><a class="underline" target="_blank" href="' + (r.billingUrl || 'https://www.runpod.io/console/user/billing') + '">billing console</a>' +
      (r.note ? '<div class="text-xs text-zinc-500">' + r.note + '</div>' : ''));
    const rep = balances.replicate || {};
    html += card('Replicate <span class="badge ' + (rep.manual ? 'manual' : 'error') + '">' + (rep.source || '') + '</span>',
      (rep.tokenValid != null ? 'token: ' + (rep.tokenValid ? 'valid' : 'INVALID') + (rep.username ? ' (' + rep.username + ')' : '') + '<br/>' : '') +
      'Manual balance: <b>' + (rep.manual && rep.manual.value != null ? rep.manual.value : '—') + '</b><br/><a class="underline" target="_blank" href="https://replicate.com/account/billing">billing page (no public API)</a>' +
      manualForm('replicate', rep.manual));
    const mo = balances.modal || {};
    html += card('Modal <span class="badge ' + (mo.manual ? 'manual' : 'error') + '">' + (mo.source || '') + '</span>',
      'Manual spend/balance: <b>' + (mo.manual && mo.manual.value != null ? mo.manual.value : '—') + '</b><br/><a class="underline" target="_blank" href="https://modal.com/settings/billing">billing settings</a>' +
      '<div class="text-xs text-zinc-500">Tip: run `modal billing summary --json` on the VPS, then save here.</div>' + manualForm('modal', mo.manual));
    grid.innerHTML = html;
    grid.querySelectorAll('[data-msave]').forEach((btn) => btn.addEventListener('click', async () => {
      const p = btn.getAttribute('data-msave');
      const inp = grid.querySelector('[data-mval="' + p + '"]');
      const v = inp.value === '' ? null : Number(inp.value);
      await api('/api/balance/' + p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: v, note: 'manual via dashboard' }) });
      loadBalances(false);
    }));
  } catch (e) { grid.innerHTML = '<div class="card">' + String(e.message) + '</div>'; }
}
$('#refreshBtn').addEventListener('click', () => loadBalances(true));
const stripBtn = $('#stripRefresh');
if (stripBtn) stripBtn.addEventListener('click', () => loadBalanceStrip(true));

// Storage explorer: folder navigation, list/grid views, type filter,
// thumbnails, and a viewer modal with video controls (speed, slow-mo, frame step).
const storeState = { prefix: '', view: 'grid', filter: 'all', flat: false, folders: [], objects: [], cursor: null, truncated: false, renderLimit: 60, loading: false };
const STORE_PAGE = 60;
const STORE_IMG = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'svg', 'bmp'];
const STORE_VID = ['mp4', 'webm', 'mov', 'm4v'];
const STORE_AUD = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];
function storeKind(key) {
  const m = String(key || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  const e = m ? m[1] : '';
  if (STORE_IMG.indexOf(e) >= 0) return 'image';
  if (STORE_VID.indexOf(e) >= 0) return 'video';
  if (STORE_AUD.indexOf(e) >= 0) return 'audio';
  return 'other';
}
function storeUrl(key) { return '/api/storage/download?key=' + encodeURIComponent(key); }
function storeName(key) { const p = String(key || '').split('/'); return p[p.length - 1] || key; }
function fmtSize(b) {
  b = Number(b || 0);
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}
function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}
// Frame-export timestamp: 13S, 1M05S, 1H02M03S (floored to whole seconds).
function frameStamp(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const p2 = (n) => String(n).padStart(2, '0');
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return h + 'H' + p2(m) + 'M' + p2(s) + 'S';
  if (m > 0) return m + 'M' + p2(s) + 'S';
  return s + 'S';
}
function frameBaseName(key) {
  const nm = storeName(key).replace(/\.[a-z0-9]{2,5}$/i, '');
  return (nm.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'frame').slice(0, 120);
}
// Export the exact frame the video is paused on → frames/<video>_<stamp>.jpg
// (top-level folder, next to muapi/ replicate/ wavespeed/). Perfect for
// grabbing a clean I2V start frame without taking a bad tail frame.
async function exportFrame() {
  const msg = $('#vExportMsg');
  const say = (t) => { if (msg) msg.textContent = t; };
  const m = $('#viewerMedia');
  const f = viewerState.files[viewerState.idx];
  if (!m || m.tagName !== 'VIDEO' || !f) return;
  m.pause();
  if (m.readyState < 2 || !m.videoWidth || !m.videoHeight) {
    say('frame not ready — play a second, pause, retry'); return;
  }
  let blob = null;
  try {
    const c = document.createElement('canvas');
    c.width = m.videoWidth; c.height = m.videoHeight;
    c.getContext('2d').drawImage(m, 0, 0, c.width, c.height);
    blob = await new Promise((r) => { try { c.toBlob(r, 'image/jpeg', 0.92); } catch { r(null); } });
  } catch { blob = null; }
  if (!blob) { say('capture blocked by browser'); return; }
  const key = 'frames/' + frameBaseName(f.key) + '_' + frameStamp(m.currentTime) + '.jpg';
  say('uploading ' + key + '…');
  try {
    const r = await fetch('/api/storage/upload?key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) { say('export failed: ' + (j.error || ('HTTP ' + r.status))); return; }
    say('saved ✓ ' + key);
    if (storeState.prefix === '' || storeState.prefix === 'frames/') loadStore(false);
  } catch (e) { say('export failed: ' + e.message); }
}
async function loadStore(more) {
  const box = $('#storageList');
  const st = storeState;
  st.loading = true;
  try {
    let q = '/api/storage/list?prefix=' + encodeURIComponent(st.prefix);
    if (st.flat) q += '&recursive=1';
    else q += '&delimiter=/';
    if (more && st.cursor) q += '&cursor=' + encodeURIComponent(st.cursor);
    const j = await api(q);
    if (!j.configured) { box.textContent = 'R2 not configured: ' + j.hint; return; }
    st.folders = j.folders || [];
    st.objects = more ? st.objects.concat(j.objects || []) : (j.objects || []);
    st.truncated = !!j.truncated;
    st.cursor = j.cursor || null;
    if (!more) st.renderLimit = STORE_PAGE;
    renderStore();
  } catch (e) { box.textContent = String(e.message); }
  finally { st.loading = false; }
}
// Lazy thumbnails: placeholders swap in only when scrolled near the viewport.
// The queue is viewport-prioritized, not FIFO: jobs for cards that scrolled
// away or were removed are skipped (not run), and everything parks while the
// viewer is open so playback gets all of the browser's ~6 per-origin
// connections. Without this, 200 queued captures starve each other and the
// viewer — cards pulse forever and playback stalls with no error.
let viewerMediaOpen = false;
const thumbObserver = ('IntersectionObserver' in window) ? new IntersectionObserver((ents) => {
  for (const en of ents) {
    if (en.isIntersecting) { thumbObserver.unobserve(en.target); loadThumb(en.target); }
  }
}, { rootMargin: '200px' }) : null;
const thumbQueue = []; // {el, tries, prio}
let thumbActive = 0;
function elNearViewport(el, margin) {
  try {
    const r = el.getBoundingClientRect();
    const m = margin == null ? 800 : margin;
    return r.bottom > -m && r.top < (window.innerHeight + m);
  } catch { return true; }
}
function pumpThumbs() {
  // One pass over the current queue per call — requeued (parked) jobs wait
  // for the next pump instead of burning their retries in a single loop.
  let n = thumbQueue.length;
  while (thumbActive < 4 && thumbQueue.length && n-- > 0) {
    const job = thumbQueue.shift();
    if (!job.el.isConnected) continue; // card re-rendered — stale job
    if (viewerMediaOpen && !job.prio) { thumbQueue.push(job); continue; } // free parking while watching
    if (!elNearViewport(job.el)) {
      job.tries = (job.tries || 0) + 1;
      if (job.tries < 20) { thumbQueue.push(job); continue; }
      // Give up: static icon, stop pulsing. Fresh renders re-observe.
      try {
        job.el.classList.remove('thumb-ph');
        job.el.removeAttribute('data-thumb');
      } catch {}
      continue;
    }
    thumbActive++;
    job.el.dataset.done = '1';
    runThumbCapture(job).catch(() => {}).finally(() => { thumbActive--; pumpThumbs(); });
  }
}
function observeThumbs(root, prio) {
  const els = (root || document).querySelectorAll('[data-thumb]:not([data-done])');
  if (prio) els.forEach((el) => { el.dataset.prio = '1'; });
  if (!thumbObserver) { els.forEach(loadThumb); return; }
  els.forEach((el) => thumbObserver.observe(el));
}
// Capture one poster frame from a video without keeping a <video> mounted:
// temp element → first frame (or ~0.5s in) → JPEG data URL → element released.
function captureVideoPoster(url, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    // err: null on success, 'timeout' on stall, or 'media-err-N' (1 aborted,
    // 2 network, 3 decode, 4 src-not-supported) straight from the browser.
    const finish = (dataUrl, duration, err) => {
      if (done) return; done = true;
      try { v.removeAttribute('src'); v.load(); } catch {}
      resolve({ dataUrl: dataUrl || null, duration, err: err || null });
    };
    const v = document.createElement('video');
    // preload=metadata: fetch head + tail (moov) only, not the whole mdat.
    // The open-ended first range would otherwise pull the entire file.
    v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = url;
    const to = setTimeout(() => finish(null, v.duration, 'timeout'), timeoutMs || 12000);
    const grab = () => {
      if (done) return;
      clearTimeout(to);
      let dataUrl = null;
      try {
        const w = v.videoWidth, h = v.videoHeight;
        if (w && h) {
          const scale = Math.min(1, 320 / w);
          const c = document.createElement('canvas');
          c.width = Math.max(2, Math.round(w * scale));
          c.height = Math.max(2, Math.round(h * scale));
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          dataUrl = c.toDataURL('image/jpeg', 0.7);
        }
      } catch {}
      finish(dataUrl, v.duration);
    };
    v.addEventListener('loadeddata', () => {
      try {
        const t = (Number.isFinite(v.duration) && v.duration > 1) ? Math.min(0.5, v.duration / 3) : 0;
        if (t > 0.05) {
          v.addEventListener('seeked', grab, { once: true });
          try { v.currentTime = t; } catch { grab(); }
          setTimeout(grab, 5000); // seek fallback — grab whatever frame we have
        } else grab();
      } catch { grab(); }
    }, { once: true });
    v.addEventListener('error', () => { clearTimeout(to); finish(null, NaN, 'media-err-' + (v.error ? v.error.code : '?')); }, { once: true });
  });
}
function loadThumb(el) {
  if (!el || el.dataset.done) return;
  const card = el.closest('[data-kind]');
  const kind = card ? card.dataset.kind : (el.dataset.kind || '');
  const key = card ? card.dataset.key : el.dataset.key;
  if (!key) return;
  if (kind === 'image') {
    if (el.tagName === 'IMG') {
      el.dataset.done = '1';
      el.addEventListener('error', () => { el.classList.remove('thumb-ph'); }, { once: true });
      el.addEventListener('load', () => { el.classList.remove('thumb-ph'); }, { once: true });
      el.src = el.dataset.src;
    }
    return;
  }
  if (kind === 'video') {
    // Queued — done flag is set only when the capture actually starts,
    // so parked jobs stay eligible instead of being marked finished.
    thumbQueue.push({ el, tries: 0, prio: el.dataset.prio === '1' });
    pumpThumbs();
  }
}
async function runThumbCapture(job) {
  const el = job.el;
  const card = el.closest('[data-kind]');
  const key = card ? card.dataset.key : el.dataset.key;
  if (!key || !el.isConnected) return;
  let r;
  try { r = await captureVideoPoster(storeUrl(key), 12000); }
  catch { r = { dataUrl: null, duration: NaN, err: 'capture-threw' }; }
  if (!el.isConnected) return; // navigated away mid-capture
  // Playlist thumbs carry data-key themselves; grid thumbs live inside the card.
  const ph = (card === el || !card) ? el : (card.querySelector('[data-thumb]') || el);
  if (r.dataUrl && ph.isConnected) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = r.dataUrl;
    img.className = ph.hasAttribute('data-pl')
      ? ('pl-thumb' + (ph.className.indexOf('active') >= 0 ? ' active' : ''))
      : 'store-thumb';
    if (ph.hasAttribute('data-pl')) {
      const pl = ph.getAttribute('data-pl'), ti = ph.getAttribute('title');
      if (pl !== null) img.setAttribute('data-pl', pl);
      if (ti !== null) img.setAttribute('title', ti);
    }
    ph.replaceWith(img);
  } else if (ph.isConnected) {
    ph.classList.remove('thumb-ph'); // keep the 🎬 icon, stop pulsing
    ph.setAttribute('title', 'No preview: ' + (r.err || 'no-frame'));
    if (r.err) {
      const b = document.createElement('div');
      b.className = 'vfail';
      b.textContent = r.err;
      ph.appendChild(b);
    }
  }
  if (Number.isFinite(r.duration) && r.duration > 0 && card && card.isConnected) {
    const meta = card.querySelector('.vmeta');
    if (meta && meta.textContent.indexOf(':') < 0) meta.textContent += ' · ' + fmtTime(r.duration);
  }
}
function renderStore() {
  const box = $('#storageList');
  const st = storeState;
  // Breadcrumb
  const segs = st.prefix.split('/').filter(Boolean);
  let crumbs = '<button class="vbtn" data-crumb="">root</button>';
  let acc = '';
  segs.forEach((s) => {
    acc += s + '/';
    crumbs += ' / <button class="vbtn" data-crumb="' + esc(acc) + '">' + esc(s) + '</button>';
  });
  $('#storeCrumbs').innerHTML = crumbs;
  $('#storeViewList').style.borderColor = st.view === 'list' ? '#059669' : '';
  $('#storeViewGrid').style.borderColor = st.view === 'grid' ? '#059669' : '';
  // Apply type filter (+ client-side paging so huge flat views stay light)
  const allFiles = st.objects.filter((o) => st.filter === 'all' || storeKind(o.key) === st.filter);
  const files = allFiles.slice(0, st.renderLimit);
  const folders = (st.filter === 'all' && !st.flat) ? st.folders : [];
  let html = '';
  if (st.view === 'grid') {
    html += '<div class="store-grid">';
    folders.forEach((f) => {
      html += '<div class="store-card" data-folder="' + esc(f) + '"><div class="store-folder">📁</div>' +
        '<div class="store-meta"><div class="truncate">' + esc(storeName(f.slice(0, -1))) + '/</div></div></div>';
    });
    files.forEach((o) => {
      const kind = storeKind(o.key), u = storeUrl(o.key), nm = storeName(o.key);
      // Thumbnails are placeholders here — a scroll observer swaps in the real
      // preview only when the card is near the viewport (see observeThumbs).
      // Video cards never mount a <video> until opened: posters are captured
      // to canvas on demand instead, so 100 videos don't stall each other.
      let thumb;
      if (kind === 'image') thumb = '<img class="store-thumb thumb-ph" data-thumb data-src="' + u + '" alt="" />';
      else if (kind === 'video') thumb = '<div class="store-folder thumb-ph" data-thumb>🎬</div>';
      else if (kind === 'audio') thumb = '<div class="store-folder">🎵</div>';
      else thumb = '<div class="store-folder">📄</div>';
      html += '<div class="store-card" data-key="' + esc(o.key) + '" data-kind="' + kind + '">' + thumb +
        '<div class="store-meta"><div class="truncate" title="' + esc(o.key) + '">' + esc(nm) + '</div>' +
        '<div class="text-zinc-500 vmeta">' + fmtSize(o.size) + '</div></div></div>';
    });
    html += '</div>';
  } else {
    folders.forEach((f) => {
      html += '<div class="store-row" data-folder="' + esc(f) + '"><span>📁</span><span class="underline"> ' + esc(f) + '</span></div>';
    });
    files.forEach((o) => {
      const kind = storeKind(o.key);
      const icon = kind === 'image' ? '🖼️' : kind === 'video' ? '🎬' : kind === 'audio' ? '🎵' : '📄';
      html += '<div class="store-row"><span>' + icon + '</span>' +
        '<a class="underline truncate" href="' + storeUrl(o.key) + '" target="_blank" rel="noopener" style="max-width:60%">' + esc(o.key) + '</a>' +
        '<span class="text-zinc-500">(' + fmtSize(o.size) + ')</span>';
      if (kind !== 'other') html += ' <button class="vbtn" data-key="' + esc(o.key) + '">View</button>';
      html += '</div>';
    });
  }
  if (!folders.length && !files.length) html += '<div class="text-zinc-500">empty folder</div>';
  if (allFiles.length > files.length) html += '<div class="mt-3"><button class="btn" id="storeShowMore">Show more (' + files.length + ' of ' + allFiles.length + ')…</button></div>';
  if (st.truncated) html += '<div class="mt-3"><button class="btn" id="storeMore">Load more from storage (' + st.objects.length + ' fetched)…</button></div>';
  else if (st.flat && st.objects.length) html += '<div class="text-zinc-500 text-xs mt-2">' + st.objects.length + ' files, flat view — no subfolders to dig through.</div>';
  box.innerHTML = html;
  observeThumbs(box);
}
$('#listBtn').addEventListener('click', () => loadStore(false));
$('#storeFlat').addEventListener('click', () => {
  storeState.flat = !storeState.flat;
  $('#storeFlat').style.borderColor = storeState.flat ? '#059669' : '';
  loadStore(false);
});
$('#storeViewList').addEventListener('click', () => { storeState.view = 'list'; renderStore(); });
$('#storeViewGrid').addEventListener('click', () => { storeState.view = 'grid'; renderStore(); });
$('#storeFilter').addEventListener('change', (e) => { storeState.filter = e.target.value; storeState.renderLimit = STORE_PAGE; renderStore(); });
$('#storageList').addEventListener('click', (e) => {
  if (e.target.closest('#storeMore')) { loadStore(true); return; }
  if (e.target.closest('#storeShowMore')) { storeState.renderLimit += STORE_PAGE; renderStore(); return; }
  const f = e.target.closest('[data-folder]');
  if (f) { storeState.prefix = f.dataset.folder; loadStore(false); return; }
  const c = e.target.closest('[data-key]');
  if (c && storeKind(c.dataset.key) !== 'other') { openViewer(c.dataset.key); return; }
});
$('#storeCrumbs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-crumb]');
  if (!b) return;
  storeState.prefix = b.dataset.crumb;
  loadStore(false);
});

// Viewer modal: images full-size; video/audio with custom controls
// (play, seek, volume, speed select, slow-mo toggle, frame step, loop, fullscreen).
const viewerState = { files: [], idx: 0 };
function viewerMediaFiles() {
  return storeState.objects.filter((o) => storeKind(o.key) !== 'other');
}
function openViewer(key) {
  const files = viewerMediaFiles();
  let i = files.findIndex((o) => o.key === key);
  if (i < 0) i = 0;
  viewerState.files = files;
  viewerState.idx = i;
  viewerMediaOpen = true; // park background captures — playback gets the connections
  $('#viewerModal').classList.remove('hidden');
  renderViewer();
}
function closeViewer() {
  $('#viewerModal').classList.add('hidden');
  $('#viewerStage').innerHTML = '';
  $('#viewerControls').innerHTML = '';
  $('#viewerPlaylist').innerHTML = '';
  viewerState.files = [];
  viewerMediaOpen = false;
  pumpThumbs();
  observeThumbs($('#storageList')); // pick up cards parked while watching
}
function viewerStep(d) {
  if (!viewerState.files.length) return;
  viewerState.idx = (viewerState.idx + d + viewerState.files.length) % viewerState.files.length;
  renderViewer();
}
// Thumbnail playlist strip: the whole current file list is the queue —
// click any thumb to jump, and video auto-advances to the next item on ended.
function renderPlaylist() {
  const box = $('#viewerPlaylist');
  const files = viewerState.files;
  if (files.length < 2) { box.innerHTML = ''; return; }
  box.innerHTML = files.map((o, i) => {
    const kind = storeKind(o.key), u = storeUrl(o.key);
    const cls = i === viewerState.idx ? ' active' : '';
    const sel = 'data-pl="' + i + '" title="' + esc(storeName(o.key)) + '"';
    // Lazy like the grid — playlist can hold the whole flat view.
    if (kind === 'image') return '<img class="pl-thumb thumb-ph' + cls + '" ' + sel + ' data-thumb data-src="' + u + '" data-kind="image" data-key="' + esc(o.key) + '" alt="" />';
    if (kind === 'video') return '<div class="pl-thumbicon thumb-ph' + cls + '" ' + sel + ' data-thumb data-kind="video" data-key="' + esc(o.key) + '">🎬</div>';
    const icon = kind === 'audio' ? '🎵' : '📄';
    return '<div class="pl-thumbicon' + cls + '" ' + sel + '>' + icon + '</div>';
  }).join('');
  const active = box.querySelector('.active');
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'center' });
  observeThumbs(box, true); // playlist thumbs jump the queue even while watching
}
$('#viewerPlaylist').addEventListener('click', (e) => {
  const t = e.target.closest('[data-pl]');
  if (!t) return;
  viewerState.idx = parseInt(t.dataset.pl, 10) || 0;
  renderViewer();
});
function renderViewer() {
  const f = viewerState.files[viewerState.idx];
  if (!f) { closeViewer(); return; }
  const kind = storeKind(f.key), u = storeUrl(f.key);
  $('#viewerTitle').textContent = f.key + '  (' + (viewerState.idx + 1) + '/' + viewerState.files.length + ', ' + fmtSize(f.size) + ')';
  $('#viewerOpen').href = u;
  renderPlaylist();
  const stage = $('#viewerStage'), ctrl = $('#viewerControls');
  if (kind === 'image') {
    stage.innerHTML = '<img src="' + u + '" alt="" />';
    ctrl.innerHTML = '<a class="vbtn" href="' + u + '" download="' + esc(storeName(f.key)) + '">Download</a>';
    return;
  }
  const tag = kind === 'video' ? 'video' : 'audio';
  stage.innerHTML = '<' + tag + ' id="viewerMedia" src="' + u + '" preload="metadata" playsinline' +
    (kind === 'video' ? '' : ' controls style="width:100%"') + '></' + tag + '>';
  const m = $('#viewerMedia');
  const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
  ctrl.innerHTML =
    '<button class="vbtn" id="vPlay">▶</button>' +
    '<span id="vTime">0:00 / 0:00</span>' +
    '<input type="range" id="vSeek" class="vseek" min="0" max="1000" value="0" />' +
    '<button class="vbtn" id="vBack" title="Back 1 frame">|‹</button>' +
    '<button class="vbtn" id="vFwd" title="Forward 1 frame">›|</button>' +
    '<button class="vbtn" id="vSlow" title="Toggle slow motion (0.25×)">🐢 Slow</button>' +
    '<select id="vSpeed" class="vselect" title="Playback speed">' +
    speeds.map((s) => '<option value="' + s + '"' + (s === 1 ? ' selected' : '') + '>' + s + '×</option>').join('') +
    '</select>' +
    '<input type="range" id="vVol" min="0" max="100" value="100" style="width:70px" title="Volume" />' +
    '<button class="vbtn" id="vLoop" title="Loop">🔁</button>' +
    (kind === 'video' ? '<button class="vbtn" id="vFull" title="Fullscreen">⛶</button>' : '') +
    (kind === 'video' ? '<button class="vbtn" id="vShot" title="Export this frame to frames/ (works paused)">📷</button><span id="vExportMsg" class="text-zinc-400"></span>' : '') +
    '<a class="vbtn" href="' + u + '" download="' + esc(storeName(f.key)) + '">Download</a>';
  let prevSpeed = 1;
  const t = $('#vTime'), seek = $('#vSeek');
  m.addEventListener('loadedmetadata', () => { t.textContent = '0:00 / ' + fmtTime(m.duration); });
  m.addEventListener('timeupdate', () => {
    t.textContent = fmtTime(m.currentTime) + ' / ' + fmtTime(m.duration);
    if (Number.isFinite(m.duration) && m.duration > 0 && document.activeElement !== seek) {
      seek.value = Math.round((m.currentTime / m.duration) * 1000);
    }
  });
  m.addEventListener('play', () => { $('#vPlay').textContent = '⏸'; });
  m.addEventListener('pause', () => { $('#vPlay').textContent = '▶'; });
  m.addEventListener('error', () => {
    const code = m.error ? m.error.code : '?';
    const names = { 1: 'aborted', 2: 'network', 3: 'decode', 4: 'not-supported' };
    const d = document.createElement('div');
    d.className = 'verror';
    d.innerHTML = 'Failed to load (error ' + code + ': ' + (names[code] || '?') + '). ' +
      '<a class="underline" href="' + u + '" target="_blank" rel="noopener">Open original in new tab</a>';
    stage.appendChild(d);
  });
  m.addEventListener('ended', () => {
    if (m.loop || viewerState.files.length < 2) return;
    viewerStep(1);
    const nm = $('#viewerMedia');
    if (nm && nm.play) nm.play().catch(() => {});
  });
  $('#vPlay').addEventListener('click', () => { if (m.paused) m.play().catch(() => {}); else m.pause(); });
  seek.addEventListener('input', () => {
    if (Number.isFinite(m.duration) && m.duration > 0) m.currentTime = (seek.value / 1000) * m.duration;
  });
  $('#vSpeed').addEventListener('change', (e) => {
    m.playbackRate = parseFloat(e.target.value) || 1;
    $('#vSlow').classList.toggle('on', m.playbackRate === 0.25);
  });
  $('#vSlow').addEventListener('click', () => {
    if (m.playbackRate === 0.25) { m.playbackRate = prevSpeed === 0.25 ? 1 : prevSpeed; }
    else { prevSpeed = m.playbackRate; m.playbackRate = 0.25; }
    $('#vSpeed').value = String(m.playbackRate);
    $('#vSlow').classList.toggle('on', m.playbackRate === 0.25);
  });
  const stepFrame = (d) => { m.pause(); if (Number.isFinite(m.duration)) m.currentTime = Math.min(Math.max(0, m.currentTime + d / 30), m.duration || 0); };
  $('#vBack').addEventListener('click', () => stepFrame(-1));
  $('#vFwd').addEventListener('click', () => stepFrame(1));
  $('#vVol').addEventListener('input', (e) => { m.volume = (parseInt(e.target.value, 10) || 0) / 100; m.muted = false; });
  $('#vLoop').addEventListener('click', (e) => { m.loop = !m.loop; e.target.classList.toggle('on', m.loop); });
  const shot = $('#vShot');
  if (shot) shot.addEventListener('click', exportFrame);
  const full = $('#vFull');
  if (full) full.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (m.requestFullscreen) m.requestFullscreen().catch(() => {});
    else if (m.webkitEnterFullscreen) m.webkitEnterFullscreen();
  });
}
$('#viewerClose').addEventListener('click', closeViewer);
$('#viewerBackdrop').addEventListener('click', closeViewer);
$('#viewerPrev').addEventListener('click', () => viewerStep(-1));
$('#viewerNext').addEventListener('click', () => viewerStep(1));
document.addEventListener('keydown', (e) => {
  if ($('#viewerModal').classList.contains('hidden')) return;
  if (e.key === 'Escape') closeViewer();
  else if (e.key === 'ArrowLeft') viewerStep(-1);
  else if (e.key === 'ArrowRight') viewerStep(1);
  else if (e.key === ' ') {
    const m = $('#viewerMedia');
    if (m && (e.target === document.body || e.target === m)) { e.preventDefault(); if (m.paused) m.play().catch(() => {}); else m.pause(); }
  }
});

// Storage browser + batch uploader (multi-file, folder, drag-drop).
const storeQueue = []; // {file, relPath, status: 'queued|uploading|done|error', detail}

function queueFiles(files, basePath) {
  for (const f of files) {
    const rel = (f.webkitRelativePath || (basePath ? basePath + '/' + f.name : f.name)).replace(/^\/+/, '');
    storeQueue.push({ file: f, relPath: rel, status: 'queued', detail: '' });
  }
  renderQueue();
}

function renderQueue() {
  const box = $('#uploadQueue');
  if (!storeQueue.length) { box.innerHTML = '<span class="text-zinc-500">queue empty</span>'; return; }
  box.innerHTML = storeQueue.map((q, i) =>
    '<div>[' + q.status + '] ' + q.relPath + ' <span class="text-zinc-500">(' + q.file.size + 'b)</span> ' +
    (q.detail ? '<span class="text-zinc-400">' + q.detail + '</span>' : '') + '</div>'
  ).join('');
}

async function collectDroppedEntries(items) {
  // Traverse dropped folders via FileSystem API; fall back to plain files.
  const out = [];
  const walk = (entry, path) => new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((f) => {
        f._dropPath = (path ? path + '/' : '') + f.name;
        out.push(f);
        resolve();
      }, resolve);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readAll = () => reader.readEntries(async (entries) => {
        if (!entries.length) { resolve(); return; }
        for (const e of entries) await walk(e, (path ? path + '/' : '') + entry.name);
        readAll();
      }, resolve);
      readAll();
    } else resolve();
  });
  const jobs = [];
  for (const it of items) {
    const e = it.webkitGetAsEntry && it.webkitGetAsEntry();
    if (e) jobs.push(walk(e, ''));
    else if (it.getAsFile()) { const f = it.getAsFile(); f._dropPath = f.name; out.push(f); }
  }
  await Promise.all(jobs);
  return out;
}

$('#storeFiles').addEventListener('change', (e) => {
  queueFiles(Array.from(e.target.files), '');
  e.target.value = '';
});
$('#storeDir').addEventListener('change', (e) => {
  queueFiles(Array.from(e.target.files), '');
  e.target.value = '';
});
const dz = $('#dropZone');
['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.style.borderColor = '#059669'; }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.style.borderColor = ''; }));
dz.addEventListener('drop', async (e) => {
  const dt = e.dataTransfer;
  let files = [];
  if (dt.items && dt.items.length && dt.items[0].webkitGetAsEntry) {
    files = await collectDroppedEntries(Array.from(dt.items));
    queueFiles(files.map((f) => {
      if (f._dropPath) {
        try { Object.defineProperty(f, 'webkitRelativePath', { value: f._dropPath }); } catch {}
      }
      return f;
    }), '');
  } else {
    queueFiles(Array.from(dt.files), '');
  }
});
$('#clearQueueBtn').addEventListener('click', () => {
  for (let i = storeQueue.length - 1; i >= 0; i--) {
    if (storeQueue[i].status !== 'uploading') storeQueue.splice(i, 1);
  }
  renderQueue();
});
renderQueue();

async function uploadOne(q, prefix) {
  q.status = 'uploading';
  renderQueue();
  const key = (prefix + q.relPath).replace(/\/+/g, '/');
  try {
    const r = await fetch('/api/storage/upload?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': q.file.type || 'application/octet-stream' },
      body: q.file,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    q.status = 'done';
    q.detail = key;
  } catch (err) {
    q.status = 'error';
    q.detail = String(err.message || err);
  }
  renderQueue();
}

$('#uploadBtn').addEventListener('click', async () => {
  let prefix = ($('#storePrefix').value || 'uploads/').trim();
  if (prefix && !prefix.endsWith('/')) prefix += '/';
  const pending = storeQueue.filter((q) => q.status === 'queued' || q.status === 'error');
  if (!pending.length) { alert('queue is empty — pick files, a folder, or drop them above'); return; }
  const CONCURRENCY = 4;
  let i = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
    while (i < pending.length) uploadOne(pending[i++], prefix);
  });
  await Promise.all(workers);
  $('#listBtn').click();
});

// ── Shared history browser (genai-history via Worker) ──
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function histPromptOf(run) {
  try {
    const j = JSON.parse(run.input_preview || '{}');
    if (typeof j.prompt === 'string' && j.prompt) return j.prompt;
    if (typeof j.text === 'string' && j.text) return j.text;
  } catch {}
  return (run.input_preview || '').slice(0, 400);
}
function histMediaUrl(run) {
  try {
    const keys = JSON.parse(run.r2_keys_json || '[]');
    if (keys.length) return { url: '/api/storage/download?key=' + encodeURIComponent(keys[0]), via: 'r2', key: keys[0] };
  } catch {}
  try {
    const outs = JSON.parse(run.output_urls_json || '[]');
    if (outs.length) return { url: outs[0], via: 'cdn', key: null };
  } catch {}
  return null;
}
function histIsVideo(u) { return /\.(mp4|webm|mov)(\?|$)/i.test(u || ''); }
function histStars(run) {
  const cur = run.rating || 0;
  let s = '';
  for (let i = 1; i <= 5; i++) {
    s += '<button data-rate="' + run.id + ':' + i + '" class="text-lg leading-none ' + (i <= cur ? 'text-amber-400' : 'text-zinc-600 hover:text-amber-300') + '" title="rate ' + i + '">★</button>';
  }
  return s;
}
async function loadHistStats() {
  const box = $('#histStats');
  try {
    const s = await api('/api/history/stats');
    box.textContent = s.runs + ' runs · ' + s.with_r2 + ' with R2 media · ' + s.rated + ' rated' +
      (s.avg_rating != null ? ' (avg ' + s.avg_rating + ')' : '') + ' · ' + s.enhancements + ' enhancements';
  } catch (e) { box.textContent = String(e.message); }
}
async function loadHistory() {
  const grid = $('#histGrid');
  grid.innerHTML = '<div class="card">loading…</div>';
  const q = new URLSearchParams();
  const pv = $('#histProvider').value, ml = $('#histModel').value.trim(), st = $('#histStatus').value,
    mr = $('#histMinRating').value, od = $('#histOrder').value;
  if (pv) q.set('provider', pv);
  if (ml) q.set('model_like', ml);
  if (st) q.set('status', st);
  if (mr === 'unrated') q.set('unrated', '1');
  else if (mr) q.set('min_rating', mr);
  if (od) q.set('order', od);
  q.set('limit', '60');
  try {
    const { runs } = await api('/api/history/runs?' + q.toString());
    if (!runs.length) { grid.innerHTML = '<div class="card">no runs match</div>'; return; }
    grid.innerHTML = runs.map((r) => {
      const m = histMediaUrl(r);
      const media = m
        ? (histIsVideo(m.url)
          ? '<video src="' + esc(m.url) + '" controls preload="metadata" class="hist-media w-full max-h-64 rounded bg-black"></video>'
          : '<a href="' + esc(m.url) + '" target="_blank" rel="noopener"><img src="' + esc(m.url) + '" loading="lazy" class="hist-media w-full max-h-64 object-contain rounded bg-black" /></a>')
        : '<div class="text-zinc-600 text-sm">no media saved</div>';
      let loras = {};
      try { loras = JSON.parse(r.loras_json || '{}'); } catch {}
      const loraBadge = Object.keys(loras).length ? ' <span class="badge manual">LoRA</span>' : '';
      return '<div class="card">' + media +
        '<div class="mt-2 text-sm font-semibold">' + esc(r.model) + loraBadge +
        ' <span class="badge ' + (r.status === 'succeeded' || r.status === 'completed' ? 'live' : (r.status === 'failed' ? 'error' : '')) + '">' + esc(r.status || '') + '</span></div>' +
        '<div class="text-xs text-zinc-500">' + esc(r.provider) + ' · ' + esc(r.source_app || '') + ' · ' + esc(r.created_at || '') + (r.enhancement_id ? ' · <span title="linked enhancement">enh#' + r.enhancement_id + '</span>' : '') + '</div>' +
        '<div class="mt-1 text-xs text-zinc-300 whitespace-pre-wrap" style="max-height:7rem;overflow:hidden">' + esc(histPromptOf(r).slice(0, 500)) + '</div>' +
        '<div class="mt-2 flex items-center gap-1">' + histStars(r) + '<span class="text-xs text-zinc-500 ml-1">rate</span></div>' +
        '</div>';
    }).join('');
    // Remote CDN links can expire (MuAPI purges after ~30d): swap dead players for a note.
    grid.querySelectorAll('.hist-media').forEach((el) => {
      el.addEventListener('error', () => {
        const note = document.createElement('div');
        note.className = 'text-zinc-500 text-sm rounded bg-black px-3 py-8 text-center';
        note.textContent = 'media unavailable — source link expired (no R2 copy was saved)';
        el.replaceWith(note);
      }, { once: true });
    });
    grid.querySelectorAll('[data-rate]').forEach((btn) => btn.addEventListener('click', async () => {
      const [id, rating] = btn.getAttribute('data-rate').split(':');
      try {
        await api('/api/history/rate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: Number(id), rating: Number(rating) }) });
        // Update stars in place — no grid re-render, so scroll position is preserved.
        // If filtering to unrated only, the card no longer matches: fade it out instead of reloading.
        const onlyUnrated = $('#histMinRating').value === 'unrated';
        if (onlyUnrated) {
          const cardEl = btn.closest('.card');
          if (cardEl) { cardEl.style.transition = 'opacity .4s'; cardEl.style.opacity = '0.25'; cardEl.querySelectorAll('[data-rate]').forEach((b) => { b.disabled = true; }); }
        } else {
          btn.closest('.card').querySelectorAll('[data-rate]').forEach((b) => {
            const on = Number(b.dataset.rate) <= Number(rating);
            b.classList.toggle('text-amber-400', on);
            b.classList.toggle('text-zinc-600', !on);
          });
        }
        loadHistStats();
      } catch (e) { alert(String(e.message)); }
    }));
  } catch (e) { grid.innerHTML = '<div class="card">' + esc(String(e.message)) + '</div>'; }
}
$('#histSearchBtn').addEventListener('click', loadHistory);
loadHistStats();
