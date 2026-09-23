import { useCallback, useEffect, useState } from 'react';
import { deleteCustomLora, fetchBalances, fetchCustomLoras, fetchEnhancements, fetchHealth, fetchLinks, fetchRuns, fetchStats, rateRun, saveCustomLora } from './api';
import CustomLoraLibrary from './components/CustomLoraLibrary';
import Headshots from './components/Headshots';
import MaskPainter from './components/MaskPainter';
import StorageBrowser from './components/StorageBrowser';
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
  const [enhProviders, setEnhProviders] = useState([]);
  const [enhMedia, setEnhMedia] = useState('all');
  const [balances, setBalances] = useState(null);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balancesNote, setBalancesNote] = useState('');
  const [customLoras, setCustomLoras] = useState([]);

  const loadCustomLoras = useCallback(async () => {
    try {
      setCustomLoras(await fetchCustomLoras());
    } catch (e) {
      toast(`Custom LoRAs failed: ${e.message}`, 'error');
    }
  }, [toast]);

  const handleAddCustom = useCallback(async (entry) => {
    const r = await saveCustomLora(entry);
    await loadCustomLoras();
    toast(r.deduplicated ? 'Already in library' : `Added ${entry.name}`, r.deduplicated ? 'info' : 'success');
    return r;
  }, [toast, loadCustomLoras]);

  const handleDeleteCustom = useCallback(async (id, name) => {
    if (!window.confirm(`Remove custom LoRA "${name || id}"?`)) return;
    try {
      await deleteCustomLora(id);
      await loadCustomLoras();
      toast('Custom LoRA removed', 'success');
    } catch (e) {
      toast(`Remove failed: ${e.message}`, 'error');
    }
  }, [toast, loadCustomLoras]);

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
      setEnhancements(await fetchEnhancements({ model_like: enhModel.trim(), limit: 200 }));
    } catch (e) {
      toast(`Enhancements failed: ${e.message}`, 'error');
    } finally {
      setEnhLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  const loadBalances = useCallback(async (refresh = false) => {
    setBalancesLoading(true);
    try {
      setBalances(await fetchBalances(refresh));
      setBalancesNote('');
    } catch (e) {
      setBalancesNote(e.message);
    } finally {
      setBalancesLoading(false);
    }
  }, []);

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
      loadBalances(false);
      loadCustomLoras();
      try {
        setEnhancements(await fetchEnhancements({ limit: 200 }));
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

  const mediaOf = (m) => (/video|wan|h3|hailuo|kling|ltx|seedance|pixverse|vidu|sora|veo|avatar|lipsync|heygen|animate|moond|hunyuan/i.test(m || '') ? 'video' : 'image');
  const enhProvAvail = [...new Set(enhancements.map((e) => e.target_provider || e.source_app).filter(Boolean))].sort();
  const shownEnh = enhancements.filter((e) => {
    const p = e.target_provider || e.source_app || '';
    if (enhProviders.length && !enhProviders.includes(p)) return false;
    if (enhMedia !== 'all' && mediaOf(e.target_model) !== enhMedia) return false;
    return true;
  });
  const toggleProv = (p) => setEnhProviders((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));

  const TOOLS = [
    ['sec-stats', 'Stats', 'fa-gauge-high'],
    ['sec-enh', 'Enhancements', 'fa-wand-magic-sparkles'],
    ['sec-loras', 'LoRAs', 'fa-layer-group'],
    ['sec-headshots', 'Headshots', 'fa-scissors'],
    ['sec-mask', 'Mask', 'fa-paintbrush'],
    ['sec-files', 'Files', 'fa-folder-open'],
    ['sec-billing', 'Billing', 'fa-credit-card'],
    ['sec-runs', 'Runs', 'fa-clock-rotate-left'],
  ];
  const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const apps = links.filter((l) => l.kind === 'app');
  // Billing page owns billing links; RunPod entries retired.
  const billingLinks = links.filter((l) => l.kind === 'billing' && !l.id.startsWith('runpod'));
  const fallbackApps = [
    { id: 'muapi', title: 'MuAPI', url: 'https://muapi-prompt-generator.d33pstatetech.workers.dev' },
    { id: 'replicate', title: 'Replicate', url: 'https://replicate-prompt-orchestrator.d33pstatetech.workers.dev' },
    { id: 'wavespeed', title: 'WaveSpeed', url: 'https://wavespeed-prompt-generator.d33pstatetech.workers.dev' },
  ];
  const headerApps = apps.length ? apps : fallbackApps;
  const money = (v) => (v == null || !isFinite(Number(v)) ? '—' : `$${Number(v).toFixed(2)}`);
  const strip = [
    { id: 'muapi', label: 'MuAPI', value: money(balances?.muapi?.balance), sub: balances?.muapi?.source || balances?.muapi?.error || '' },
    { id: 'wavespeed', label: 'WaveSpeed', value: money(balances?.wavespeed?.balance), sub: balances?.wavespeed?.source || balances?.wavespeed?.error || '' },
    { id: 'runpod', label: 'RunPod 30d', value: money(balances?.runpod?.spend30d), sub: balances?.runpod?.source || balances?.runpod?.error || '' },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 sticky top-0 z-30 bg-gray-950/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <a href="/" className="flex items-center gap-3 min-w-0" title="Back to dashboard home">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-none">
              <i className="fas fa-chart-simple text-white text-sm"></i>
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold gradient-text truncate">Generative AI Dashboard</h1>
              <p className="text-[11px] text-gray-500 truncate">
                {health ? `worker ok · ${health.version || '?'} · db:${health.bindings?.db ? 'yes' : 'no'} r2:${health.bindings?.r2 ? 'yes' : 'no'}` : 'stats · history · links hub'}
              </p>
            </div>
          </a>
          <span className={`ml-auto w-2 h-2 rounded-full flex-none ${health ? 'bg-emerald-500' : 'bg-gray-600'}`} title={health ? 'Connected' : 'Unknown'}></span>
        </div>
        <div className="max-w-6xl mx-auto px-4 pb-2 flex gap-2 overflow-x-auto">
          {headerApps.map((l) => (
            <a key={l.id} href={l.url} target="_blank" rel="noreferrer"
              className="flex-none text-xs font-semibold px-3 min-h-[44px] inline-flex items-center rounded-lg bg-violet-600 hover:bg-violet-500 text-white">
              {l.title} <i className="fas fa-arrow-up-right-from-square text-[10px] ml-1"></i>
            </a>
          ))}
          {linksNote && <span className="flex-none self-center text-[11px] text-gray-600">{linksNote}</span>}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 pt-2 flex gap-1.5 overflow-x-auto" role="navigation" aria-label="Tools">
        {TOOLS.map(([id, label, icon]) => (
          <button key={id} type="button" onClick={() => jump(id)}
            className="flex-none text-[11px] px-2.5 min-h-[44px] inline-flex items-center gap-1.5 rounded-lg border border-gray-700 text-gray-300 hover:border-violet-500 hover:text-white">
            <i className={`fas ${icon} text-[10px] text-violet-300`}></i>{label}
          </button>
        ))}
      </div>

      <div className="max-w-6xl mx-auto px-4 pt-3">
        <div className="panel !p-2 flex items-stretch gap-2">
          {strip.map((s) => (
            <div key={s.id} className="flex-1 min-w-0 text-center" title={s.sub}>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold truncate">{s.label}</div>
              <div className="font-mono text-sm text-emerald-300 truncate">{balancesLoading ? '…' : s.value}</div>
            </div>
          ))}
          <button type="button" onClick={() => loadBalances(true)} disabled={balancesLoading}
            className="btn-secondary !min-h-[44px] flex-none" aria-label="Refresh balances" title={balancesNote || 'Refresh balances live'}>
            <i className={`fas fa-rotate text-xs ${balancesLoading ? 'fa-spin' : ''}`}></i>
          </button>
        </div>
        {balancesNote && <p className="mt-1 text-[11px] text-gray-600">{balancesNote}</p>}
      </div>

      <main className="max-w-6xl mx-auto px-4 py-4 space-y-4">
        <Section id="sec-stats" icon="fa-gauge-high" title="Stats overview" defaultOpen={true}
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

        <Section id="sec-enh" icon="fa-wand-magic-sparkles" title="Enhancements" defaultOpen={false} summary={`${shownEnh.length}/${enhancements.length} shown`}>
          <div className="flex gap-2 mb-2">
            <input className="input flex-1" value={enhModel} onChange={(e) => setEnhModel(e.target.value)} placeholder="target model contains…" aria-label="Enhancement model filter" />
            <button type="button" onClick={loadEnhancements} disabled={enhLoading} className="btn-primary-sm flex-none">
              {enhLoading ? '…' : 'Search'}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-1" role="group" aria-label="Provider filter">
            {enhProvAvail.map((p) => (
              <button key={p} type="button" onClick={() => toggleProv(p)} aria-pressed={enhProviders.includes(p)}
                className={`text-[11px] px-2.5 min-h-[44px] rounded-full border ${enhProviders.includes(p) ? 'bg-violet-600 border-violet-500 text-white' : 'border-gray-700 text-gray-400'}`}>
                {p}
              </button>
            ))}
            {!!enhProviders.length && (
              <button type="button" onClick={() => setEnhProviders([])} className="text-[11px] px-2 min-h-[44px] text-gray-500 underline">
                clear
              </button>
            )}
          </div>
          <div className="flex gap-1.5 mb-3" role="group" aria-label="Media type filter">
            {['all', 'image', 'video'].map((m) => (
              <button key={m} type="button" onClick={() => setEnhMedia(m)} aria-pressed={enhMedia === m}
                className={`text-[11px] px-3 min-h-[44px] rounded-full border capitalize ${enhMedia === m ? 'bg-violet-600 border-violet-500 text-white' : 'border-gray-700 text-gray-400'}`}>
                {m === 'all' ? 'image + video' : m}
              </button>
            ))}
          </div>
          {enhLoading
            ? <p className="text-xs text-gray-500">Loading…</p>
            : <EnhancementsList items={shownEnh} />}
        </Section>

        <Section id="sec-loras" icon="fa-layer-group" title="LoRA library" defaultOpen={false} summary={customLoras.length ? `${customLoras.length} custom` : 'add from URL'}>
          <p className="text-[11px] text-gray-500 mb-2">Centralized LoRA management — add from HuggingFace/CivitAI URLs once, use from every generator app. Custom entries appear in each app's pickers under a Custom group.</p>
          <CustomLoraLibrary loras={customLoras} onAdd={handleAddCustom} onDelete={handleDeleteCustom} notify={toast} />
        </Section>

        <Section id="sec-headshots" icon="fa-scissors" title="Headshot splitter" defaultOpen={false} summary="3×3 · 3×2 → headshots/">
          <p className="text-[11px] text-gray-500 mb-2">Split character reference sheets into tiles. Source is archived to <span className="font-mono">headshots/sources/</span>, tiles land in <span className="font-mono">headshots/&lt;prefix&gt;_N.jpg</span> — same layout as <span className="font-mono">magick in.jpg -crop 3x3@ +repage +adjoin</span>.</p>
          <Headshots notify={toast} />
        </Section>

        <Section id="sec-mask" icon="fa-paintbrush" title="Inpaint mask painter" defaultOpen={false} summary="paint → masks/">
          <p className="text-[11px] text-gray-500 mb-2">Paint the area to inpaint (red). Export is a full-resolution B/W mask: black = remove, white = keep. Save straight to <span className="font-mono">masks/</span> in R2.</p>
          <MaskPainter notify={toast} />
        </Section>

        <Section id="sec-files" icon="fa-folder-open" title="File browser" defaultOpen={false} summary="browse · upload · delete">
          <p className="text-[11px] text-gray-500 mb-2">Browse every folder in R2 — not just run outputs. Upload from your PC into the current folder, tick multiple files and delete them together.</p>
          <StorageBrowser notify={toast} />
        </Section>

        <Section id="sec-billing" icon="fa-credit-card" title="Billing" defaultOpen={false}
          summary={billingLinks.length ? `${billingLinks.length} links` : undefined}>
          {billingLinks.length ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {billingLinks.map((l) => (
                <a key={l.id} href={l.url} target="_blank" rel="noreferrer"
                  className="panel !p-4 block hover:border-violet-600 min-h-[44px]">
                  <div className="text-sm font-semibold text-gray-100">{l.title}</div>
                  {l.desc && <p className="mt-1 text-xs text-gray-500">{l.desc}</p>}
                  <div className="mt-2 text-xs text-violet-300">Open billing <i className="fas fa-arrow-up-right-from-square text-[10px]"></i></div>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-600">No billing links available{linksNote ? ` (${linksNote})` : ''}.</p>
          )}
        </Section>

        <Section id="sec-runs" icon="fa-clock-rotate-left" title="Runs history" defaultOpen={true} summary={`${runs.length} shown`}>
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
