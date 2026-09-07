import { describe, expect, it, vi } from "vitest";
import type { NormalizedFixture } from "@fcp/football-core";
import { collectFixtures } from "../../workers/football-ingestion/src/polling.js";

const fixture = (
  id: string,
  status: NormalizedFixture["status"] = "first_half",
  league = "39",
) =>
  ({
    sourceFixtureId: id,
    competition: { sourceId: league, season: 2026 },
    status,
    receivedAt: new Date("2026-09-08T00:00:00Z"),
  }) as NormalizedFixture;
const enabled = [{ sourceId: "39", season: 2026 }];
const provider = () => ({
  getLiveFixtures: vi.fn().mockResolvedValue([]),
  getFixturesByDate: vi.fn().mockResolvedValue([]),
  getFixture: vi.fn().mockResolvedValue(null),
});
describe("fixture discovery and reconciliation", () => {
  it("makes no upstream calls with no enabled competitions", async () => {
    const api = provider();
    expect(await collectFixtures(api, [], ["1"], true)).toEqual([]);
    expect(api.getLiveFixtures).not.toHaveBeenCalled();
  });
  it("reconciles a finished fixture missing from the live feed", async () => {
    const api = provider();
    api.getFixture.mockResolvedValue(fixture("1", "finished"));
    expect(await collectFixtures(api, enabled, ["1", "1"], false)).toEqual([
      fixture("1", "finished"),
    ]);
    expect(api.getFixture).toHaveBeenCalledTimes(1);
  });
  it("discovers yesterday, today, and tomorrow across UTC midnight", async () => {
    const api = provider();
    api.getFixturesByDate.mockResolvedValue([fixture("1", "scheduled")]);
    const found = await collectFixtures(
      api,
      enabled,
      ["1"],
      true,
      new Date("2026-09-08T00:01:00Z"),
    );
    expect(api.getFixturesByDate.mock.calls).toEqual([
      ["2026-09-07"],
      ["2026-09-08"],
      ["2026-09-09"],
    ]);
    expect(found).toHaveLength(1);
    expect(api.getFixture).not.toHaveBeenCalled();
  });
  it("filters disabled leagues and never infers a finish from a missing response", async () => {
    const api = provider();
    api.getLiveFixtures.mockResolvedValue([fixture("2", "first_half", "99")]);
    expect(await collectFixtures(api, enabled, ["1"], false)).toEqual([]);
  });
  it("propagates upstream failures instead of persisting an empty observation", async () => {
    const api = provider();
    api.getFixture.mockRejectedValue(new Error("quota"));
    await expect(collectFixtures(api, enabled, ["1"], false)).rejects.toThrow(
      "quota",
    );
  });
});
