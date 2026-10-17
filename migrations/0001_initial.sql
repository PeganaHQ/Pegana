-- Pegana — initial schema
--
-- Requires: Postgres 16 + TimescaleDB extension.
-- Apply with: sqlx migrate run --source migrations

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============== ENUMS ===============

CREATE TYPE asset_class AS ENUM (
    'lst',
    'stable_fiat',
    'stable_cdp',
    'stable_rwa',
    'stable_dn',
    'stable_fx'
);

CREATE TYPE peg_target AS ENUM ('SOL', 'USD', 'BRL', 'EUR');
CREATE TYPE token_program AS ENUM ('spl', 'token_2022');
CREATE TYPE peg_state AS ENUM (
    'PEGGED', 'DRIFT', 'DEPEG', 'CRITICAL', 'BLACK_SWAN', 'UNKNOWN'
);

-- =============== CATALOG ===============

CREATE TABLE assets (
    symbol         TEXT          PRIMARY KEY,
    mint           TEXT          NOT NULL UNIQUE,
    name           TEXT          NOT NULL,
    class          asset_class   NOT NULL,
    peg_target     peg_target    NOT NULL,
    decimals       SMALLINT      NOT NULL CHECK (decimals BETWEEN 0 AND 18),
    token_program  token_program NOT NULL DEFAULT 'spl',
    intrinsic_kind TEXT          NOT NULL,
    intrinsic_cfg  JSONB         NOT NULL DEFAULT '{}'::jsonb,
    market_kind    TEXT          NOT NULL DEFAULT 'jupiter_usd',
    market_cfg     JSONB         NOT NULL DEFAULT '{}'::jsonb,
    pyth_feed_id   TEXT,
    thresholds     JSONB         NOT NULL,
    is_active      BOOLEAN       NOT NULL DEFAULT TRUE,
    added_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    metadata       JSONB         NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX assets_active_class_idx ON assets(class, is_active) WHERE is_active;
CREATE INDEX assets_peg_idx          ON assets(peg_target);

-- =============== SNAPSHOTS (hypertables) ===============

CREATE TABLE intrinsic_snapshots (
    asset       TEXT           NOT NULL REFERENCES assets(symbol),
    value_usd   NUMERIC(30,18) NOT NULL,
    source      TEXT           NOT NULL,
    meta        JSONB,
    slot        BIGINT,
    ts          TIMESTAMPTZ    NOT NULL,
    PRIMARY KEY (asset, source, ts)
);
SELECT create_hypertable('intrinsic_snapshots', 'ts', chunk_time_interval => INTERVAL '1 day');
SELECT add_retention_policy('intrinsic_snapshots', INTERVAL '90 days');

CREATE TABLE market_snapshots (
    asset            TEXT           NOT NULL REFERENCES assets(symbol),
    value_usd        NUMERIC(30,18) NOT NULL,
    numeraire        TEXT           NOT NULL,
    raw_in           NUMERIC(30,0),
    raw_out          NUMERIC(30,0),
    price_impact_pct NUMERIC(10,6),
    route_label      TEXT,
    ts               TIMESTAMPTZ    NOT NULL,
    PRIMARY KEY (asset, ts)
);
SELECT create_hypertable('market_snapshots', 'ts', chunk_time_interval => INTERVAL '1 day');
SELECT add_retention_policy('market_snapshots', INTERVAL '90 days');

CREATE TABLE oracle_snapshots (
    feed         TEXT           NOT NULL,
    feed_id      TEXT           NOT NULL,
    price        NUMERIC(30,18) NOT NULL,
    confidence   NUMERIC(30,18),
    publish_time TIMESTAMPTZ    NOT NULL,
    PRIMARY KEY (feed, publish_time)
);
SELECT create_hypertable('oracle_snapshots', 'publish_time', chunk_time_interval => INTERVAL '1 day');
SELECT add_retention_policy('oracle_snapshots', INTERVAL '90 days');

CREATE TABLE discount_snapshots (
    asset           TEXT           NOT NULL REFERENCES assets(symbol),
    discount_raw    NUMERIC(10,6)  NOT NULL,
    discount_smooth NUMERIC(10,6)  NOT NULL,
    oracle_discount NUMERIC(10,6),
    state           peg_state      NOT NULL,
    confidence      TEXT           NOT NULL,
    intrinsic_usd   NUMERIC(30,18) NOT NULL,
    market_usd      NUMERIC(30,18) NOT NULL,
    extra           JSONB,
    ts              TIMESTAMPTZ    NOT NULL,
    PRIMARY KEY (asset, ts)
);
SELECT create_hypertable('discount_snapshots', 'ts', chunk_time_interval => INTERVAL '1 day');
SELECT add_retention_policy('discount_snapshots', INTERVAL '365 days');

-- Continuous aggregate: 1-min buckets per asset
CREATE MATERIALIZED VIEW discount_1m
WITH (timescaledb.continuous) AS
SELECT
    asset,
    time_bucket(INTERVAL '1 minute', ts) AS bucket,
    avg(discount_smooth) AS avg_discount,
    min(discount_smooth) AS min_discount,
    max(discount_smooth) AS max_discount,
    last(state, ts)      AS end_state
FROM discount_snapshots
GROUP BY asset, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'discount_1m',
    start_offset      => INTERVAL '1 hour',
    end_offset        => INTERVAL '1 minute',
    schedule_interval => INTERVAL '30 seconds'
);

