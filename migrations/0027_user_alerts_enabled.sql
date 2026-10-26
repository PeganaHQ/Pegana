-- Per-user global on/off switch for alert delivery.
--
-- Sits ABOVE the per-subscription mute/snooze: when alerts_enabled=FALSE,
-- the dispatcher skips delivery to this user regardless of their active
-- subscriptions. This is the user's "I don't want to be pinged at all
-- right now" knob — distinct from /mute (per-asset) and /snooze (all,
-- timed). New users default to TRUE so an opt-in /start still wakes up
-- subscribed users; existing rows backfill to TRUE.
--
-- Public-mode (FEATURE_PUBLIC_ALERTS=true) honors this flag. Dogfood
-- mode bypasses subscription matching entirely and goes straight to the
-- configured chat — by design — so the flag only takes effect when
-- multiple users are involved.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE;
