import { apiBase, serverApiHeaders } from "@/lib/api/base";
import type { AssetCardData } from "@/lib/api/types";

/**
 * Server-only fetch of Pegana's own tracked LSTs (the verdict overlay, not
 * the universe). 60s cache — same cadence the live board advertises
 * ("live · 60s") — keeps state pills fresh without hammering the API on
 * every /lst render within the window. Never throws: a down Pegana API should
 * still let /lst render the directory universe rather than 500.
 *
 * It returns a STATUS, not a bare array, and the difference is the whole point.
 * Returning `[]` on failure made every LST on the page render "not yet covered"
 * — a permanent claim about what this product tracks — when the truth was that
 * we could not reach our own API for sixty seconds. A visitor evaluating Pegana
 * mid-blip would read that as "covers nothing", which is worse than a 500 and
 * is precisely the confusion between absent and confirmed data that the product
 * exists to prevent. The caller needs to be able to tell the two apart.
 */
export type PeganaLstResult =
  | { status: "ok"; assets: AssetCardData[] }
  | { status: "error"; assets: [] };

export async function fetchPeganaLstAssets(): Promise<PeganaLstResult> {
  try {
    const res = await fetch(`${apiBase()}/v1/assets?class=lst`, {
      headers: { Accept: "application/json", ...serverApiHeaders() },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.warn("pegana lst assets fetch non-ok", res.status);
      return { status: "error", assets: [] };
    }
    const body = (await res.json()) as { data: AssetCardData[] };
    return { status: "ok", assets: body.data };
  } catch (err) {
    console.error("pegana lst assets fetch error", err);
    return { status: "error", assets: [] };
  }
}
