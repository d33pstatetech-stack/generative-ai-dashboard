/**
 * Generative AI Dashboard - Cloudflare Worker
 * Hub links + hybrid balance proxy + R2 storage browser.
 * Access-locked like muapi-prompt-generator / replicate-prompt-orchestrator.
 *
 * Routes:
 *   GET  /api/health
 *   GET  /api/links
 *   GET  /api/balance                → all providers (cached where possible)
 *   GET  /api/balance/:provider      → muapi|wavespeed|runpod|replicate|modal
 *   PUT  /api/balance/:provider      → {value, note} manual fallback (replicate/modal)
 *   GET  /api/storage/list?prefix=
 *   POST /api/storage/upload?key=    → body = file bytes
 *   GET  /api/storage/download?key=
 *   GET  /api/history/runs?provider=&model_like=&status=&min_rating=&order=newest|top&limit=
 *   GET  /api/history/enhancements?kind=&model_like=&limit=
 *   GET  /api/history/stats          → totals, by provider/model, ratings
 *   POST /api/history/rate           → {id mask} or {provider, external_job_id} + {rating 1-5}
 *   * → static assets (public/)
 */

const PROTECTED_API_PREFIXES = ['/api/balance', '/api/storage', '/api/links', '/api/config', '/api/history'];
const PROVIDERS = ['muapi', 'wavespeed', 'runpod', 'replicate', 'modal'];
const CACHE_TTL_MS = 10 * 60 * 1000;

function isAccessAuthenticated(request) {
  const url = new URL(request.url);
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return true;
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  return !!(jwt || email);
}

function jsonResponse(obj, status = 200, extra = {}) {
  const res = new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
  return res;
}

function histDB(env) { return env.HISTORY || null; }

// Extension → content-type fallback for objects stored before the uploader
// set proper httpMetadata (or stored as application/octet-stream).
const EXT_CONTENT_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml', bmp: 'image/bmp',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
};
function guessContentType(key, stored) {
  if (stored && stored !== 'application/octet-stream') return stored;
  const m = String(key || '').split('?')[0].match(/\.([a-z0-9]{2,5})$/i);
  return (m && EXT_CONTENT_TYPES[m[1].toLowerCase()]) || stored || 'application/octet-stream';
}

async function readCache(env, provider) {
  try {
    if (!env.DB) return null;
    const row = await env.DB.prepare('SELECT json, updated_at FROM balance_cache WHERE provider=?').bind(provider).first();
    if (!row) return null;
    const age = Date.now() - Date.parse(row.updated_at + 'Z');
    return { data: JSON.parse(row.json), ageMs: age, fresh: age < CACHE_TTL_MS };
  } catch { return null; }
}

async function writeCache(env, provider, data) {
  try {
    if (!env.DB) return;
    await env.DB.prepare(
      "INSERT OR REPLACE INTO balance_cache (provider, json, updated_at) VALUES (?, ?, datetime('now'))"
    ).bind(provider, JSON.stringify(data)).run();
  } catch {}
}

async function readManual(env, provider) {
  try {
    if (!env.DB) return null;
    const row = await env.DB.prepare('SELECT value, note, updated_at FROM manual_balances WHERE provider=?').bind(provider).first();
    return row || null;
  } catch { return null; }
}

