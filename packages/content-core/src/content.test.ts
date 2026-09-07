import { describe, expect, it } from "vitest";
import { generateContent, type ContentContext } from "./index.js";

const goal: ContentContext = {
  eventType: "goal",
  minute: 67,
  homeTeam: "Arsenal Football Club",
  homeTeamShort: "Arsenal",
  awayTeam: "Chelsea Football Club",
  awayTeamShort: "Chelsea",
  homeScore: 2,
  awayScore: 1,
  playerName: "Bukayo Saka",
  scoringTeamName: "Arsenal",
  competitionSlug: "epl",
};

describe("deterministic content generation", () => {
  it("renders repeatable goal content", () => {
    expect(generateContent(goal, 160)).toEqual(
      generateContent({ ...goal }, 160),
    );
    expect(generateContent(goal, 160).shortText).toContain("2-1");
  });

  it("uses short team names before dropping essential information", () => {
    const content = generateContent(goal, 55);
    expect(content.shortText.length).toBeLessThanOrEqual(55);
    expect(content.shortText).toContain("2-1");
    expect(content.shortText).toContain("GOAL");
    expect(content.shortText).toContain("67'");
  });

  it("fails explicitly when the configured limit cannot preserve meaning", () => {
    expect(() => generateContent(goal, 10)).toThrow(RangeError);
  });

  it("renders halftime and fulltime markers", () => {
    expect(
      generateContent({ ...goal, eventType: "half_time" }, 160).shortText,
    ).toMatch(/^HT/);
    expect(
      generateContent({ ...goal, eventType: "match_finished" }, 160).shortText,
    ).toMatch(/^FT/);
  });
});
