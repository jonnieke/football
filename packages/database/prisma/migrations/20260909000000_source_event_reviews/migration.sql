ALTER TABLE "fixtures" ADD COLUMN "source_review_version" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "source_event_reviews" (
  "id" UUID PRIMARY KEY,
  "fixture_id" UUID NOT NULL REFERENCES "fixtures"("id") ON DELETE RESTRICT,
  "fixture_state_id" UUID NOT NULL REFERENCES "fixture_states"("id") ON DELETE RESTRICT,
  "source_event_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "source_event" JSONB NOT NULL,
  "evidence" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "decided_by" TEXT,
  "decision_reason" TEXT,
  "decided_at" TIMESTAMP(3),
  "event_id" UUID REFERENCES "football_events"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "source_review_status" CHECK ("status" IN ('pending', 'published', 'dismissed')),
  CONSTRAINT "source_review_decision" CHECK (
    ("status" = 'pending' AND "decided_at" IS NULL AND "decided_by" IS NULL AND "decision_reason" IS NULL AND "event_id" IS NULL)
    OR ("status" <> 'pending' AND "decided_at" IS NOT NULL AND "decided_by" IS NOT NULL AND "decision_reason" IS NOT NULL AND length(trim("decided_by")) > 0 AND length(trim("decision_reason")) > 0)
  )
);
CREATE UNIQUE INDEX "source_event_reviews_fixture_id_source_event_id_key" ON "source_event_reviews"("fixture_id", "source_event_id");
CREATE INDEX "source_event_reviews_status_created_at_id_idx" ON "source_event_reviews"("status", "created_at", "id");
CREATE INDEX "source_event_reviews_fixture_state_id_idx" ON "source_event_reviews"("fixture_state_id");
CREATE INDEX "source_event_reviews_event_id_idx" ON "source_event_reviews"("event_id");
