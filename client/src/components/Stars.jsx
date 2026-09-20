// 1–5 star rating control (44px-friendly: each star is a real button).
export default function Stars({ value = 0, runId, onRate, disabled }) {
  return (
    <span className="inline-flex items-center gap-1" role="group" aria-label={`Rate run ${runId}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          disabled={disabled}
          title={`Rate ${i}`}
          aria-label={`Rate ${i} stars`}
          onClick={() => onRate && onRate(runId, i)}
          className={`min-w-[44px] min-h-[44px] text-xl leading-none ${i <= (value || 0) ? 'text-amber-400' : 'text-zinc-600 hover:text-amber-300'}`}
        >
          ★
        </button>
      ))}
    </span>
  );
}
