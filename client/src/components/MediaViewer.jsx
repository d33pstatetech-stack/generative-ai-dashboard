// Media viewer modal: main pane (image or video) + sidebar with run details.
// Props: { media: { url, video }, run, onClose } — plus optional sibling
// navigation { items: [{ media, run }], index, onNav } which degrades to
// single-item usage when omitted (arrows no-op, no filmstrip).
// Every sidebar field is optional — absent fields render nothing.
import { useCallback, useEffect, useRef, useState } from 'react';
import './MediaViewer.css';

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;
const SWIPE_PX = 50;

function textOf(run) {
  const raw = run?.input_json || run?.input_preview || '';
  if (!raw) return '';
  try {
    const j = JSON.parse(raw);
    if (typeof j === 'string') return j;
    if (j && typeof j === 'object') return j.prompt ?? j.input ?? j.text ?? raw;
    return raw;
  } catch {
    return raw;
  }
}

function lorasOf(run) {
  const v = run?.loras_json;
  if (v == null || v === '') return [];
  try {
    const a = JSON.parse(v);
    if (Array.isArray(a)) return a.map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x))).filter(Boolean);
    if (typeof a === 'string') return a ? [a] : [];
    if (a && typeof a === 'object') return [JSON.stringify(a)];
    return [];
  } catch {
    return [String(v)];
  }
}

function Row({ label, children }) {
  if (children == null || children === '' || children === false) return null;
  return (
    <div className="py-1 border-b border-gray-800/50 last:border-0">
      <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{label}</dt>
      <dd className="mt-0.5 text-xs text-gray-200 break-words">{children}</dd>
    </div>
  );
}

function isTypingTarget(t) {
  return !!(
    t &&
    (t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT' ||
      t.isContentEditable)
  );
}

