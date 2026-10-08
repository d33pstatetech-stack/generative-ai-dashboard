import { useState } from 'react';
import AddLoraUrl from './AddLoraUrl';

// Centralized LoRA library: add-from-URL + full custom list (Aznten / Misc / NSFW).
// Same name-pattern rule as the generator apps: aznten / asian-ten / d33pstate
// variants are yours regardless of source; the rest (non-NSFW) is Misc.
// Props: loras, central (fail-soft null), onAdd(entry), onDelete(id, name),
// onRename(id, name), notify.
const AZNTEN_RE = /aznten|asian[- ]ten|d33pstate/i;
const NAME_MAX = 200;

// Central rows carry group_name (aznten|misc|nsfw); fall back to the same
// AZNTEN_RE rule when group_name is absent (older seeds / unexpected values).
function centralGroup(l) {
  const g = String(l.group_name || '').toLowerCase();
  if (g === 'aznten' || g === 'misc' || g === 'nsfw') return g;
  if (l.nsfw) return 'nsfw';
  return AZNTEN_RE.test(`${l.name || ''} ${l.id || ''}`) ? 'aznten' : 'misc';
}

export default function CustomLoraLibrary({ loras, central, onAdd, onDelete, onRename, notify }) {
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');

  const list = Array.isArray(loras) ? loras : [];
  const sfw = list.filter((l) => !l.nsfw);
  const aznten = sfw.filter((l) => AZNTEN_RE.test(`${l.name || ''} ${l.id || ''}`));
  const misc = sfw.filter((l) => !AZNTEN_RE.test(`${l.name || ''} ${l.id || ''}`));
  const nsfw = list.filter((l) => !!l.nsfw);

  const centralList = Array.isArray(central) ? central : [];
  const hasCentral = centralList.length > 0;
  const cAz = centralList.filter((l) => centralGroup(l) === 'aznten');
  const cMisc = centralList.filter((l) => centralGroup(l) === 'misc');
  const cNsfw = centralList.filter((l) => centralGroup(l) === 'nsfw');

  const copyUrl = async (url) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      notify && notify('file_url copied — paste into an app ad-hoc box', 'success');
    } catch {
      // Non-secure-context fallback.
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        notify && notify('file_url copied — paste into an app ad-hoc box', 'success');
      } catch {
        notify && notify('Copy failed — select the URL manually', 'error');
      }
    }
  };

  const centralCard = (l) => {
    const triggers = Array.isArray(l.triggers) ? l.triggers : [];
    return (
      <div key={`central:${l.id}`} className="p-2 rounded-lg bg-gray-800/50 border border-gray-700">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-gray-200 truncate" title={l.name}>
              {l.name}{' '}
              <span className="ml-1 align-middle text-[9px] font-bold uppercase tracking-wider px-1.5 py-px rounded bg-sky-900/60 text-sky-300 border border-sky-700/60" title="Central library entry (read-only)">
                central
              </span>
            </div>
            <div className="text-[10px] text-gray-500 truncate" title={`${l.repo_url || ''} · ${l.file || ''}`}>
              {l.source} · {l.repo} · {l.file}
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">
              base: <span className="text-gray-300">{l.base_model || 'unknown'}</span>
              {' · '}{triggers.length ? `triggers: ${triggers.join(', ')}` : 'no triggers found'}
            </div>
            {l.note && <div className="text-[10px] text-gray-500 mt-0.5" title={l.note}>{l.note}</div>}
          </div>
          {l.file_url && (
            <button type="button" onClick={() => copyUrl(l.file_url)}
              title={l.file_url} className="text-[10px] text-sky-300 hover:text-sky-100 underline flex-none">
              Copy-URL
            </button>
          )}
        </div>
      </div>
    );
  };

  const startRename = (l) => {
    setEditId(l.customId);
    setEditName(l.name || '');
  };

  const cancelRename = () => {
    setEditId(null);
    setEditName('');
  };

  const saveRename = async (l) => {
    const name = editName.trim();
    if (!name) {
      notify && notify('Name cannot be empty', 'error');
      return;
    }
    if (name.length > NAME_MAX) {
      notify && notify(`Name must be ${NAME_MAX} characters or fewer`, 'error');
      return;
    }
    if (name === (l.name || '')) {
      cancelRename();
      return;
    }
    if (!onRename) {
      notify && notify('Rename unavailable', 'error');
      return;
    }
    // onRename owns the error reporting (it toasts on failure), so this only
    // has to leave edit mode either way.
    await onRename(l.customId, name);
    cancelRename();
  };

  const card = (l) => {
    const editing = editId === l.customId;
    return (
      <div key={l.id} className="p-2 rounded-lg bg-gray-800/50 border border-gray-700">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="flex items-center gap-1">
                <input
                  value={editName}
                  autoFocus
                  maxLength={NAME_MAX}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveRename(l);
                    if (e.key === 'Escape') cancelRename();
                  }}
                  className="min-w-0 flex-1 bg-gray-900 border border-sky-700 rounded px-1 py-px text-xs text-gray-100"
                  aria-label="LoRA name"
                />
                <button type="button" onClick={() => saveRename(l)}
                  className="text-[10px] text-sky-300 hover:text-sky-100 underline flex-none">Save</button>
                <button type="button" onClick={cancelRename}
                  className="text-[10px] text-gray-500 hover:text-gray-300 underline flex-none">Cancel</button>
              </div>
            ) : (
              <div className="text-xs font-semibold text-gray-200 truncate" title={l.name}>{l.name}</div>
            )}
            <div className="text-[10px] text-gray-500 truncate" title={`${l.repo_url || ''} · ${l.file || ''}`}>
              {l.source} · {l.repo} · {l.file}
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">
              base: <span className="text-gray-300">{l.base_model || 'unknown'}</span>
              {' · '}{(l.triggers || []).length ? `triggers: ${(l.triggers || []).join(', ')}` : 'no triggers found'}
            </div>
            {l.note && <div className="text-[10px] text-gray-500 mt-0.5" title={l.note}>{l.note}</div>}
          </div>
          <div className="flex flex-col items-end gap-0.5 flex-none">
            {!editing && (
              <button type="button" onClick={() => startRename(l)}
                title="Rename this custom LoRA" className="text-[10px] text-gray-500 hover:text-sky-300 underline">
                Rename
              </button>
            )}
            {!editing && (
              <button type="button" onClick={() => onDelete && onDelete(l.customId, l.name)}
                title="Remove this custom LoRA" className="text-[10px] text-gray-500 hover:text-red-400 underline">
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {hasCentral && (
        <p className="text-[11px] text-gray-400 px-1">
          Library: {centralList.length} central + {list.length} custom
        </p>
      )}
      {hasCentral && (
        <div className="space-y-2">
          {cAz.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-fuchsia-300 px-1">Central · Aznten ({cAz.length})</div>
              {cAz.map(centralCard)}
            </div>
          )}
          {cMisc.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-gray-300 px-1">Central · Misc ({cMisc.length})</div>
              {cMisc.map(centralCard)}
            </div>
          )}
          {cNsfw.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-red-300 px-1">Central · NSFW ({cNsfw.length}) — 18+ only</div>
              {cNsfw.map(centralCard)}
            </div>
          )}
        </div>
      )}
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
