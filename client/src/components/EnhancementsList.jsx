// Enhancements list: raw → enhanced prompt pairs from /api/history/enhancements.
export default function EnhancementsList({ items }) {
  if (!items.length) return <p className="text-xs text-gray-600 py-8 text-center">No enhancements yet.</p>;
  return (
    <div className="space-y-3">
      {items.map((e) => (
        <article key={e.id} className="panel !p-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
            <span className="badge">{e.kind}</span>
            <span className="truncate">{e.target_provider || ''}{e.target_model ? ` · ${e.target_model}` : ''}</span>
            <span className="ml-auto flex-none">{e.created_at || ''}</span>
          </div>
          <p className="mt-2 text-xs text-gray-400 whitespace-pre-wrap break-words line-clamp-3">
            <span className="text-gray-600 font-semibold">RAW: </span>{e.raw_prompt}
          </p>
          <p className="mt-1 text-xs text-gray-200 whitespace-pre-wrap break-words line-clamp-6">
            <span className="text-violet-400 font-semibold">ENHANCED: </span>{e.enhanced_prompt}
          </p>
          {(e.llm_provider || e.llm_model) && (
            <p className="mt-1 text-[11px] text-gray-600">
              via {e.llm_provider || ''} {e.llm_model || ''}{e.template_version ? ` · ${e.template_version}` : ''}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
