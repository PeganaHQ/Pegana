-- 0050: contain ONyc as monitoring-only (follow-up to the 2026-06-14
-- freeze-detection investigation, ADR-0024).
--
-- ONyc (OnRe reinsurance-yield RWA) is public but its MARKET leg is frozen: the
-- Jupiter quote sits at a single value for ~20h (no recent fills — the RWA has
-- no liquid secondary market) while only its NAV intrinsic (Pyth
-- Crypto.NAV.ONYC/USD) updates. With a stale market leg the public peg signal
-- cannot detect a real ONyc market move — the same "frozen leg / can't detect
-- stress" property that put hyloSOL+ on monitoring-only (migration 0049).
--
-- Per ADR-0024 the right handling is curation, not an automated freeze detector
-- (a constant discount is a continuum — healthy illiquid/RWA assets sit constant
-- for hours, so no threshold separates frozen from healthy). Contain ONyc until
-- it has a reliable market/depth source (liquidity gate, TIER 2). Idempotent.

UPDATE assets
SET metadata = metadata || jsonb_build_object(
  'monitoring_only', true,
  'monitoring_since', '2026-06-14',
  'monitoring_reason', 'Public RWA with a frozen market leg (no liquid secondary market; the quote sits at one value for ~20h) — cannot detect a real market move. Contained pending a reliable market/depth source.'
)
WHERE symbol = 'ONyc';
