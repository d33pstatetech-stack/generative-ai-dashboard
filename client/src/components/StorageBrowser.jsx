import { useCallback, useEffect, useState } from 'react';
import { storageBrowse, storageDelete, storageUpload } from '../api';

const IMG = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const VID = /\.(mp4|webm|mov|m4v)$/i;

const kb = (n) => (n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`);

// R2 file browser: folder navigation, PC uploads, multi-select delete.
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

  const load = useCallback(async (px = prefix, cur = null, append = false) => {
    setLoading(true);
    try {
      const d = await storageBrowse(px, cur);
      setFolders(append ? (f) => f : (d.folders || []));
      setObjects((o) => (append ? [...o, ...(d.objects || [])] : (d.objects || [])));
      setCursor(d.truncated ? d.cursor : null);
      setSelected([]);
    } catch (e) {
      notify && notify(`Browse failed: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [prefix, notify]);

  useEffect(() => { load('', null, false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const nav = (px) => {
    setPrefix(px);
    load(px, null, false);
  };

  const crumbs = prefix.split('/').filter(Boolean);
  const up = () => nav(crumbs.slice(0, -1).join('/') + (crumbs.length > 1 ? '/' : ''));

  const toggle = (key) => setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  const toggleAll = () => setSelected((s) => (s.length === objects.length && objects.length ? [] : objects.map((o) => o.key)));

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
        <button type="button" onClick={toggleAll} disabled={busy || !objects.length} className="btn-secondary">
          {selected.length === objects.length && objects.length ? 'Deselect all' : 'Select all'}
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
          {objects.map((o) => {
            const on = selected.includes(o.key);
            return (
              <div key={o.key} className={`flex items-center gap-2 p-1.5 rounded-lg border ${on ? 'border-violet-500 bg-violet-950/30' : 'border-gray-800'}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(o.key)} aria-label={`Select ${o.key}`}
                  className="accent-purple-500 w-5 h-5 flex-none ml-0.5" />
                {thumb(o)}
                <div className="min-w-0 flex-1">
                  <a className="block text-[11px] font-mono text-gray-300 truncate hover:text-violet-300"
                    href={`/api/storage/download?key=${encodeURIComponent(o.key)}`} target="_blank" rel="noreferrer" title={o.key}>
                    {o.key.replace(prefix, '')}
                  </a>
                  <span className="text-[10px] text-gray-600">{kb(o.size)}{o.uploaded ? ` · ${String(o.uploaded).slice(0, 10)}` : ''}</span>
                </div>
              </div>
            );
          })}
          {!folders.length && !objects.length && (
            <p className="text-[11px] text-gray-600 py-4 text-center">Empty folder.</p>
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
