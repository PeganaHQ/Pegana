"use client";

import { useStats } from "@/lib/hooks/use-stats";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";
import { useRevealV2 } from "@/lib/motion/use-reveal-v2";
import { cn } from "@/lib/utils/cn";
import { partnerLogoUrl } from "@/lib/static-assets";
import { LOGO_ITEMS } from "@/components/organisms/v2/shared";

// Bento grid (redesign 2026-08-05): 4 equal cards in a single row on
// desktop, stacked on mobile. The first card (assets tracked, the live
// number) gets an iridescent top accent + slightly larger font; the other
// 3 are architecture facts at a smaller but equal scale. Visual hierarchy
// comes from the accent and font size, not from card dimensions.

interface StatCard {
  value: string;
  label: string;
  accent?: boolean;
}

function StatCardCell({ card, index }: { card: StatCard; index: number }) {
  const { ref, style } = useRevealV2<HTMLDivElement>({ index });
  return (
    <div
      ref={ref}
      style={style}
      className={cn(
        "group relative h-full overflow-hidden rounded-[16px] border p-5 sm:p-6",
        card.accent
          ? "border-[var(--v2-line2)] bg-[rgba(255,255,255,0.015)]"
          : "border-[var(--v2-line)] bg-transparent",
      )}
    >
      {card.accent && (
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-px opacity-50"
          style={{
            background:
              "linear-gradient(90deg, transparent, #ff8a5b 20%, #f7269b 50%, #c02ef2 80%, transparent)",
          }}
        />
      )}
      <div
        className={cn(
          "font-mono font-medium leading-none tracking-[-0.01em] tabular-nums text-[var(--v2-text)]",
          card.accent
            ? "text-[clamp(32px,3.5vw,44px)]"
            : "text-[clamp(26px,3vw,34px)]",
        )}
      >
        {card.value}
      </div>
      <div className="mt-3 text-[12.5px] leading-[1.45] text-[var(--v2-muted)]">
        {card.label}
      </div>
    </div>
  );
}

export function SourcesV2() {
  const { data: stats } = useStats();
  const reduced = useAppReducedMotion();

  const cards: StatCard[] = [
    {
      value: stats?.assets_tracked != null ? String(stats.assets_tracked) : "-",
      label: "assets monitored across stables, LSTs, yield, CDP and synthetic classes",
      accent: true,
    },
    {
      value: String(LOGO_ITEMS.length),
      label: "issuers, venues and oracles featured below",
    },
    { value: "5", label: "peg states, one finite-state machine" },
    {
      value: "1:1",
      label: "byte-exact replay, every receipt since methodology 0.4.0",
    },
  ];

  return (
    <section className="pb-11 pt-14 max-[759px]:pb-[30px] max-[759px]:pt-10">
      <div className="mx-auto max-w-[1180px] px-6 sm:px-10">
        <h2 className="mb-[30px] text-[19px] font-medium leading-[1.5] tracking-[-0.015em] text-[var(--v2-text)] max-[760px]:mb-[22px] sm:text-[22px]">
          Where the numbers come from.
        </h2>

        <div className="mb-9 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 max-[639px]:gap-2.5">
          {cards.map((card, i) => (
            <StatCardCell key={card.label} card={card} index={i} />
          ))}
        </div>

        <div
          className="overflow-hidden pt-[34px] [mask-image:linear-gradient(90deg,transparent_0%,black_8%,black_92%,transparent_100%)] [-webkit-mask-image:linear-gradient(90deg,transparent_0%,black_8%,black_92%,transparent_100%)]"
          aria-hidden
        >
          <div
            className={cn(
              "flex w-max items-center will-change-transform",
              !reduced &&
                "v2-anim-marquee animate-[v2-lmarq_48s_linear_infinite]",
            )}
          >
            {[0, 1].map((loop) =>
              LOGO_ITEMS.map((logo) => (
                <span
                  key={`${loop}-${logo.slug}`}
                  className="flex cursor-default items-center gap-3 px-[34px] opacity-[0.62] transition-opacity duration-300 ease-[var(--v2-ease)] hover:opacity-100"
                >
                  <img
                    src={partnerLogoUrl(logo.slug)}
                    loading="lazy"
                    alt=""
                    aria-hidden
                    width={24}
                    height={24}
                    className="h-6 w-6 object-contain"
                  />
                  <span className="whitespace-nowrap font-mono text-[12.5px] uppercase tracking-[0.16em] text-[var(--v2-muted)]">
                    {logo.label}
                  </span>
                </span>
              )),
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
