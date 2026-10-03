import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { storageBrowse } from '../api';

// Images only for the headshot queue (keep in sync with Headshots pick()
// which filters File types to image/*). Videos and other objects are skipped.
const IMG_PICK = /\.(jpe?g|png|webp|gif)$/i;

const basename = (key) => String(key || '').split('/').filter(Boolean).pop() || key || '';
const kb = (n) => (n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`);
const dlUrl = (key) => `/api/storage/download?key=${encodeURIComponent(key)}`;

// R2 image picker modal for the headshot splitter: mini file browser over
// storageBrowse (delimiter=/ listing) showing image files only. Selection
// persists across folder navigation. Confirm returns selected keys; the
// caller downloads each key and feeds Files through the existing pick()
// path (Headshots.jsx). Client-side only, no worker changes.
export default function R2ImagePicker({ open, onClose, onConfirm }) {
  const [prefix, setPrefix] = useState('');
  const [folders, setFolders] = useState([]);
  const [objects, setObjects] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState([]); // full R2 keys
  const [search, setSearch] = useState('');
  const dialogRef = useRef(null);
  const closeRef = useRef(null);

  const load = useCallback(async (px, cur = null, append = false) => {
    setLoading(true);
    setError('');
    try {
      const d = await storageBrowse(px, cur);
      setFolders(append ? (f) => f : (d.folders || []));
      setObjects((o) => (append ? [...o, ...(d.objects || [])] : ([...(d.objects || [])])));
      setCursor(d.truncated ? d.cursor : null);
    } catch (e) {
      setError(e.message || 'Browse failed');
    } finally {
      setLoading(false);
    }
  }, []);

  // (Re)load root each time the modal opens; reset search, keep nothing stale.
  useEffect(() => {
    if (!open) return;
    setPrefix('');
    setSearch('');
    setCursor(null);
    load('', null, false);
  }, [open, load]);

  // Esc closes; focus the dialog on open for keyboard users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose && onClose();
    };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => {
      if (dialogRef.current) dialogRef.current.focus();
      else if (closeRef.current) closeRef.current.focus();
    }, 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open, onClose]);

  const nav = (px) => {
    setPrefix(px);
    load(px, null, false);
  };

  const crumbs = prefix.split('/').filter(Boolean);
  const up = () => nav(crumbs.slice(0, -1).join('/') + (crumbs.length > 1 ? '/' : ''));

  // Server objects filtered to images only; search narrows by name substring.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return objects
      .filter((o) => IMG_PICK.test(o.key || ''))
      .filter((o) => (!q || String(o.key || '').toLowerCase().includes(q)));
  }, [objects, search]);

  const toggle = (key) => setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  const toggleAllVisible = () => setSelected((s) => {
    const keys = visible.map((o) => o.key);
    const allOn = keys.length > 0 && keys.every((k) => s.includes(k));
    if (allOn) return s.filter((k) => !keys.includes(k));
    return [...new Set([...s, ...keys])];
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
      onClick={() => onClose && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Pick images from R2"
        tabIndex={-1}
        className="panel !p-3 md:!p-4 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 min-h-[44px]">
          <h3 className="panel-title !mb-0 flex-1">Pick images from R2</h3>
          <span className="text-[11px] text-gray-400 flex-none" aria-live="polite">
            {selected.length} selected
          </span>
          <button ref={closeRef} type="button" onClick={() => onClose && onClose()}
            className="btn-secondary !px-3 flex-none" aria-label="Close R2 picker">
            ✕
          </button>
        </div>

        <div className="flex flex-wrap gap-2 items-center mt-2">
          <div className="flex items-center gap-1 min-w-0 flex-1" aria-label="Breadcrumbs">
            <button type="button" onClick={() => nav('')}
              className="text-emerald-300 hover:text-white flex-none min-h-[44px]" title="Root" aria-label="Storage root">
              R2
            </button>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1 min-w-0">
                <span className="text-gray-600" aria-hidden="true">/</span>
                <button type="button"
                  onClick={() => nav(crumbs.slice(0, i + 1).join('/') + '/')}
                  className="text-emerald-300 hover:text-white truncate min-h-[44px]" title={c} aria-label={`Folder ${c}`}>
                  {c}
                </button>
              </span>
            ))}
          </div>
          {prefix && (
            <button type="button" onClick={up} className="btn-secondary flex-none" aria-label="Go up one folder">
              ↑ Up
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2 items-center mt-2">
          <input className="input !w-56 text-xs" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by filename…" aria-label="Filter images by filename" />
          <button type="button" onClick={toggleAllVisible} disabled={!visible.length}
            className="btn-secondary" aria-label={visible.length ? 'Toggle select all visible images' : 'No images to select'}>
            Select visible
          </button>
          {!!selected.length && (
            <button type="button" onClick={() => setSelected([])} className="text-[11px] text-gray-500 underline min-h-[44px]"
              aria-label="Clear R2 selection">
              clear ({selected.length})
            </button>
          )}
        </div>

        {error && <p className="text-[11px] text-red-400 mt-2" role="alert">{error}</p>}

        <div className="mt-2 min-h-0 overflow-y-auto">
          {loading && !objects.length && !folders.length ? (
            <p className="text-xs text-gray-500 flex items-center gap-2 py-4">
              <span className="spinner !border-gray-600" aria-hidden="true"></span>Loading…
            </p>
          ) : (
            <div className="space-y-2">
              {!!folders.length && (
                <div className="space-y-1" aria-label="Folders">
                  {folders.map((f) => (
                    <button key={f} type="button" onClick={() => nav(f)}
                      className="w-full flex items-center gap-2 p-2 rounded-lg bg-gray-800/40 border border-gray-800 hover:border-emerald-600 text-left min-h-[44px]"
                      aria-label={`Open folder ${f}`}>
                      <span className="text-amber-400/80 text-sm flex-none" aria-hidden="true">📁</span>
                      <span className="text-xs text-gray-200 truncate">{f.replace(prefix, '')}</span>
                    </button>
                  ))}
                </div>
              )}
              {visible.length > 0 ? (
                <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2" aria-label="Images">
                  {visible.map((o) => {
                    const on = selected.includes(o.key);
                    const label = basename(o.key);
                    return (
                      <li key={o.key}
                        className={`relative rounded-lg border overflow-hidden bg-gray-900/60 ${on ? 'border-emerald-500 ring-1 ring-emerald-500/50' : 'border-gray-800 hover:border-emerald-700'}`}>
                        <input type="checkbox" checked={on} onChange={() => toggle(o.key)}
                          aria-label={`Select ${o.key}`}
                          onClick={(e) => e.stopPropagation()}
                          className="absolute top-2 left-2 z-20 accent-emerald-500 w-5 h-5 rounded shadow" />
                        <button type="button" onClick={() => toggle(o.key)} aria-pressed={on}
                          aria-label={`${on ? 'Deselect' : 'Select'} ${o.key}`} title={o.key}
                          className="block w-full text-left cursor-pointer">
                          <span className="block w-full aspect-square bg-black pointer-events-none">
                            <img src={dlUrl(o.key)} alt="" loading="lazy" className="w-full h-full object-cover" />
                          </span>
                          <span className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-2 pt-5 pb-1.5 pointer-events-none">
                            <span className="block text-[11px] font-mono text-gray-100 truncate" title={o.key}>{label}</span>
                            <span className="block text-[10px] text-gray-400 truncate">{kb(o.size)}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                !folders.length && (
                  <p className="text-[11px] text-gray-600 py-4 text-center">
                    {objects.length ? 'No images match (videos and other files are hidden).' : 'Empty folder.'}
                  </p>
                )
              )}
            </div>
          )}
        </div>

        {cursor && (
          <button type="button" onClick={() => load(prefix, cursor, true)} disabled={loading}
            className="btn-secondary w-full mt-2" aria-label="Load more images">
            {loading ? 'Loading…' : 'Load more…'}
          </button>
        )}

        <div className="flex flex-wrap gap-2 mt-3">
          <button type="button" onClick={() => onClose && onClose()} className="btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={() => onConfirm && onConfirm(selected)}
            disabled={!selected.length} className="btn-primary-sm"
            aria-label={selected.length ? `Add ${selected.length} images to queue` : 'Select images to add'}>
            {selected.length ? `Add ${selected.length} to queue` : 'Add to queue'}
          </button>
        </div>
      </div>
    </div>
  );
}
