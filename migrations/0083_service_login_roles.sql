-- 0083 — Per-service LOGIN roles and trimmed group grants.
--
-- Migration 0072 created NOLOGIN privilege groups. This migration:
--   1. trims grants that no service uses (api-rs writes nothing; the
--      dispatcher only stamps alerts.dispatched_at),
--   2. adds the SELECT grants the services read but 0072 left out,
--   3. creates one LOGIN role per service, member of exactly one group.
--
-- The LOGIN roles are created WITHOUT a password, so they cannot authenticate
-- until scripts/provision-service-credentials.sh sets one on the box (generated there,
-- written only to the box .env, never printed). Until then the services keep
-- using the bootstrap role, so applying this migration changes nothing at
-- runtime. Roles that already exist keep their password; their attributes are
-- normalised.

-- 1. Trim over-grants. api-rs writes nothing and reads none of the user /
-- webhook / session tables, so drop every privilege on them. Each statement is
-- guarded by to_regclass, so the file stays re-runnable after migration 0084
-- has dropped some of these tables.
DO $trim$
DECLARE
    t text;
    q text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'users', 'subscriptions', 'web_sessions', 'bot_magic_links',
        'webhook_subscriptions', 'webhook_deliveries', 'webhook_dead_letter'
    ]
    LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
            EXECUTE format('REVOKE INSERT, UPDATE, DELETE, SELECT ON public.%I FROM pegana_api', t);
        END IF;
    END LOOP;
    FOREACH q IN ARRAY ARRAY['users_id_seq', 'subscriptions_id_seq', 'webhook_deliveries_id_seq']
    LOOP
        IF to_regclass('public.' || q) IS NOT NULL THEN
            EXECUTE format('REVOKE USAGE ON SEQUENCE public.%I FROM pegana_api', q);
        END IF;
    END LOOP;
END
$trim$;

REVOKE UPDATE ON alerts FROM pegana_dispatcher;
GRANT UPDATE (dispatched_at) ON alerts TO pegana_dispatcher;

-- 2. Reads the services perform that 0072 did not grant.
GRANT SELECT ON engine_state_snapshot TO pegana_api;
GRANT SELECT ON assets, alert_evidence, alert_evidence_pending, alert_events TO pegana_mcp;
GRANT SELECT ON discount_1m TO pegana_mcp;

-- mcp get_asset_history reads the discount_1m continuous aggregate. Make it a
-- real-time aggregate so the newest minute or two (not yet materialised) are
-- included. Idempotent; skipped on a database without the aggregate.
DO $rt$
BEGIN
    IF EXISTS (SELECT 1 FROM timescaledb_information.continuous_aggregates WHERE view_name = 'discount_1m') THEN
        ALTER MATERIALIZED VIEW discount_1m SET (timescaledb.materialized_only = false);
    END IF;
END
$rt$;
GRANT SELECT ON discount_snapshots TO pegana_engine;
GRANT SELECT ON market_snapshots, intrinsic_liveness TO pegana_indexer;

-- Tables created by later migrations (as the migration owner) stay readable by
-- the backup role without a new grant each time.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO pegana_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO pegana_backup;

-- 3. LOGIN roles, one per service, no password yet.
DO $login$
DECLARE
    spec record;
BEGIN
    FOR spec IN
        SELECT * FROM (VALUES
            ('pegana_api_login',               'pegana_api',               30),
            ('pegana_mcp_login',               'pegana_mcp',               15),
            ('pegana_indexer_login',           'pegana_indexer',           20),
            ('pegana_engine_login',            'pegana_engine',            15),
            ('pegana_dispatcher_login',        'pegana_dispatcher',        25),
            ('pegana_protocol_indexer_login',  'pegana_protocol_indexer',  15)
        ) AS t(login_role, grp, conn_limit)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = spec.login_role) THEN
            EXECUTE format('CREATE ROLE %I', spec.login_role);
        END IF;
        -- Set the attributes unconditionally so a role created earlier by hand
        -- is normalised too. The password is left untouched. Limits sit above the
        -- services' pool sizes (api 25, dispatcher 20, indexer 15, engine 10).
        EXECUTE format(
            'ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT %s',
            spec.login_role, spec.conn_limit);
        IF NOT pg_has_role(spec.login_role, spec.grp, 'MEMBER') THEN
            EXECUTE format('GRANT %I TO %I', spec.grp, spec.login_role);
        END IF;
    END LOOP;
END
$login$;

COMMENT ON ROLE pegana_api_login IS 'LOGIN role for api-rs (member of pegana_api). Password is set by scripts/provision-service-credentials.sh.';
COMMENT ON ROLE pegana_mcp_login IS 'LOGIN role for mcp-ts (member of pegana_mcp). Password is set by scripts/provision-service-credentials.sh.';
COMMENT ON ROLE pegana_indexer_login IS 'LOGIN role for indexer-rs (member of pegana_indexer). Password is set by scripts/provision-service-credentials.sh.';
COMMENT ON ROLE pegana_engine_login IS 'LOGIN role for engine-rs (member of pegana_engine). Password is set by scripts/provision-service-credentials.sh.';
COMMENT ON ROLE pegana_dispatcher_login IS 'LOGIN role for dispatcher-rs (member of pegana_dispatcher). Password is set by scripts/provision-service-credentials.sh.';
COMMENT ON ROLE pegana_protocol_indexer_login IS 'LOGIN role for protocol-indexer-ts (member of pegana_protocol_indexer). Password is set by scripts/provision-service-credentials.sh.';
