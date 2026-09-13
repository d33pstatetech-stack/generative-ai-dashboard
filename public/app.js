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
    $('#healthBadge').textContent = 'worker ok · db:' + (h.bindings.db ? 'yes' : 'no') + ' r2:' + (h.bindings.r2 ? 'yes' : 'no');
  } catch (e) { $('#healthBadge').textContent = String(e.message); }
  try {
    const { links } = await api('/api/links');
    $('#linksGrid').innerHTML = links.map((l) =>
      '<div class="card"><div class="font-semibold"><a class="underline" href="' + l.url + '" target="_blank" rel="noopener">' + l.title + '</a></div>' +
      '<div class="text-xs text-zinc-400">' + (l.desc || l.kind) + '</div>' +
      '<div class="text-xs truncate text-zinc-500">' + l.url + '</div></div>'
    ).join('');
  } catch (e) { $('#linksGrid').innerHTML = '<div class="card">' + String(e.message) + '</div>'; }
  loadBalances(false);
})();

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

// Storage explorer: folder navigation, list/grid views, type filter,
// thumbnails, and a viewer modal with video controls (speed, slow-mo, frame step).
const storeState = { prefix: '', view: 'grid', filter: 'all', folders: [], objects: [], loading: false };
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
async function loadStore() {
  const box = $('#storageList');
  storeState.loading = true;
  try {
    const j = await api('/api/storage/list?prefix=' + encodeURIComponent(storeState.prefix) + '&delimiter=/');
    if (!j.configured) { box.textContent = 'R2 not configured: ' + j.hint; return; }
    storeState.folders = j.folders || [];
    storeState.objects = j.objects || [];
    if (j.truncated) box.dataset.note = ' (list truncated at 100 — narrow the prefix)';
    renderStore();
  } catch (e) { box.textContent = String(e.message); }
  finally { storeState.loading = false; }
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
  // Apply type filter
  const files = st.objects.filter((o) => st.filter === 'all' || storeKind(o.key) === st.filter);
  const folders = st.filter === 'all' ? st.folders : [];
  let html = '';
  if (st.view === 'grid') {
    html += '<div class="store-grid">';
    folders.forEach((f) => {
      html += '<div class="store-card" data-folder="' + esc(f) + '"><div class="store-folder">📁</div>' +
        '<div class="store-meta"><div class="truncate">' + esc(storeName(f.slice(0, -1))) + '/</div></div></div>';
    });
    files.forEach((o) => {
      const kind = storeKind(o.key), u = storeUrl(o.key), nm = storeName(o.key);
      let thumb;
      if (kind === 'image') thumb = '<img class="store-thumb" loading="lazy" src="' + u + '" alt="" />';
      else if (kind === 'video') thumb = '<video class="store-thumb" preload="metadata" muted playsinline src="' + u + '"></video>';
      else if (kind === 'audio') thumb = '<div class="store-folder">🎵</div>';
      else thumb = '<div class="store-folder">📄</div>';
      html += '<div class="store-card" data-key="' + esc(o.key) + '">' + thumb +
        '<div class="store-meta"><div class="truncate" title="' + esc(o.key) + '">' + esc(nm) + '</div>' +
        '<div class="text-zinc-500">' + fmtSize(o.size) + '</div></div></div>';
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
  if (box.dataset.note) { html += '<div class="text-zinc-500 text-xs mt-2">' + esc(box.dataset.note) + '</div>'; delete box.dataset.note; }
  box.innerHTML = html;
}
$('#listBtn').addEventListener('click', loadStore);
$('#storeViewList').addEventListener('click', () => { storeState.view = 'list'; renderStore(); });
$('#storeViewGrid').addEventListener('click', () => { storeState.view = 'grid'; renderStore(); });
$('#storeFilter').addEventListener('change', (e) => { storeState.filter = e.target.value; renderStore(); });
$('#storageList').addEventListener('click', (e) => {
  const f = e.target.closest('[data-folder]');
  if (f) { storeState.prefix = f.dataset.folder; loadStore(); return; }
  const c = e.target.closest('[data-key]');
  if (c && storeKind(c.dataset.key) !== 'other') { openViewer(c.dataset.key); return; }
});
$('#storeCrumbs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-crumb]');
  if (!b) return;
  storeState.prefix = b.dataset.crumb;
  loadStore();
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
  $('#viewerModal').classList.remove('hidden');
  renderViewer();
}
function closeViewer() {
  $('#viewerModal').classList.add('hidden');
  $('#viewerStage').innerHTML = '';
  $('#viewerControls').innerHTML = '';
  viewerState.files = [];
}
function viewerStep(d) {
  if (!viewerState.files.length) return;
  viewerState.idx = (viewerState.idx + d + viewerState.files.length) % viewerState.files.length;
  renderViewer();
}
function renderViewer() {
  const f = viewerState.files[viewerState.idx];
  if (!f) { closeViewer(); return; }
  const kind = storeKind(f.key), u = storeUrl(f.key);
  $('#viewerTitle').textContent = f.key + '  (' + (viewerState.idx + 1) + '/' + viewerState.files.length + ', ' + fmtSize(f.size) + ')';
  $('#viewerOpen').href = u;
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
          ? '<video src="' + esc(m.url) + '" controls preload="metadata" class="w-full max-h-64 rounded bg-black"></video>'
          : '<a href="' + esc(m.url) + '" target="_blank" rel="noopener"><img src="' + esc(m.url) + '" loading="lazy" class="w-full max-h-64 object-contain rounded bg-black" /></a>')
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
