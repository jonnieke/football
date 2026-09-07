BEGIN;
LOCK TABLE "content_items" IN ACCESS EXCLUSIVE MODE;

-- Refuse to accidentally publish inconsistent legacy rows during backfill.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM content_items WHERE status = 'published' AND published_at IS NULL) THEN
    RAISE EXCEPTION 'Published content without a timestamp requires operator reconciliation before feed migration';
  END IF;
END $$;

CREATE TABLE "feed_publication_state" (
  "id" INTEGER PRIMARY KEY CHECK (id = 1),
  "epoch" UUID NOT NULL,
  "high_water" BIGINT NOT NULL DEFAULT 0 CHECK (high_water >= 0)
);
ALTER TABLE "content_items" ADD COLUMN "publication_sequence" BIGINT;
ALTER TABLE "content_items" ADD COLUMN "event_type" TEXT;
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY published_at, id) AS position
  FROM content_items WHERE published_at IS NOT NULL
)
UPDATE content_items AS item SET publication_sequence = ordered.position,
  event_type = event.event_type
FROM ordered, football_events AS event
WHERE item.id = ordered.id AND item.event_id = event.id;
INSERT INTO feed_publication_state (id, epoch, high_water)
SELECT 1, gen_random_uuid(), COALESCE(max(publication_sequence), 0) FROM content_items;
CREATE UNIQUE INDEX "content_items_publication_sequence_key" ON "content_items"("publication_sequence");
CREATE INDEX "content_items_channel_publication_sequence_idx" ON "content_items"("channel", "publication_sequence");
CREATE INDEX "content_items_event_type_publication_sequence_idx" ON "content_items"("event_type", "publication_sequence");
ALTER TABLE content_items ADD CONSTRAINT content_publication_shape CHECK (
  (publication_sequence IS NULL AND event_type IS NULL AND status <> 'published')
  OR (publication_sequence IS NOT NULL AND publication_sequence > 0 AND event_type IS NOT NULL AND published_at IS NOT NULL)
);

CREATE FUNCTION assign_feed_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE position BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.publication_sequence IS NOT NULL THEN
      RAISE EXCEPTION 'Published feed items cannot be deleted; append an editorial correction';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.publication_sequence IS NOT NULL THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Published feed items are immutable; append an editorial correction';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.publication_sequence IS NOT NULL OR NEW.event_type IS NOT NULL THEN
    RAISE EXCEPTION 'Publication metadata is assigned by the database';
  END IF;
  IF NEW.status = 'published' THEN
    -- This is a transactional row update, NOT nextval(). Its row lock remains
    -- held until commit/rollback, so a higher position cannot commit first.
    EXECUTE format('UPDATE %I.feed_publication_state SET high_water = high_water + 1 WHERE id = 1 RETURNING high_water', TG_TABLE_SCHEMA) INTO position;
    IF position IS NULL THEN RAISE EXCEPTION 'Feed publication state is missing'; END IF;
    NEW.publication_sequence := position;
    EXECUTE format('SELECT event_type FROM %I.football_events WHERE id = $1', TG_TABLE_SCHEMA) INTO NEW.event_type USING NEW.event_id;
    NEW.published_at := COALESCE(NEW.published_at, clock_timestamp());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER content_feed_publication BEFORE INSERT OR UPDATE OR DELETE ON content_items
FOR EACH ROW EXECUTE FUNCTION assign_feed_publication();
COMMIT;
