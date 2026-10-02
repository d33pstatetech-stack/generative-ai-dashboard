// Media viewer modal: main pane (image or video) + sidebar with run details.
// Props: { media: { url, video }, run, onClose }. Every sidebar field is
// optional — absent fields render nothing (no crash on missing data).
import { useEffect } from 'react';

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

export default function MediaViewer({ media, run = {}, onClose }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape' && onClose) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  if (!media) return null;
  const prompt = textOf(run);
  const loras = lorasOf(run);
  const ok = run.status === 'succeeded' || run.status === 'completed';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
      onClick={() => onClose && onClose()} role="dialog" aria-modal="true" aria-label="Media viewer">
      <div className="panel w-full max-w-5xl max-h-[90vh] overflow-y-auto !p-3 md:!p-4 grid gap-3 md:grid-cols-[2fr_1fr]"
        onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0">
          {media.video ? (
            <video src={media.url} controls preload="metadata" className="w-full max-h-[70vh] rounded-lg bg-black" />
          ) : (
            <img src={media.url} alt="" className="w-full max-h-[70vh] object-contain rounded-lg bg-black" />
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <a href={media.url} target="_blank" rel="noreferrer" className="btn-secondary !min-h-[36px] text-xs">
              Open original <i className="fas fa-arrow-up-right-from-square text-[10px] ml-1"></i>
            </a>
            <a href={media.url} download className="btn-secondary !min-h-[36px] text-xs">
              <i className="fas fa-download text-[10px] mr-1"></i>Download
            </a>
            <button type="button" onClick={() => onClose && onClose()} className="btn-secondary !min-h-[36px] text-xs ml-auto">
              Close
            </button>
          </div>
        </div>
        <aside className="min-w-0">
          <h3 className="panel-title !mb-1">Run details</h3>
          <dl>
            {prompt ? (
              <div className="py-1 border-b border-gray-800/50">
                <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Prompt</dt>
                <dd className="mt-0.5 text-xs text-gray-200 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{prompt}</dd>
              </div>
            ) : null}
            <Row label="Model">{run.model}</Row>
            <Row label="Provider">{run.provider}</Row>
            <Row label="Source app">{run.source_app}</Row>
            {run.status ? (
              <div className="py-1 border-b border-gray-800/50">
                <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Status</dt>
                <dd className="mt-0.5">
                  <span className={`badge ${ok ? 'live' : run.status === 'failed' ? 'error' : ''}`}>{run.status}</span>
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
            {run.rating ? (
              <div className="py-1 border-b border-gray-800/50">
                <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Rating</dt>
                <dd className="mt-0.5 text-xs text-amber-300 font-semibold">★ {run.rating}/5</dd>
              </div>
            ) : null}
            <Row label="Cost hint">{run.cost_hint}</Row>
            <Row label="Created">{run.created_at}</Row>
            <Row label="External job id">
              {run.external_job_id ? <span className="font-mono break-all">{run.external_job_id}</span> : ''}
            </Row>
          </dl>
        </aside>
      </div>
    </div>
  );
}
