# Webhook Channel Types — Discord / Slack / Generic

**Date:** 2026-06-09
**Status:** Design — approved, pending spec review
**Branch:** `feat/webhook-channel-types`
**Sub-project:** 1 of 2 (backend). Sub-project 2 is the accounts/webhooks UI/UX redesign with shadcn (separate spec).

## Problem

A user registers a Discord channel webhook URL (`https://discord.com/api/webhooks/…`) on
`/account/webhooks` and **nothing ever arrives in Discord**. Root cause, confirmed in code:

1. **Wrong payload shape (the hard bug).** Every Pegana webhook is sent as generic signed JSON —
   `{asset, from_state, to_state, discount_bps, alert_id, evidence_url, …}` — built in
   `crates/dispatcher-rs/src/main.rs:516` (production fan-out), `crates/api-rs/src/webhook_dispatch.rs:215`
   (test/replay synthetic), plus the retraction (`dispatcher-rs/src/retraction.rs`) and
   evidence-ready (`dispatcher-rs/src/evidence_reconcile.rs`) payloads. Discord's webhook endpoint
   **requires** the body to contain `content` and/or `embeds`; a body with neither is rejected
   `HTTP 400 {"code":50006,"message":"Cannot send an empty message"}`. So even a real alert is dropped.
   The system was built for *machine* receivers that verify the `x-pegana-signature` Ed25519 header
   (see `docs/examples/webhook-receivers/`); Discord is a *chat sink* that ignores the signature and
   only renders `content`/`embeds`.

2. **No registration feedback.** `POST /v1/me/webhooks` only inserts a row — no confirmation ping.
   The backend has a working `POST /v1/me/webhooks/{id}/test`, but the frontend never wired it up
   (handled in sub-project 2). So after registering, the only thing that could reach Discord is a real
   peg transition crossing the threshold — and ① 400s it anyway.

3. **Structural gap.** `webhook_subscriptions` (migration 0022) has **no `channel_type`**. The system
   cannot tell a machine receiver from Discord from Slack, so it cannot format per destination.

What is already solid (and stays unchanged): the dispatcher loop, SSRF guard (`pegana_common::webhook_url`),
exponential-backoff retry, dead-letter persistence, per-attempt `webhook_deliveries` audit log, replay,
and Ed25519 signing (`pegana_common::webhook_sign`). This change is **additive** — a channel renderer,
not a rewrite.

## Goals

- A user who registers a Discord (or Slack) webhook receives correctly-rendered messages on real alerts
  and on `/test`.
- `channel_type` is a first-class, explicit, auto-detected-but-overridable attribute of a subscription.
- One source of truth for channel rendering, shared by `dispatcher-rs` and `api-rs` (no format drift).
- Discord-correct: embeds, hard-limit truncation, and `429 Retry-After` honoring.
- Backward compatible: existing generic subscribers are byte-for-byte unchanged.
- A thorough test + stress pass over the webhook subsystem ("tenha certeza absoluta").

## Non-goals

- The accounts/webhooks UI, the "Send test" button, shadcn — that is sub-project 2. SP1 ships the API
  contract SP2 consumes.
- Auditing backend areas unrelated to webhooks (engine, indexer, alert classification). "Full backend
  audit/stress" here is scoped to the **webhook subsystem** — the thing that is broken. Widening is a
  separate effort.
- Per-subscription secrets, Discord OAuth/bot tokens, threaded replies, message editing. Out of scope.

## Architecture

### Single source of truth: `pegana_common::webhook_channel`

New module `crates/common/src/webhook_channel.rs`, consumed by both send crates:

```rust
pub enum ChannelType { Generic, Discord, Slack }   // Default::default() == Generic
impl FromStr / Display for ChannelType             // "generic" | "discord" | "slack"

/// Host-based detection. Conservative: exact host or dot-suffix match only,
/// so spoofs like `discord.com.evil.com` fall through to Generic.
pub fn detect_channel_type(url: &str) -> ChannelType;

pub struct Rendered { pub body: serde_json::Value, pub sign: bool }

/// Project a canonical Pegana event onto a channel. `canonical` is the EXISTING
/// generic JSON (alerts) or the `{type:"retraction"|"evidence_now_available", …}`
/// objects. The renderer switches on the `type` field (absent ⇒ alert). The
/// canonical event is never mutated — Discord/Slack are pure projections.
pub fn render_for_channel(ch: ChannelType, canonical: &serde_json::Value) -> Rendered;
```

- `sign == true` only for `Generic`. Chat sinks cannot verify Ed25519, and signing a *different* body
  than the documented canonical would misrepresent the signature contract; we omit `x-pegana-signature`
  for Discord/Slack but keep `x-pegana-event-id` (idempotency/debug).
- The renderer is the **only** place a channel body is constructed. Both crates already share
  `pegana_common::{webhook_sign, webhook_url, webhook_response}`, so this is the natural home.

