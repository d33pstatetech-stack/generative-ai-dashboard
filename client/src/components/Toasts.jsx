// Tiny toast list (audit design language: emerald accent on dark zinc).
// Props: toasts [{ id, message, kind }]. Pure presentational — state lives in
// App's useToast hook (prop-drilled list). role="status" announces to AT.
export default function Toasts({ toasts }) {
  if (!toasts?.length) return null;
  return (
    <div className="fixed bottom-4 right-4 space-y-2 z-50 max-w-[90vw]" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`text-xs px-3 py-2 rounded-lg border shadow-xl ${t.kind === 'error' ? 'bg-red-950/90 border-red-800 text-red-200' : t.kind === 'success' ? 'bg-emerald-950/90 border-emerald-800 text-emerald-200' : 'bg-gray-900/95 border-gray-700 text-gray-200'}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
