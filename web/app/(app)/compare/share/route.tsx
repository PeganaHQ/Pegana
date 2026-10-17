// /compare/share?s=USDC,USDT — branded Pegana share-card PNG for /compare.
//
// Distinct from the existing raw-chart PNG export (compare-chart canvas
// snapshot): this is a self-contained, Pegana-branded summary card (mark +
// wordmark + per-asset holder-signed spread), suitable for sharing outside
// the app (X, Discord, Telegram) where the raw chart alone carries no brand
// context. Modeled directly on `app/(app)/asset/[symbol]/opengraph-image.tsx`
// — same ImageResponse/font-loading/brand-token idiom — but this file is a
// plain Route Handler (not a Next.js special `opengraph-image` file) since it
// renders an on-demand multi-asset card rather than a per-route static image.
// Shared helpers live in `lib/og/shared.ts` (extracted from the duplicated
// constants across opengraph-image.tsx and compare/share/route.tsx).

import { ImageResponse } from "next/og";
import { apiBase } from "@/lib/api/base";
import { WAVE_DATA_URL } from "@/lib/brand/wave";
import { displaySymbol, resolveAliasSymbol } from "@/lib/asset/display-symbol";
import { reconcileBps } from "@/lib/api/format";
import {
  IRIDESCENT_GRADIENT,
  STATE_COLOR,
  STATE_LABEL,
  SATORI_CANVAS,
  SATORI_TEXT,
  SATORI_MUTED,
  SATORI_HAIRLINE,
  SATORI_FOOTER,
  SATORI_SANS,
  SATORI_MONO,
  formatGapBps as formatGap,
  formatGeneratedAt,
  loadGeistFonts,
  satoriSpreadColor,
} from "@/lib/og/shared";

const API_BASE = apiBase();

// Cap the card to a readable count — beyond this a share card stops being a
// scannable summary and the compare page itself (MAX=4 selection) never asks
// for more than a handful anyway. Generous headroom for hand-built URLs.
const MAX_ASSETS = 8;

