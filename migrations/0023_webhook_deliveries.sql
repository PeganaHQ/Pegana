-- 0023: Per-attempt webhook delivery log (Sprint 1c).
--
-- Sits alongside `webhook_dead_letter` but captures EVERY attempt,
-- success or fail. This is what backs `GET /v1/me/webhooks/{id}/deliveries`
-- and lets operators see latency / error trends without grepping logs.
--
-- Volume bound: each event = up to 6 retries × N matching subscriptions.
-- At v1 launch (~22 assets, single-digit subscribers per asset) this is
-- bounded in hundreds of rows/day. Retention is intentionally not
-- enforced here — schedule `DELETE FROM webhook_deliveries WHERE
-- attempted_at < now() - INTERVAL '30 days'` from cron once volume
-- justifies it. The `(subscription_id, attempted_at DESC)` index keeps
-- the operator query fast regardless.

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id              BIGSERIAL    PRIMARY KEY,
    subscription_id UUID         NOT NULL REFERENCES webhook_subscriptions(id),
    alert_id        UUID         NOT NULL,
    -- 1..max_attempts. SMALLINT — current cap is 6, headroom to 32k.
    attempt         SMALLINT     NOT NULL,
    -- NULL when the request never produced an HTTP response (DNS
    -- failure, timeout, TLS handshake, SSRF guard rejection).
    http_status     SMALLINT,
    elapsed_ms      INTEGER      NOT NULL,
    -- NULL on 2xx success; populated otherwise. Capped at 8 KiB by app
    -- code to avoid runaway HTML bodies from misconfigured receivers.
    error           TEXT,
    -- TRUE for deliveries triggered by `POST /v1/me/webhooks/{id}/test`.
    -- Lets `/deliveries` callers filter their operator-facing test
    -- traffic out of production-trend dashboards.
    is_test         BOOLEAN      NOT NULL DEFAULT FALSE,
    attempted_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_sub_time_idx
    ON webhook_deliveries (subscription_id, attempted_at DESC);
