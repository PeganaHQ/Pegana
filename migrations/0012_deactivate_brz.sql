-- BRZ has no viable market source on Solana as of 2026-05-22:
--   * Jupiter returns TOKEN_NOT_TRADABLE for the mint
--   * DexScreener has zero pairs for it
-- assets.toml is the canonical source for indexer/engine; this just keeps
-- the API/dashboard in sync so BRZ doesn't appear in /v1/assets responses
-- with a stale CRITICAL state from 17h ago.
UPDATE assets SET is_active = false WHERE symbol = 'BRZ';
