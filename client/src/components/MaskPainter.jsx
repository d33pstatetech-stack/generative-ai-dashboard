import { useEffect, useRef, useState } from 'react';
import { storageUpload } from '../api';

// Inpaint mask painter (port of public/mask.js): paint over the image, red =
// remove/inpaint. Export is full-resolution B/W PNG (black=inpaint, white=keep).
// Touch-friendly via pointer events.
export default function MaskPainter({ notify }) {
  const viewRef = useRef(null);
  const ringRef = useRef(null);
  const fileRef = useRef(null);
  const maskRef = useRef(null); // full-res export canvas
  const ovlRef = useRef(null); // display-res red overlay canvas
  const imgRef = useRef(null);
  const undoRef = useRef([]);
  const paintRef = useRef(false);
  const lastRef = useRef(null);
  const [tool, setTool] = useState('paint');
  const [mode, setMode] = useState('overlay');
  const [brush, setBrush] = useState(40);
  const [opacity, setOpacity] = useState(60);
  const [ready, setReady] = useState(false);
  const [undoDepth, setUndoDepth] = useState(0);
  const [saving, setSaving] = useState(false);
  const toolRef = useRef(tool);
  toolRef.current = tool;

  useEffect(() => {
    maskRef.current = document.createElement('canvas');
    ovlRef.current = document.createElement('canvas');
  }, []);

  const fitView = (img) => {
    const view = viewRef.current;
    const mask = maskRef.current;
    const ovl = ovlRef.current;
    const s = Math.min(1, 1000 / img.naturalWidth);
    view.width = Math.max(1, Math.round(img.naturalWidth * s));
    view.height = Math.max(1, Math.round(img.naturalHeight * s));
    mask.width = img.naturalWidth;
    mask.height = img.naturalHeight;
    ovl.width = view.width;
    ovl.height = view.height;
  };

  const resetMask = () => {
    const mask = maskRef.current;
    const mctx = mask.getContext('2d');
    mctx.globalCompositeOperation = 'source-over';
    mctx.fillStyle = '#ffffff';
    mctx.fillRect(0, 0, mask.width, mask.height);
    ovlRef.current.getContext('2d').clearRect(0, 0, ovlRef.current.width, ovlRef.current.height);
    undoRef.current = [];
    setUndoDepth(0);
  };

  const rebuildOverlay = () => {
    const ovl = ovlRef.current;
    const octx = ovl.getContext('2d');
    octx.clearRect(0, 0, ovl.width, ovl.height);
    const tmp = document.createElement('canvas');
    tmp.width = ovl.width;
    tmp.height = ovl.height;
    const t = tmp.getContext('2d', { willReadFrequently: true });
    t.drawImage(maskRef.current, 0, 0, tmp.width, tmp.height);
    const d = t.getImageData(0, 0, tmp.width, tmp.height);
    const out = octx.createImageData(tmp.width, tmp.height);
    for (let i = 0; i < d.data.length; i += 4) {
      out.data[i] = 255;
      out.data[i + 1] = 0;
      out.data[i + 2] = 0;
      out.data[i + 3] = 255 - d.data[i];
    }
    octx.putImageData(out, 0, 0);
  };

  const render = () => {
    const view = viewRef.current;
    const img = imgRef.current;
    if (!view || !img) return;
    const vctx = view.getContext('2d');
    vctx.globalCompositeOperation = 'source-over';
    vctx.globalAlpha = 1;
    vctx.drawImage(img, 0, 0, view.width, view.height);
    if (mode === 'mask') {
      vctx.drawImage(maskRef.current, 0, 0, view.width, view.height);
      return;
    }
    vctx.globalAlpha = opacity / 100;
    vctx.drawImage(ovlRef.current, 0, 0);
    vctx.globalAlpha = 1;
  };

  useEffect(render); // re-render on mode/opacity change

  const toSrc = (dispPx) => (dispPx * maskRef.current.width) / viewRef.current.width;

  const stamp = (sx, sy, painting) => {
    const mctx = maskRef.current.getContext('2d');
    const octx = ovlRef.current.getContext('2d');
    const k = viewRef.current.width / maskRef.current.width;
    const r = Math.max(1, toSrc(brush) / 2);
    const t = toolRef.current;
    mctx.globalCompositeOperation = 'source-over';
    mctx.fillStyle = t === 'paint' ? '#000000' : '#ffffff';
    mctx.beginPath();
    mctx.arc(sx, sy, r, 0, Math.PI * 2);
    mctx.fill();
    if (t === 'paint') {
      octx.globalCompositeOperation = 'source-over';
      octx.fillStyle = 'rgba(255,0,0,255)';
    } else {
      octx.globalCompositeOperation = 'destination-out';
    }
    octx.beginPath();
    octx.arc(sx * k, sy * k, Math.max(1, brush / 2), 0, Math.PI * 2);
    octx.fill();
    octx.globalCompositeOperation = 'source-over';
    void painting;
  };

  const strokeTo = (sx, sy) => {
    const last = lastRef.current;
    if (!last) {
      stamp(sx, sy);
      lastRef.current = { x: sx, y: sy };
      return;
    }
    const dx = sx - last.x;
    const dy = sy - last.y;
    const step = Math.max(1, toSrc(brush) / 4);
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / step));
    for (let i = 1; i <= n; i++) stamp(last.x + (dx * i) / n, last.y + (dy * i) / n);
    lastRef.current = { x: sx, y: sy };
  };

  const evtSrc = (e) => {
    const r = viewRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * maskRef.current.width,
      y: ((e.clientY - r.top) / r.height) * maskRef.current.height,
    };
  };

  const pushUndo = () => {
    try {
      const mctx = maskRef.current.getContext('2d');
      undoRef.current.push(mctx.getImageData(0, 0, maskRef.current.width, maskRef.current.height));
      if (undoRef.current.length > 10) undoRef.current.shift();
      setUndoDepth(undoRef.current.length);
    } catch { /* ignore */ }
  };

  const onDown = (e) => {
    if (!imgRef.current) return;
    e.preventDefault();
    paintRef.current = true;
    try { viewRef.current.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    pushUndo();
    lastRef.current = null;
    const p = evtSrc(e);
    strokeTo(p.x, p.y);
    render();
  };
  const onMove = (e) => {
    updateRing(e);
    if (!paintRef.current || !imgRef.current) return;
    e.preventDefault();
    const p = evtSrc(e);
    strokeTo(p.x, p.y);
    render();
  };
  const stop = () => { paintRef.current = false; lastRef.current = null; };

  const updateRing = (e) => {
    const ring = ringRef.current;
    if (!ring || !imgRef.current) return;
    const r = viewRef.current.getBoundingClientRect();
    ring.style.display = 'block';
    ring.style.width = ring.style.height = `${brush}px`;
    ring.style.left = `${e.clientX - r.left - brush / 2}px`;
    ring.style.top = `${e.clientY - r.top - brush / 2}px`;
  };

  const loadFile = (f) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => {
      imgRef.current = im;
      fitView(im);
      resetMask();
      render();
      setReady(true);
      URL.revokeObjectURL(url);
    };
    im.onerror = () => notify && notify('Could not decode image', 'error');
    im.src = url;
  };

  const undo = () => {
    const prev = undoRef.current.pop();
    if (prev) {
      maskRef.current.getContext('2d').putImageData(prev, 0, 0);
      rebuildOverlay();
      render();
      setUndoDepth(undoRef.current.length);
    }
  };

  const clear = () => { resetMask(); render(); };

  const invert = () => {
    if (!imgRef.current) return;
    pushUndo();
    const mctx = maskRef.current.getContext('2d');
    const d = mctx.getImageData(0, 0, maskRef.current.width, maskRef.current.height);
    for (let i = 0; i < d.data.length; i += 4) d.data[i] = d.data[i + 1] = d.data[i + 2] = 255 - d.data[i];
    mctx.putImageData(d, 0, 0);
    rebuildOverlay();
    render();
  };

  const download = () => {
    if (!imgRef.current) return;
    const a = document.createElement('a');
    a.download = 'mask.png';
    a.href = maskRef.current.toDataURL('image/png');
    a.click();
  };

  const saveR2 = async () => {
    if (!imgRef.current) return;
    setSaving(true);
    try {
      const blob = await new Promise((res) => maskRef.current.toBlob(res, 'image/png'));
      if (!blob) throw new Error('encode failed');
      const key = `masks/mask-${Date.now()}.png`;
      await storageUpload(key, blob, 'image/png');
      notify && notify(`Mask saved: ${key}`, 'success');
    } catch (e) {
      notify && notify(`Save failed: ${e.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const btn = (active) => (active ? 'btn-primary-sm flex-1' : 'btn-secondary flex-1');

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <label className="btn-secondary cursor-pointer">
          Choose image
          <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-label="Source image"
            onChange={(e) => loadFile(e.target.files?.[0])} />
        </label>
        <div className="flex gap-1 flex-1 min-w-[140px]">
          <button type="button" onClick={() => setTool('paint')} className={btn(tool === 'paint')}>Paint</button>
          <button type="button" onClick={() => setTool('erase')} className={btn(tool === 'erase')}>Erase</button>
        </div>
        <div className="flex gap-1 flex-1 min-w-[140px]">
          <button type="button" onClick={() => { setMode('overlay'); }} className={btn(mode === 'overlay')}>Overlay</button>
          <button type="button" onClick={() => { setMode('mask'); }} className={btn(mode === 'mask')}>Mask</button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-500 w-12 flex-none">Brush</span>
        <input type="range" min={4} max={200} value={brush} onChange={(e) => setBrush(Number(e.target.value))}
          className="flex-1 accent-purple-500 min-h-[44px]" aria-label="Brush size" />
        <span className="text-[11px] font-mono text-gray-300 w-12 text-right flex-none">{brush}px</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-500 w-12 flex-none">Overlay</span>
        <input type="range" min={10} max={100} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))}
          className="flex-1 accent-purple-500 min-h-[44px]" aria-label="Overlay opacity" />
        <span className="text-[11px] font-mono text-gray-300 w-12 text-right flex-none">{opacity}%</span>
      </div>
      <div className="relative rounded-lg overflow-hidden bg-black touch-none select-none" style={{ touchAction: 'none' }}>
        <canvas ref={viewRef} width={640} height={360}
          className="w-full block" style={{ cursor: 'none' }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={stop} onPointerCancel={stop}
          onPointerLeave={() => { if (ringRef.current) ringRef.current.style.display = 'none'; }} />
        <span ref={ringRef} className="absolute rounded-full border-2 border-white pointer-events-none"
          style={{ display: 'none', boxShadow: '0 0 0 1px #000' }} />
        {!ready && (
          <p className="absolute inset-0 flex items-center justify-center text-xs text-gray-500 pointer-events-none">
            Choose an image, then paint the area to inpaint (red)
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={undo} disabled={!undoDepth} className="btn-secondary flex-1">Undo</button>
        <button type="button" onClick={clear} disabled={!ready} className="btn-secondary flex-1">Clear</button>
        <button type="button" onClick={invert} disabled={!ready} className="btn-secondary flex-1">Invert</button>
        <button type="button" onClick={download} disabled={!ready} className="btn-secondary flex-1">Download</button>
        <button type="button" onClick={saveR2} disabled={!ready || saving} className="btn-primary-sm flex-1">
          {saving ? 'Saving…' : 'Save to R2'}
        </button>
      </div>
    </div>
  );
}
