// Mask painter v2: paint directly OVER the image.
// Pattern follows the standard inpainting editors (e.g. ComfyUI MaskEditor,
// lxfater/inpaint-web): source image as background, painted areas shown as
// red overlay. Export is a full-resolution B/W PNG: black = remove/inpaint,
// white = keep (SD standard).
//
// Performance: strokes paint to a full-res mask canvas (for export) AND an
// incremental display-size overlay canvas (for rendering), so mousemove
// renders stay cheap. Overlay is rebuilt from the mask only on
// undo/invert/clear/load.
(() => {
  const view = document.getElementById('maskView');
  if (!view) return;
  const vctx = view.getContext('2d');
  const ring = document.getElementById('brushRing');
  const brushInput = document.getElementById('brushSize');
  const brushVal = document.getElementById('brushVal');
  const opacityInput = document.getElementById('overlayOpacity');

  const mask = document.createElement('canvas'); // full source resolution (export)
  const mctx = mask.getContext('2d', { willReadFrequently: true });
  const ovl = document.createElement('canvas'); // display resolution (red tint)
  const octx = ovl.getContext('2d');

  let img = null;
  let tool = 'paint';   // 'paint' (black=remove) | 'erase' (white=keep)
  let mode = 'overlay'; // 'overlay' | 'mask'
  let painting = false;
  let last = null;
  const undoStack = [];
  const UNDO_CAP = 10;

  const toDisp = (srcPx) => (srcPx * view.width) / mask.width;
  const toSrc = (dispPx) => (dispPx * mask.width) / view.width;

  function brushDispPx() { return Math.max(1, Number(brushInput.value)); }

  function fitView() {
    const maxW = 1000;
    const s = Math.min(1, maxW / img.naturalWidth);
    view.width = Math.max(1, Math.round(img.naturalWidth * s));
    view.height = Math.max(1, Math.round(img.naturalHeight * s));
    mask.width = img.naturalWidth;
    mask.height = img.naturalHeight;
    ovl.width = view.width;
    ovl.height = view.height;
  }

  function resetMask() {
    mctx.globalCompositeOperation = 'source-over';
    mctx.fillStyle = '#ffffff';
    mctx.fillRect(0, 0, mask.width, mask.height);
    octx.clearRect(0, 0, ovl.width, ovl.height);
    undoStack.length = 0;
  }

  // Rebuild display overlay from full-res mask (downscaled). Heavy op —
  // only used on undo/invert/clear/load, not during strokes.
  function rebuildOverlay() {
    octx.clearRect(0, 0, ovl.width, ovl.height);
    const tmp = document.createElement('canvas');
    tmp.width = ovl.width; tmp.height = ovl.height;
    const t = tmp.getContext('2d', { willReadFrequently: true });
    t.drawImage(mask, 0, 0, tmp.width, tmp.height);
    const d = t.getImageData(0, 0, tmp.width, tmp.height);
    const out = octx.createImageData(tmp.width, tmp.height);
    for (let i = 0; i < d.data.length; i += 4) {
      out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 0;
      out.data[i + 3] = 255 - d.data[i]; // dark mask px => opaque red
    }
    octx.putImageData(out, 0, 0);
  }

  function render() {
    if (!img) return;
    vctx.globalCompositeOperation = 'source-over';
    vctx.globalAlpha = 1;
    vctx.drawImage(img, 0, 0, view.width, view.height);
    if (mode === 'mask') {
      vctx.drawImage(mask, 0, 0, view.width, view.height);
      return;
    }
    vctx.globalAlpha = Number(opacityInput.value) / 100;
    vctx.drawImage(ovl, 0, 0);
    vctx.globalAlpha = 1;
  }

  function stampMask(x, y) {
    const r = Math.max(1, toSrc(brushDispPx()) / 2);
    mctx.globalCompositeOperation = 'source-over';
    mctx.fillStyle = tool === 'paint' ? '#000000' : '#ffffff';
    mctx.beginPath();
    mctx.arc(x, y, r, 0, Math.PI * 2);
    mctx.fill();
  }

  function stampOverlay(dx, dy) {
    const r = Math.max(1, brushDispPx() / 2);
    if (tool === 'paint') {
      octx.globalCompositeOperation = 'source-over';
      octx.fillStyle = 'rgba(255,0,0,255)';
      octx.beginPath();
      octx.arc(dx, dy, r, 0, Math.PI * 2);
      octx.fill();
    } else {
      octx.globalCompositeOperation = 'destination-out';
      octx.beginPath();
      octx.arc(dx, dy, r, 0, Math.PI * 2);
      octx.fill();
      octx.globalCompositeOperation = 'source-over';
    }
  }

  function strokeTo(sx, sy) {
    const k = view.width / mask.width; // src -> disp
    if (!last) {
      stampMask(sx, sy);
      stampOverlay(sx * k, sy * k);
      last = { x: sx, y: sy };
      return;
    }
    const dx = sx - last.x, dy = sy - last.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(1, toSrc(brushDispPx()) / 4);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) {
      const x = last.x + (dx * i) / n, y = last.y + (dy * i) / n;
      stampMask(x, y);
      stampOverlay(x * k, y * k);
    }
    last = { x: sx, y: sy };
  }

  function evtSrc(e) {
    const r = view.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * mask.width,
      y: ((e.clientY - r.top) / r.height) * mask.height,
    };
  }

  function pushUndo() {
    try {
      undoStack.push(mctx.getImageData(0, 0, mask.width, mask.height));
      if (undoStack.length > UNDO_CAP) undoStack.shift();
    } catch {}
  }

  view.addEventListener('pointerdown', (e) => {
    if (!img) return;
    painting = true;
    try { view.setPointerCapture(e.pointerId); } catch {}
    pushUndo();
    last = null;
    const p = evtSrc(e);
    strokeTo(p.x, p.y);
    render();
  });
  view.addEventListener('pointermove', (e) => {
    updateRing(e);
    if (!painting || !img) return;
    const p = evtSrc(e);
    strokeTo(p.x, p.y);
    render();
  });
  const stop = () => { painting = false; last = null; };
  view.addEventListener('pointerup', stop);
  view.addEventListener('pointercancel', stop);
  view.addEventListener('pointerleave', () => { if (ring) ring.style.display = 'none'; });

  function updateRing(e) {
    if (!ring || !img) return;
    const r = view.getBoundingClientRect();
    const d = Number(brushInput.value);
    ring.style.display = 'block';
    ring.style.width = ring.style.height = d + 'px';
    ring.style.left = (e.clientX - r.left - d / 2) + 'px';
    ring.style.top = (e.clientY - r.top - d / 2) + 'px';
  }

  document.getElementById('maskFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => {
      img = im;
      fitView();
      resetMask();
      render();
      URL.revokeObjectURL(url);
    };
    im.src = url;
  });

  const paintBtn = document.getElementById('toolPaint');
  const eraseBtn = document.getElementById('toolErase');
  function syncTools() {
    paintBtn.classList.toggle('active', tool === 'paint');
    eraseBtn.classList.toggle('active', tool === 'erase');
  }
  paintBtn.addEventListener('click', () => { tool = 'paint'; syncTools(); });
  eraseBtn.addEventListener('click', () => { tool = 'erase'; syncTools(); });
  syncTools();

  const ovBtn = document.getElementById('viewOverlay');
  const mBtn = document.getElementById('viewMask');
  function syncView() {
    ovBtn.classList.toggle('active', mode === 'overlay');
    mBtn.classList.toggle('active', mode === 'mask');
  }
  ovBtn.addEventListener('click', () => { mode = 'overlay'; syncView(); render(); });
  mBtn.addEventListener('click', () => { mode = 'mask'; syncView(); render(); });
  syncView();

  brushInput.addEventListener('input', () => { brushVal.textContent = brushInput.value + 'px'; });
  brushVal.textContent = brushInput.value + 'px';
  opacityInput.addEventListener('input', render);

  document.getElementById('undoStroke').addEventListener('click', () => {
    const prev = undoStack.pop();
    if (prev) { mctx.putImageData(prev, 0, 0); rebuildOverlay(); render(); }
  });
  document.getElementById('clearMask').addEventListener('click', () => { resetMask(); render(); });
  document.getElementById('invertMask').addEventListener('click', () => {
    if (!img) return;
    pushUndo();
    const d = mctx.getImageData(0, 0, mask.width, mask.height);
    for (let i = 0; i < d.data.length; i += 4) {
      d.data[i] = d.data[i + 1] = d.data[i + 2] = 255 - d.data[i];
    }
    mctx.putImageData(d, 0, 0);
    rebuildOverlay();
    render();
  });
  document.getElementById('downloadMask').addEventListener('click', () => {
    if (!img) return;
    const a = document.createElement('a');
    a.download = 'mask.png';
    a.href = mask.toDataURL('image/png');
    a.click();
  });
  document.getElementById('saveMaskR2').addEventListener('click', async () => {
    if (!img) return;
    const blob = await new Promise((res) => mask.toBlob(res, 'image/png'));
    if (!blob) return;
    const key = 'masks/mask-' + Date.now() + '.png';
    const r = await fetch('/api/storage/upload?key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob,
    });
    alert(r.ok ? 'saved: ' + key : 'save failed (R2 unconfigured or login required)');
  });

  view.style.cursor = 'none';
})();