export default function MediaViewer({ media, run = {}, onClose, items, index, onNav }) {
  const hasNav =
    Array.isArray(items) && items.length > 0 &&
    typeof index === 'number' && typeof onNav === 'function';
  const current = hasNav ? items[index] || {} : {};
  const curMedia = (hasNav ? current.media : media) || media;
  const curRun = (hasNav ? current.run : run) || run || {};
  const canNav = hasNav && items.length > 1;
  const isVideo = !!curMedia?.video;

  const dialogRef = useRef(null);
  const viewportRef = useRef(null);
  const openerRef = useRef(null);
  const dragRef = useRef(null); // { startX, startY, panX, panY, pointerId } | null
  const touchRef = useRef(null); // { x, y } | null

  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const [dragging, setDragging] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Reset zoom/pan when the shown media changes.
  useEffect(() => {
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
    setOrigin({ x: 50, y: 50 });
    setDragging(false);
    dragRef.current = null;
  }, [curMedia?.url]);

  // Capture opener, auto-focus dialog, lock body scroll, return focus on unmount.
  useEffect(() => {
    openerRef.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (dialogRef.current) dialogRef.current.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prevOverflow;
      const opener = openerRef.current;
      if (opener && typeof opener.focus === 'function') {
        try { opener.focus({ preventScroll: true }); } catch { /* noop */ }
      }
    };
  }, []);

  const go = useCallback((next) => {
    if (!canNav) return;
    const clamped = Math.max(0, Math.min(items.length - 1, next));
    if (clamped !== index) onNav(clamped);
  }, [canNav, items, index, onNav]);

  const zoomIn = useCallback(() => {
    if (isVideo) return;
    setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)));
  }, [isVideo]);
  const zoomOut = useCallback(() => {
    if (isVideo) return;
    setZoom((z) => {
      const next = +(z - ZOOM_STEP).toFixed(2);
      if (next <= MIN_ZOOM) {
        setPan({ x: 0, y: 0 });
        return MIN_ZOOM;
      }
      return next;
    });
  }, [isVideo]);
  const zoomReset = useCallback(() => {
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
    setOrigin({ x: 50, y: 50 });
  }, []);

  // Keyboard: dialog behaviour + zoom + sibling navigation.
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') {
        if (onClose) onClose();
        return;
      }
      // Focus trap: Tab cycles inside the dialog.
      if (e.key === 'Tab' && dialogRef.current) {
        const els = [...dialogRef.current.querySelectorAll(
          'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )].filter((el) => el.getClientRects().length > 0);
        if (!els.length) {
          e.preventDefault();
          return;
        }
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      // Never hijack keys while typing in a form field.
      if (isTypingTarget(e.target)) return;
      if (e.key === 'ArrowLeft') {
        if (canNav) { e.preventDefault(); go(index - 1); }
      } else if (e.key === 'ArrowRight') {
        if (canNav) { e.preventDefault(); go(index + 1); }
      } else if (e.key === '+' || e.key === '=') {
        if (!isVideo) { e.preventDefault(); zoomIn(); }
      } else if (e.key === '-' || e.key === '_') {
        if (!isVideo) { e.preventDefault(); zoomOut(); }
      } else if (e.key === '0') {
        if (!isVideo) { e.preventDefault(); zoomReset(); }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, canNav, index, go, isVideo, zoomIn, zoomOut, zoomReset]);

  // Wheel zoom centered on cursor (images only). Non-passive so we can preventDefault.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || isVideo) return;
    const h = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setOrigin({
          x: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
          y: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
        });
      }
      if (e.deltaY < 0) zoomIn();
      else if (e.deltaY > 0) zoomOut();
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, [isVideo, zoomIn, zoomOut, curMedia?.url]);

  // Auto-center the active filmstrip thumb.
  useEffect(() => {
    if (!canNav || !dialogRef.current) return;
    const active = dialogRef.current.querySelector('.mv-thumb.active');
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
  }, [canNav, index]);

  const onPointerDown = (e) => {
    if (isVideo || zoom <= MIN_ZOOM) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y, pointerId: e.pointerId };
    setDragging(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    setPan({ x: d.panX + (e.clientX - d.startX), y: d.panY + (e.clientY - d.startY) });
  };
  const endDrag = (e) => {
    if (dragRef.current && e && e.pointerId !== dragRef.current.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  };

  const onDoubleClick = (e) => {
    if (isVideo) return;
    if (zoom > MIN_ZOOM) {
      zoomReset();
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setOrigin({
          x: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
          y: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
        });
      }
      setZoom(2);
    }
  };

  const onTouchStart = (e) => {
    if (e.touches.length !== 1) { touchRef.current = null; return; } // multi-touch (pinch) ignored
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    const s = touchRef.current;
    touchRef.current = null;
    if (!s || zoom > MIN_ZOOM) return; // panning owns the gesture when zoomed
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5 && canNav) {
      go(index + (dx < 0 ? 1 : -1));
    }
  };

  if (!curMedia) return null;
  const prompt = textOf(curRun);
  const loras = lorasOf(curRun);
  const ok = curRun.status === 'succeeded' || curRun.status === 'completed';

  return (
    <div className="mv-backdrop" onClick={() => onClose && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Media viewer"
        tabIndex={-1}
        className="mv-dialog panel !p-3 md:!p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mv-layout">
          <div className="mv-stage-col">
            <div className="mv-stage-bar">
              {canNav ? (
                <span className="mv-counter" aria-live="polite">
                  {index + 1} / {items.length}
                </span>
              ) : <span />}
              {!isVideo && (
                <div className="mv-zoom-tools" role="group" aria-label="Zoom controls">
                  <button type="button" className="mv-tool-btn" onClick={zoomOut} disabled={zoom <= MIN_ZOOM}
                    aria-label="Zoom out" title="Zoom out (-)">−</button>
                  <button type="button" className="mv-tool-btn" onClick={zoomReset} disabled={zoom <= MIN_ZOOM}
                    aria-label="Reset zoom" title="Reset zoom (0)">{Math.round(zoom * 100)}%</button>
                  <button type="button" className="mv-tool-btn" onClick={zoomIn} disabled={zoom >= MAX_ZOOM}
                    aria-label="Zoom in" title="Zoom in (+)">+</button>
                </div>
              )}
            </div>

            <div className="mv-stage">
              {canNav && (
                <button type="button" className="mv-nav-btn mv-nav-prev" onClick={() => go(index - 1)}
                  disabled={index <= 0} aria-label="Previous media" title="Previous (←)">‹</button>
              )}
              {isVideo ? (
                <video src={curMedia.url} controls preload="metadata" className="mv-video" />
              ) : (
                <div
                  ref={viewportRef}
                  className={`mv-viewport${zoom > MIN_ZOOM ? ' mv-zoomed' : ''}${dragging ? ' mv-dragging' : ''}`}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onDoubleClick={onDoubleClick}
                  onTouchStart={onTouchStart}
                  onTouchEnd={onTouchEnd}
                  title={zoom > MIN_ZOOM ? 'Drag to pan · double-click to reset' : 'Scroll to zoom · double-click for 2x · drag when zoomed'}
                >
                  <img
                    src={curMedia.url}
                    alt=""
                    draggable={false}
                    className="mv-img"
                    style={{
                      '--mv-scale': zoom,
                      '--mv-tx': `${pan.x}px`,
                      '--mv-ty': `${pan.y}px`,
                      '--mv-ox': `${origin.x}%`,
                      '--mv-oy': `${origin.y}%`,
                    }}
                  />
                </div>
              )}
              {canNav && (
                <button type="button" className="mv-nav-btn mv-nav-next" onClick={() => go(index + 1)}
                  disabled={index >= items.length - 1} aria-label="Next media" title="Next (→)">›</button>
              )}
            </div>

            {canNav && (
              <div className="mv-filmstrip" role="listbox" aria-label="Media items">
                {items.map((it, i) => (
                  <button
                    key={it?.media?.url || i}
                    type="button"
                    role="option"
                    aria-selected={i === index}
                    aria-label={`Media ${i + 1}${it?.media?.video ? ' (video)' : ''}`}
                    className={`mv-thumb${i === index ? ' active' : ''}`}
                    onClick={() => { if (i !== index) onNav(i); }}
                  >
                    {it?.media?.video ? (
                      <span className="mv-thumb-badge" aria-hidden="true">▶</span>
                    ) : (
                      <img src={it?.media?.url} alt="" loading="lazy" draggable={false} />
                    )}
                  </button>
                ))}
              </div>
            )}

            <div className="mv-actions">
              <a href={curMedia.url} target="_blank" rel="noreferrer" className="btn-secondary !min-h-[36px] text-xs">
                Open original <i className="fas fa-arrow-up-right-from-square text-[10px] ml-1"></i>
              </a>
              <a href={curMedia.url} download className="btn-secondary !min-h-[36px] text-xs">
                <i className="fas fa-download text-[10px] mr-1"></i>Download
              </a>
              <button type="button" onClick={() => onClose && onClose()} className="btn-secondary !min-h-[36px] text-xs ml-auto">
                Close
              </button>
            </div>

            <button
              type="button"
              className="mv-details-toggle"
              aria-expanded={detailsOpen}
              onClick={() => setDetailsOpen((v) => !v)}
            >
              {detailsOpen ? 'Hide details ▲' : 'Show details ▼'}
            </button>
          </div>

          <aside className={`mv-sidebar${detailsOpen ? '' : ' mv-collapsed'}`}>
            <h3 className="panel-title !mb-1">Run details</h3>
            <dl>
              {prompt ? (
                <div className="py-1 border-b border-gray-800/50">
                  <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Prompt</dt>
                  <dd className="mt-0.5 text-xs text-gray-200 mv-prompt-scroll">{prompt}</dd>
                </div>
              ) : null}
              <Row label="Model">{curRun.model}</Row>
              <Row label="Provider">{curRun.provider}</Row>
              <Row label="Source app">{curRun.source_app}</Row>
              {curRun.status ? (
                <div className="py-1 border-b border-gray-800/50">
                  <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Status</dt>
                  <dd className="mt-0.5">
                    <span className={`badge ${ok ? 'live' : curRun.status === 'failed' ? 'error' : ''}`}>{curRun.status}</span>
                  </dd>
                </div>
              ) : null}
              {loras.length ? (
                <div className="py-1 border-b border-gray-800/50">
                  <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">LoRAs</dt>
                  <dd className="mt-0.5 text-xs text-gray-200 break-words">
                    <ul className="list-disc pl-4 space-y-0.5">
                      {loras.map((l, i) => <li key={i} className="font-mono break-all">{l}</li>)}
                    </ul>
                  </dd>
                </div>
              ) : null}
              {curRun.rating ? (
                <div className="py-1 border-b border-gray-800/50">
                  <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Rating</dt>
                  <dd className="mt-0.5 text-xs text-amber-300 font-semibold">★ {curRun.rating}/5</dd>
                </div>
              ) : null}
              <Row label="Cost hint">{curRun.cost_hint}</Row>
              <Row label="Created">{curRun.created_at}</Row>
              <Row label="External job id">
                {curRun.external_job_id ? <span className="font-mono break-all">{curRun.external_job_id}</span> : ''}
              </Row>
            </dl>
          </aside>
        </div>
      </div>
    </div>
  );
}
