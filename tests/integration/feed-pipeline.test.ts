import { buildApp } from "@fcp/api";
import { generateContent } from "@fcp/content-core";
import {
  createApiKeyMaterial,
  createCanonicalEvent,
  persistNormalizedFixture,
  resolveSourceEventIdentities,
} from "@fcp/database";
import {
  detectFixtureEvents,
  type NormalizedFixture,
} from "@fcp/football-core";
import { createLogger, loadConfig } from "@fcp/shared";
import { createTestResources } from "../support/resources.js";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = process.env.RUN_INTEGRATION_TESTS === "true";
const describeIntegration = run ? describe : describe.skip;

describeIntegration(
  "fixture repositories, content, and feed integration (not queue workers)",
  () => {
    let resources: Awaited<ReturnType<typeof createTestResources>> | undefined;
    let config: ReturnType<typeof loadConfig>;
    let prisma: Awaited<ReturnType<typeof createTestResources>>["prisma"];
    let app: Awaited<ReturnType<typeof buildApp>>;
    let apiKey = "";

    beforeAll(async () => {
      resources = await createTestResources(process.env);
      prisma = resources.prisma;
      config = loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: resources.databaseUrl,
        REDIS_URL: resources.redisUrl,
        API_FOOTBALL_BASE_URL: "https://example.invalid",
        API_FOOTBALL_KEY: "test-not-used",
        CURSOR_SIGNING_SECRET:
          "test-cursor-secret-with-at-least-thirty-two-characters",
      });
      const material = await createApiKeyMaterial();
      apiKey = material.plaintext;
      await prisma.apiClient.create({
        data: {
          id: uuidv7(),
          name: "Integration partner",
          slug: "integration-partner",
          keyPrefix: material.prefix,
          keyHash: material.hash,
          rateLimit: 1000,
        },
      });
      app = await buildApp({
        config,
        prisma,
        redis: resources.redis,
        logger: createLogger("silent"),
      });
    }, 90_000);

    afterAll(async () => {
      try {
        await app?.close();
      } finally {
        await resources?.cleanup();
      }
    }, 30_000);

    it("persists, generates, paginates, and resumes without duplicates", async () => {
      const base: NormalizedFixture = {
        id: "provider-fixture-9001",
        source: "api-football",
        sourceFixtureId: "9001",
        competition: {
          id: "provider-competition-39",
          source: "api-football",
          sourceId: "39",
          name: "Premier League",
          slug: "epl",
          country: "England",
          season: 2026,
        },
        homeTeam: {
          id: "provider-team-1",
          source: "api-football",
          sourceId: "1",
          name: "Arsenal",
        },
        awayTeam: {
          id: "provider-team-2",
          source: "api-football",
          sourceId: "2",
          name: "Chelsea",
        },
        score: { home: 0, away: 0 },
        status: "first_half",
        minute: 1,
        kickoffAt: new Date("2026-08-28T18:00:00Z"),
        receivedAt: new Date("2026-08-28T18:01:00Z"),
      };
      await persistNormalizedFixture(prisma, base);
      const changed = await persistNormalizedFixture(prisma, {
        ...base,
        score: { home: 1, away: 0 },
        minute: 12,
        receivedAt: new Date("2026-08-28T18:12:00Z"),
      });
      expect(changed.changed).toBe(true);
      if (changed.previousStateId === undefined)
        throw new Error("Expected a previous fixture state");
      const [previous, current, fixture] = await Promise.all([
        prisma.fixtureState.findUniqueOrThrow({
          where: { id: changed.previousStateId },
        }),
        prisma.fixtureState.findUniqueOrThrow({
          where: { id: changed.currentStateId },
        }),
        prisma.fixture.findUniqueOrThrow({
          where: { id: changed.fixtureId },
          include: { competition: true, homeTeam: true, awayTeam: true },
        }),
      ]);
      const sourceGoal = {
        source: "api-football" as const,
        sourceFixtureId: "9001",
        sourceEventId: "goal-12",
        sourceTeamId: "1",
        sourcePlayerId: "12345",
        playerName: "Saka",
        eventType: "goal" as const,
        minute: 12,
        homeScore: 1,
        awayScore: 0,
      };
      const [resolved, replayed] = await Promise.all([
        resolveSourceEventIdentities(prisma, fixture, sourceGoal),
        resolveSourceEventIdentities(prisma, fixture, sourceGoal),
      ]);
      expect(resolved.event.playerId).toBe(replayed.event.playerId);
      expect(resolved.event.playerId).not.toBe("12345");
      expect(await prisma.player.count()).toBe(1);
      const drafts = detectFixtureEvents(
        fixture.id,
        {
          status: previous.status as "first_half",
          score: { home: previous.homeScore, away: previous.awayScore },
          ...(previous.minute === null ? {} : { minute: previous.minute }),
        },
        {
          status: current.status as "first_half",
          score: { home: current.homeScore, away: current.awayScore },
          ...(current.minute === null ? {} : { minute: current.minute }),
        },
        [resolved.event],
      );
      expect(drafts).toHaveLength(1);
      const canonical = await createCanonicalEvent(prisma, drafts[0]!);
      expect(canonical.created).toBe(true);
      const stored = await prisma.footballEvent.findUniqueOrThrow({
        where: { id: canonical.id },
        include: { player: true, team: true },
      });
      expect(stored.player?.sourceId).toBe("12345");
      expect(stored.team?.id).toBe(fixture.homeTeamId);
      await expect(
        createCanonicalEvent(prisma, drafts[0]!),
      ).resolves.toMatchObject({ id: canonical.id, created: false });
      const generated = generateContent(
        {
          eventType: "goal",
          minute: 12,
          homeTeam: fixture.homeTeam.name,
          awayTeam: fixture.awayTeam.name,
          homeScore: 1,
          awayScore: 0,
          competitionSlug: fixture.competition.slug,
        },
        config.SHORT_CONTENT_MAX_LENGTH,
      );
      await prisma.contentItem.create({
        data: {
          id: uuidv7(),
          eventId: canonical.id,
          ...generated,
          publishedAt: new Date("2026-08-28T18:12:01Z"),
        },
      });

      const first = await app.inject({
        method: "GET",
        url: "/v1/feed",
        headers: { authorization: `Bearer ${apiKey}` },
      });
      expect(first.statusCode).toBe(200);
      const firstBody = first.json<{
        items: Array<{ id: string }>;
        next_cursor: string;
      }>();
      expect(firstBody.items).toHaveLength(1);

      const empty = await app.inject({
        method: "GET",
        url: `/v1/feed?after=${encodeURIComponent(firstBody.next_cursor)}`,
        headers: { authorization: `Bearer ${apiKey}` },
      });
      expect(empty.json<{ items: unknown[] }>().items).toHaveLength(0);

      const second = await createCanonicalEvent(prisma, {
        fixtureId: fixture.id,
        eventType: "red_card",
        minute: 20,
        teamId: fixture.awayTeamId,
        homeScore: 1,
        awayScore: 0,
      });
      const secondContent = generateContent(
        {
          eventType: "red_card",
          minute: 20,
          homeTeam: fixture.homeTeam.name,
          awayTeam: fixture.awayTeam.name,
          homeScore: 1,
          awayScore: 0,
          competitionSlug: fixture.competition.slug,
        },
        config.SHORT_CONTENT_MAX_LENGTH,
      );
      await prisma.contentItem.create({
        data: {
          id: uuidv7(),
          eventId: second.id,
          ...secondContent,
          publishedAt: new Date("2026-08-28T18:20:01Z"),
        },
      });
      const resumed = await app.inject({
        method: "GET",
        url: `/v1/feed?after=${encodeURIComponent(firstBody.next_cursor)}`,
        headers: { authorization: `Bearer ${apiKey}` },
      });
      expect(
        resumed.json<{ items: Array<{ event_type: string }> }>().items,
      ).toEqual([expect.objectContaining({ event_type: "red_card" })]);
    });
  },
);
