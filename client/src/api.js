// Thin wrappers over the existing dashboard worker API (unchanged backend).
const API = '';

async function json(res) {
  const t = await res.text();
  try {
    return JSON.parse(t);
  } catch {
    return { _raw: t };
  }
}

export function errText(v, fallback = '') {
  if (v == null) return fallback;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((x) => errText(x, '')).filter(Boolean).join('; ') || fallback;
  if (typeof v === 'object') return errText(v.message ?? v.error ?? v.detail ?? v.msg, fallback);
  return String(v);
}

async function get(path) {
  const res = await fetch(`${API}${path}`);
  const data = await json(res);
  if (res.status === 401) throw new Error('Access login required (Cloudflare Access). Sign in in the browser first.');
  if (!res.ok) throw new Error(errText(data.message || data.error, `Request failed (${res.status})`));
  return data;
}

export async function fetchHealth() {
  return get('/api/health');
}

export async function fetchLinks() {
  const data = await get('/api/links');
  return data.links || [];
}

export async function fetchBalances(refresh = false) {
  const data = await get(`/api/balance${refresh ? '?refresh=1' : ''}`);
  return data.balances || {};
}

export async function fetchStats() {
  return get('/api/history/stats');
}

export async function fetchRuns({ provider = '', model_like = '', status = '', min_rating = '', unrated = false, order = 'newest', limit = 60 } = {}) {
  const q = new URLSearchParams();
  if (provider) q.set('provider', provider);
  if (model_like) q.set('model_like', model_like);
  if (status) q.set('status', status);
  if (unrated) q.set('unrated', '1');
  else if (min_rating) q.set('min_rating', min_rating);
  if (order) q.set('order', order);
  q.set('limit', String(limit));
  const data = await get(`/api/history/runs?${q.toString()}`);
  return data.runs || [];
}

export async function fetchEnhancements({ kind = 'enhanced', model_like = '', limit = 50 } = {}) {
  const q = new URLSearchParams({ kind, limit: String(limit) });
  if (model_like) q.set('model_like', model_like);
  const data = await get(`/api/history/enhancements?${q.toString()}`);
  return data.enhancements || [];
}

export async function rateRun({ id, rating }) {
  const res = await fetch(`${API}/api/history/rate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: Number(id), rating: Number(rating) }),
  });
  const data = await json(res);
  if (!res.ok) throw new Error(errText(data.message || data.error, `Rate failed (${res.status})`));
  return data;
}

// Centralized Add-from-URL: resolve an HF/CivitAI model-card URL to LoRA file(s).
export async function resolveLoraUrl(url) {
  const res = await fetch(`${API}/api/lora/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await json(res);
  if (!res.ok) throw new Error(errText(data.error, `Resolve failed (${res.status})`));
  return data;
}

export async function fetchCustomLoras() {
  return (await get('/api/loras/custom')).loras || [];
}

export async function saveCustomLora(entry) {
  const res = await fetch(`${API}/api/loras/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  const data = await json(res);
  if (!res.ok) throw new Error(errText(data.error, `Save failed (${res.status})`));
  return data;
}

export async function deleteCustomLora(id) {
  const res = await fetch(`${API}/api/loras/custom/${id}`, { method: 'DELETE' });
  const data = await json(res);
  if (!res.ok) throw new Error(errText(data.error, `Delete failed (${res.status})`));
  return data;
}

// R2 storage browser primitives (headshots tool + power users).
export async function storageUpload(key, blob, contentType) {
  const res = await fetch(`${API}/api/storage/upload?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType || blob?.type || 'application/octet-stream' },
    body: blob,
  });
  const data = await json(res);
  if (!res.ok) throw new Error(errText(data.error, `Upload failed (${res.status})`));
  return data; // { ok, key, size }
}

export async function storageList(prefix = '') {
  const q = new URLSearchParams({ prefix, recursive: '1' });
  const data = await get(`/api/storage/list?${q.toString()}`);
  return Array.isArray(data.objects) ? data.objects : [];
}
