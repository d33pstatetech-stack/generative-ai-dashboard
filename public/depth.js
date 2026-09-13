// Depth-lite: client-side transformers.js depth-estimation. Lazy-loaded on demand.
(() => {
  const src = document.getElementById('depthSrc');
  const out = document.getElementById('depthOut');
  if (!src || !out) return;
  const sctx = src.getContext('2d');
  const octx = out.getContext('2d');
  let img = null;
  let predictor = null;
  const status = () => document.getElementById('depthStatus');

  function fit(w, h) {
    const maxW = 640;
    const s = Math.min(1, maxW / w);
    src.width = out.width = Math.round(w * s);
    src.height = out.height = Math.round(h * s);
  }
  document.getElementById('depthFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    img = new Image();
    img.onload = () => { fit(img.naturalWidth, img.naturalHeight); sctx.drawImage(img, 0, 0, src.width, src.height); URL.revokeObjectURL(url); };
    img.src = url;
  });
  document.getElementById('runDepth').addEventListener('click', async () => {
    if (!img) { status().textContent = 'pick an image first'; return; }
    status().textContent = 'loading depth model (first run downloads ~100-300MB)…';
    try {
      const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
      if (!predictor) predictor = await pipeline('depth-estimation', 'Xenova/dpt-large');
      status().textContent = 'running…';
      const result = await predictor(src.toDataURL('image/png'));
      // v2 depth-estimation returns { predicted_depth: Tensor, depth: RawImage }.
      // RawImage has no browser toCanvas/toDataURL helper, so render from
      // raw.data/width/height/channels via putImageData (works for 1/3/4 ch).
      const raw = result.depth || result.predicted_depth;
      let dataURL = null;
      if (raw && typeof raw.toDataURL === 'function') {
        try { dataURL = raw.toDataURL(); } catch {}
      }
      if (!dataURL && raw && raw.data && raw.width && raw.height) {
        const ch = raw.channels || 1;
        const img2 = octx.createImageData(raw.width, raw.height);
        const d = img2.data, s = raw.data;
        if (ch === 4) d.set(s.subarray(0, d.length));
        else if (ch === 3) {
          for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
            d[i] = s[j]; d[i + 1] = s[j + 1]; d[i + 2] = s[j + 2]; d[i + 3] = 255;
          }
        } else {
          for (let i = 0, j = 0; i < d.length; i += 4, j++) {
            d[i] = d[i + 1] = d[i + 2] = s[j]; d[i + 3] = 255;
          }
        }
        const c = document.createElement('canvas');
        c.width = raw.width; c.height = raw.height;
        c.getContext('2d').putImageData(img2, 0, 0);
        dataURL = c.toDataURL();
      }
      if (!dataURL) throw new Error('unexpected pipeline output shape');
      const tmp = new Image();
      tmp.onload = () => {
        octx.drawImage(tmp, 0, 0, out.width, out.height);
        applyContrast();
        status().textContent = 'done';
      };
      tmp.onerror = () => { status().textContent = 'could not render depth output'; };
      tmp.src = dataURL;
    } catch (e) { status().textContent = 'depth failed: ' + String(e.message || e); }
  });
  function applyContrast() {
    const c = Number(document.getElementById('depthContrast').value || 100) / 100;
    const d = octx.getImageData(0, 0, out.width, out.height);
    for (let i = 0; i < d.data.length; i += 4) {
      const g = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3;
      const v = Math.max(0, Math.min(255, 128 + (g - 128) * c));
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    }
    octx.putImageData(d, 0, 0);
  }
  document.getElementById('depthContrast').addEventListener('input', () => { try { applyContrast(); } catch {} });
  document.getElementById('downloadDepth').addEventListener('click', () => {
    const a = document.createElement('a');
    a.download = 'depth.png';
    a.href = out.toDataURL('image/png');
    a.click();
  });
  fit(640, 400);
})();
