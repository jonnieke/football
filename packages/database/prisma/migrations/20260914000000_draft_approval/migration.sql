BEGIN;
-- Existing published content remains immutable and visible. Never backfill
-- publication or reset feed cursors when enabling draft-first generation.
ALTER TABLE content_items ALTER COLUMN status SET DEFAULT 'draft';
CREATE INDEX content_items_drafts_id_idx ON content_items (id) WHERE status = 'draft';
CREATE TABLE content_approvals (
  id UUID PRIMARY KEY,
  content_id UUID NOT NULL UNIQUE REFERENCES content_items(id),
  actor VARCHAR(254) NOT NULL,
  fingerprint VARCHAR(64) NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- No browser Data API access. The existing trusted server connection owns writes.
ALTER TABLE content_approvals ENABLE ROW LEVEL SECURITY;
COMMIT;
