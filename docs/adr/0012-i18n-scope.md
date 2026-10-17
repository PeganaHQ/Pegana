# ADR 0012 — i18n scope for v0.1.0

**Status**: Accepted (2026-05-28)
**Context**: Trust Layer v0.1.0; surface localization

## Problem

Spec specifies:
- Bot: PT-BR + EN
- API/MCP/web: EN-only

Asymmetry is justifiable (bot serves humans; API/MCP serve developers
who default to English) but undocumented. Korean and Chinese audiences
are large on Solana; no commitment either way.

## Decision

v0.1.0 ships exactly what spec says: PT-BR + EN bot, EN-only API/MCP/web.
Other locales are out of scope and gated by demand signals.

### Backlog entry: "Phase 16 — i18n expansion"

Activates when ANY of:
- ≥10 requests from non-English-speaking users in `mcp_call_log` or bot
  message logs (need geolocation enrichment).
- ≥1 design partner from Korea/China/Japan signs.
- ≥1 unsolicited PR adds a locale file (community signal).

### Languages prioritized in Phase 16
1. Korean (largest Solana retail volume non-EN)
2. Chinese (simplified) — for trader audience
3. Japanese — for institutional audience
4. Spanish (LATAM) — natural extension of PT-BR coverage

### What we publish in v0.1.0
- `/methodology` page: footnote "Pegana is currently English-only on web
  and API. Bot is PT-BR + EN. Request your language at
  github.com/lrafasouza/pegana/issues."
- Bot `/help`: same disclaimer in both supported languages.

## Why defer and not include now

- Translation quality matters more than coverage breadth; bad translations
  damage trust.
- No data yet shows non-EN demand is there.
- Phase 16 adds ~3 days per language for templates + tests + review.
  That's 12+ days for the top 4 — material cost without validated demand.

## Consequences

- Spec is now explicit about the scope decision and the trigger for
  expansion.
- Telemetry must capture enough signal to detect non-EN demand (already
  covered by ADR-0011's `mcp_call_log` if combined with IP geolocation).
- Bot's `/help` and `/methodology` carry the disclaimer + feedback URL.

## Cross-refs

- `docs/pegana-trust-layer-v0.1.0/08-external-surfaces.md § Telegram bot`
- `docs/pegana-trust-layer-v0.1.0/09-web-pages.md § /methodology`
