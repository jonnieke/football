BEGIN;
ALTER TABLE competitions ADD COLUMN coverage_version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE competition_audit (
  id UUID PRIMARY KEY,
  competition_id UUID NOT NULL REFERENCES competitions(id),
  actor VARCHAR(254) NOT NULL,
  action TEXT NOT NULL,
  before JSONB,
  after JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX competition_audit_created_id_idx ON competition_audit(created_at DESC, id DESC);
ALTER TABLE competition_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON competition_audit FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON competition_audit FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON competition_audit FROM authenticated';
  END IF;
END $$;
COMMIT;
