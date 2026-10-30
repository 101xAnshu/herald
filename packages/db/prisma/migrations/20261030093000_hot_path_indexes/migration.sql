-- Partial indexes for the non-terminal subset that operational queries touch.
CREATE INDEX IF NOT EXISTS notifications_scheduler_partial_idx
  ON notifications (status, scheduled_for)
  WHERE status NOT IN ('delivered', 'failed', 'canceled', 'suppressed');

CREATE INDEX IF NOT EXISTS deliveries_retry_partial_idx
  ON deliveries (status, next_attempt_at)
  WHERE status IN ('pending', 'retry_scheduled', 'unknown');

CREATE INDEX IF NOT EXISTS outbox_unpublished_idx
  ON outbox (status, available_at, id)
  WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS inbox_items_unread_partial_idx
  ON inbox_items (user_id, sequence DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS retry_schedules_due_partial_idx
  ON retry_schedules (due_at)
  WHERE state = 'pending';

CREATE INDEX IF NOT EXISTS campaigns_scheduler_partial_idx
  ON campaigns (scheduled_for)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS users_campaign_partial_idx
  ON users (city, last_booking_at)
  WHERE kind = 'customer';
