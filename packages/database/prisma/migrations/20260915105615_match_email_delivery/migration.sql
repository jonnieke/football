BEGIN;
ALTER TABLE alert_recipients ADD COLUMN match_alerts BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE match_email_deliveries (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL,
  recipient_id UUID NOT NULL,
  recipient_version INTEGER NOT NULL,
  email VARCHAR(254) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','cancelled','expired','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP(3) NOT NULL,
  locked_until TIMESTAMP(3),
  lease_token UUID,
  provider_id TEXT,
  last_error_code TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP(3)
);
CREATE UNIQUE INDEX match_email_deliveries_event_id_recipient_id_key ON match_email_deliveries(event_id, recipient_id);
CREATE INDEX match_email_deliveries_status_available_at_idx ON match_email_deliveries(status, available_at);
CREATE INDEX match_email_deliveries_created_at_id_idx ON match_email_deliveries(created_at, id);
ALTER TABLE match_email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON match_email_deliveries FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON match_email_deliveries FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON match_email_deliveries FROM authenticated';
  END IF;
END $$;
COMMIT;
