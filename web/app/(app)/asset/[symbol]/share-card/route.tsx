// /asset/[symbol]/share-card — branded Pegana share-card PNG for a single
// asset. Vertical 4:5 portrait card (1080x1350), designed as a premium social
// post (not an OG image). Downloaded by users and posted on X, Discord, etc.
//
// Design direction: "Swiss Signal" — brutal swiss typography, oversized
// symbol, iridescent ring cut at the edge, spread as visual headline in state
// color, minimal data strip at bottom. Uses the real Pegana brand kit
// (winged-P mark, iridescent gradient, Switzer/Geist Mono fonts, state colors).
//
// Shared helpers live in `lib/og/shared.ts`.

import { ImageResponse } from "next/og";
import { lookupAsset } from "@/lib/asset/fetch-asset";
import { publicSurfaceOf } from "@/lib/asset/public-surface";
import { OG_CACHE_CONTROL } from "@/lib/og/cache";
import { WAVE_DATA_URL } from "@/lib/brand/wave";
import { displaySymbol, resolveAliasSymbol } from "@/lib/asset/display-symbol";
import {
  IRIDESCENT_GRADIENT,
  SATORI_CANVAS,
  SATORI_TEXT,
  SATORI_MUTED,
  SATORI_HAIRLINE,
  SATORI_FOOTER,
  SATORI_SANS,
  SATORI_MONO,
  formatGeneratedAt,
  loadGeistFonts,
  satoriStateMeta,
  satoriSpreadColor,
} from "@/lib/og/shared";
import { reconcileBps, holderSignedPct, formatUsdValue } from "@/lib/api/format";


// Card dimensions: vertical 4:5 portrait (social-post aspect ratio).
const CARD_W = 1080;
const CARD_H = 1350;

interface AssetData {
  symbol: string;
  name: string | null;
  state:
    | "PEGGED"
    | "DRIFT"
    | "DEPEG"
    | "CRITICAL"
    | "BLACK_SWAN"
    | "UNKNOWN"
    | null;
  discount: string | null;
  intrinsic_usd: string | null;
  market_usd: string | null;
  peg_target?: string | null;
  class?: string | null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  try {
    const { symbol: rawSymbol } = await params;
    const symbol = resolveAliasSymbol(decodeURIComponent(rawSymbol));

    // Same lookup (and 60s data cache) as the page. A leveraged synth (xSOL,
    // no peg) or an unknown symbol has no card: the page 404s it, and a
    // downloadable PNG must not publish a peg verdict for it either.
    const lookup = await lookupAsset(symbol);
    if (publicSurfaceOf(lookup) === "not_tracked") {
      return new Response(`${displaySymbol(symbol)} is not tracked by Pegana`, {
        status: 404,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": OG_CACHE_CONTROL,
        },
      });
    }
    const asset: AssetData | null =
      lookup.kind === "found" ? lookup.asset : null;

    const state = asset?.state ?? "UNKNOWN";
    const { color: stateColor, label: stateLabel } = satoriStateMeta(state);

    const bps = asset
      ? reconcileBps({
          discount: asset.discount,
          intrinsic_usd: asset.intrinsic_usd,
          market_usd: asset.market_usd,
        }).bps
      : null;

    const gapStr = holderSignedPct(bps);
    const generatedAt = formatGeneratedAt(new Date());

    const fonts = await loadGeistFonts();