### Canonical stays the store-of-record

`webhook_dead_letter.payload` continues to store the **canonical** generic JSON. Replay re-renders per
the subscription's current `channel_type` at send time. One source of truth; channel rendering is always
derived, never persisted. Pre-existing dead-letter rows replay correctly with no migration of their payloads.

### Send-path integration (render at the call site, dispatch stays thin)

The three call sites resolve `channel_type`, call `render_for_channel`, and pass `Rendered` to dispatch:

- **Production fan-out** — `dispatcher-rs/src/webhook.rs::dispatch_one` + `main.rs::webhook_fanout`.
  `webhook_queries::subs_for_asset` SELECT and the `Subscription` struct gain `channel_type`.
- **Test** — `api-rs/src/routes/webhooks.rs::test_webhook` → `user_owned_sub` SELECT gains `channel_type`;
  `synthetic_payload` stays canonical; render before `dispatch_once`.
- **Replay** — `api-rs/src/routes/webhooks.rs::replay_webhook` → render each dead-letter canonical per the
  sub's `channel_type`.

`dispatch_one` / `dispatch_once` gain a `sign: bool` parameter so they attach the `x-pegana-signature`
header only when `sign` is true. Everything else (other headers, timeout, delivery logging, dead-letter)
is unchanged.

## Channel projections

### Discord (embed)

A peg alert:

```json
{ "embeds": [{
  "title": "jitoSOL · DRIFT",
  "description": "Peg PEGGED → DRIFT · discount −47 bps (−0.47%)",
  "url": "https://pegana.xyz/audit/<alert_id>",
  "color": 16098083,
  "fields": [
    { "name": "Asset",      "value": "jitoSOL",        "inline": true },
    { "name": "Transition", "value": "PEGGED → DRIFT",  "inline": true },
    { "name": "Discount",   "value": "−47 bps",         "inline": true }
  ],
  "footer": { "text": "Pegana · evidence: ready" },
  "timestamp": "<rfc3339>"
}] }
```

- **Color by severity:** DEPEG/BLACK_SWAN → red `0xE5484D`; DRIFT → amber `0xF5A623`;
  PEGGED/recovery → green `0x30A46C` (brand-aligned hues).
- **Retraction** → distinct title ("Alert retracted") + neutral color + `fix_url`/evidence link.
- **Evidence-ready** → "Evidence now available" + audit link.
- **Defensive truncation** to Discord hard limits even though our content is small: title ≤256,
  description ≤4096, field name ≤256, field value ≤1024, ≤25 fields, footer ≤2048, ≤10 embeds,
  ≤6000 chars total. Truncation appends `…`.

### Slack (attachment)

Mirrors the Discord embed via a single legacy `attachments` entry (incoming-webhook compatible):

```json
{ "attachments": [{
  "color": "#F5A623",
  "title": "jitoSOL · DRIFT",
  "title_link": "https://pegana.xyz/audit/<alert_id>",
  "text": "Peg PEGGED → DRIFT · discount −47 bps (−0.47%)",
  "fields": [ { "title": "Discount", "value": "−47 bps", "short": true } ],
  "footer": "Pegana", "ts": <unix>
}] }
```

### Generic (unchanged)

The exact current canonical JSON, fully Ed25519-signed. Zero behavioral change for existing subscribers.

## Correctness: honor `Retry-After` on 429

