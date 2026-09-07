CREATE TABLE "work_outbox" (
  "id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "prepared_data" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "paused_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_outbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "work_outbox_dedupe_key_key" ON "work_outbox"("dedupe_key");
CREATE INDEX "work_outbox_completed_at_paused_at_available_at_id_idx"
  ON "work_outbox"("completed_at", "paused_at", "available_at", "id");

-- Recover canonical events stranded by the old commit-then-enqueue handoff.
-- Do not automatically reinterpret historical fixture snapshots.
INSERT INTO "work_outbox" ("id", "kind", "dedupe_key", "payload")
SELECT gen_random_uuid(), 'content_generation', 'content-' || e."id"::text,
       jsonb_build_object('eventId', e."id"::text)
FROM "football_events" e
WHERE NOT EXISTS (SELECT 1 FROM "content_items" c WHERE c."event_id" = e."id");
