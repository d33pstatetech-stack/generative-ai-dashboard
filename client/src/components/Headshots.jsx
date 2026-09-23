import { useRef, useState } from 'react';
import { storageList, storageUpload } from '../api';
import { computeTiles, computeTilesPercent } from '../tiling';

const PRESETS = [
  { id: '3x3', mode: 'grid', cols: 3, rows: 3, label: '3×3 — 9 headshots (3 rows × 3 cols)' },
  { id: '3x2', mode: 'grid', cols: 3, rows: 2, label: '3×2 — 6 shots (2 rows × 3 cols)' },
  { id: '1x3', mode: 'grid', cols: 3, rows: 1, label: '1×3 — full body (1 row × 3 cols)' },
  { id: '1x4', mode: 'percent', label: '1×4 — full body, adjustable (front · left · right · back)' },
];
const QUARTERS = ['front', 'left profile', 'right profile', 'back'];

const sanitize = (n) => String(n || 'source.jpg').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 120);

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, w: img.naturalWidth, h: img.naturalHeight, url });
    img.onerror = () => reject(new Error(`Could not decode ${file.name}`));
    img.src = url;
  });
}

function tileBlob(img, t) {
  return new Promise((resolve, reject) => {
    const c = document.createElement('canvas');
    c.width = t.w;
    c.height = t.h;
    c.getContext('2d').drawImage(img, t.x, t.y, t.w, t.h, 0, 0, t.w, t.h);
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Tile encode failed'))), 'image/jpeg', 0.92);
  });
}

