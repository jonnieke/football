BEGIN;
CREATE TABLE "staging_push_deliveries" (
  "id" UUID NOT NULL,
  "content_id" UUID NOT NULL,
  "message" VARCHAR(150) NOT NULL CHECK (char_length("message") BETWEEN 1 AND 150),
  "menu_cmd" VARCHAR(40) NOT NULL DEFAULT 'LIVESCORES' CHECK ("menu_cmd" = 'LIVESCORES'),
  "uploaded_by" VARCHAR(100) NOT NULL DEFAULT 'Football Content Platform' CHECK (char_length(btrim("uploaded_by")) > 0),
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'delivered', 'expired', 'failed')),
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "locked_until" TIMESTAMP(3),
  "lease_token" UUID,
  "target_record_id" VARCHAR(100),
  "last_error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),

  CONSTRAINT "staging_push_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staging_push_deliveries_content_id_fkey"
    FOREIGN KEY ("content_id") REFERENCES "content_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "staging_push_deliveries_content_id_key"
  ON "staging_push_deliveries"("content_id");
CREATE INDEX "staging_push_deliveries_status_available_at_idx"
  ON "staging_push_deliveries"("status", "available_at");
CREATE INDEX "staging_push_deliveries_created_at_id_idx"
  ON "staging_push_deliveries"("created_at", "id");

ALTER TABLE "staging_push_deliveries" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "staging_push_deliveries" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "staging_push_deliveries" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "staging_push_deliveries" FROM authenticated';
  END IF;
END $$;
COMMIT;
