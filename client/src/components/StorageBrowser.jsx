import { useCallback, useEffect, useMemo, useState } from 'react';
import { storageBrowse, storageDelete, storageList, storageUpload } from '../api';

const IMG = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const VID = /\.(mp4|webm|mov|m4v)$/i;

const kb = (n) => (n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`);

const typeOf = (key) => {
  if (IMG.test(key || '')) return 'image';
  if (VID.test(key || '')) return 'video';
  return 'other';
};

// R2 file browser: folder navigation, PC uploads, multi-select delete.
// Flatten mode lists recursively (storageList with recursive=1) and renders
// full keys; default stays hierarchical (storageBrowse). Sort + filter are
// client-side over the loaded objects. Upload/delete flows are untouched.
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

  useEffect(() => { load('', null, false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      load(prefix, null, false);
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
    load(prefix, null, false);
  };

  const thumb = (o) => {
    const url = `/api/storage/download?key=${encodeURIComponent(o.key)}`;
    if (IMG.test(o.key)) return <img src={url} alt="" loading="lazy" className="w-12 h-12 object-cover rounded bg-black flex-none" />;
    if (VID.test(o.key)) {
      return <span className="w-12 h-12 rounded bg-black flex-none flex items-center justify-center"><i className="fas fa-video text-gray-600 text-xs"></i></span>;
    }
    return <span className="w-12 h-12 rounded bg-gray-900 flex-none flex items-center justify-center"><i className="fas fa-file text-gray-600 text-xs"></i></span>;
  };

  return (
    <div className="space-y-2">
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
        <button type="button" onClick={() => load(prefix, null, false)} disabled={loading} className="btn-secondary" aria-label="Refresh">
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
        <div className="space-y-1 max-h-[420px] overflow-y-auto">
          {folders.map((f) => (
            <button key={f} type="button" onClick={() => nav(f)} disabled={busy}
              className="w-full flex items-center gap-2 p-2 rounded-lg bg-gray-800/40 border border-gray-800 hover:border-violet-600 text-left min-h-[44px]">
              <i className="fas fa-folder text-amber-400/80 text-sm flex-none"></i>
              <span className="text-xs text-gray-200 truncate">{f.replace(prefix, '')}</span>
            </button>
          ))}
          {visible.map((o) => {
            const on = selected.includes(o.key);
            return (
              <div key={o.key} className={`flex items-center gap-2 p-1.5 rounded-lg border ${on ? 'border-violet-500 bg-violet-950/30' : 'border-gray-800'}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(o.key)} aria-label={`Select ${o.key}`}
                  className="accent-purple-500 w-5 h-5 flex-none ml-0.5" />
                {thumb(o)}
                <div className="min-w-0 flex-1">
                  <a className="block text-[11px] font-mono text-gray-300 truncate hover:text-violet-300"
                    href={`/api/storage/download?key=${encodeURIComponent(o.key)}`} target="_blank" rel="noreferrer" title={o.key}>
                    {flatten ? o.key : o.key.replace(prefix, '')}
                  </a>
                  <span className="text-[10px] text-gray-600">{kb(o.size)}{o.uploaded ? ` · ${String(o.uploaded).slice(0, 10)}` : ''}</span>
                </div>
              </div>
            );
          })}
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
    </div>
  );
}
