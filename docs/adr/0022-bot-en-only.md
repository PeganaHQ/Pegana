# ADR-0022: Telegram bot is English-only (supersedes ADR-0012 §bot scope)

- **Status:** Accepted (2026-06-03)
- **Supersedes:** ADR-0012 clause "PT-BR + EN bot". Web/API/MCP were already
  English-only under ADR-0012 and are unaffected.

## Context

The bot already defaulted to English (`index.ts` `getUserOrCreate` upserts
`locale = "en"`) with pt-BR available as an opt-in `/lang pt`. But the DB
column default was still `'pt-BR'` (`0001_initial.sql:133`) — a latent mismatch
where a row created outside the bot's upsert path would have been pt-BR while
the bot negotiated to English. During the private calibration window,
maintaining a second locale (a full `pt-BR.ftl`, a parallel copy table, a
language switch, and a per-language command menu) was unjustified cost for a
zero-confirmed-pt-user beta. Brazilian beta testers receive English — an
intentional strategic choice, not an oversight.

## Decision

The Telegram bot is **English-only**. The Fluent i18n machinery is kept dormant
(a single `en.ftl`, `localeNegotiator: () => "en"`, `defaultLocale: "en"`), so
ADR-0012's Phase-16 expansion (Korean, Chinese, Japanese, Spanish) remains a
cheap re-add — a new `.ftl` plus re-enabling a switch — not a rebuild.

## Consequences

- **Removed:** `pt-BR.ftl`; `COPY_PT` / `CLASS_LABELS_PT` (`helpers.ts`); the
  `/lang` command; the `set:lang:toggle` callback and settings-panel language
  button; `lang_usage` / `lang_set` strings; the `pt` command menu
  (`COMMANDS_PT`); and the dead `setLocale` / `getLocale` DB helpers.
- **`getLocale`'s one non-locale caller** — `rejectGroupIfNoDm`, which read its
  null-on-missing-row return purely as a "has this user DMed us?" existence
  test — was rewired to a dedicated `db.userExists()`.
- **Migration 0043** sets the `users.locale` default to `'en'` and normalizes
  every existing non-`en` row to `'en'`. (Broadened from `IN ('pt-BR','pt')`
  after a local apply surfaced a stray `'en-US'` row; `users.locale` is now
  vestigial — the renderer ignores it — so a uniform `'en'` column is correct.)
  The column is kept, not dropped, so re-introducing locales stays cheap.
- **One-time boot cleanup:** `bot.api.deleteMyCommands({ language_code: "pt" })`
  runs once (the changed command payload changes the registration hash) so
  Brazilian-UI users stop seeing the cached pt command menu, including `/lang`.
- ADR-0012's Phase-16 i18n backlog stays valid; this defers it, not cancels it.
