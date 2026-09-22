import { useState } from 'react';
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
    img.onerror = () => reject(new Error('Could not decode image'));
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

// Headshot sheet splitter: 3x3 / 3x2 reference grids → headshots/ in R2.
// Equivalent to: magick in.jpg -crop 3x3@ +repage +adjoin headshot_%d.jpg
export default function Headshots({ notify }) {
  const [src, setSrc] = useState(null); // {img,w,h,url,fileName}
  const [preset, setPreset] = useState(PRESETS[0]);
  const [cuts, setCuts] = useState([0.3, 0.5, 0.7]); // 1x4 divider fractions
  const [prefix, setPrefix] = useState('headshot');
  const [thumbs, setThumbs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [outputs, setOutputs] = useState([]);

  const tiles = src
    ? preset.mode === 'percent'
      ? computeTilesPercent(src.w, src.h, cuts)
      : computeTiles(src.w, src.h, preset.cols, preset.rows)
    : [];
  const tileCount = tiles.length;
  const captions = preset.id === '1x4' ? QUARTERS : [];

  const pick = async (file) => {
    if (!file) return;
    try {
      const loaded = await loadImage(file);
      setSrc({ ...loaded, file, fileName: file.name });
      setOutputs([]);
      setProgress('');
    } catch (e) {
      notify && notify(e.message, 'error');
    }
  };

  const preview = (rects = tiles) => {
    if (!src) return;
    setThumbs(rects.map((t) => thumbUrl(src.img, t)));
  };

  // Re-preview live while dragging dividers.
  const adjustCut = (i, v) => {
    const lo = i === 0 ? 0.05 : cuts[i - 1] + 0.03;
    const hi = i === cuts.length - 1 ? 0.95 : cuts[i + 1] - 0.03;
    const cv = Math.min(hi, Math.max(lo, v));
    const next = [...cuts];
    next[i] = cv;
    setCuts(next);
    if (src && thumbs.length) {
      setThumbs(computeTilesPercent(src.w, src.h, next).map((t) => thumbUrl(src.img, t)));
    }
  };

  const splitSave = async () => {
    if (!src) return;
    const pre = (prefix.trim() || 'headshot').replace(/[^a-z0-9_-]+/gi, '_');
    setBusy(true);
    try {
      // 1. source → headshots/sources/
      const srcKey = `headshots/sources/${sanitize(src.fileName)}`;
      setProgress('Uploading source…');
      await storageUpload(srcKey, src.file, src.file.type || 'image/jpeg');
      // 2. tiles → headshots/<prefix>_<i>.jpg
      const done = [];
      for (let i = 0; i < tiles.length; i++) {
        setProgress(`Saving tile ${i + 1}/${tiles.length}…`);
        const blob = await tileBlob(src.img, tiles[i]);
        const key = `headshots/${pre}_${i}.jpg`;
        await storageUpload(key, blob, 'image/jpeg');
        done.push(key);
      }
      // 3. review output dir
      setProgress('Listing headshots/…');
      const listed = await storageList('headshots/');
      setOutputs(listed);
      setProgress(`Done — ${done.length} tiles + source saved.`);
      notify && notify(`Split ${tiles.length} tiles → headshots/`, 'success');
    } catch (e) {
      setProgress('');
      notify && notify(`Split failed: ${e.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <label className="btn-secondary cursor-pointer">
          Choose sheet image
          <input type="file" accept="image/*" className="hidden" aria-label="Sheet image"
            onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {src && (
          <span className="text-[11px] text-gray-400">
            {src.fileName} · {src.w}×{src.h}px
          </span>
        )}
      </div>

      {src && (
        <>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => { setPreset(p); setThumbs([]); }}
                className={preset.id === p.id ? 'btn-primary-sm' : 'btn-secondary'} aria-pressed={preset.id === p.id}>
                {p.label}
              </button>
            ))}
            <input className="input !w-36" value={prefix} onChange={(e) => setPrefix(e.target.value)}
              placeholder="headshot" aria-label="Output prefix" title="Output files: headshots/<prefix>_N.jpg" />
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => preview()} className="btn-secondary">Preview tiles</button>
            <button type="button" onClick={splitSave} disabled={busy} className="btn-primary-sm">
              {busy ? 'Working…' : `Split ${tileCount} & save to R2`}
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

          {!!thumbs.length && (
            <div className="grid gap-1.5" style={{ maxWidth: 640, gridTemplateColumns: `repeat(${Math.min(thumbs.length, 4)}, minmax(0,1fr))` }}>
              {thumbs.map((u, i) => (
                <figure key={i} className="relative rounded overflow-hidden bg-black">
                  <img src={u} alt={`tile ${i}`} loading="lazy" className="w-full block" />
                  <figcaption className="absolute bottom-0.5 right-1 text-[10px] font-mono text-white bg-black/60 px-1 rounded">
                    {captions[i] ? `${captions[i]} · ` : ''}{prefix.trim() || 'headshot'}_{i}.jpg
                  </figcaption>
                </figure>
              ))}
            </div>
          )}

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
