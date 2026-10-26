-- Dogfood-mode deliveries don't correspond to a real `subscriptions` row.
-- Previously the dispatcher bound `subscription_id.max(1)` to satisfy the
-- NOT NULL + FK; that only worked by accident (assumes subscriptions.id=1
-- exists). Make the column nullable + drop the cascade so dogfood deliveries
-- can be logged honestly as "no subscription."
ALTER TABLE alert_deliveries
    ALTER COLUMN subscription_id DROP NOT NULL;
