# ADR-0040 — Bot keeps the idempotency claim on an ambiguous send failure

- **Status:** Accepted (2026-07-18). Built on `landing/v2-port`, 1:1 + test-validated, **NOT deployed**.
- **Scope:** `bot-ts` internal `/send` endpoint (the dispatcher → bot delivery path).
- **Supersedes the T5 blanket-release behavior** for the `HttpError` case only.

## Context

The dispatcher POSTs each alert to the bot's `/send` with an `idempotencyKey`. The bot:

1. `claimIdempotency(key)` — first claim wins; a duplicate short-circuits (`{ ok: true, duplicate: true }`).
2. `bot.api.sendMessage(...)` — the actual Telegram delivery.
3. on error: previously **released the claim** so the dispatcher's retry (`5s → 30s → 5m → 30m → 2h`) could re-attempt (the **T5 audit** fix — a claim must not survive a *failed* send, else the retry short-circuits and the alert is reported delivered but never sent).

`sendMessage` is **not idempotent** and the bot→dispatcher HTTP ack is **not reliable**. That makes exactly-once impossible; the only choice is which failure to prefer. The blanket release chose *at-least-once* and reopened a **double-send** window: when Telegram **receives and delivers** the message but the response is lost (network drop / **timeout**), the bot's `await sendMessage` *also* throws → the old code released the claim → the dispatcher retry re-claimed and **sent the alert a second time** (audit-review finding #4).

grammY's error taxonomy (verified against the docs via context7) is exactly the signal needed:

- **`GrammyError`** — Telegram **received** the request and returned an API error (400 bad payload, 403 blocked, 429 rate-limit, 5xx). The message was **not delivered**.
- **`HttpError`** — grammY got **no confirmed response** (network failure / timeout). The message **may already be delivered**; only the response was lost.

## Decision

Release the idempotency claim **only when the send definitely did not reach Telegram** — i.e. on `GrammyError` or any error thrown *before* the send (render/validation). On an **`HttpError` keep the claim**, so the dispatcher retry short-circuits as a duplicate instead of double-sending.

The decision is a pure, unit-tested predicate `shouldReleaseClaimOnSendError(e) = !(e instanceof HttpError)` in the side-effect-free `helpers.ts` (the `/send` handler is inline in `Bun.serve` and can't be imported without side effects).

## Consequences

- **Eliminates the common-case double-send** — a timeout after Telegram already delivered no longer re-sends on retry.
- **Preserves T5 for definite non-deliveries** — a `GrammyError` still releases, so a transient 429/5xx can retry, and a 400 fails fast without ever double-sending (it never delivered).
- **Accepted residual (the tradeoff):** a *true* couldn't-connect `HttpError` (Telegram unreachable — the request genuinely never left) is now also held, so that alert is **dropped rather than duplicated**. Accepted because:
  1. a **duplicate risk-alert is the reported harm** (#4); a rare drop on a transient network blip is the lesser evil for the common failure mode (timeout ≫ couldn't-connect in practice),
  2. the drop is **observable** — Sentry captures it and the dispatcher writes the exhausted delivery to its DLQ,
  3. the only **can't-lose** alert, **BLACK_SWAN**, bypasses the dispatcher's per-user dedup and re-emits with a **fresh `alert_id` (⇒ fresh idempotency key) every recompute** (~60s), so it is delivered **at-least-once regardless** of any single held claim.
- **No change to the happy path or to the `duplicate: true` short-circuit.**

## Tests

`bot-ts/test/helpers.test.ts::shouldReleaseClaimOnSendError` locks all three arms: `HttpError → keep`, `GrammyError → release`, pre-send/unknown → release.
