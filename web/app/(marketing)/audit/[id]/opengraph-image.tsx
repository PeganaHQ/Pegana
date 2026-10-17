import { ImageResponse } from "next/og";
import { WAVE_DATA_URL } from "@/lib/brand/wave";
import { displaySymbol } from "@/lib/asset/display-symbol";
import {
  STATE_COLOR,
  SATORI_CANVAS,
  SATORI_TEXT,
  SATORI_FOOTER,
  SATORI_SANS,
  SATORI_MONO,
  loadGeistFonts,
} from "@/lib/og/shared";

export const alt = "Pegana audit receipt";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "https://api.pegana.xyz";

type AuditSummary = {
  alert: {
    asset: string;
    from_state: string;
    to_state: string;
    detected_at: string;
  };
  evidence: {
    methodology_version: string;
    receipt_sha256: string;
  };
};

const STATE_BG: Record<string, string> = {
  PEGGED: "#0d2418",
  DRIFT: "#2a1a0d",
  DEPEG: "#2a0f10",
  CRITICAL: "#3a0f0f",
  BLACK_SWAN: "#3a0f0f",
  UNKNOWN: "#1a1f24",
};

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let data: AuditSummary | null = null;
  try {
    const r = await fetch(`${API_BASE}/v1/audit/${id}`, { cache: "no-store" });
    if (r.ok) data = (await r.json()) as AuditSummary;
  } catch {
    // Unreachable upstream → render the generic shell below.
  }

  const asset = displaySymbol(data?.alert.asset ?? "pegana");
  const fromState = data?.alert.from_state ?? "-";
  const toState = data?.alert.to_state ?? "-";
  const version = data?.evidence.methodology_version ?? "0.1.0";
  const receiptShort = data?.evidence.receipt_sha256.slice(0, 12) ?? "-";
  const stateColor = STATE_COLOR[toState] ?? STATE_COLOR.UNKNOWN!;
  const stateBg = STATE_BG[toState] ?? STATE_BG.UNKNOWN!;

  // Brand fonts (Geist + Geist Mono). Best-effort; on failure satori's
  // default renders the card instead.
  const fonts = await loadGeistFonts();

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        background: SATORI_CANVAS,
        color: SATORI_TEXT,
        padding: "60px 80px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        fontFamily: SATORI_SANS,
      }}
    >
      {/* Top: brand + methodology */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: SATORI_MONO,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 28,
            letterSpacing: "0.04em",
          }}
        >
          <img
            src={WAVE_DATA_URL}
            width={38}
            height={34}
            alt=""
            style={{ marginRight: 9 }}
          />
          <span
            style={{
              fontFamily: SATORI_SANS,
              fontWeight: 600,
              color: SATORI_TEXT,
            }}
          >
            pegana
          </span>
          <span style={{ color: "#8f8aa3", paddingLeft: 10 }}>
            audit receipt
          </span>
        </div>
        <div style={{ display: "flex", fontSize: 22, color: SATORI_FOOTER }}>
          methodology v{version}
        </div>
      </div>

      {/* Middle: asset + transition */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontSize: 144,
            fontWeight: 600,
            lineHeight: 1,
            letterSpacing: "-0.04em",
          }}
        >
          {asset}
        </div>
        <div
          style={{
            marginTop: 32,
            display: "flex",
            alignItems: "center",
            fontFamily: SATORI_MONO,
            fontSize: 38,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          <span
            style={{
              display: "flex",
              background: "#17171a",
              border: "1px solid rgba(255,255,255,0.16)",
              color: "#8f8aa3",
              padding: "10px 22px",
              borderRadius: 4,
            }}
          >
            {fromState}
          </span>
          <span style={{ display: "flex", color: SATORI_FOOTER, marginLeft: 20 }}>{"->"}</span>
          <span
            style={{
              display: "flex",
              background: stateBg,
              border: `1px solid ${stateColor}`,
              color: stateColor,
              padding: "10px 22px",
              borderRadius: 4,
              marginLeft: 20,
            }}
          >
            {toState}
          </span>
        </div>
      </div>

      {/* Bottom: receipt + verify call-to-action */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: SATORI_MONO,
          fontSize: 22,
          color: SATORI_FOOTER,
          letterSpacing: "0.04em",
        }}
      >
        <div style={{ display: "flex" }}>sha256:{receiptShort}</div>
        <div style={{ display: "flex", color: "#8f8aa3" }}>
          verify at pegana.xyz/methodology
        </div>
      </div>
    </div>,
    { ...size, ...(fonts ? { fonts } : {}) },
  );
}
