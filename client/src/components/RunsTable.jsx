import Stars from './Stars';

function promptOf(run) {
  try {
    const j = JSON.parse(run.input_preview || run.input_json || '{}');
    if (typeof j === 'string') return j;
    return j.prompt || j.input || j.text || run.input_preview || '';
  } catch {
    return run.input_preview || '';
  }
}

function firstOutput(run) {
  try {
    const urls = JSON.parse(run.output_urls_json || '[]');
    if (Array.isArray(urls) && urls.length) return urls[0];
  } catch { /* ignore */ }
  return null;
}

const isVideo = (u) => /\.(mp4|webm|mov)(\?|$)/i.test(u || '');

// Mirror the pre-rework dashboard: prefer the archived R2 copy (provider CDN
// links expire), fall back to the provider output URL.
function resolveMedia(run) {
  try {
    const keys = JSON.parse(run.r2_keys_json || '[]');
    if (Array.isArray(keys) && keys.length) {
      const key = String(keys[0]);
      return {
        url: `/api/storage/download?key=${encodeURIComponent(key)}`,
        video: /\.(mp4|webm|mov)$/i.test(key.split('?')[0]),
      };
    }
  } catch { /* fall through to CDN */ }
  const out = firstOutput(run);
  if (out) return { url: out, video: isVideo(out) };
  return null;
}

// Mobile-first runs history: stacked cards on small screens, table on md+.
export default function RunsTable({ runs, onRate, ratingBusyId }) {
  if (!runs.length) return <p className="text-xs text-gray-600 py-8 text-center">No runs match these filters.</p>;
  return (
    <div className="space-y-3">
      {runs.map((r) => {
        const media = resolveMedia(r);
        const ok = r.status === 'succeeded' || r.status === 'completed';
        return (
          <article key={r.id} className="panel !p-3">
            {media ? (
              media.video ? (
                <video src={media.url} controls preload="metadata" className="w-full max-h-64 rounded-lg bg-black" />
              ) : (
                <a href={media.url} target="_blank" rel="noreferrer">
                  <img src={media.url} alt="" loading="lazy" className="w-full max-h-64 object-contain rounded-lg bg-black" />
                </a>
              )
            ) : (
              <p className="text-xs text-gray-600">No media saved.</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold break-all">{r.model}</span>
              <span className={`badge ${ok ? 'live' : r.status === 'failed' ? 'error' : ''}`}>{r.status || '—'}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-gray-500">
              {r.provider} · {r.source_app || '—'} · {r.created_at || ''}
              {r.enhancement_id ? ` · enh#${r.enhancement_id}` : ''}
            </p>
            <p className="mt-1 text-xs text-gray-300 whitespace-pre-wrap break-words line-clamp-4">
              {String(promptOf(r)).slice(0, 500)}
            </p>
            <div className="mt-1 flex items-center gap-1">
              <Stars value={r.rating} runId={r.id} onRate={onRate} disabled={ratingBusyId === r.id} />
              {ratingBusyId === r.id && <span className="spinner !border-gray-600 ml-1"></span>}
            </div>
          </article>
        );
      })}
    </div>
  );
}
