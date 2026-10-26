-- 0084 — Remove the legacy Telegram-bot / web-session / API-key tables.
--
-- The bot, the console login and the API-key rail were removed from the
-- product; no service reads or writes these tables (verified against
-- crates/, mcp-ts/ and protocol-indexer-ts/), yet they still held personal
-- identifiers (Telegram ids, chat ids, usernames, session user agents and IPs)
-- and flowed into every backup.
--
--   dropped:  api_key_daily_usage, api_keys, web_sessions, bot_magic_links,
--             bot_sessions, bot_runtime_kv, bot_idempotency
--   scrubbed: users (telegram_id, chat_id, username); chat ids quoted in
--             alert_deliveries.error (see "Scrub rule" below). The tables stay because
--             webhook_subscriptions.user_id and the subscriptions /
--             alert_deliveries foreign keys still point at them.
--
-- This is irreversible, so everything below is ONE statement (a single DO
-- block): the guard, the drops and the scrubs succeed or fail together, even
-- when the file is applied without ON_ERROR_STOP. While any row would be
-- removed or scrubbed, the migration refuses to run unless the database
-- setting pegana.allow_pii_drop equals the EXACT total row count it reports
-- in its error message ('on' is not accepted). See the owner checklist in
-- docs/ops/2026-10-23-a1-owner-actions.md (set it with ALTER DATABASE, run
-- deploy.sh --migrate, RESET it again). Apply 0083 first: it revokes grants
-- on tables dropped here.
-- Scrub rule for alert_deliveries.error (the same definition is used by the
-- owner checklist's count query, step 17b; keep them identical):
--   1. any chat-id mention: case-insensitive
--      chat[_ ]?id"?\s*[=:( ]+\s*-?[0-9]+   (chat_id=5, "chat_id":5, ChatId(5), chat id: 5)
--      -> the number becomes [removed];
--   2. for rows with channel = 'telegram', any run of 6 or more digits
--      (optionally negative), the same threshold api-rs applies when it
--      redacts delivery errors in /v1/stats -> [removed].
-- Older backups, R2 archive/, local ~/backups and restore-drill databases keep
-- the data until they are handled separately.

DO $pii$
DECLARE
    t text;
    n bigint;
    total bigint := 0;
    scrub_users bigint := 0;
    scrub_errors bigint := 0;
    allowed text := coalesce(current_setting('pegana.allow_pii_drop', true), '');
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'api_key_daily_usage', 'api_keys', 'web_sessions', 'bot_magic_links',
        'bot_sessions', 'bot_runtime_kv', 'bot_idempotency'
    ]
    LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
            EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
            RAISE NOTICE '0084: % holds % row(s)', t, n;
            total := total + n;
        END IF;
    END LOOP;
    IF to_regclass('public.users') IS NOT NULL THEN
        SELECT count(*) INTO scrub_users FROM public.users
         WHERE telegram_id IS NOT NULL OR chat_id <> 0 OR username IS NOT NULL;
        RAISE NOTICE '0084: users has % row(s) with personal data', scrub_users;
        total := total + scrub_users;
    END IF;
    IF to_regclass('public.alert_deliveries') IS NOT NULL THEN
        SELECT count(*) INTO scrub_errors FROM public.alert_deliveries
         WHERE error ~* 'chat[_ ]?id"?\s*[=:( ]+\s*-?[0-9]+'
            OR (channel = 'telegram' AND error ~ '-?[0-9]{6,}');
        RAISE NOTICE '0084: alert_deliveries has % error text(s) quoting a chat id', scrub_errors;
        total := total + scrub_errors;
    END IF;

    IF total > 0 AND allowed <> total::text THEN
        RAISE EXCEPTION '0084 would remove or scrub % row(s) holding personal data; archive them, then set pegana.allow_pii_drop to exactly % (currently ''%'')',
            total, total, allowed;
    END IF;

    FOREACH t IN ARRAY ARRAY[
        'api_key_daily_usage', 'api_keys', 'web_sessions', 'bot_magic_links',
        'bot_sessions', 'bot_runtime_kv', 'bot_idempotency'
    ]
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS public.%I', t);
    END LOOP;

    IF to_regclass('public.users') IS NOT NULL THEN
        UPDATE public.users
           SET telegram_id = NULL, chat_id = 0, username = NULL
         WHERE telegram_id IS NOT NULL OR chat_id <> 0 OR username IS NOT NULL;
    END IF;
    IF to_regclass('public.alert_deliveries') IS NOT NULL THEN
        UPDATE public.alert_deliveries
           SET error = CASE
                 WHEN channel = 'telegram'
                   THEN regexp_replace(
                          regexp_replace(error, '(chat[_ ]?id"?\s*[=:( ]+\s*)-?[0-9]+', '\1[removed]', 'gi'),
                          '-?[0-9]{6,}', '[removed]', 'g')
                 ELSE regexp_replace(error, '(chat[_ ]?id"?\s*[=:( ]+\s*)-?[0-9]+', '\1[removed]', 'gi')
               END
         WHERE error ~* 'chat[_ ]?id"?\s*[=:( ]+\s*-?[0-9]+'
            OR (channel = 'telegram' AND error ~ '-?[0-9]{6,}');
    END IF;
END
$pii$;
