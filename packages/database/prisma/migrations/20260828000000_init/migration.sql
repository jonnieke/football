-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "competitions" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "country" TEXT,
    "season" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "country" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "team_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixtures" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "source_fixture_id" TEXT NOT NULL,
    "competition_id" UUID NOT NULL,
    "home_team_id" UUID NOT NULL,
    "away_team_id" UUID NOT NULL,
    "kickoff_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "minute" INTEGER,
    "home_score" INTEGER NOT NULL DEFAULT 0,
    "away_score" INTEGER NOT NULL DEFAULT 0,
    "last_source_update_at" TIMESTAMP(3),
    "last_polled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixtures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixture_states" (
    "id" UUID NOT NULL,
    "fixture_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "minute" INTEGER,
    "home_score" INTEGER NOT NULL,
    "away_score" INTEGER NOT NULL,
    "raw_hash" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixture_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "football_events" (
    "id" UUID NOT NULL,
    "fixture_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "source_event_id" TEXT,
    "event_fingerprint" TEXT NOT NULL,
    "minute" INTEGER,
    "extra_time" INTEGER,
    "team_id" UUID,
    "player_id" UUID,
    "player_name" TEXT,
    "related_event_id" UUID,
    "home_score" INTEGER,
    "away_score" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "occurred_at" TIMESTAMP(3),
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "football_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_items" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "short_text" TEXT NOT NULL,
    "standard_text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'published',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_templates" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "template_type" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "template_text" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_clients" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'enabled',
    "key_prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "rate_limit" INTEGER NOT NULL DEFAULT 120,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_request_logs" (
    "id" UUID NOT NULL,
    "api_client_id" UUID,
    "request_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "ip_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polling_runs" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fixtures_retrieved" INTEGER NOT NULL DEFAULT 0,
    "changed_fixtures" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "error_code" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "polling_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_incidents" (
    "id" UUID NOT NULL,
    "component" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "system_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "competitions_enabled_priority_idx" ON "competitions"("enabled", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "competitions_source_source_id_season_key" ON "competitions"("source", "source_id", "season");

-- CreateIndex
CREATE UNIQUE INDEX "competitions_slug_season_key" ON "competitions"("slug", "season");

-- CreateIndex
CREATE UNIQUE INDEX "teams_source_source_id_key" ON "teams"("source", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "players_source_source_id_key" ON "players"("source", "source_id");

-- CreateIndex
CREATE INDEX "fixtures_status_kickoff_at_idx" ON "fixtures"("status", "kickoff_at");

-- CreateIndex
CREATE INDEX "fixtures_competition_id_kickoff_at_idx" ON "fixtures"("competition_id", "kickoff_at");

-- CreateIndex
CREATE UNIQUE INDEX "fixtures_source_source_fixture_id_key" ON "fixtures"("source", "source_fixture_id");

-- CreateIndex
CREATE INDEX "fixture_states_fixture_id_captured_at_idx" ON "fixture_states"("fixture_id", "captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "football_events_event_fingerprint_key" ON "football_events"("event_fingerprint");

-- CreateIndex
CREATE INDEX "football_events_fixture_id_detected_at_idx" ON "football_events"("fixture_id", "detected_at");

-- CreateIndex
CREATE INDEX "football_events_event_type_detected_at_idx" ON "football_events"("event_type", "detected_at");

-- CreateIndex
CREATE INDEX "content_items_published_at_id_idx" ON "content_items"("published_at", "id");

-- CreateIndex
CREATE INDEX "content_items_channel_published_at_id_idx" ON "content_items"("channel", "published_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "content_items_event_id_channel_content_type_key" ON "content_items"("event_id", "channel", "content_type");

-- CreateIndex
CREATE UNIQUE INDEX "content_templates_event_type_template_type_language_version_key" ON "content_templates"("event_type", "template_type", "language", "version");

-- CreateIndex
CREATE UNIQUE INDEX "api_clients_slug_key" ON "api_clients"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "api_clients_key_prefix_key" ON "api_clients"("key_prefix");

-- CreateIndex
CREATE INDEX "api_request_logs_api_client_id_created_at_idx" ON "api_request_logs"("api_client_id", "created_at");

-- CreateIndex
CREATE INDEX "api_request_logs_request_id_idx" ON "api_request_logs"("request_id");

-- CreateIndex
CREATE INDEX "polling_runs_started_at_idx" ON "polling_runs"("started_at");

-- CreateIndex
CREATE INDEX "system_incidents_component_status_idx" ON "system_incidents"("component", "status");

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixture_states" ADD CONSTRAINT "fixture_states_fixture_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "fixtures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "football_events" ADD CONSTRAINT "football_events_fixture_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "fixtures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "football_events" ADD CONSTRAINT "football_events_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "football_events" ADD CONSTRAINT "football_events_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "football_events" ADD CONSTRAINT "football_events_related_event_id_fkey" FOREIGN KEY ("related_event_id") REFERENCES "football_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "football_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_api_client_id_fkey" FOREIGN KEY ("api_client_id") REFERENCES "api_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
