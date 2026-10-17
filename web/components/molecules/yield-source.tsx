import { YIELD_SOURCES } from "@/lib/yield-sources";
import { IconArrowUpRight } from "@/components/atoms/icon-arrow-right";

/**
 * Renders the "Yield source" card on /asset/[symbol] pages for
 * `class === "stable_yield"` assets. Tells users WHERE the asset's
 * yield comes from + the KEY RISKS Pegana would alert on.
 *
 * Returns null (renders nothing) if the symbol isn't in the YIELD_SOURCES
 * map — that's the safe behaviour for an asset that doesn't have a
 * documented mechanism (e.g. sHYUSD, which has its own Hylo surface).
 */
export function YieldSource({ symbol }: { symbol: string }) {
  const meta = YIELD_SOURCES[symbol];
  if (!meta) return null;

  return (
    <div>
      <h2 className="text-[28px] font-medium leading-[1.1] tracking-[-0.01em] text-text">
        Yield source
      </h2>
      <p className="mb-4 mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-caption">
        Where the yield comes from, and the key risks Pegana watches for
      </p>

      <section className="rounded-[16px] border border-hairline bg-surface-1/50 p-4 sm:p-5">
        <div className="grid gap-6 md:grid-cols-[1fr_2fr] md:items-start">
          <div>
            <div className="text-[18px] font-medium leading-tight tracking-tight">
              {meta.mechanism}
            </div>
            <a
              href={meta.link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted underline-offset-4 transition-colors hover:text-text hover:underline"
            >
              Issuer docs <IconArrowUpRight size={10} />
            </a>
          </div>
          <div className="space-y-3 text-[13px] leading-relaxed text-text">
            <p>{meta.description}</p>
            <p className="text-text-muted">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em]">
                Key risks ·{" "}
              </span>
              {meta.risks}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
