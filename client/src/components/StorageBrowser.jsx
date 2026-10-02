import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { storageBrowse, storageDelete, storageList, storageUpload, storageUsage } from '../api';
import MediaViewer from './MediaViewer';

const IMG = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const VID = /\.(mp4|webm|mov|m4v)$/i;

const kb = (n) => (n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`);

const fmtBytes = (n) => {
  if (n == null || !isFinite(Number(n))) return '—';
  const v = Number(n);
  if (v >= 1073741824) return `${(v / 1073741824).toFixed(2)} GB`;
  if (v >= 1048576) return `${(v / 1048576).toFixed(1)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${v} B`;
};

const typeOf = (key) => {
  if (IMG.test(key || '')) return 'image';
  if (VID.test(key || '')) return 'video';
  return 'other';
};

const dlUrl = (key) => `/api/storage/download?key=${encodeURIComponent(key)}`;

// Viewport-lazy video preview: renders a pulsing placeholder until the tile
// is near the viewport, then mounts the <video> (single src request).
// Each tile owns its observer, so filtering / flatten / Load-more just work
// (new tiles observe on mount). Observer disconnects after first intersect.
function LazyVideo({ url, onError }) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            obs.disconnect();
            break;
          }
        }
      },
      { rootMargin: '200px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <span ref={ref} className="block w-full h-full" aria-hidden="true">
      {!inView ? (
        <span className="block w-full h-full bg-gray-800 animate-pulse" />
      ) : (
        <span className="relative block w-full h-full">
          <span className="absolute inset-0 bg-gray-800 animate-pulse" />
          <video src={url} muted playsInline preload="metadata" disablePictureInPicture
            onError={onError}
            className="relative w-full h-full object-cover pointer-events-none" />
        </span>
      )}
    </span>
  );
}

// R2 file browser: folder navigation, PC uploads, multi-select delete.
// Flatten mode lists recursively (storageList with recursive=1) and renders
// full keys; default stays hierarchical (storageBrowse). Sort + filter are
// client-side over the loaded objects. Upload/delete flows are untouched.
// Objects render as a responsive grid (2/3/4 cols) with image <img> previews,
// muted video first-frame previews + play badge, and icon tiles for other
// files. Clicking a media tile opens the MediaViewer modal (same pattern as
// RunsTable); non-media tiles link to the download URL in a new tab.
// Props: notify.
export default function StorageBrowser({ notify }) {
  const [prefix, setPrefix] = useState('');
  const [folders, setFolders] = useState([]);
  const [objects, setObjects] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [flatten, setFlatten] = useState(false);
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [filterType, setFilterType] = useState('all');
  const [filterText, setFilterText] = useState('');
  const [viewer, setViewer] = useState(null); // { media: { url, video }, run } | null
  const [usage, setUsage] = useState(null); // { objects, bytes, freeTierBytes, updatedAt } | null
  const [videoErr, setVideoErr] = useState({}); // key -> true when tile preview fails to load

  const fetchUsage = useCallback(async () => {
    try {
      const u = await storageUsage();
      if (u && typeof u.bytes === 'number') setUsage(u);
    } catch {
      // Fail-soft: hide the capacity bar, never block the browser.
    }
  }, []);

  const load = useCallback(async (px = prefix, cur = null, append = false, flat = flatten) => {
    setLoading(true);
    try {
      if (flat) {
        const arr = await storageList(px, 1, cur);
        setFolders([]);
        setObjects((o) => (append ? [...o, ...arr] : [...arr]));
        setCursor(arr.truncated ? arr.cursor : null);
      } else {
        const d = await storageBrowse(px, cur);
        setFolders(append ? (f) => f : (d.folders || []));
        setObjects((o) => (append ? [...o, ...(d.objects || [])] : (d.objects || [])));
        setCursor(d.truncated ? d.cursor : null);
      }
      setSelected([]);
    } catch (e) {
      notify && notify(`Browse failed: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [prefix, flatten, notify]);

  useEffect(() => {
    // First list load, then lazily fetch usage so the bar never blocks browsing.
    load('', null, false).finally(() => { fetchUsage(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const nav = (px) => {
    setPrefix(px);
    load(px, null, false);
  };

  const toggleFlatten = () => {
    const next = !flatten;
    setFlatten(next);
    load(prefix, null, false, next);
  };

  const crumbs = prefix.split('/').filter(Boolean);
  const up = () => nav(crumbs.slice(0, -1).join('/') + (crumbs.length > 1 ? '/' : ''));

  const visible = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    const filtered = objects.filter((o) => {
      if (filterType !== 'all' && typeOf(o.key) !== filterType) return false;
      if (q && !String(o.key || '').toLowerCase().includes(q)) return false;
      return true;
    });
    const dir = sortDir === 'desc' ? -1 : 1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'size') return ((a.size ?? 0) - (b.size ?? 0)) * dir;
      if (sortKey === 'uploaded') {
        const ta = a.uploaded ? Date.parse(a.uploaded) : 0;
        const tb = b.uploaded ? Date.parse(b.uploaded) : 0;
        return (ta - tb) * dir;
      }
      return String(a.key || '').localeCompare(String(b.key || '')) * dir;
    });
  }, [objects, sortKey, sortDir, filterType, filterText]);

  const toggle = (key) => setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  const toggleAll = () => setSelected((s) => (s.length === visible.length && visible.length ? [] : visible.map((o) => o.key)));

  const openViewer = (o) => {
    const url = dlUrl(o.key);
    const video = VID.test(o.key || '');
    setViewer({ media: { url, video }, run: {} });
  };

  const upload = async (files) => {
    const list = [...(files || [])];
    if (!list.length) return;
    setBusy(true);
    try {
      for (let i = 0; i < list.length; i++) {
        setProgress(`Uploading ${i + 1}/${list.length}…`);
        await storageUpload(`${prefix}${list[i].name}`, list[i], list[i].type || undefined);
      }
      setProgress('');
      notify && notify(`Uploaded ${list.length} file(s) → ${prefix || '(root)'}`, 'success');
      await load(prefix, null, false);
      fetchUsage();
    } catch (e) {
      setProgress('');
      notify && notify(`Upload failed: ${e.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeSelected = async () => {
    if (!selected.length) return;
    if (!window.confirm(`Permanently delete ${selected.length} object(s)?`)) return;
    setBusy(true);
    const errs = [];
    for (let i = 0; i < selected.length; i++) {
      setProgress(`Deleting ${i + 1}/${selected.length}…`);
      try {
        await storageDelete(selected[i]);
      } catch (e) {
        errs.push(`${selected[i]}: ${e.message}`);
      }
    }
    setProgress('');
    setBusy(false);
    if (errs.length) notify && notify(`Deleted with ${errs.length} error(s): ${errs[0]}`, 'error');
    else notify && notify(`Deleted ${selected.length} object(s)`, 'success');
    await load(prefix, null, false);
    fetchUsage();
  };

  const usageBar = useMemo(() => {
    if (!usage || typeof usage.bytes !== 'number') return null;
    const total = usage.freeTierBytes || 10737418240;
    const pct = total > 0 ? Math.min(100, (usage.bytes / total) * 100) : 0;
    return { total, pct };
  }, [usage]);

  const renderTile = (o) => {
    const on = selected.includes(o.key);
    const url = dlUrl(o.key);
    const kind = typeOf(o.key);
    const label = flatten ? o.key : o.key.replace(prefix, '');
    return (
      <div key={o.key}
        className={`relative rounded-lg border overflow-hidden bg-gray-900/60 ${on ? 'border-violet-500 ring-1 ring-violet-500/50' : 'border-gray-800 hover:border-violet-700'}`}>
        <input type="checkbox" checked={on} onChange={() => toggle(o.key)} aria-label={`Select ${o.key}`}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-2 left-2 z-20 accent-purple-500 w-5 h-5 rounded shadow" />
        {kind === 'image' ? (
          <button type="button" onClick={() => openViewer(o)} title={o.key} aria-label={`Open image ${label}`}
            className="block w-full aspect-square bg-black cursor-zoom-in">
            <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" />
          </button>
        ) : kind === 'video' ? (
          videoErr[o.key] ? (
            <button type="button" onClick={() => openViewer(o)} title={o.key} aria-label={`Open video ${label}`}
              className="flex items-center justify-center w-full aspect-square bg-gray-900 hover:bg-gray-800 cursor-pointer">
              <i className="fas fa-file-video text-gray-600 text-2xl"></i>
            </button>
          ) : (
          <button type="button" onClick={() => openViewer(o)} title={o.key} aria-label={`Open video ${label}`}
            className="relative block w-full aspect-square bg-black cursor-pointer">
            <LazyVideo url={url} onError={() => setVideoErr((m) => ({ ...m, [o.key]: true }))} />
            <span className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
              <span className="w-10 h-10 rounded-full bg-black/70 border border-white/30 flex items-center justify-center">
                <i className="fas fa-play text-white text-sm ml-0.5"></i>
              </span>
            </span>
          </button>
          )
        ) : (
          <a href={url} target="_blank" rel="noreferrer" title={o.key} aria-label={`Open file ${label}`}
            className="flex items-center justify-center w-full aspect-square bg-gray-900 hover:bg-gray-800">
            <i className="fas fa-file text-gray-600 text-2xl"></i>
          </a>
        )}
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-2 pt-5 pb-1.5 pointer-events-none">
          <p className="text-[11px] font-mono text-gray-100 truncate" title={o.key}>{label}</p>
          <p className="text-[10px] text-gray-400 truncate">{kb(o.size)}{o.uploaded ? ` · ${String(o.uploaded).slice(0, 10)}` : ''}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {usageBar && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-2" aria-label="Storage usage"
          title={usage.updatedAt ? `Updated ${usage.updatedAt}` : undefined}>
          <div className="flex justify-between gap-2 text-[11px] text-gray-300">
            <span className="truncate">Used {fmtBytes(usage.bytes)} of {fmtBytes(usageBar.total)} free tier ({usageBar.pct.toFixed(1)}%)</span>
            <span className="flex-none font-mono text-gray-400">{usage.objects ?? 0} objects</span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-gray-800 overflow-hidden" role="progressbar"
            aria-valuenow={Math.round(usageBar.pct)} aria-valuemin={0} aria-valuemax={100} aria-label="R2 free-tier usage">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all" style={{ width: `${usageBar.pct}%` }} />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <label className="btn-secondary cursor-pointer">
          Upload from PC
          <input type="file" multiple className="hidden" aria-label="Upload files"
            onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
        </label>
        <div className="flex items-center gap-1 text-[11px] min-w-0 flex-1" aria-label="Breadcrumbs">
          <button type="button" onClick={() => nav('')} disabled={busy} className="text-violet-300 hover:text-white flex-none" title="Root">R2</button>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1 min-w-0">
              <span className="text-gray-600">/</span>
              <button type="button" disabled={busy}
                onClick={() => nav(crumbs.slice(0, i + 1).join('/') + '/')}
                className="text-violet-300 hover:text-white truncate" title={c}>{c}</button>
            </span>
          ))}
        </div>
        {prefix && <button type="button" onClick={up} disabled={busy} className="btn-secondary flex-none">↑ Up</button>}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" onClick={toggleAll} disabled={busy || !visible.length} className="btn-secondary">
          {selected.length === visible.length && visible.length ? 'Deselect all' : 'Select all'}
        </button>
        <button type="button" onClick={removeSelected} disabled={busy || !selected.length}
          className="text-[11px] px-3 min-h-[44px] rounded-lg bg-red-900/60 border border-red-800 text-red-200 disabled:opacity-40">
          Delete selected ({selected.length})
        </button>
        <button type="button" onClick={() => { load(prefix, null, false); fetchUsage(); }} disabled={loading} className="btn-secondary" aria-label="Refresh">
          <i className={`fas fa-rotate text-xs ${loading ? 'fa-spin' : ''}`}></i>
        </button>
        {progress && <span className="text-[11px] text-gray-400">{progress}</span>}
      </div>

      <div className="flex flex-wrap gap-2 items-center" role="group" aria-label="Flatten, sort and filter">
        <label className="btn-secondary inline-flex items-center gap-2 cursor-pointer select-none" title="List recursively with full keys">
          <input type="checkbox" checked={flatten} onChange={toggleFlatten} disabled={busy || loading}
            className="accent-purple-500 w-4 h-4" aria-label="Flatten: list all objects recursively" />
          Flatten
        </label>
        <select className="input !w-auto !min-h-[44px] text-xs" value={sortKey} onChange={(e) => setSortKey(e.target.value)}
          aria-label="Sort by" title="Sort by">
          <option value="name">name</option>
          <option value="size">size</option>
          <option value="uploaded">uploaded</option>
        </select>
        <select className="input !w-auto !min-h-[44px] text-xs" value={sortDir} onChange={(e) => setSortDir(e.target.value)}
          aria-label="Sort direction" title="Sort direction">
          <option value="asc">asc ↑</option>
          <option value="desc">desc ↓</option>
        </select>
        <select className="input !w-auto !min-h-[44px] text-xs" value={filterType} onChange={(e) => setFilterType(e.target.value)}
          aria-label="Filter by type" title="Filter by type">
          <option value="all">all types</option>
          <option value="image">images</option>
          <option value="video">videos</option>
          <option value="other">other</option>
        </select>
        <input className="input !w-40 !min-h-[44px] text-xs" value={filterText} onChange={(e) => setFilterText(e.target.value)}
          placeholder="filename contains…" aria-label="Filter by filename" title="Filter by filename substring" />
        {(filterType !== 'all' || filterText.trim()) && (
          <span className="text-[11px] text-gray-500">{visible.length}/{objects.length} shown</span>
        )}
      </div>

      {loading && !objects.length && !folders.length ? (
        <p className="text-xs text-gray-500 flex items-center gap-2"><span className="spinner !border-gray-600"></span>Loading…</p>
      ) : (
        <div className="space-y-2 max-h-[420px] overflow-y-auto">
          {folders.length > 0 && (
            <div className="space-y-1">
              {folders.map((f) => (
                <button key={f} type="button" onClick={() => nav(f)} disabled={busy}
                  className="w-full flex items-center gap-2 p-2 rounded-lg bg-gray-800/40 border border-gray-800 hover:border-violet-600 text-left min-h-[44px]">
                  <i className="fas fa-folder text-amber-400/80 text-sm flex-none"></i>
                  <span className="text-xs text-gray-200 truncate">{f.replace(prefix, '')}</span>
                </button>
              ))}
            </div>
          )}
          {visible.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {visible.map((o) => renderTile(o))}
            </div>
          )}
          {!folders.length && !visible.length && (
            <p className="text-[11px] text-gray-600 py-4 text-center">
              {objects.length ? 'No objects match the current filters.' : 'Empty folder.'}
            </p>
          )}
        </div>
      )}
      {cursor && (
        <button type="button" onClick={() => load(prefix, cursor, true)} disabled={loading} className="btn-secondary w-full">
          Load more…
        </button>
      )}
      {viewer && <MediaViewer media={viewer.media} run={viewer.run || {}} onClose={() => setViewer(null)} />}
    </div>
  );
}
