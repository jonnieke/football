-- NULL marks legacy snapshots whose source response was not captured.
ALTER TABLE "fixture_states" ADD COLUMN "source_events" JSONB;
