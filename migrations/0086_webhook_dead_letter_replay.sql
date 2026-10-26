-- Replayable dead letters: deliveries deferred while a subscriber's circuit
-- breaker was open (or its backlog/queue was full) are re-sent when it is
-- healthy again.
--   replayed_at      set when the deferred delivery was re-sent
--   event_id         original x-pegana-event-id (NULL = the alert id), so a
--                    replayed retraction or evidence follow-up keeps its own id
--   replay_attempts  permanent rejections (HTTP 4xx other than 408/429) seen
--   replay_failed_at set after repeated permanent rejections: the row is given
--                    up on so one poison payload cannot stall the rest
ALTER TABLE webhook_dead_letter
    ADD COLUMN IF NOT EXISTS replayed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS event_id UUID,
    ADD COLUMN IF NOT EXISTS replay_attempts SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS replay_failed_at TIMESTAMPTZ;

-- Same predicate literals as the replay queries, so the planner can use it.
CREATE INDEX IF NOT EXISTS webhook_dl_unreplayed_idx
    ON webhook_dead_letter (subscription_id, failed_at)
    WHERE replayed_at IS NULL AND last_error LIKE 'deferred:%';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pegana_dispatcher') THEN
        GRANT SELECT ON webhook_dead_letter TO pegana_dispatcher;
        GRANT UPDATE (replayed_at, replay_attempts, replay_failed_at)
            ON webhook_dead_letter TO pegana_dispatcher;
    END IF;
END
$$;
