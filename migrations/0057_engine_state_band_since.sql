-- Spec 03 (persistence / time-below-peg). band_since = when the asset last
-- ENTERED its current committed FSM band. Nullable: unknown until the first
-- committed transition, and NULL for a pre-migration row (→ treated as
-- "not sustained" until the next genuine transition stamps it). Engine runtime
-- cache, NOT a replay input (same as the rest of engine_state_snapshot,
-- ADR-0010) — it does NOT enter the receipt.
ALTER TABLE engine_state_snapshot ADD COLUMN band_since TIMESTAMPTZ;

-- Backfill (review finding F1). The engine only stamps band_since GOING FORWARD,
-- so without this an asset ALREADY in a long episode at migrate time (e.g. a
-- months-old DRIFT) would show no duration until its NEXT transition — making the
-- time-below-peg signal invisible for exactly the assets it is meant to surface
-- on day one. Derive the current band's entry time from discount_snapshots: the
-- boundary of the current contiguous run of `last_state` = the most recent ts the
-- asset was in a DIFFERENT state (the same "since" logic the /v1/assets state()
-- endpoint uses). Fall back to the earliest snapshot when the asset has only ever
-- been in its current state; leave NULL (→ "not sustained") when there is no
-- snapshot history. Bounded by discount_snapshots' 365-day retention — duration
-- cannot predate when Pegana began tracking the asset, which is the honest bound.
-- discount_snapshots.state is the COMMITTED final_state (persist_discount writes
-- it), so it aligns with engine_state_snapshot.last_state.
UPDATE engine_state_snapshot e
SET band_since = COALESCE(
        (SELECT max(d.ts) FROM discount_snapshots d
         WHERE d.asset = e.asset AND d.state::text <> e.last_state),
        (SELECT min(d.ts) FROM discount_snapshots d
         WHERE d.asset = e.asset)
    )
WHERE e.band_since IS NULL;
