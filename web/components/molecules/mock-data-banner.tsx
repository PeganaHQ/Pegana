/**
 * Top-of-page banner that admits the landing is rendering against the
 * hardcoded MOCKED assets instead of live API data. Shown only when
 * useStats/useAssets both come back undefined (API unreachable). Keeps
 * the visual language understated — this is honesty signal, not an
 * error toast.
 */
interface Props {
  show: boolean;
  /** Optional retry handler — typically `mutate()` from the SWR hooks. */
  onRetry?: () => void;
}

export function MockDataBanner({ show, onRetry }: Props) {
  if (!show) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-st-drift/40 bg-st-drift/[0.08] px-5 sm:px-8 lg:px-12 xl:px-20 py-2.5"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-st-drift">
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-st-drift" />{" "}
        Showing sample data. Live API unreachable. Numbers below are
        illustrative, not current.
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="font-mono text-[11px] uppercase tracking-[0.08em] text-st-drift underline decoration-st-drift/40 underline-offset-4 transition-colors hover:text-text hover:decoration-text"
        >
          Retry now
        </button>
      )}
    </div>
  );
}
