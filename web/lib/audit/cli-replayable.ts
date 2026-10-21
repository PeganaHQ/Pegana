// The first methodology version that has a published `pegana-replay` CLI
// build. Receipts from earlier versions predate every CLI release, so they
// can be checked by hash (in the browser) but not replayed by the CLI. Kept in
// step with lib/content/faq.ts and /releases, which state the same cut.
export const FIRST_CLI_METHODOLOGY = [0, 4, 0] as const;

function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * True when a published CLI build can replay a receipt of this methodology
 * version. An unparseable or missing version returns false: the page then
 * offers the hash check only, rather than promising a replay it cannot vouch
 * for.
 */
export function isCliReplayable(version: string | null | undefined): boolean {
  if (!version) return false;
  const p = parseVersion(version);
  if (!p) return false;
  for (let i = 0; i < 3; i++) {
    if (p[i] !== FIRST_CLI_METHODOLOGY[i]) return p[i] > FIRST_CLI_METHODOLOGY[i];
  }
  return true;
}