    return new ImageResponse(
      <div
        style={{
          width: "100%",
          height: "100%",
          background: SATORI_CANVAS,
          color: SATORI_TEXT,
          padding: "72px 80px",
          display: "flex",
          flexDirection: "column",
          fontFamily: SATORI_SANS,
          position: "relative",
        }}
      >
        {/* Iridescent ring — large circle cut at the top-right edge.
            Satori supports rounded divs and background gradients, so we
            layer an empty circle with the iridescent gradient that bleeds
            off the canvas. This is the visual anchor of the Swiss Signal
            composition. */}
        <div
          style={{
            position: "absolute",
            top: -380,
            right: -380,
            width: 760,
            height: 760,
            borderRadius: "50%",
            background: IRIDESCENT_GRADIENT,
            opacity: 0.18,
          }}
        />
        {/* Inner ring outline for crisp definition */}
        <div
          style={{
            position: "absolute",
            top: -362,
            right: -362,
            width: 724,
            height: 724,
            borderRadius: "50%",
            border: "1.5px solid rgba(255,255,255,0.08)",
          }}
        />

        {/* Brand mark — winged-P + "pegana" wordmark */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 28,
            fontWeight: 500,
            letterSpacing: "-0.01em",
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

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Center block — symbol + data */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
          }}
        >
          {/* State label with dot — sits above the symbol */}
          {asset && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: 28,
              }}
            >
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: stateColor,
                  marginRight: 12,
                }}
              />
              <span
                style={{
                  fontFamily: SATORI_MONO,
                  fontSize: 20,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: stateColor,
                  fontWeight: 500,
                }}
              >
                {stateLabel.toLowerCase()}
              </span>
            </div>
          )}

          {/* Asset symbol — oversized swiss display */}
          <div
            style={{
              display: "flex",
              fontSize: 140,
              fontWeight: 500,
              lineHeight: 0.95,
              letterSpacing: "-0.045em",
            }}
          >
            {asset ? displaySymbol(asset.symbol) : "pegana.xyz"}
          </div>

          {/* Asset name — muted, below symbol */}
          {asset?.name && (
            <div
              style={{
                display: "flex",
                marginTop: 10,
                fontSize: 22,
                color: SATORI_MUTED,
                maxWidth: 760,
              }}
            >
              {asset.name}
            </div>
          )}

          {/* Spread — the visual headline, massive, state color */}
          {asset && (
            <div
              style={{
                display: "flex",
                marginTop: 48,
                alignItems: "baseline",
              }}
            >
              <div
                style={{
                  fontFamily: SATORI_MONO,
                  fontSize: 136,
                  fontWeight: 500,
                  lineHeight: 0.9,
                  letterSpacing: "-0.02em",
                  color: satoriSpreadColor(bps),
                }}
              >
                {gapStr}
              </div>
              <div
                style={{
                  fontFamily: SATORI_MONO,
                  fontSize: 22,
                  color: SATORI_MUTED,
                  marginLeft: 16,
                }}
              >
                spread
              </div>
            </div>
          )}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Bottom data strip — intrinsic/market + timestamp */}
        <div
          style={{
            display: "flex",
            borderTop: `1px solid ${SATORI_HAIRLINE}`,
            paddingTop: 28,
            paddingBottom: 0,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          {/* Left — intrinsic + market */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                fontFamily: SATORI_MONO,
                fontSize: 16,
                color: SATORI_MUTED,
                marginBottom: 8,
              }}
            >
              intrinsic
            </div>
            <div
              style={{
                display: "flex",
                fontFamily: SATORI_MONO,
                fontSize: 28,
                fontWeight: 500,
                color: SATORI_TEXT,
                lineHeight: 1,
              }}
            >
              {asset ? formatUsdValue(asset.intrinsic_usd) : "-"}
            </div>
            <div
              style={{
                display: "flex",
                fontFamily: SATORI_MONO,
                fontSize: 16,
                color: SATORI_MUTED,
                marginTop: 12,
                marginBottom: 8,
              }}
            >
              market
            </div>
            <div
              style={{
                display: "flex",
                fontFamily: SATORI_MONO,
                fontSize: 28,
                fontWeight: 500,
                color: SATORI_TEXT,
                lineHeight: 1,
              }}
            >
              {asset ? formatUsdValue(asset.market_usd) : "-"}
            </div>
          </div>

          {/* Right — URL + timestamp */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
            }}
          >
            <div
              style={{
                display: "flex",
                fontFamily: SATORI_MONO,
                fontSize: 18,
                color: SATORI_FOOTER,
              }}
            >
              pegana.xyz/asset/{asset ? encodeURIComponent(asset.symbol) : ""}
            </div>
            <div
              style={{
                display: "flex",
                fontFamily: SATORI_MONO,
                fontSize: 16,
                color: SATORI_FOOTER,
                marginTop: 8,
              }}
            >
              {generatedAt}
            </div>
          </div>
        </div>
      </div>,
      {
        width: CARD_W,
        height: CARD_H,
        ...(fonts ? { fonts } : {}),
        headers: { "cache-control": OG_CACHE_CONTROL },
      },
    );
  } catch {
    return new Response("failed", { status: 500 });
  }
}
