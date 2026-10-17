import { parseDirectoryRows } from "./parse";
import type { DirectoryLstRaw } from "./types";

const DIRECTORY_URL = "https://lst-directory.com/api/directory";

export type DirectoryFetchResult =
  { status: "ok"; rows: DirectoryLstRaw[] } | { status: "unreachable" };

/**
 * Server-only fetch of the LST universe (lst-directory.com, maintained by
 * Hylo). Cached 15 minutes — matches the directory's own refresh cadence, so
 * this never polls faster than the source actually updates. Called from a
 * server component / route handler ONLY: never fetch this client-side (no
 * CORS guarantee from a third party we don't control, and it would make the
 * page hard-depend on an upstream that's allowed to go down).
 *
 * Never throws — any failure (network, non-2xx, empty/malformed body)
 * degrades to `{ status: "unreachable" }` so the caller can fall back to
 * Pegana's own covered LSTs instead of the page breaking.
 */
export async function fetchLstDirectory(): Promise<DirectoryFetchResult> {
  try {
    const res = await fetch(DIRECTORY_URL, {
      headers: { Accept: "application/json" },
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.warn("lst directory fetch non-ok", res.status);
      return { status: "unreachable" };
    }
    const body = (await res.json()) as { rows?: unknown };
    const rows = parseDirectoryRows(body?.rows);
    if (rows.length === 0) return { status: "unreachable" };
    return { status: "ok", rows };
  } catch (err) {
    console.error("lst directory fetch error", err);
    return { status: "unreachable" };
  }
}
