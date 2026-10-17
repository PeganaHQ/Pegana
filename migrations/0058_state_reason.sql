-- state_reason: advisory machine-readable reason for the snapshot's state.
-- Nullable + additive; legacy rows stay NULL. Not part of any receipt hash.
ALTER TABLE discount_snapshots ADD COLUMN IF NOT EXISTS state_reason text;