-- =============== USERS / SUBSCRIPTIONS / ALERTS ===============

CREATE TABLE users (
    id              BIGSERIAL    PRIMARY KEY,
    telegram_id     BIGINT       UNIQUE,
    chat_id         BIGINT       NOT NULL,
    username        TEXT,
    locale          TEXT         NOT NULL DEFAULT 'pt-BR',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    is_blocked      BOOLEAN      NOT NULL DEFAULT FALSE
);
CREATE INDEX users_chat_idx ON users(chat_id);

CREATE TABLE subscriptions (
    id              BIGSERIAL    PRIMARY KEY,
    user_id         BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset           TEXT         NOT NULL REFERENCES assets(symbol),
    threshold_bps   INT          NOT NULL CHECK (threshold_bps > 0),
    min_confidence  TEXT         NOT NULL DEFAULT 'low',
    channel         TEXT         NOT NULL DEFAULT 'telegram',
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_fired_at   TIMESTAMPTZ,
    UNIQUE(user_id, asset, threshold_bps, channel)
);
CREATE INDEX subscriptions_active_asset_idx ON subscriptions(asset, is_active) WHERE is_active;
CREATE INDEX subscriptions_user_idx         ON subscriptions(user_id);

CREATE TABLE alerts (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    asset           TEXT         NOT NULL REFERENCES assets(symbol),
    class           asset_class  NOT NULL,
    from_state      peg_state    NOT NULL,
    to_state        peg_state    NOT NULL,
    discount        NUMERIC(10,6),
    intrinsic_usd   NUMERIC(30,18) NOT NULL,
    market_usd      NUMERIC(30,18) NOT NULL,
    confidence      TEXT         NOT NULL,
    context_slot    BIGINT,
    detected_at     TIMESTAMPTZ  NOT NULL,
    dispatched_at   TIMESTAMPTZ,
    dispatch_count  INT          NOT NULL DEFAULT 0,
    payload         JSONB        NOT NULL
);
CREATE INDEX alerts_asset_recent_idx     ON alerts(asset, detected_at DESC);
CREATE INDEX alerts_pending_idx          ON alerts(detected_at DESC) WHERE dispatched_at IS NULL;

CREATE TABLE alert_deliveries (
    id              BIGSERIAL    PRIMARY KEY,
    alert_id        UUID         NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    subscription_id BIGINT       NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    channel         TEXT         NOT NULL,
    status          TEXT         NOT NULL,
    error           TEXT,
    attempted_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);
CREATE INDEX deliveries_alert_idx  ON alert_deliveries(alert_id);
CREATE INDEX deliveries_queued_idx ON alert_deliveries(status, attempted_at) WHERE status = 'queued';

-- =============== Hylo-specific state (CR history) ===============

CREATE TABLE hylo_state_snapshots (
    ts                TIMESTAMPTZ    NOT NULL PRIMARY KEY,
    cr                NUMERIC(10,6)  NOT NULL,
    hyusd_supply      NUMERIC(30,0)  NOT NULL,
    reserve_sol       NUMERIC(30,9)  NOT NULL,
    reserve_usd       NUMERIC(30,18) NOT NULL,
    stability_mode    SMALLINT       NOT NULL DEFAULT 0,
    stability_pool    NUMERIC(30,0)  NOT NULL DEFAULT 0,
    xsol_supply       NUMERIC(30,9)  NOT NULL DEFAULT 0,
    raw_state         JSONB
);
SELECT create_hypertable('hylo_state_snapshots', 'ts', chunk_time_interval => INTERVAL '7 days');
SELECT add_retention_policy('hylo_state_snapshots', INTERVAL '365 days');

-- =============== IDL drift tracking (D6) ===============

CREATE TABLE idl_snapshots (
    program     TEXT         PRIMARY KEY,
    idl_hash    TEXT         NOT NULL,
    idl_raw     JSONB        NOT NULL,
    fetched_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
