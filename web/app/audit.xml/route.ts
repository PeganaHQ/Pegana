// Wave 11M.2 — /audit.xml Atom 1.0 feed of recent receipts.
//
// Subscribers (journalists, automated monitors, aggregators) get peg-state
// transitions without polling our JSON API. One <entry> per receipt; channel
// metadata + per-entry sha256 hash + methodology version so a reader can
// independently verify any line against /v1/audit/<id>.
//
// ADR-0003 retraction protocol — entries from a methodology version that has
// been marked `broken` should carry <category>retraction</category>. The
// status lookup requires a /v1/methodology/{version} endpoint that surfaces
// the lifecycle state (active/deprecated/broken). The new
// /v1/methodology/current handler only exposes the running engine version,
// not the full table, so we defer the per-entry retraction tagging to a
// follow-up once that endpoint exists. See the TODO below.

import { NextResponse } from "next/server";
import { apiBase, serverApiHeaders } from "@/lib/api/base";
import { siteOrigin } from "@/lib/seo/site-origin";

export const revalidate = 60;

const API_BASE = apiBase();
const SITE_URL = siteOrigin();

interface AuditIndexRow {
  id: string;
  asset: string;
  from_state: string;
  to_state: string;
  detected_at: string;
  methodology_version: string;
  receipt_sha256: string;
  onchain_tx_sig: string | null;
}

function xmlEscape(s: string): string {
  return s.replace(
    /[<>&'"]/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[c] ?? c,
  );
}

function iso(s: string): string {
  try {
    return new Date(s).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function entryFor(a: AuditIndexRow): string {
  const title = `alert ${a.asset} ${a.to_state.toLowerCase()}`;
  const link = `${SITE_URL}/audit/${a.id}`;
  const updated = iso(a.detected_at);
  const content =
    `Methodology v${a.methodology_version}\n` +
    `Receipt sha256: ${a.receipt_sha256}\n` +
    `Transition: ${a.from_state} → ${a.to_state}\n` +
    (a.onchain_tx_sig ? `On-chain tx: ${a.onchain_tx_sig}` : "");
  // TODO (ADR-0003): when the API exposes per-version lifecycle state,
  // append <category term="retraction" /> for entries whose
  // methodology_version is marked `broken`. Right now we have no way to
  // know that here without an N-call lookup, so retraction tagging is
  // deferred — replayability is preserved by the receipt sha alone.
  return `
  <entry>
    <id>${xmlEscape(link)}</id>
    <title>${xmlEscape(title)}</title>
    <link href="${xmlEscape(link)}" />
    <updated>${updated}</updated>
    <summary>${xmlEscape(content)}</summary>
    <category term="${xmlEscape(a.to_state.toLowerCase())}" />
    <category term="${xmlEscape(a.asset)}" />
  </entry>`;
}

export async function GET() {
  let entries: string[] = [];
  let updated = new Date().toISOString();

  try {
    const resp = await fetch(`${API_BASE}/v1/audit?limit=50`, {
      headers: { Accept: "application/json", ...serverApiHeaders() },
      next: { revalidate: 60 },
    });
    if (resp.ok) {
      const rows = (await resp.json()) as AuditIndexRow[];
      entries = rows.map(entryFor);
      if (rows[0]?.detected_at) updated = iso(rows[0].detected_at);
    }
  } catch {
    // Empty (still well-formed) feed if upstream is down — readers will retry.
  }

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Pegana. Trust Layer Receipts</title>
  <subtitle>Verifiable peg-state transitions for Solana stablecoins, LSTs, and yield-bearing assets.</subtitle>
  <link href="${xmlEscape(SITE_URL)}" />
  <link href="${xmlEscape(SITE_URL)}/audit.xml" rel="self" type="application/atom+xml" />
  <id>${xmlEscape(SITE_URL)}/audit</id>
  <icon>${xmlEscape(SITE_URL)}/favicon.ico</icon>
  <updated>${updated}</updated>
  <author>
    <name>Pegana</name>
    <uri>${xmlEscape(SITE_URL)}</uri>
  </author>
  <rights>© ${new Date().getUTCFullYear()} Pegana</rights>${entries.join("")}
</feed>
`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=60",
    },
  });
}