interface AssetData {
  symbol: string;
  name: string | null;
  state:
    "PEGGED" | "DRIFT" | "DEPEG" | "CRITICAL" | "BLACK_SWAN" | "UNKNOWN" | null;
  discount: string | null;
  intrinsic_usd: string | null;
  market_usd: string | null;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const raw = url.searchParams.get("s") ?? "";
    const symbols = Array.from(
      new Set(
        raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => resolveAliasSymbol(s)),
      ),
    ).slice(0, MAX_ASSETS);

    // Fetch server-side (no CORS) and filter to the requested symbols. Empty
    // `symbols` (bad/absent `?s=`) or a failed fetch both fall through to an
    // empty `assets` array, which renders the generic "Pegana peg comparison"
    // card below rather than erroring.
    let assets: AssetData[] = [];
    if (symbols.length > 0) {
      try {
        const r = await fetch(`${API_BASE}/v1/assets`, { cache: "no-store" });
        if (r.ok) {
          const body = (await r.json()) as { data: AssetData[] };
          const all = body.data;
          const map = new Map(all.map((a) => [a.symbol, a]));
          assets = symbols
            .map((s) => map.get(s))
            .filter((a): a is AssetData => !!a);
        }
      } catch {
        /* fall through to the generic card */
      }
    }

    // Brand fonts (Geist + Geist Mono). Best-effort; on failure satori's
    // default renders the card instead.
    const fonts = await loadGeistFonts();
    const SANS = SATORI_SANS;
    const MONO = SATORI_MONO;

    const n = assets.length;
    // Row/dot sizing scales down as the set grows — flex:1 rows already
    // divide the available vertical space evenly for any count 2-8, this
    // just keeps the type readable at each density instead of a fixed size
    // that's cramped at 8 or wastes space at 2.
    const rowFontSize =
      n <= 2 ? 40 : n <= 3 ? 34 : n <= 4 ? 30 : n <= 6 ? 24 : 19;
    const dotSize = n <= 3 ? 16 : n <= 5 ? 13 : 10;
    const generatedAt = formatGeneratedAt(new Date());

    return new ImageResponse(
      <div
        style={{
          width: "100%",
          height: "100%",
          background: SATORI_CANVAS,
          color: SATORI_TEXT,
          padding: "56px 76px",
          display: "flex",
          flexDirection: "column",
          fontFamily: SANS,
          position: "relative",
        }}
      >
        {/* iridescent accent — top edge (the one signature moment, brand.md) */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 6,
            background: IRIDESCENT_GRADIENT,
          }}
        />

        {/* brand mark — winged-P */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 28,
            fontWeight: 500,
          }}
        >
          <img
            src={WAVE_DATA_URL}
            width={40}
            height={36}
            alt=""
            style={{ marginRight: 10 }}
          />
          <span>pegana</span>
        </div>

        {/* Title */}
        <div
          style={{
            display: "flex",
            marginTop: 26,
            fontSize: 52,
            fontWeight: 500,
            letterSpacing: "-0.02em",
          }}
        >
          Peg comparison
        </div>

        {n === 0 ? (
          <>
            <div
              style={{
                display: "flex",
                marginTop: 22,
                maxWidth: 760,
                fontSize: 24,
                lineHeight: 1.5,
                color: SATORI_MUTED,
              }}
            >
              Live peg-risk snapshot across Solana stables, LSTs and leveraged
              synths. Verified against on-chain intrinsic value.
            </div>
            <div style={{ display: "flex", flex: 1 }} />
          </>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              marginTop: 18,
            }}
          >
            {assets.map((asset, i) => {
              // Canonical reconcileBps (200bps drift tolerance) — the SAME
              // function /compare's board + CSV export use, so the card can't
              // diverge from them (its `.bps` is raw-API-signed: + = discount).
              // Holder convention negates it → `+` = premium, `−` = discount.
              const canonicalBps = reconcileBps(asset).bps;
              const holderBps = canonicalBps == null ? null : -canonicalBps;
              const gap = formatGap(holderBps);
              const state = asset.state ?? "UNKNOWN";
              const color = STATE_COLOR[state] ?? STATE_COLOR.UNKNOWN!;
              const stateLabel = STATE_LABEL[state] ?? STATE_LABEL.UNKNOWN!;
              return (
                <div
                  key={asset.symbol}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flex: 1,
                    borderBottom:
                      i < n - 1 ? `1px solid ${SATORI_HAIRLINE}` : "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div
                      style={{
                        width: dotSize,
                        height: dotSize,
                        borderRadius: dotSize / 2,
                        background: color,
                      }}
                    />
                    <span
                      style={{
                        marginLeft: 16,
                        fontSize: rowFontSize,
                        fontWeight: 500,
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {displaySymbol(asset.symbol)}
                    </span>
                    <span
                      style={{
                        marginLeft: 16,
                        fontFamily: MONO,
                        fontSize: Math.round(rowFontSize * 0.36),
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: "#8f8aa3",
                      }}
                    >
                      {stateLabel}
                    </span>
                  </div>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: Math.round(rowFontSize * 0.7),
                      fontWeight: 500,
                      // Sign-driven, from the RAW bps — `holderBps` above is already
                      // negated, so passing it here would invert the color.
                      color: satoriSpreadColor(canonicalBps),
                    }}
                  >
                    {gap}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: `1px solid ${SATORI_HAIRLINE}`,
            paddingTop: 22,
            fontFamily: MONO,
            fontSize: 20,
            color: SATORI_FOOTER,
          }}
        >
          <span>pegana.xyz</span>
          <span>{generatedAt}</span>
        </div>
      </div>,
      {
        width: 1200,
        height: 630,
        ...(fonts ? { fonts } : {}),
        headers: { "cache-control": "public, max-age=300" },
      },
    );
  } catch {
    // Mirror the OG/embed route pattern — never let a rendering error bubble
    // up as an unhandled 500 HTML page; a short plain-text failure is enough
    // since this route is only ever consumed as an <a download> target.
    return new Response("failed", { status: 500 });
  }
}
