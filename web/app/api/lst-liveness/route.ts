import { fetchLstDirectory } from "@/lib/lst/fetch-directory";

// Same-origin proxy for an LST's liveness flags, so a CLIENT component (the
// asset-detail hero) can read the intrinsic-side "backing may be frozen"
// signal without ever touching lst-directory.com directly. The directory
// fetch is server-only BY DESIGN (no CORS guarantee from a third party we
// don't control, and it would make the page hard-depend on an upstream that's
// allowed to go down — see fetch-directory.ts); this route relays just the
// per-mint `flags` through our own origin.
//
// SSRF-safe BY CONSTRUCTION: the client supplies only a `mint`; the response
// is resolved server-side from the same revalidate(900)-cached directory the
// /lst page already uses (fetchLstDirectory) — no caller-controlled URL.
//
// This is the intrinsic-side analogue of the API's `oracle_degraded` amber
// advisory (ADR-0035), but kept FRONTEND-ONLY (ADR-0037): the directory
// already carries the maintainer's own `flags.{stale,deprecated,dead}`
// liveness determination for the ~41 sanctum_lst universe, so no Rust/engine/
// migration is needed. Purely advisory, out-of-hash — never a verdict input.
export const runtime = "nodejs";

// Every failure mode (missing mint, unreachable directory, mint not covered)
// degrades to a plain 404 — never a 500 — so the client hook resolves to
// `null` and the badge renders nothing (silence = the correct neutral for an
// un-degraded / uncovered LST).
function notFound(): Response {
  return new Response(null, { status: 404 });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mint = searchParams.get("mint");
  if (!mint) return notFound();

  const directory = await fetchLstDirectory();
  if (directory.status !== "ok") return notFound();

  const row = directory.rows.find((r) => r.mint === mint);
  if (!row) return notFound();

  return Response.json(
    {
      mint: row.mint,
      // Only the three liveness booleans the badge classifier consumes. `rate`
      // rides along for context/debuggability (not used by the classifier).
      flags: {
        stale: row.flags.stale,
        deprecated: row.flags.deprecated,
        dead: row.flags.dead,
      },
      rate: row.rate,
    },
    {
      headers: {
        // Match the directory's own 15-min refresh cadence at the CDN; the
        // browser revalidates so a freshly-flagged LST surfaces within a cycle.
        "cache-control":
          "public, max-age=0, s-maxage=900, stale-while-revalidate=300",
      },
    },
  );
}
