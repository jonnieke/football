-- CreateTable
CREATE TABLE "pre_match_approvals" (
    "id" UUID NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "fixture_id" UUID NOT NULL,
    "detail_type" VARCHAR(40) NOT NULL,
    "approved_by" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pre_match_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pre_match_approvals_date_fixture_id_detail_type_key" ON "pre_match_approvals"("date", "fixture_id", "detail_type");

-- CreateIndex
CREATE INDEX "pre_match_approvals_date_idx" ON "pre_match_approvals"("date");

-- CreateIndex
CREATE INDEX "pre_match_approvals_fixture_id_idx" ON "pre_match_approvals"("fixture_id");

-- AddForeignKey
ALTER TABLE "pre_match_approvals" ADD CONSTRAINT "pre_match_approvals_fixture_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "fixtures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