function thumbUrl(img, t, max = 160) {
  const s = Math.min(1, max / Math.max(t.w, t.h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(t.w * s));
  c.height = Math.max(1, Math.round(t.h * s));
  c.getContext('2d').drawImage(img, t.x, t.y, t.w, t.h, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

// Headshot sheet splitter with batch queue: select N sheets once, split them
// all the same way. Equivalent per file to:
// magick in.jpg -crop 3x3@ +repage +adjoin headshot_<n>_%d.jpg
export default function Headshots({ notify }) {
  const [queue, setQueue] = useState([]); // {qid,file,fileName,img,w,h,url,status,detail,thumbs[]}
  const [preset, setPreset] = useState(PRESETS[0]);
  const [cuts, setCuts] = useState([0.3, 0.5, 0.7]); // 1x4 divider fractions
  const [prefix, setPrefix] = useState('headshot');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [outputs, setOutputs] = useState([]);
  const qidRef = useRef(0);

  const tilesFor = (item) => (
    preset.mode === 'percent'
      ? computeTilesPercent(item.w, item.h, cuts)
      : computeTiles(item.w, item.h, preset.cols, preset.rows)
  );
  const captions = preset.id === '1x4' ? QUARTERS : [];
  const perFile = queue.length ? tilesFor(queue[0]).length : 0;

  const pick = async (files) => {
    const list = [...(files || [])].filter((f) => f && /^image\//.test(f.type));
    if (!list.length) return;
    const loaded = await Promise.all(list.map(async (file) => {
      try {
        const l = await loadImage(file);
        return { qid: qidRef.current++, file, fileName: file.name, ...l, status: 'ready', detail: '', thumbs: [] };
      } catch (e) {
        notify && notify(e.message, 'error');
        return null;
      }
    }));
    const good = loaded.filter(Boolean);
    if (good.length) {
      setQueue((q) => [...q, ...good]);
      setOutputs([]);
      setProgress('');
    }
  };

  const removeItem = (qid) => setQueue((q) => q.filter((i) => i.qid !== qid));
  const clearDone = () => setQueue((q) => q.filter((i) => i.status !== 'done'));

  const previewAll = () => {
    setQueue((q) => q.map((item) => ({ ...item, thumbs: tilesFor(item).map((t) => thumbUrl(item.img, t)) })));
  };

  // Re-preview live while dragging dividers.
  const adjustCut = (i, v) => {
    const lo = i === 0 ? 0.05 : cuts[i - 1] + 0.03;
    const hi = i === cuts.length - 1 ? 0.95 : cuts[i + 1] - 0.03;
    const next = [...cuts];
    next[i] = Math.min(hi, Math.max(lo, v));
    setCuts(next);
    setQueue((q) => q.map((item) => (
      item.thumbs.length ? { ...item, thumbs: computeTilesPercent(item.w, item.h, next).map((t) => thumbUrl(item.img, t)) } : item
    )));
  };

  const setStatus = (qid, status, detail = '') =>
    setQueue((q) => q.map((i) => (i.qid === qid ? { ...i, status, detail } : i)));

  const splitSaveAll = async () => {
    const pending = queue.filter((i) => i.status !== 'done');
    if (!pending.length) return;
    const pre = (prefix.trim() || 'headshot').replace(/[^a-z0-9_-]+/gi, '_');
    setBusy(true);
    try {
      for (let fi = 0; fi < pending.length; fi++) {
        const item = pending[fi];
        const rects = tilesFor(item);
        setStatus(item.qid, 'working', `tile 0/${rects.length}`);
        try {
          await storageUpload(`headshots/sources/${sanitize(item.fileName)}`, item.file, item.file.type || 'image/jpeg');
          for (let ti = 0; ti < rects.length; ti++) {
            setStatus(item.qid, 'working', `tile ${ti + 1}/${rects.length} (file ${fi + 1}/${pending.length})`);
            setProgress(`File ${fi + 1}/${pending.length} · tile ${ti + 1}/${rects.length}`);
            const blob = await tileBlob(item.img, rects[ti]);
            await storageUpload(`headshots/${pre}_${item.qid}_${ti}.jpg`, blob, 'image/jpeg');
          }
          setStatus(item.qid, 'done', `${rects.length} tiles`);
        } catch (e) {
          setStatus(item.qid, 'error', String(e.message).slice(0, 120));
        }
      }
      setProgress('Listing headshots/…');
      setOutputs(await storageList('headshots/'));
      const doneN = pending.length; // statuses already updated above
      setProgress('Batch complete.');
      notify && notify(`Batch complete — ${doneN} file(s) processed`, 'success');
    } finally {
      setBusy(false);
    }
  };

  const statusColor = (s) => (s === 'done' ? 'text-emerald-300' : s === 'error' ? 'text-red-400' : s === 'working' ? 'text-amber-300' : 'text-gray-500');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <label className="btn-secondary cursor-pointer">
          Choose sheet images
          <input type="file" accept="image/*" multiple className="hidden" aria-label="Sheet images"
            onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
        </label>
        {!!queue.length && (
          <span className="text-[11px] text-gray-400">
            {queue.length} file{queue.length > 1 ? 's' : ''} queued · {perFile} tiles each
          </span>
        )}
        {queue.some((i) => i.status === 'done') && (
          <button type="button" onClick={clearDone} className="text-[11px] text-gray-500 underline">clear done</button>
        )}
      </div>

      {!!queue.length && (
        <>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => setPreset(p)}
                className={preset.id === p.id ? 'btn-primary-sm' : 'btn-secondary'} aria-pressed={preset.id === p.id}>
                {p.label}
              </button>
            ))}
            <input className="input !w-36" value={prefix} onChange={(e) => setPrefix(e.target.value)}
              placeholder="headshot" aria-label="Output prefix" title="Output files: headshots/<prefix>_<file>_<tile>.jpg" />
          </div>

          <div className="space-y-2">
            {queue.map((item) => (
              <div key={item.qid} className="panel !p-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-200 truncate flex-1" title={item.fileName}>
                    {item.fileName} · {item.w}×{item.h}px
                  </span>
                  <span className={`text-[10px] flex-none ${statusColor(item.status)}`}>
                    {item.status}{item.detail ? ` — ${item.detail}` : ''}
                  </span>
                  <button type="button" onClick={() => removeItem(item.qid)} disabled={busy}
                    className="text-[10px] text-gray-500 hover:text-red-400 underline flex-none">remove</button>
                </div>
                {!!item.thumbs.length && (
                  <div className="grid gap-1.5 mt-2" style={{ gridTemplateColumns: `repeat(${Math.min(item.thumbs.length, 4)}, minmax(0,1fr))` }}>
                    {item.thumbs.map((u, i) => (
                      <figure key={i} className="relative rounded overflow-hidden bg-black">
                        <img src={u} alt={`tile ${i}`} loading="lazy" className="w-full block" />
                        <figcaption className="absolute bottom-0.5 right-1 text-[10px] font-mono text-white bg-black/60 px-1 rounded">
                          {captions[i] ? `${captions[i]} · ` : ''}{prefix.trim() || 'headshot'}_{item.qid}_{i}.jpg
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={previewAll} className="btn-secondary">Preview all</button>
            <button type="button" onClick={splitSaveAll} disabled={busy} className="btn-primary-sm">
              {busy ? 'Working…' : `Split ${queue.filter((i) => i.status !== 'done').length} file(s) & save to R2`}
            </button>
          </div>
          {preset.mode === 'percent' && (
            <div className="panel !p-3 space-y-2">
              <p className="text-[11px] text-gray-500">Drag dividers to match the sheet — front/back are usually wider than the profiles.</p>
              {cuts.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 w-14 flex-none">cut {i + 1}</span>
                  <input type="range" min={2} max={98} step={0.5} value={Math.round(c * 100)}
                    onChange={(e) => adjustCut(i, Number(e.target.value) / 100)}
                    className="flex-1 accent-purple-500 min-h-[44px]" aria-label={`Divider ${i + 1} percent`} />
                  <span className="text-[11px] font-mono text-gray-300 w-12 text-right flex-none">{Math.round(c * 100)}%</span>
                </div>
              ))}
            </div>
          )}
          {progress && <p className="text-[11px] text-gray-400">{progress}</p>}

          {!!outputs.length && (
            <div className="panel !p-3">
              <h3 className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
                headshots/ — {outputs.length} objects
              </h3>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {outputs.map((o) => (
                  <div key={o.key} className="flex justify-between gap-2 text-[11px] font-mono">
                    <a className="text-gray-300 truncate hover:text-violet-300"
                      href={`/api/storage/download?key=${encodeURIComponent(o.key)}`} target="_blank" rel="noreferrer" title={o.key}>
                      {o.key}
                    </a>
                    <span className="text-gray-500 flex-none">{(o.size / 1024).toFixed(1)} KB</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
