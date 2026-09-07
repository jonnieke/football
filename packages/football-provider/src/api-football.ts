import type {
  FixtureStatus,
  FootballEventType,
  NormalizedCompetition,
  NormalizedFixture,
  NormalizedSourceEvent,
  NormalizedTeam,
} from "@fcp/football-core";
import { z } from "zod";
import type { FootballProvider } from "./provider.js";

export class ProviderError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly statusCode?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProviderError";
  }
}

export interface ProviderLogger {
  debug(data: Record<string, unknown>, message: string): void;
  warn(data: Record<string, unknown>, message: string): void;
}

export interface ApiFootballConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
}

const nullableNumber = z.number().int().nonnegative().nullable();
const fixtureSchema = z.object({
  fixture: z.object({
    id: z.number().int().positive(),
    date: z.iso.datetime({ offset: true }),
    timestamp: z.number().int(),
    status: z.object({
      long: z.string(),
      short: z.string(),
      elapsed: nullableNumber,
    }),
  }),
  league: z.object({
    id: z.number().int().positive(),
    name: z.string(),
    country: z.string().optional().default(""),
    season: z.number().int(),
    round: z.string().optional(),
  }),
  teams: z.object({
    home: z.object({ id: z.number().int().positive(), name: z.string() }),
    away: z.object({ id: z.number().int().positive(), name: z.string() }),
  }),
  goals: z.object({ home: nullableNumber, away: nullableNumber }),
});

const fixturesResponseSchema = z.object({
  response: z.array(fixtureSchema),
  errors: z
    .union([z.array(z.unknown()), z.record(z.string(), z.unknown())])
    .optional(),
});

const eventSchema = z.object({
  time: z.object({ elapsed: nullableNumber, extra: nullableNumber }),
  team: z.object({ id: z.number().int().positive(), name: z.string() }),
  player: z.object({
    id: z.number().int().positive().nullable(),
    name: z.string().nullable(),
  }),
  type: z.string(),
  detail: z.string(),
  comments: z.string().nullable().optional(),
});

const eventsResponseSchema = z.object({ response: z.array(eventSchema) });
const leaguesResponseSchema = z.object({
  response: z.array(
    z.object({
      league: z.object({
        id: z.number().int().positive(),
        name: z.string(),
        type: z.string(),
      }),
      country: z.object({ name: z.string() }),
      seasons: z.array(
        z.object({ year: z.number().int(), current: z.boolean() }),
      ),
    }),
  ),
});

const statusMap: Readonly<Record<string, FixtureStatus>> = {
  TBD: "scheduled",
  NS: "scheduled",
  PST: "postponed",
  CANC: "cancelled",
  ABD: "abandoned",
  SUSP: "suspended",
  INT: "suspended",
  "1H": "first_half",
  HT: "half_time",
  "2H": "second_half",
  ET: "extra_time",
  BT: "extra_time",
  P: "penalty_shootout",
  FT: "finished",
  AET: "finished",
  PEN: "finished",
  AWD: "finished",
  WO: "finished",
  LIVE: "first_half",
};

