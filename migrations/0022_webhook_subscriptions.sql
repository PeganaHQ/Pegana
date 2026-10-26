-- 0022: Webhook channel — subscription registry + dead-letter queue.
--
-- (0021 is reserved for the calibration threshold updates that come
-- out of Plan 1 Task E3 dogfood. If 0021 hasn't been written yet at
-- deploy time, this migration is still safe — strict numeric ordering
-- is preserved by the runner.)

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         BIGINT       NOT NULL REFERENCES users(id),
    url             TEXT         NOT NULL,
    asset           TEXT         NOT NULL REFERENCES assets(symbol),
    threshold_bps   INTEGER      NOT NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_fired_at   TIMESTAMPTZ,
    last_status     SMALLINT,
    UNIQUE (user_id, url, asset)
);

CREATE INDEX IF NOT EXISTS webhook_subs_active_asset_idx
    ON webhook_subscriptions(asset, is_active) WHERE is_active;

CREATE TABLE IF NOT EXISTS webhook_dead_letter (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID         NOT NULL REFERENCES webhook_subscriptions(id),
    alert_id        UUID         NOT NULL,
    payload         JSONB        NOT NULL,
    last_error      TEXT         NOT NULL,
    attempts        SMALLINT     NOT NULL,
    failed_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_dl_failed_at_idx
    ON webhook_dead_letter(failed_at);
