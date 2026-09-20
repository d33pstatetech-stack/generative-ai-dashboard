// Single stat card for the overview grid.
export default function StatCard({ icon, label, value, sub }) {
  return (
    <div className="panel !p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
        {icon && <i className={`fas ${icon} text-violet-400`}></i>}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-bold font-mono truncate">{value ?? '—'}</div>
      {sub && <div className="mt-0.5 text-[11px] text-gray-500 truncate">{sub}</div>}
    </div>
  );
}
