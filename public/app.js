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

// Storage browser
$('#listBtn').addEventListener('click', async () => {
  const box = $('#storageList');
  try {
    const j = await api('/api/storage/list');
    if (!j.configured) { box.textContent = 'R2 not configured: ' + j.hint; return; }
    box.innerHTML = (j.objects || []).map((o) =>
      '<div><a class="underline" href="/api/storage/download?key=' + encodeURIComponent(o.key) + '" target="_blank">' + o.key + '</a> <span class="text-zinc-500">(' + o.size + 'b)</span></div>'
    ).join('') || 'empty';
  } catch (e) { box.textContent = String(e.message); }
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
