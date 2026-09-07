import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { redisKey } from "./redis.js";
const environment = {
  DATABASE_URL: "postgresql://localhost/test",
  REDIS_URL: "redis://localhost/1",
  API_FOOTBALL_BASE_URL: "https://example.invalid",
  API_FOOTBALL_KEY: "test",
  CURSOR_SIGNING_SECRET: "test-secret-with-at-least-thirty-two-characters",
};
describe("isolated coordination namespaces", () => {
  it("preserves current production queue and heartbeat defaults", () => {
    expect(loadConfig(environment).QUEUE_PREFIX).toBe("bull");
    expect(redisKey("health:worker:event-processor", "bull")).toBe(
      "health:worker:event-processor",
    );
  });
  it("scopes heartbeat and lock keys with a configured queue prefix", () => {
    expect(redisKey("health:worker:event-processor", "fcp_test_a")).toBe(
      "fcp_test_a:health:worker:event-processor",
    );
    expect(
      loadConfig({ ...environment, QUEUE_PREFIX: "fcp_test_a" }).QUEUE_PREFIX,
    ).toBe("fcp_test_a");
  });
  it.each(["", "unsafe:*", "with space"])(
    "rejects invalid prefix %s",
    (QUEUE_PREFIX) => {
      expect(() => loadConfig({ ...environment, QUEUE_PREFIX })).toThrow(
        "QUEUE_PREFIX",
      );
    },
  );
});
