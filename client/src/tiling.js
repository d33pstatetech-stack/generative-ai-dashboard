// Pure tile math for grid-splitting reference sheets.
// Mirrors ImageMagick `magick in.jpg -crop CxR@ +repage +adjoin out_%d.jpg`:
// row-major order, remainder pixels distributed to leading tiles (sizes differ ≤1px).

// Split `total` into `parts`, spreading remainder over leading parts.
// distribute(1033, 3) → [345, 344, 344]
export function distribute(total, parts) {
  const base = Math.floor(total / parts);
  const rem = total % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rem ? 1 : 0));
}

// Tile rects for a cols×rows grid over a W×H image. Row-major, IM-compatible.
export function computeTiles(w, h, cols, rows) {
  const cws = distribute(w, cols);
  const rhs = distribute(h, rows);
  const tiles = [];
  let y = 0;
  for (const rh of rhs) {
    let x = 0;
    for (const cw of cws) {
      tiles.push({ x, y, w: cw, h: rh });
      x += cw;
    }
    y += rh;
  }
  return tiles;
}

// Sanity helper for tests: total covered area must equal W*H.
export function coveredArea(tiles) {
  return tiles.reduce((a, t) => a + t.w * t.h, 0);
}

// Uneven single-row split from divider fractions, e.g. cuts=[0.3,0.5,0.7] → 4
// full-height tiles (wide front/back, narrow profiles). Fractions are clamped
// to ascending order; widths always sum to exactly w.
export function computeTilesPercent(w, h, cuts) {
  const cs = [...cuts].map((c) => Math.min(0.99, Math.max(0.01, Number(c) || 0))).sort((a, b) => a - b);
  const bounds = [0, ...cs.map((c) => Math.round(c * w)), w];
  const tiles = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const x = bounds[i];
    const tw = bounds[i + 1] - x;
    if (tw > 0) tiles.push({ x, y: 0, w: tw, h });
  }
  return tiles;
}
