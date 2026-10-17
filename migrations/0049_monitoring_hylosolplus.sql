-- 0049: contain hyloSOL+ as monitoring-only (P0 from the 2026-06-14 validation
-- handoff).
--
-- hyloSOL+ is public (monitoring_only was never set) but its discount signal is
-- FROZEN: a single distinct value over the trailing window while market_usd
-- moves ~13 bps. Its intrinsic is single-source (pyth_feed_id = '', the Sanctum
-- sol_per_lst read) and that read is not advancing, so the engine reports a
-- confident PEGGED off a stale basis. A frozen signal would NOT detect a real
-- hyloSOL+ stress move, yet — because it is not monitoring-only — it still
-- reaches the public alert feed (it escapes the egress gate). Contain it until
-- it shows real price discovery. See docs/2026-06-14-pegana-validation-handoff.md
-- (P0 #1). The engine-side freeze detector (0049's companion engine change) is
-- the systemic fix; this is the immediate containment. Idempotent.

UPDATE assets
SET metadata = metadata || jsonb_build_object(
  'monitoring_only', true,
  'monitoring_since', '2026-06-14',
  'monitoring_reason', 'Frozen single-source signal: discount pinned to one distinct value over the window while market moves — cannot detect real stress. Contained pending genuine price discovery.'
)
WHERE symbol = 'hyloSOL+';
