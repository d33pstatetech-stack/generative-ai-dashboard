import AddLoraUrl from './AddLoraUrl';

// Centralized LoRA library: add-from-URL + full custom list (Aznten / Misc / NSFW).
// Same name-pattern rule as the generator apps: aznten / asian-ten / d33pstate
// variants are yours regardless of source; the rest (non-NSFW) is Misc.
// Props: loras, onAdd(entry), onDelete(id, name), notify.
const AZNTEN_RE = /aznten|asian[- ]ten|d33pstate/i;
export default function CustomLoraLibrary({ loras, onAdd, onDelete, notify }) {
  const list = Array.isArray(loras) ? loras : [];
  const sfw = list.filter((l) => !l.nsfw);
  const aznten = sfw.filter((l) => AZNTEN_RE.test(`${l.name || ''} ${l.id || ''}`));
  const misc = sfw.filter((l) => !AZNTEN_RE.test(`${l.name || ''} ${l.id || ''}`));
  const nsfw = list.filter((l) => !!l.nsfw);

  const card = (l) => (
    <div key={l.id} className="p-2 rounded-lg bg-gray-800/50 border border-gray-700">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-gray-200 truncate" title={l.name}>{l.name}</div>
          <div className="text-[10px] text-gray-500 truncate" title={`${l.repo_url || ''} · ${l.file || ''}`}>
            {l.source} · {l.repo} · {l.file}
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">
            base: <span className="text-gray-300">{l.base_model || 'unknown'}</span>
            {' · '}{(l.triggers || []).length ? `triggers: ${(l.triggers || []).join(', ')}` : 'no triggers found'}
          </div>
          {l.note && <div className="text-[10px] text-gray-500 mt-0.5" title={l.note}>{l.note}</div>}
        </div>
        <button type="button" onClick={() => onDelete && onDelete(l.customId, l.name)}
          title="Remove this custom LoRA" className="text-[10px] text-gray-500 hover:text-red-400 underline flex-none">
          Remove
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      <AddLoraUrl onAdd={onAdd} notify={notify} />
      {list.length === 0 && (
        <p className="text-[11px] text-gray-600">No custom LoRAs yet — paste a HuggingFace or CivitAI model-card URL above.</p>
      )}
      {aznten.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-bold text-fuchsia-300 px-1">Aznten ({aznten.length}) — my custom trained</div>
          {aznten.map(card)}
        </div>
      )}
      {misc.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-bold text-gray-300 px-1">Misc ({misc.length})</div>
          {misc.map(card)}
        </div>
      )}
      {nsfw.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-bold text-red-300 px-1">NSFW ({nsfw.length}) — 18+ only</div>
          {nsfw.map(card)}
        </div>
      )}
    </div>
  );
}
