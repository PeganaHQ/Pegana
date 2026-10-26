-- Alert content is append-only. The dispatcher may stamp dispatched_at once
-- after a successful delivery; all other changes and deletes are rejected.
-- A superuser can bypass this trigger (session_replication_role = replica or
-- ALTER TABLE ... DISABLE TRIGGER). Any future backfill must drop and recreate
-- the trigger inside the same migration.
CREATE OR REPLACE FUNCTION protect_alert_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'alerts rows cannot be deleted';
    END IF;

    IF OLD.dispatched_at IS NOT NULL
       OR NEW.dispatched_at IS NULL
       OR (to_jsonb(NEW) - 'dispatched_at') IS DISTINCT FROM
          (to_jsonb(OLD) - 'dispatched_at') THEN
        RAISE EXCEPTION 'alerts content cannot be changed';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS alerts_immutable ON alerts;
CREATE TRIGGER alerts_immutable
BEFORE UPDATE OR DELETE ON alerts
FOR EACH ROW EXECUTE FUNCTION protect_alert_row();
