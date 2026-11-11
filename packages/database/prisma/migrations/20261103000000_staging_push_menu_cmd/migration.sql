BEGIN;

ALTER TABLE "staging_push_deliveries"
  DROP CONSTRAINT IF EXISTS "staging_push_deliveries_menu_cmd_check",
  ALTER COLUMN "menu_cmd" TYPE VARCHAR(100),
  ALTER COLUMN "menu_cmd" SET DEFAULT 'All Day News/LiveScores',
  ADD CONSTRAINT "staging_push_deliveries_menu_cmd_check"
    CHECK (char_length(btrim("menu_cmd")) > 0);

CREATE OR REPLACE FUNCTION enqueue_staging_push_on_publish() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE publish_ts TIMESTAMP(3);
BEGIN
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published')
     AND char_length(NEW.short_text) BETWEEN 1 AND 150 THEN
    publish_ts := COALESCE(NEW.published_at, clock_timestamp());
    EXECUTE format(
      'INSERT INTO %I.staging_push_deliveries (id, content_id, message, menu_cmd, uploaded_by, created_at, available_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $6, $7) ON CONFLICT (content_id) DO NOTHING',
      TG_TABLE_SCHEMA
    )
    USING gen_random_uuid(),
          NEW.id,
          NEW.short_text,
          'All Day News/LiveScores',
          'Football Content Platform',
          publish_ts,
          publish_ts + interval '10 minutes';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS content_staging_push_enqueue ON "content_items";
CREATE TRIGGER content_staging_push_enqueue
  AFTER INSERT OR UPDATE ON "content_items"
  FOR EACH ROW EXECUTE FUNCTION enqueue_staging_push_on_publish();

COMMIT;