async function fetchMuapi(env) {
  const key = env.MUAPI_API_KEY || '';
  if (!key) return { provider: 'muapi', source: 'unconfigured', balance: null, hint: 'Set MUAPI_API_KEY via wrangler secret' };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch('https://api.muapi.ai/api/v1/account/balance', {
      headers: { 'x-api-key': key },
      signal: ctrl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { provider: 'muapi', source: 'live', balance: null, error: j.message || ('HTTP ' + r.status) };
    const balance = typeof j.balance === 'number' ? j.balance : (j.data && j.data.balance) ?? null;
    return { provider: 'muapi', source: 'live', balance, currency: 'credits/USD', asOf: new Date().toISOString() };
  } catch (e) {
    return { provider: 'muapi', source: 'live', balance: null, error: String(e.message || e) };
  } finally { clearTimeout(to); }
}

async function fetchWavespeed(env) {
  const key = env.WAVESPEED_API_KEY || '';
  if (!key) return { provider: 'wavespeed', source: 'unconfigured', balance: null, hint: 'Set WAVESPEED_API_KEY' };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch('https://api.wavespeed.ai/api/v3/balance', {
      headers: { Authorization: 'Bearer ' + key },
      signal: ctrl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (j.code !== 200) return { provider: 'wavespeed', source: 'live', balance: null, error: j.message || ('HTTP ' + r.status) };
    return { provider: 'wavespeed', source: 'live', balance: j.data && j.data.balance, currency: 'USD', asOf: new Date().toISOString() };
  } catch (e) {
    return { provider: 'wavespeed', source: 'live', balance: null, error: String(e.message || e) };
  } finally { clearTimeout(to); }
}

async function fetchRunpod(env) {
  const key = env.RUNPOD_API_KEY || '';
  if (!key) return { provider: 'runpod', source: 'unconfigured', spend30d: null, hint: 'Set RUNPOD_API_KEY' };
  const headers = { Authorization: 'Bearer ' + key };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const [billing, pods, endpoints] = await Promise.all([
      fetch('https://api.runpod.io/v2/billing?lastN=30&bucketSize=day', { headers, signal: ctrl.signal }).then((r) => r.json().catch(() => null)),
      fetch('https://api.runpod.io/v2/pods', { headers, signal: ctrl.signal }).then((r) => r.json().catch(() => null)),
      fetch('https://api.runpod.io/v2/serverless', { headers, signal: ctrl.signal }).then((r) => r.json().catch(() => null)),
    ]);
    let spend30d = null;
    if (billing && billing.metadata && billing.metadata.totals) spend30d = billing.metadata.totals.totalAmount ?? null;
    const podCount = Array.isArray(pods) ? pods.length : (pods && pods.pods ? pods.pods.length : null);
    const epCount = endpoints && endpoints.endpoints ? endpoints.endpoints.length : null;
    return {
      provider: 'runpod', source: 'live', spend30d, podCount, endpointCount: epCount,
      volumeId: env.RUNPOD_NETWORK_VOLUME_ID || env.RUNPOD_VOLUME_ID || 'vz9pcezb40',
      billingUrl: 'https://www.runpod.io/console/user/billing',
      asOf: new Date().toISOString(),
      note: 'Runpod is pay-as-you-go: showing 30d spend + resource counts (no credit wallet).',
    };
  } catch (e) {
    return { provider: 'runpod', source: 'live', spend30d: null, error: String(e.message || e) };
  } finally { clearTimeout(to); }
}

async function fetchReplicate(env) {
  const token = env.REPLICATE_API_TOKEN || '';
  const manual = await readManual(env, 'replicate');
  if (!token) {
    return { provider: 'replicate', source: manual ? 'manual' : 'unconfigured', manual, billingUrl: 'https://replicate.com/account/billing', hint: 'No public balance API; set manual value or REPLICATE_API_TOKEN for token check.' };
  }
  try {
    const r = await fetch('https://api.replicate.com/v1/account', { headers: { Authorization: 'Bearer ' + token } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { provider: 'replicate', source: 'live-error', tokenValid: false, manual, error: j.detail || ('HTTP ' + r.status), billingUrl: 'https://replicate.com/account/billing' };
    return { provider: 'replicate', source: manual ? 'manual' : 'token-valid', tokenValid: true, username: j.username || j.name || null, manual, billingUrl: 'https://replicate.com/account/billing', note: 'Replicate has no public balance API; enter balance manually from billing page.' };
  } catch (e) {
    return { provider: 'replicate', source: 'live-error', tokenValid: null, manual, error: String(e.message || e), billingUrl: 'https://replicate.com/account/billing' };
  }
}

async function fetchModal(env) {
  const manual = await readManual(env, 'modal');
  const configured = !!(env.MODAL_TOKEN_ID && env.MODAL_TOKEN_SECRET);
  return {
    provider: 'modal', source: manual ? 'manual' : (configured ? 'token-present' : 'unconfigured'),
    manual, tokenPresent: configured,
    billingUrl: 'https://modal.com/settings/billing',
    hint: 'Modal has no simple balance API. Enter manually, or run `modal billing summary --json` on your VPS and PUT the result here.',
  };
}

async function getProviderBalance(env, provider, opts = {}) {
  const cached = await readCache(env, provider);
  if (cached && cached.fresh && !opts.refresh) return { ...cached.data, cached: true };
  let data;
  if (provider === 'muapi') data = await fetchMuapi(env);
  else if (provider === 'wavespeed') data = await fetchWavespeed(env);
  else if (provider === 'runpod') data = await fetchRunpod(env);
  else if (provider === 'replicate') data = await fetchReplicate(env);
  else if (provider === 'modal') data = await fetchModal(env);
  else data = { provider, error: 'unknown provider' };
  if (data.source === 'live' || data.source === 'token-valid' || data.source === 'token-present') await writeCache(env, provider, data);
  return { ...data, cached: false };
}

function links(env) {
  return [
    { id: 'muapi', title: 'MuAPI Prompt Generator', url: env.MUAPI_APP_URL || 'https://muapi-prompt-generator.d33pstatetech.workers.dev', kind: 'app', desc: '600+ image/video/audio/3D models, D1 catalog, Worker proxy' },
    { id: 'replicate', title: 'Replicate Prompt Orchestrator', url: env.REPLICATE_APP_URL || 'https://replicate-prompt-orchestrator.d33pstatetech.workers.dev', kind: 'app', desc: 'Schema-driven Replicate UI + enhancer' },
    { id: 'wavespeed', title: 'WaveSpeed Prompt Generator', url: env.WAVESPEED_APP_URL || 'https://wavespeed-prompt-generator.d33pstatetech.workers.dev', kind: 'app', desc: '1035-model WaveSpeed catalog, D1 params, R2 autosave' },
    { id: 'muapi-billing', title: 'MuAPI Billing', url: 'https://muapi.ai/dashboard/billing', kind: 'billing' },
    { id: 'replicate-billing', title: 'Replicate Billing', url: 'https://replicate.com/account/billing', kind: 'billing' },
    { id: 'wavespeed-billing', title: 'WaveSpeed Billing', url: 'https://wavespeed.ai/billing', kind: 'billing' },
    { id: 'runpod-console', title: 'RunPod Console', url: 'https://www.runpod.io/console', kind: 'billing' },
    { id: 'runpod-tree', title: 'RunPod Volume File Tree (vz9pcezb40)', url: './runpod-tree.html', kind: 'data', desc: 'Styled viewer: overview map, search filter, full listing — 5287 objects' },
    { id: 'runpod-tree-txt', title: 'RunPod Volume Tree (raw .txt)', url: './runpod-tree.txt', kind: 'data', desc: 'Plain-text fallback of the full tree listing' },
    { id: 'modal-billing', title: 'Modal Billing', url: 'https://modal.com/settings/billing', kind: 'billing' },
  ];
}

const BUILD_VERSION = '2026-09-16-redesign.2';

async function handleApiRoute(request, env, path, url) {
  if (path === '/api/health' && request.method === 'GET') {
    return jsonResponse({
      ok: true,
      time: new Date().toISOString(),
      version: BUILD_VERSION,
      bindings: { db: !!env.DB, r2: !!env.ASSETS_BUCKET },
      providers: PROVIDERS,
    });
  }
  if (path === '/api/links' && request.method === 'GET') {
    return jsonResponse({ links: links(env) });
  }
  if (path === '/api/balance' && request.method === 'GET') {
    const refresh = url.searchParams.get('refresh') === '1';
    const out = {};
    for (const p of PROVIDERS) out[p] = await getProviderBalance(env, p, { refresh });
    return jsonResponse({ balances: out });
  }
  const m = path.match(/^\/api\/balance\/([a-z]+)$/);
  if (m) {
    const provider = m[1];
    if (!PROVIDERS.includes(provider)) return jsonResponse({ error: 'unknown provider' }, 404);
    if (request.method === 'GET') {
      const refresh = url.searchParams.get('refresh') === '1';
      return jsonResponse(await getProviderBalance(env, provider, { refresh }));
    }
    if (request.method === 'PUT') {
      let body;
      try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }
      if (!env.DB) return jsonResponse({ error: 'D1 not bound; cannot store manual balance' }, 500);
      const value = body.value === null || body.value === undefined ? null : Number(body.value);
      if (value !== null && !Number.isFinite(value)) return jsonResponse({ error: 'value must be a number or null' }, 400);
      await env.DB.prepare(
        "INSERT OR REPLACE INTO manual_balances (provider, value, note, updated_at) VALUES (?, ?, ?, datetime('now'))"
      ).bind(provider, value, String(body.note || '').slice(0, 500)).run();
      try {
        await env.DB.prepare('DELETE FROM balance_cache WHERE provider=?').bind(provider).run();
      } catch {}
      return jsonResponse({ ok: true });
    }
  }
  if (path === '/api/storage/list' && request.method === 'GET') {
    if (!env.ASSETS_BUCKET) return jsonResponse({ configured: false, hint: 'Create R2 bucket genai-assets and bind ASSETS_BUCKET' });
    const prefix = url.searchParams.get('prefix') || '';
    const recursive = url.searchParams.get('recursive') === '1';
    const delimiter = recursive ? undefined : (url.searchParams.get('delimiter') || '/');
    const cursor = url.searchParams.get('cursor') || undefined;
    const listed = await env.ASSETS_BUCKET.list({ prefix, delimiter, cursor, limit: 1000 });
    return jsonResponse({
      configured: true,
      prefix,
      recursive,
      folders: listed.delimitedPrefixes || [],
      objects: (listed.objects || []).map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded })),
      truncated: !!listed.truncated,
      cursor: listed.truncated ? (listed.cursor || null) : null,
    });
  }
  if (path === '/api/storage/upload' && request.method === 'POST') {
    if (!env.ASSETS_BUCKET) return jsonResponse({ configured: false }, 500);
    const key = (url.searchParams.get('key') || '').replace(/^\/+/, '').slice(0, 512);
    if (!key) return jsonResponse({ error: 'key query param required' }, 400);
    const ct = request.headers.get('content-type') || 'application/octet-stream';
    const buf = await request.arrayBuffer();
    if (!buf || buf.byteLength === 0) return jsonResponse({ error: 'empty body' }, 400);
    if (buf.byteLength > 100 * 1024 * 1024) return jsonResponse({ error: 'file too large for Worker upload (100MB cap); use presigned URL flow' }, 413);
    await env.ASSETS_BUCKET.put(key, buf, { httpMetadata: { contentType: ct } });
    return jsonResponse({ ok: true, key, size: buf.byteLength });
  }
  if (path === '/api/storage/download' && request.method === 'GET') {
    if (!env.ASSETS_BUCKET) return jsonResponse({ configured: false }, 500);
    const key = (url.searchParams.get('key') || '').replace(/^\/+/, '');
    if (!key) return jsonResponse({ error: 'key required' }, 400);
    const obj = await env.ASSETS_BUCKET.get(key);
    if (!obj) return jsonResponse({ error: 'not found' }, 404);
    const ct = guessContentType(key, obj.httpMetadata?.contentType);
    // Range support so <video>/<audio> can seek without downloading everything.
    const range = request.headers.get('range');
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (m) {
        const size = obj.size;
        let start = m[1] === '' ? null : parseInt(m[1], 10);
        let end = m[2] === '' ? null : parseInt(m[2], 10);
        if (start === null && end !== null) { start = Math.max(0, size - end); end = size - 1; }
        else if (start !== null && end === null) { end = size - 1; }
        if (start !== null && end !== null && Number.isFinite(start) && Number.isFinite(end) && start <= end && start < size) {
          end = Math.min(end, size - 1);
          const ranged = await env.ASSETS_BUCKET.get(key, { range: { offset: start, length: end - start + 1 } });
          if (ranged) {
            return new Response(ranged.body, {
              status: 206,
              headers: {
                'Content-Type': ct, 'Accept-Ranges': 'bytes',
                'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
                'Content-Length': String(end - start + 1),
              },
            });
          }
        } else {
          return new Response('Requested Range Not Satisfiable', {
            status: 416, headers: { 'Content-Range': 'bytes */' + obj.size },
          });
        }
      }
    }
    const headers = { 'Content-Type': ct, 'Accept-Ranges': 'bytes', 'Content-Length': String(obj.size) };
    return new Response(obj.body, { headers });
  }
  // ─── Shared history browser (reads genai-history; writes only ratings) ───
  if (path === '/api/history/runs' && request.method === 'GET') {
    const H = histDB(env);
    if (!H) return jsonResponse({ error: 'HISTORY not configured' }, 500);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);
    const conds = [], vals = [];
    for (const [k, col] of [['provider', 'provider'], ['model', 'model'], ['source_app', 'source_app'], ['status', 'status']]) {
      const v = url.searchParams.get(k);
      if (v) { conds.push(`${col} = ?`); vals.push(v); }
    }
    if (url.searchParams.get('model_like')) { conds.push('model LIKE ?'); vals.push(`%${url.searchParams.get('model_like')}%`); }
    if (url.searchParams.get('rated')) { conds.push('rating IS NOT NULL'); }
    if (url.searchParams.get('unrated')) { conds.push('rating IS NULL'); }
    const minRating = parseInt(url.searchParams.get('min_rating') || '', 10);
    if (minRating >= 1 && minRating <= 5) { conds.push('rating >= ?'); vals.push(minRating); }
    const order = url.searchParams.get('order') === 'top' ? 'ORDER BY rating IS NULL, rating DESC, created_at DESC' : 'ORDER BY created_at DESC';
    try {
      const { results } = await H.prepare(
        `SELECT id, source_app, provider, model, enhancement_id, external_job_id, status, substr(input_json, 1, 4000) AS input_preview, loras_json, output_urls_json, r2_keys_json, rating, cost_hint, created_at, updated_at FROM runs${conds.length ? ' WHERE ' + conds.join(' AND ') : ''} ${order} LIMIT ?`
      ).bind(...vals, limit).all();
      return jsonResponse({ runs: results || [], total: results ? results.length : 0 });
    } catch (e) { return jsonResponse({ error: e.message }, 500); }
  }
  if (path === '/api/history/enhancements' && request.method === 'GET') {
    const H = histDB(env);
    if (!H) return jsonResponse({ error: 'HISTORY not configured' }, 500);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);
    const kind = url.searchParams.get('kind') || 'enhanced';
    const conds = ['kind = ?'], vals = [kind];
    if (url.searchParams.get('model_like')) { conds.push('target_model LIKE ?'); vals.push(`%${url.searchParams.get('model_like')}%`); }
    try {
      const { results } = await H.prepare(
        `SELECT id, source_app, kind, substr(raw_prompt, 1, 2000) AS raw_prompt, substr(enhanced_prompt, 1, 6000) AS enhanced_prompt, target_provider, target_model, llm_provider, llm_model, template_version, created_at FROM enhancements WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
      ).bind(...vals, limit).all();
      return jsonResponse({ enhancements: results || [], total: results ? results.length : 0 });
    } catch (e) { return jsonResponse({ error: e.message }, 500); }
  }
  if (path === '/api/history/stats' && request.method === 'GET') {
    const H = histDB(env);
    if (!H) return jsonResponse({ error: 'HISTORY not configured' }, 500);
    try {
      const total = await H.prepare('SELECT COUNT(*) AS c FROM runs').first();
      const withR2 = await H.prepare("SELECT COUNT(*) AS c FROM runs WHERE r2_keys_json != '[]'").first();
      const rated = await H.prepare('SELECT COUNT(*) AS c, AVG(rating) AS avg FROM runs WHERE rating IS NOT NULL').first();
      const enh = await H.prepare('SELECT COUNT(*) AS c FROM enhancements').first();
      const byProv = await H.prepare('SELECT provider, COUNT(*) AS c FROM runs GROUP BY provider ORDER BY c DESC').all();
      const byModel = await H.prepare('SELECT model, COUNT(*) AS c FROM runs GROUP BY model ORDER BY c DESC LIMIT 15').all();
      const topRated = await H.prepare('SELECT model, AVG(rating) AS avg, COUNT(*) AS c FROM runs WHERE rating IS NOT NULL GROUP BY model HAVING c >= 2 ORDER BY avg DESC LIMIT 10').all();
      return jsonResponse({
        runs: total?.c || 0, with_r2: withR2?.c || 0,
        rated: rated?.c || 0, avg_rating: rated?.avg != null ? Math.round(rated.avg * 100) / 100 : null,
        enhancements: enh?.c || 0,
        by_provider: (byProv.results || []), by_model: (byModel.results || []), top_rated_models: (topRated.results || []),
      });
    } catch (e) { return jsonResponse({ error: e.message }, 500); }
  }
  if (path === '/api/history/rate' && request.method === 'POST') {
    const H = histDB(env);
    if (!H) return jsonResponse({ error: 'HISTORY not configured' }, 500);
    let b; try { b = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }
    const id = parseInt(b.id, 10) || null, rating = parseInt(b.rating, 10);
    if (!(rating >= 1 && rating <= 5)) return jsonResponse({ error: 'rating (1-5) required' }, 400);
    let where, vals;
    if (id) { where = 'id = ?'; vals = [rating, id]; }
    else if (b.provider && b.external_job_id) { where = 'provider = ? AND external_job_id = ?'; vals = [rating, String(b.provider), String(b.external_job_id)]; }
    else return jsonResponse({ error: 'id or (provider + external_job_id) required' }, 400);
    try {
      await H.prepare(`UPDATE runs SET rating = ?, updated_at = datetime('now') WHERE ${where}`).bind(...vals).run();
      return jsonResponse({ ok: true });
    } catch (e) { return jsonResponse({ error: e.message }, 500); }
  }
  return jsonResponse({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cf-Access-Jwt-Assertion',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    const needsAuth = PROTECTED_API_PREFIXES.some((p) => path.startsWith(p));
    if (needsAuth && !isAccessAuthenticated(request)) {
      const res = jsonResponse(
        { error: 'Authentication required', message: 'Protected by Cloudflare Access. Sign in via browser or present Cf-Access-Jwt-Assertion.' },
        401
      );
      for (const [k, v] of Object.entries(corsHeaders)) res.headers.set(k, v);
      return res;
    }
    if (path.startsWith('/api/')) {
      try {
        const response = await handleApiRoute(request, env, path, url);
        for (const [k, v] of Object.entries(corsHeaders)) response.headers.set(k, v);
        return response;
      } catch (err) {
        return jsonResponse({ error: String((err && err.message) || err) }, 500, corsHeaders);
      }
    }
    try {
      if (env.ASSETS) return await env.ASSETS.fetch(request);
    } catch {}
    return new Response('Not found', { status: 404 });
  },
};
