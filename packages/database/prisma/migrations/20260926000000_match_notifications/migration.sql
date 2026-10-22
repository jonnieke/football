BEGIN;
ALTER TABLE fixtures
  ADD COLUMN notifications_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN notification_version INTEGER NOT NULL DEFAULT 1 CHECK (notification_version > 0),
  ADD COLUMN notification_changed_at TIMESTAMP(3),
  ADD COLUMN notification_changed_by VARCHAR(254);
COMMIT;