Discord rate-limits webhooks (~30 messages/min/channel) and returns **429 with a `Retry-After` header**
(and `retry_after` in the body). The production retry loop (`webhook.rs:119`) currently applies a fixed
backoff curve regardless. Change: on a 429 response with a `Retry-After`, the loop sleeps the hinted
duration (capped at the curve's max, e.g. 7200s) instead of the next fixed step; otherwise it falls back
to the existing curve. Channel-agnostic — any receiver returning `Retry-After` benefits. The single-shot
`/test` and `/replay` paths do not retry, so they simply report the 429 in `DeliveryResult` (unchanged).

## Schema & API contract

### Migration 0046

```sql
ALTER TABLE webhook_subscriptions
  ADD COLUMN channel_type TEXT NOT NULL DEFAULT 'generic';
ALTER TABLE webhook_subscriptions
  ADD CONSTRAINT webhook_subscriptions_channel_type_chk
  CHECK (channel_type IN ('generic','discord','slack'));
-- Make already-registered Discord/Slack hooks work immediately.
UPDATE webhook_subscriptions
  SET channel_type = 'discord'
  WHERE url LIKE 'https://discord.com/%' OR url LIKE 'https://discordapp.com/%'
     OR url LIKE 'https://%.discord.com/%';
UPDATE webhook_subscriptions
  SET channel_type = 'slack'
  WHERE url LIKE 'https://hooks.slack.com/%';
```

(The `LIKE` backfill *approximates* `detect_channel_type` — SQL host matching is coarser than the
Rust URL parser, so it is best-effort. Any row mis-classified at migrate time is correctable via
`PATCH … {channel_type}`, and every *new* registration uses the exact Rust detector.)

### Endpoints

- **`POST /v1/me/webhooks`** — `CreateWebhook` gains optional `channel_type: Option<String>`. When
  omitted, the server runs `detect_channel_type(url)`. When provided, it is validated against the enum
  (400 on unknown). Response `Webhook` gains `channel_type`.
- **`PATCH /v1/me/webhooks/{id}`** — `PatchWebhook` gains optional `channel_type`; `COALESCE` semantics.
- **`GET /v1/me/webhooks`** — list response includes `channel_type`.
- **`POST /v1/me/webhooks/{id}/test`** — unchanged signature; now renders per the sub's `channel_type`.
- OpenAPI (`utoipa`) schemas updated for all of the above. The OpenAPI `paths.len` does **not** change
  (no new routes); only existing schemas gain a field.

## Testing & stress strategy ("tenha certeza absoluta")

### Unit (`pegana_common::webhook_channel`)

- `detect_channel_type` host matrix incl. spoofs: `discord.com`, `discordapp.com`, `ptb.discord.com`,
  `hooks.slack.com`, `discord.com.evil.com` ⇒ Generic, `notdiscord.com` ⇒ Generic, `http://` schemes.
- `render_for_channel` table tests for every (channel × event-type) combo: Discord/Slack bodies ALWAYS
  contain a renderable field (`embeds`/`attachments`); color mapping per `to_state`; retraction and
  evidence-ready titles; generic body byte-identical to today's.
- Truncation: a pathological long field is clamped to Discord's limit with `…`.
- `Generic ⇒ sign=true`, `Discord/Slack ⇒ sign=false`.

### Integration (real HTTP sink — existing axum-sink pattern in the repo)

- Register a `discord` sub → `/test` → assert the captured body is Discord-valid (`embeds` present) and
  the sink returns 200.
- **Regression lock:** a sink that mimics Discord's contract — 400 `Cannot send an empty message` when the
  body lacks `content`/`embeds`, 204 otherwise. Prove the OLD generic body 400s and the NEW Discord body
  passes. This is the test that would have caught the original bug.
- Slack sub → assert `attachments` present.
- Generic sub → assert `x-pegana-signature` present and verifies; Discord/Slack sub → assert it is absent
  but `x-pegana-event-id` present.

### 429 / Retry-After

- Sink returns 429 + `Retry-After: 1` on attempt 1, 204 on attempt 2. Assert the loop waits ≈1s (the hint),
  not the 5s curve step, and the delivery ultimately succeeds; both attempts land in `webhook_deliveries`.

### Stress / concurrency

- Fan-out to N (e.g. 200) subscribers against a slow + intermittently-failing sink. Assert: the 50-permit
  semaphore caps in-flight requests, no panic/leak, every attempt is recorded in `webhook_deliveries`,
  terminal failures land in `webhook_dead_letter`, and a subsequent replay re-renders each per its
  `channel_type`. Record throughput + p50/p99 latency as a sanity signal (not a hard SLA gate).
- Mixed-channel fan-out (generic + discord + slack subscribers on the same asset) renders each correctly
  in one pass.

### Run surface

`cargo test` for `pegana-common`, `api-rs`, `dispatcher-rs` against prod-local Postgres
(`WEBHOOK_SSRF_ALLOW_LOOPBACK=1` for loopback sinks). `cargo clippy` + `cargo fmt` clean. Playwright is
sub-project 2 (UI).

## Rollout (calibration-safe)

Touches `api-rs`, `dispatcher-rs`, and migration 0046 only — **never engine/indexer**, so it is safe
mid-calibration (verdict gate 2026-06-11). Deploy: `scripts/deploy.sh --migrate --services 'api dispatcher'`
(service names confirmed in `docker-compose.yml`). Fully additive: generic subscribers unchanged, new
column defaults to `generic`, backfill upgrades existing Discord/Slack rows on migrate. Rollback = revert
the two binaries; the column is inert to old code (it never SELECTs it).

## Risks & mitigations

- **Discord changes its contract / limits.** Mitigated by defensive truncation + the regression-lock test
  encoding the contract; if Discord shifts, that test tells us.
- **Signature semantics confusion.** Documented explicitly: chat channels are unsigned; only generic is a
  signed machine contract. The `Rendered.sign` flag makes this a single, testable decision.
- **A subscriber URL's channel is mis-detected.** User can override `channel_type` on create/patch; the
  enum CHECK constraint prevents bad values at the DB edge.
- **429 storms.** Honoring `Retry-After` plus the existing dead-letter/replay envelope bounds exposure.

## Open questions

None outstanding. Slack is included; Discord uses rich embeds; 429 `Retry-After` is honored.
