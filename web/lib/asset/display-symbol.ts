/**
 * Canonical DB/API symbol -> user-facing display label overrides, for a
 * cosmetic issuer rebrand where Pegana's DB/receipt/replay identity must
 * NOT change (assets.toml `symbol`, engine classification key, alert-policy
 * keys, Telegram-bot subscription payload, webhook filter value, localStorage
 * watchlist key, canonical-hash inputs). Add an entry here — never rename
 * the underlying `symbol` anywhere else.
 *
 * sHYUSD -> eHYUSD: Hylo renamed the Stability Pool receipt token to
 * "eHYUSD" (Earn pool), 2026-07. Zero DB/replay change — display-only.
 */
export const SYMBOL_DISPLAY_ALIASES: Readonly<Record<string, string>> = {
  sHYUSD: "eHYUSD",
};

// Reverse map for alias resolution, case-insensitive.
const REVERSE_ALIASES: ReadonlyMap<string, string> = new Map(
  Object.entries(SYMBOL_DISPLAY_ALIASES).map(([dbSymbol, display]) => [
    display.toLowerCase(),
    dbSymbol,
  ]),
);

/**
 * DB/API symbol -> what a user should see. Identity for every asset without
 * an override. Call ONLY at the literal render boundary — a JSX text node,
 * `aria-label`, `title`, `alt`, SVG `<text>`, OG-image string, exported
 * filename/CSV cell. Never call this on a value that then becomes a URL, an
 * API fetch parameter, a lookup-map key, a bot/webhook payload, or a
 * storage key — those must stay the literal DB symbol.
 */
export function displaySymbol(symbol: string): string {
  return SYMBOL_DISPLAY_ALIASES[symbol] ?? symbol;
}

/**
 * The inverse: resolves a symbol a user may have typed, pasted, or linked
 * — possibly the display alias, possibly the canonical DB symbol, in any
 * case — to the literal DB/API symbol the backend understands. Identity
 * when the input isn't a known alias (including when it's already the
 * canonical symbol). Call at every entry point where a URL path segment or
 * query param becomes an API lookup key (asset page params, OG metadata,
 * embed badge route).
 */
export function resolveAliasSymbol(input: string): string {
  return REVERSE_ALIASES.get(input.toLowerCase()) ?? input;
}
