BEGIN;
CREATE TABLE "alert_recipients" (
  "id" UUID PRIMARY KEY,
  "email" VARCHAR(254) NOT NULL UNIQUE,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "warnings" BOOLEAN NOT NULL DEFAULT true,
  "critical" BOOLEAN NOT NULL DEFAULT true,
  "recovery" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CHECK (email = lower(btrim(email)))
);
-- Intentionally no cascading FK: removing a recipient preserves its change history.
CREATE TABLE "alert_recipient_audit" (
  "id" UUID PRIMARY KEY,
  "recipient_id" UUID NOT NULL,
  "actor" VARCHAR(200) NOT NULL,
  "action" TEXT NOT NULL CHECK (action IN ('add', 'update', 'remove')),
  "before" JSONB,
  "after" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "alert_recipient_audit_recipient_id_created_at_id_idx"
  ON "alert_recipient_audit" ("recipient_id", "created_at", "id");
COMMIT;
