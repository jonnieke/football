import { createHash } from "node:crypto";
import { Queue, type ConnectionOptions } from "bullmq";

/** Stable, delimiter-safe identity for a fixture observation's queue job. */
export function fixtureChangeJobId(
  fixtureId: string,
  currentStateId: string,
): string {
  return `fixture-${createHash("sha256")
    .update(JSON.stringify([fixtureId, currentStateId]))
    .digest("hex")}`;
}

export const QUEUE_NAMES = {
  fixtureChanges: "fixture-changes",
  contentGeneration: "content-generation",
} as const;

export interface FixtureChangeJob {
  outboxId?: string;
  fixtureId: string;
  previousStateId: string;
  currentStateId: string;
}

export interface ContentGenerationJob {
  outboxId?: string;
  eventId: string;
}

export function createQueues(connection: ConnectionOptions): {
  fixtureChanges: Queue<FixtureChangeJob>;
  contentGeneration: Queue<ContentGenerationJob>;
} {
  return {
    fixtureChanges: new Queue<FixtureChangeJob>(QUEUE_NAMES.fixtureChanges, {
      connection,
    }),
    contentGeneration: new Queue<ContentGenerationJob>(
      QUEUE_NAMES.contentGeneration,
      { connection },
    ),
  };
}
