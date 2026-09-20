import { useCallback, useEffect, useState } from 'react';
import { fetchEnhancements, fetchHealth, fetchLinks, fetchRuns, fetchStats, rateRun } from './api';
import EnhancementsList from './components/EnhancementsList';
import RunsTable from './components/RunsTable';
import Section from './components/Section';
import StatCard from './components/StatCard';
import Tip from './components/Tip';

function useToast() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, kind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return { toasts, push };
}

const DEFAULT_FILTERS = { provider: '', model_like: '', status: '', min_rating: '', order: 'newest' };

export default function App() {
  const { toasts, push: toast } = useToast();
  const [health, setHealth] = useState(null);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [ratingBusyId, setRatingBusyId] = useState(null);
  const [enhancements, setEnhancements] = useState([]);
  const [enhLoading, setEnhLoading] = useState(false);
  const [enhModel, setEnhModel] = useState('');
  const [links, setLinks] = useState([]);
  const [linksNote, setLinksNote] = useState('');

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      setStats(await fetchStats());
    } catch (e) {
      toast(`Stats failed: ${e.message}`, 'error');
    } finally {
      setStatsLoading(false);
    }
  }, [toast]);

  const loadRuns = useCallback(async (f = filters) => {
    setRunsLoading(true);
    try {
      const unrated = f.min_rating === 'unrated';
      setRuns(await fetchRuns({ ...f, min_rating: unrated ? '' : f.min_rating, unrated }));
    } catch (e) {
      toast(`Runs failed: ${e.message}`, 'error');
    } finally {
      setRunsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  const loadEnhancements = useCallback(async () => {
    setEnhLoading(true);
    try {
      setEnhancements(await fetchEnhancements({ model_like: enhModel.trim() }));
    } catch (e) {
      toast(`Enhancements failed: ${e.message}`, 'error');
    } finally {
      setEnhLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  useEffect(() => {
    (async () => {
      try {
        setHealth(await fetchHealth());
      } catch { /* worker may require Access; sections surface their own errors */ }
      try {
        setLinks(await fetchLinks());
      } catch (e) {
        setLinksNote(e.message);
      }
      loadStats();
      loadRuns(DEFAULT_FILTERS);
      try {
        setEnhancements(await fetchEnhancements({}));
      } catch { /* surfaced on manual refresh */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRate = useCallback(async (id, rating) => {
    setRatingBusyId(id);
    try {
      await rateRun({ id, rating });
      setRuns((rs) => rs.map((r) => (r.id === id ? { ...r, rating } : r)));
      toast(`Rated #${id} → ${rating}★`, 'success');
      loadStats();
    } catch (e) {
      toast(`Rate failed: ${e.message}`, 'error');
    } finally {
      setRatingBusyId(null);
    }
  }, [toast, loadStats]);

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const apps = links.filter((l) => l.kind === 'app');
  const billingLinks = links.filter((l) => l.kind === 'billing' || l.kind === 'data');

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 sticky top-0 z-30 bg-gray-950/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-none">
            <i className="fas fa-chart-simple text-white text-sm"></i>
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold gradient-text truncate">Generative AI Dashboard</h1>
            <p className="text-[11px] text-gray-500 truncate">
              {health ? `worker ok · ${health.version || '?'} · db:${health.bindings?.db ? 'yes' : 'no'} r2:${health.bindings?.r2 ? 'yes' : 'no'}` : 'stats · history · links hub'}
            </p>
          </div>
          <span className={`ml-auto w-2 h-2 rounded-full flex-none ${health ? 'bg-emerald-500' : 'bg-gray-600'}`} title={health ? 'Connected' : 'Unknown'}></span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-4 space-y-4">
        <Section icon="fa-gauge-high" title="Stats overview" defaultOpen={true}
          summary={stats ? `${stats.runs} runs` : undefined}
          actions={<button type="button" onClick={loadStats} className="btn-secondary !min-h-[44px]" aria-label="Refresh stats"><i className="fas fa-rotate text-xs"></i></button>}>
          {statsLoading ? (
            <p className="text-xs text-gray-500 flex items-center gap-2"><span className="spinner !border-gray-600"></span>Loading stats…</p>
          ) : stats ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard icon="fa-list-check" label="Total runs" value={stats.runs} />
                <StatCard icon="fa-hard-drive" label="With R2 media" value={stats.with_r2} />
                <StatCard icon="fa-star" label="Rated" value={stats.rated} sub={stats.avg_rating != null ? `avg ${stats.avg_rating}` : 'no ratings yet'} />
                <StatCard icon="fa-wand-magic-sparkles" label="Enhancements" value={stats.enhancements} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                <div className="panel !p-3">
                  <h3 className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-2">By provider</h3>
                  {(stats.by_provider || []).map((r) => (
                    <div key={r.provider} className="flex justify-between text-xs py-1 border-b border-gray-800/50 last:border-0">
                      <span className="text-gray-300">{r.provider}</span>
                      <span className="font-mono text-gray-400">{r.c}</span>
                    </div>
                  ))}
                </div>
                <div className="panel !p-3">
                  <h3 className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-2">Top models</h3>
                  {(stats.by_model || []).slice(0, 8).map((r) => (
                    <div key={r.model} className="flex justify-between gap-2 text-xs py-1 border-b border-gray-800/50 last:border-0">
                      <span className="text-gray-300 truncate">{r.model}</span>
                      <span className="font-mono text-gray-400 flex-none">{r.c}</span>
                    </div>
                  ))}
                </div>
                <div className="panel !p-3">
                  <h3 className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
                    Top rated <Tip text="Models with ≥2 ratings, ordered by average rating." />
                  </h3>
                  {(stats.top_rated_models || []).slice(0, 8).map((r) => (
                    <div key={r.model} className="flex justify-between gap-2 text-xs py-1 border-b border-gray-800/50 last:border-0">
                      <span className="text-gray-300 truncate">{r.model}</span>
                      <span className="font-mono text-amber-300 flex-none">★{Number(r.avg).toFixed(1)} ({r.c})</span>
                    </div>
                  ))}
                  {!(stats.top_rated_models || []).length && <p className="text-[11px] text-gray-600">Rate runs to build this list.</p>}
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-600">Stats unavailable (sign in via Cloudflare Access, then refresh).</p>
          )}
        </Section>

        <Section icon="fa-clock-rotate-left" title="Runs history" defaultOpen={true} summary={`${runs.length} shown`}>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
            <select className="input" value={filters.provider} onChange={set('provider')} aria-label="Provider filter">
              <option value="">all providers</option>
              <option value="muapi">muapi</option>
              <option value="replicate">replicate</option>
              <option value="wavespeed">wavespeed</option>
              <option value="runpod">runpod</option>
              <option value="modal">modal</option>
            </select>
            <input className="input" value={filters.model_like} onChange={set('model_like')} placeholder="model contains…" aria-label="Model filter" />
            <select className="input" value={filters.status} onChange={set('status')} aria-label="Status filter">
              <option value="">any status</option>
              <option value="succeeded">succeeded</option>
              <option value="completed">completed</option>
              <option value="failed">failed</option>
            </select>
            <select className="input" value={filters.min_rating} onChange={set('min_rating')} aria-label="Rating filter">
              <option value="">any rating</option>
              <option value="unrated">unrated only</option>
              <option value="5">★★★★★</option>
              <option value="4">★★★★+</option>
              <option value="3">★★★+</option>
            </select>
            <select className="input" value={filters.order} onChange={set('order')} aria-label="Order">
              <option value="newest">newest</option>
              <option value="top">top rated</option>
            </select>
          </div>
          <div className="flex gap-2 mb-3">
            <button type="button" onClick={() => loadRuns()} disabled={runsLoading} className="btn-primary-sm flex-1">
              {runsLoading ? 'Searching…' : 'Search'}
            </button>
            <button type="button" onClick={() => { setFilters(DEFAULT_FILTERS); loadRuns(DEFAULT_FILTERS); }} className="btn-secondary">
              Reset
            </button>
          </div>
          {runsLoading
            ? <p className="text-xs text-gray-500 flex items-center gap-2"><span className="spinner !border-gray-600"></span>Loading runs…</p>
            : <RunsTable runs={runs} onRate={handleRate} ratingBusyId={ratingBusyId} />}
        </Section>

        <Section icon="fa-wand-magic-sparkles" title="Enhancements" defaultOpen={false} summary={`${enhancements.length} shown`}>
          <div className="flex gap-2 mb-3">
            <input className="input flex-1" value={enhModel} onChange={(e) => setEnhModel(e.target.value)} placeholder="target model contains…" aria-label="Enhancement model filter" />
            <button type="button" onClick={loadEnhancements} disabled={enhLoading} className="btn-primary-sm flex-none">
              {enhLoading ? '…' : 'Search'}
            </button>
          </div>
          {enhLoading
            ? <p className="text-xs text-gray-500">Loading…</p>
            : <EnhancementsList items={enhancements} />}
        </Section>

        <Section icon="fa-arrow-up-right-from-square" title="Generator apps" defaultOpen={true}
          summary={apps.length ? `${apps.length} apps` : undefined}
          actions={linksNote ? <Tip text={linksNote} /> : null}>
          {apps.length ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {apps.map((l) => (
                <a key={l.id} href={l.url} target="_blank" rel="noreferrer"
                  className="panel !p-4 block hover:border-violet-600 min-h-[44px]">
                  <div className="text-sm font-semibold text-gray-100">{l.title}</div>
                  {l.desc && <p className="mt-1 text-xs text-gray-500">{l.desc}</p>}
                  <div className="mt-2 text-xs text-violet-300">Open app <i className="fas fa-arrow-up-right-from-square text-[10px]"></i></div>
                </a>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { id: 'muapi', title: 'MuAPI Prompt Generator', desc: 'Image/video/audio/3D models' },
                { id: 'replicate', title: 'Replicate Prompt Orchestrator', desc: 'Schema-driven Replicate UI + enhancer' },
                { id: 'wavespeed', title: 'WaveSpeed Prompt Generator', desc: 'WaveSpeed catalog, R2 autosave' },
              ].map((a) => (
                <div key={a.id} className="panel !p-4">
                  <div className="text-sm font-semibold text-gray-100">{a.title}</div>
                  <p className="mt-1 text-xs text-gray-500">{a.desc}{linksNote ? ` (${linksNote})` : ''}</p>
                </div>
              ))}
            </div>
          )}
          {!!billingLinks.length && (
            <div className="mt-3 flex flex-wrap gap-2">
              {billingLinks.map((l) => (
                <a key={l.id} href={l.url} target="_blank" rel="noreferrer" className="badge hover:border-violet-500 !py-2 !px-3 min-h-[44px] inline-flex items-center">
                  {l.title}
                </a>
              ))}
            </div>
          )}
        </Section>
      </main>

      <div className="fixed bottom-4 right-4 space-y-2 z-50 max-w-[90vw]">
        {toasts.map((t) => (
          <div key={t.id} className={`text-xs px-3 py-2 rounded-lg border shadow-xl ${t.kind === 'error' ? 'bg-red-950/90 border-red-800 text-red-200' : t.kind === 'success' ? 'bg-emerald-950/90 border-emerald-800 text-emerald-200' : 'bg-gray-900/95 border-gray-700 text-gray-200'}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
