import { ApiFootballProvider } from "../packages/football-provider/src/api-football.js";

export interface MatchCapture {
  version: 1;
  capturedAt: string;
  fixtureId: string;
  fixtureResponse: unknown;
  eventsResponse: unknown;
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected provider object");
  return value as Record<string, unknown>;
};

export function completedFixtureId(envelope: unknown): string {
  const data = record(envelope);
  if (data.errors && Object.keys(recordOrArray(data.errors)).length)
    throw new Error("Provider returned an error envelope");
  if (!Array.isArray(data.response) || data.response.length !== 1)
    throw new Error("Expected exactly one completed match");
  const row = record(data.response[0]);
  const fixture = record(row.fixture);
  if (record(row.league).id !== 39 || record(fixture.status).short !== "FT")
    throw new Error("Only full-time Premier League matches are allowed");
  if (!Number.isSafeInteger(fixture.id) || Number(fixture.id) <= 0)
    throw new Error("Invalid fixture identifier");
  return String(fixture.id);
}

function recordOrArray(value: unknown): object {
  return Array.isArray(value) ? value : record(value);
}

/** Normalizes captured responses using the real adapter, with no network. */
export async function decodeCapture(input: unknown) {
  const data = record(input);
  if (
    data.version !== 1 ||
    typeof data.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(data.capturedAt)) ||
    typeof data.fixtureId !== "string" ||
    !/^\d+$/.test(data.fixtureId)
  )
    throw new Error("Invalid match capture metadata");
  if (completedFixtureId(data.fixtureResponse) !== data.fixtureId)
    throw new Error("Capture fixture identity mismatch");
  const fixtureId = data.fixtureId;
  const provider = new ApiFootballProvider(
    {
      baseUrl: "https://capture.invalid",
      apiKey: "offline",
      timeoutMs: 1000,
      maxRetries: 0,
    },
    { debug() {}, warn() {} },
    (input) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      const payload =
        url.pathname === "/fixtures" && url.search === `?id=${fixtureId}`
          ? data.fixtureResponse
          : url.pathname === "/fixtures/events" &&
              url.search === `?fixture=${fixtureId}`
            ? data.eventsResponse
            : undefined;
      if (payload === undefined) throw new Error("Unexpected offline request");
      return Promise.resolve(
        new Response(JSON.stringify(payload), { status: 200 }),
      );
    },
  );
  const fixture = await provider.getFixture(fixtureId);
  if (!fixture || fixture.status !== "finished")
    throw new Error("Match is not finished");
  fixture.receivedAt = new Date(data.capturedAt);
  if (fixture.kickoffAt >= fixture.receivedAt)
    throw new Error("Match is not historical");
  const events = await provider.getFixtureEvents(fixtureId);
  if (
    events.length > 200 ||
    events.some(
      (event) =>
        ![fixture.homeTeam.sourceId, fixture.awayTeam.sourceId].includes(
          event.sourceTeamId ?? "",
        ),
    )
  )
    throw new Error("Unexpected match event data");
  return { fixture, events };
}

/** At most three GETs, one fixed host, no redirects/retries or other secrets. */
export async function captureCompletedMatch(
  apiKey: string,
  fetcher: typeof fetch = fetch,
) {
  if (!apiKey.trim()) throw new Error("Football provider key is missing");
  let requests = 0;
  const read = async (path: string) => {
    if (++requests > 3) throw new Error("Capture request budget exceeded");
    const response = await fetcher(
      new URL(path, "https://v3.football.api-sports.io"),
      {
        headers: { "x-apisports-key": apiKey },
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
    if (!response.body) throw new Error("Empty provider response");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = (await reader.read()) as {
        done: boolean;
        value?: Uint8Array;
      };
      if (done) break;
      if (!value) throw new Error("Invalid provider stream");
      size += value.length;
      if (size > 2_000_000) {
        await reader.cancel();
        throw new Error("Capture size limit exceeded");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  };
  const fixtureId = completedFixtureId(
    await read("/fixtures?league=39&last=1&status=FT"),
  );
  const fixtureResponse = await read(`/fixtures?id=${fixtureId}`);
  if (completedFixtureId(fixtureResponse) !== fixtureId)
    throw new Error("Provider fixture mismatch");
  const eventsResponse = await read(`/fixtures/events?fixture=${fixtureId}`);
  const capture: MatchCapture = {
    version: 1,
    capturedAt: new Date().toISOString(),
    fixtureId,
    fixtureResponse,
    eventsResponse,
  };
  await decodeCapture(capture);
  return { capture, requests };
}
