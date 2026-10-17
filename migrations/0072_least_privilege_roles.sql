-- 0072 — Phase 1 least-privilege service group roles.
--
-- These NOLOGIN roles only establish privilege groups. Provision LOGIN roles,
-- grant each LOGIN membership in exactly one group, and cut over service
-- DATABASE_URL credentials separately. Existing bootstrap privileges are not
-- revoked in this phase.

DO $roles$
DECLARE
    role_name text;
BEGIN
    FOREACH role_name IN ARRAY ARRAY[
        'pegana_api',
        'pegana_mcp',
        'pegana_bot',
        'pegana_indexer',
        'pegana_engine',
        'pegana_dispatcher',
        'pegana_protocol_indexer',
        'pegana_backup'
    ]
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format('CREATE ROLE %I NOLOGIN', role_name);
        END IF;
    END LOOP;
END
$roles$;

COMMENT ON ROLE pegana_api IS 'NOLOGIN privilege group for api-rs; attach a separately provisioned LOGIN role during credential cutover.';
COMMENT ON ROLE pegana_mcp IS 'NOLOGIN privilege group for mcp-ts; attach a separately provisioned LOGIN role during credential cutover.';
COMMENT ON ROLE pegana_bot IS 'NOLOGIN privilege group for bot-ts; attach a separately provisioned LOGIN role during credential cutover.';
COMMENT ON ROLE pegana_indexer IS 'NOLOGIN privilege group for indexer-rs; attach a separately provisioned LOGIN role during credential cutover.';
COMMENT ON ROLE pegana_engine IS 'NOLOGIN privilege group for engine-rs; attach a separately provisioned LOGIN role during credential cutover.';
COMMENT ON ROLE pegana_dispatcher IS 'NOLOGIN privilege group for dispatcher-rs; attach a separately provisioned LOGIN role during credential cutover.';
COMMENT ON ROLE pegana_protocol_indexer IS 'NOLOGIN privilege group for protocol-indexer-ts; attach a separately provisioned LOGIN role during credential cutover.';
COMMENT ON ROLE pegana_backup IS 'NOLOGIN read-only privilege group for pg_dump; attach a separately provisioned LOGIN role during backup credential cutover.';

GRANT USAGE ON SCHEMA public TO
    pegana_api,
    pegana_mcp,
    pegana_bot,
    pegana_indexer,
    pegana_engine,
    pegana_dispatcher,
    pegana_protocol_indexer,
    pegana_backup;

GRANT SELECT ON
    assets,
    intrinsic_snapshots,
    market_snapshots,
    oracle_snapshots,
    discount_snapshots,
    discount_1m,
    alerts,
    alert_deliveries,
    alert_evidence,
    alert_evidence_pending,
    methodology_versions,
    hylo_state_snapshots,
    users,
    subscriptions,
    web_sessions,
    bot_magic_links,
    webhook_subscriptions,
    webhook_deliveries,
    webhook_dead_letter,
    liquidity_observations,
    loop_exposure_snapshots,
    loop_hf_distribution
TO pegana_api;
GRANT INSERT ON users, subscriptions, web_sessions, bot_magic_links, webhook_subscriptions, webhook_deliveries, webhook_dead_letter TO pegana_api;
GRANT UPDATE ON users, subscriptions, web_sessions, bot_magic_links, webhook_subscriptions TO pegana_api;
GRANT DELETE ON subscriptions, webhook_subscriptions TO pegana_api;
GRANT USAGE, SELECT ON SEQUENCE users_id_seq, subscriptions_id_seq, webhook_deliveries_id_seq TO pegana_api;

GRANT SELECT ON discount_snapshots, alerts TO pegana_mcp;
GRANT INSERT ON mcp_call_log TO pegana_mcp;
GRANT USAGE, SELECT ON SEQUENCE mcp_call_log_id_seq TO pegana_mcp;

GRANT SELECT ON assets, users, subscriptions, alerts, discount_snapshots, bot_runtime_kv, bot_sessions TO pegana_bot;
GRANT SELECT (key, expires_at) ON bot_idempotency TO pegana_bot;
GRANT SELECT (attempted_at) ON alert_deliveries TO pegana_bot;
GRANT INSERT ON users, subscriptions, bot_idempotency, bot_runtime_kv, bot_sessions TO pegana_bot;
GRANT UPDATE ON users, subscriptions, bot_runtime_kv, bot_sessions TO pegana_bot;
GRANT DELETE ON subscriptions, bot_idempotency, bot_sessions, alert_deliveries TO pegana_bot;
GRANT USAGE, SELECT ON SEQUENCE users_id_seq, subscriptions_id_seq TO pegana_bot;

GRANT SELECT ON intrinsic_snapshots, assets TO pegana_indexer;
GRANT INSERT ON intrinsic_snapshots, market_snapshots, oracle_snapshots, hylo_state_snapshots, liquidity_observations, intrinsic_liveness TO pegana_indexer;
GRANT UPDATE ON assets, intrinsic_liveness TO pegana_indexer;

GRANT SELECT ON assets, intrinsic_liveness, methodology_versions, engine_state_snapshot, alerts, alert_evidence, alert_evidence_pending, alert_evidence_commit_failures TO pegana_engine;
GRANT INSERT ON methodology_versions, engine_state_snapshot, discount_snapshots, alerts, alert_evidence, alert_evidence_pending, alert_evidence_commit_failures TO pegana_engine;
GRANT UPDATE ON engine_state_snapshot, alert_evidence, alert_evidence_pending, alert_evidence_commit_failures TO pegana_engine;
GRANT DELETE ON alert_evidence_pending TO pegana_engine;

GRANT SELECT ON assets, users, subscriptions, alerts, alert_deliveries, alert_evidence, alert_evidence_pending, webhook_subscriptions, webhook_deliveries, retractions TO pegana_dispatcher;
GRANT INSERT ON alert_deliveries, webhook_deliveries, webhook_dead_letter TO pegana_dispatcher;
GRANT UPDATE ON alerts, webhook_subscriptions, retractions TO pegana_dispatcher;
GRANT USAGE, SELECT ON SEQUENCE alert_deliveries_id_seq, webhook_deliveries_id_seq TO pegana_dispatcher;

GRANT SELECT ON assets TO pegana_protocol_indexer;
GRANT INSERT, UPDATE ON loop_exposure_snapshots, loop_hf_distribution TO pegana_protocol_indexer;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO pegana_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO pegana_backup;

-- Compose and deploy.sh run migrations as the configurable POSTGRES_USER, so the
-- schema/migration owner cannot be named safely here. Future tables and sequences
-- are therefore not covered by this migration. During LOGIN-role cutover, add
-- ALTER DEFAULT PRIVILEGES for the actual migration owner so pegana_backup keeps
-- SELECT access to objects that owner creates.