export function mapApiFootballStatus(status: string): FixtureStatus {
  return statusMap[status] ?? "unknown";
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function team(id: number, name: string): NormalizedTeam {
  return {
    id: `api-football:team:${id}`,
    source: "api-football",
    sourceId: String(id),
    name,
  };
}

export function normalizeApiFootballFixture(
  input: z.infer<typeof fixtureSchema>,
  receivedAt = new Date(),
): NormalizedFixture {
  const sourceFixtureId = String(input.fixture.id);
  return {
    id: `api-football:fixture:${sourceFixtureId}`,
    source: "api-football",
    sourceFixtureId,
    competition: {
      id: `api-football:competition:${input.league.id}:${input.league.season}`,
      source: "api-football",
      sourceId: String(input.league.id),
      name: input.league.name,
      slug: slugify(input.league.name),
      ...(input.league.country === "" ? {} : { country: input.league.country }),
      season: input.league.season,
    },
    homeTeam: team(input.teams.home.id, input.teams.home.name),
    awayTeam: team(input.teams.away.id, input.teams.away.name),
    score: {
      home: input.goals.home ?? 0,
      away: input.goals.away ?? 0,
    },
    status: mapApiFootballStatus(input.fixture.status.short),
    ...(input.fixture.status.elapsed === null
      ? {}
      : { minute: input.fixture.status.elapsed }),
    kickoffAt: new Date(input.fixture.date),
    receivedAt,
  };
}

function mapEventType(type: string, detail: string): FootballEventType | null {
  const value = `${type} ${detail}`.toLowerCase();
  if (value.includes("cancel")) return "goal_cancelled";
  if (value.includes("missed penalty")) return "penalty_missed";
  if (value.includes("own goal")) return "own_goal";
  if (value.includes("penalty") && type.toLowerCase() === "goal")
    return "penalty_goal";
  if (type.toLowerCase() === "goal") return "goal";
  if (value.includes("red card")) return "red_card";
  return null;
}

export class ApiFootballProvider implements FootballProvider {
  public constructor(
    private readonly config: ApiFootballConfig,
    private readonly logger: ProviderLogger,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      const startedAt = Date.now();
      try {
        const response = await this.fetcher(
          new URL(path, this.config.baseUrl),
          {
            headers: { "x-apisports-key": this.config.apiKey },
            signal: controller.signal,
          },
        );
        const latencyMs = Date.now() - startedAt;
        this.logger.debug(
          {
            provider: "api-football",
            latency_ms: latencyMs,
            status_code: response.status,
            rate_limit_remaining: response.headers.get(
              "x-ratelimit-requests-remaining",
            ),
          },
          "provider request completed",
        );
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          throw new ProviderError(
            "UPSTREAM_HTTP_ERROR",
            `API-Football returned HTTP ${response.status}`,
            retryable,
            response.status,
          );
        }
        const payload: unknown = await response.json();
        const parsed = schema.safeParse(payload);
        if (!parsed.success) {
          throw new ProviderError(
            "MALFORMED_UPSTREAM_RESPONSE",
            "API-Football returned an invalid response",
            false,
            response.status,
            {
              cause: parsed.error,
            },
          );
        }
        return parsed.data;
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof ProviderError
            ? error.retryable
            : error instanceof DOMException && error.name === "AbortError";
        if (!retryable || attempt === this.config.maxRetries) break;
        const backoffMs = Math.min(
          250 * 2 ** attempt + Math.floor(Math.random() * 100),
          4000,
        );
        this.logger.warn(
          {
            provider: "api-football",
            attempt: attempt + 1,
            backoff_ms: backoffMs,
          },
          "retrying provider request",
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      } finally {
        clearTimeout(timer);
      }
    }
    if (lastError instanceof ProviderError) throw lastError;
    throw new ProviderError(
      "UPSTREAM_UNAVAILABLE",
      "API-Football request failed",
      true,
      undefined,
      { cause: lastError },
    );
  }

  public async getLiveFixtures(): Promise<NormalizedFixture[]> {
    const data = await this.request(
      "/fixtures?live=all",
      fixturesResponseSchema,
    );
    const receivedAt = new Date();
    return data.response.map((fixture) =>
      normalizeApiFootballFixture(fixture, receivedAt),
    );
  }

  public async getFixture(
    fixtureId: string,
  ): Promise<NormalizedFixture | null> {
    const data = await this.request(
      `/fixtures?id=${encodeURIComponent(fixtureId)}`,
      fixturesResponseSchema,
    );
    const fixture = data.response[0];
    return fixture === undefined ? null : normalizeApiFootballFixture(fixture);
  }

  public async getFixtureEvents(
    fixtureId: string,
  ): Promise<NormalizedSourceEvent[]> {
    const data = await this.request(
      `/fixtures/events?fixture=${encodeURIComponent(fixtureId)}`,
      eventsResponseSchema,
    );
    return data.response.flatMap((event, index) => {
      const eventType = mapEventType(event.type, event.detail);
      if (eventType === null) return [];
      return [
        {
          sourceEventId: `${fixtureId}:${event.time.elapsed ?? 0}:${index}:${event.team.id}:${event.player.id ?? "none"}:${event.detail}`,
          source: "api-football" as const,
          sourceFixtureId: fixtureId,
          eventType,
          ...(event.time.elapsed === null
            ? {}
            : { minute: event.time.elapsed }),
          ...(event.time.extra === null ? {} : { extraTime: event.time.extra }),
          sourceTeamId: String(event.team.id),
          ...(event.player.id === null
            ? {}
            : { sourcePlayerId: String(event.player.id) }),
          ...(event.player.name === null
            ? {}
            : { playerName: event.player.name }),
        },
      ];
    });
  }

  public async getCompetitions(): Promise<NormalizedCompetition[]> {
    const data = await this.request(
      "/leagues?current=true",
      leaguesResponseSchema,
    );
    return data.response.flatMap((item) =>
      item.seasons
        .filter((season) => season.current)
        .map((season) => ({
          id: `api-football:competition:${item.league.id}:${season.year}`,
          source: "api-football" as const,
          sourceId: String(item.league.id),
          name: item.league.name,
          slug: slugify(item.league.name),
          country: item.country.name,
          season: season.year,
        })),
    );
  }

  public async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const startedAt = Date.now();
    try {
      await this.request("/status", z.object({ response: z.unknown() }));
      return { healthy: true, latencyMs: Date.now() - startedAt };
    } catch {
      return { healthy: false, latencyMs: Date.now() - startedAt };
    }
  }
}
