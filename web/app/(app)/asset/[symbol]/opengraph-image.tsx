import { ImageResponse } from "next/og";
import { lookupAsset } from "@/lib/asset/fetch-asset";
import { publicSurfaceOf } from "@/lib/asset/public-surface";
import { OG_CACHE_CONTROL } from "@/lib/og/cache";
import { WAVE_DATA_URL } from "@/lib/brand/wave";
import { displaySymbol, resolveAliasSymbol } from "@/lib/asset/display-symbol";
import {
  IRIDESCENT_GRADIENT,
  STATE_COLOR,
  SATORI_CANVAS,
  SATORI_TEXT,
  SATORI_MUTED,
  SATORI_HAIRLINE,
  SATORI_FOOTER,
  SATORI_SANS,
  SATORI_MONO,
  loadGeistFonts,
  satoriSpreadColor,
} from "@/lib/og/shared";
import { reconcileBps, holderSignedPct, formatUsdValue } from "@/lib/api/format";

export const alt = "Pegana: peg status";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

interface AssetData {
  symbol: string;
  name: string | null;
  state:
    "PEGGED" | "DRIFT" | "DEPEG" | "CRITICAL" | "BLACK_SWAN" | "UNKNOWN" | null;
  discount: string | null;
  intrinsic_usd: string | null;
  market_usd: string | null;
}

export default async function Image({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol: rawSymbol } = await params;
  const symbol = resolveAliasSymbol(decodeURIComponent(rawSymbol));

  // Same lookup (and 60s data cache) as the page. A leveraged synth (xSOL,
  // no peg) or an unknown symbol gets a neutral "not tracked" card: the page
  // 404s it, so the unfurl must not publish a peg verdict either.
  const lookup = await lookupAsset(symbol);
  const notTracked = publicSurfaceOf(lookup) === "not_tracked";
  const asset: AssetData | null =
    lookup.kind === "found" && !notTracked ? lookup.asset : null;

  const state = asset?.state ?? "UNKNOWN";
  const stateColor = STATE_COLOR[state] ?? STATE_COLOR.UNKNOWN!;

  // Canonical reconcileBps (200bps drift threshold) so the OG image never
  // disagrees with the asset page / board / rail.
  const bps = asset
    ? reconcileBps({
        discount: asset.discount,
        intrinsic_usd: asset.intrinsic_usd,
        market_usd: asset.market_usd,
      }).bps
    : null;

  // holderSignedPct handles the negate-and-format in one canonical call.
  const gap = holderSignedPct(bps);

  // Brand fonts (Geist + Geist Mono). Best-effort; on failure satori's
  // default renders the card instead.
  const fonts = await loadGeistFonts();
  const SANS = SATORI_SANS;
  const MONO = SATORI_MONO;

  return new ImageResponse(
    <div
        style={{
          width: "100%",
          height: "100%",
          background: SATORI_CANVAS,
          color: SATORI_TEXT,
          padding: "64px 80px",
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

      {/* brand mark — Wave Signal */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          fontSize: 30,
          fontWeight: 500,
        }}
      >
        <img
          src={WAVE_DATA_URL}
          width={42}
          height={38}
          alt=""
          style={{ marginRight: 10 }}
        />
        <span>pegana</span>
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 24,
        }}
      >
        {/* Left — symbol + state pill */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 158,
              fontWeight: 500,
              lineHeight: 1,
              letterSpacing: "-0.04em",
            }}
          >
            {asset
              ? displaySymbol(asset.symbol)
              : notTracked
                ? displaySymbol(symbol)
                : "pegana.xyz"}
          </div>
          {notTracked && (
            <div
              style={{
                display: "flex",
                marginTop: 34,
                fontFamily: MONO,
                fontSize: 30,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: SATORI_MUTED,
              }}
            >
              not tracked by Pegana
            </div>
          )}
          {asset && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginTop: 34,
                border: `1px solid ${stateColor}55`,
                background: `${stateColor}1a`,
                padding: "12px 22px",
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  background: stateColor,
                }}
              />
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 30,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: stateColor,
                  paddingLeft: 16,
                }}
              >
                {state.toLowerCase().replace("_", " ")}
              </span>
            </div>
          )}
        </div>

        {/* Right — figures */}
        {asset && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              fontFamily: MONO,
              fontSize: 28,
              color: SATORI_MUTED,
            }}
          >
            <div style={{ display: "flex", color: satoriSpreadColor(bps), fontSize: 60 }}>
              {gap}
            </div>
            <div style={{ display: "flex", marginTop: 16 }}>
              intrinsic {formatUsdValue(asset.intrinsic_usd)}
            </div>
            <div style={{ display: "flex", marginTop: 10 }}>
              market {formatUsdValue(asset.market_usd)}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: `1px solid ${SATORI_HAIRLINE}`,
          paddingTop: 26,
          fontFamily: MONO,
          fontSize: 22,
          color: SATORI_FOOTER,
        }}
      >
        <span>Live peg-risk oracle · Solana</span>
        <span>pegana.xyz</span>
      </div>
    </div>,
    {
      ...size,
      ...(fonts ? { fonts } : {}),
      // Cached at the CDN: crawlers and unfurlers re-fetch these often, and
      // each miss is a function invocation plus a satori render.
      headers: { "Cache-Control": OG_CACHE_CONTROL },
    },
  );
}
