import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sandboxEnvironment } from "../../scripts/sandbox-config.js";
import { testEndpoints } from "../support/isolation.js";

it("ignores live secrets, node hooks, proxy routing and test URL overrides", () => {
  const env = sandboxEnvironment({
    PATH: "runtime-path",
    SystemRoot: "windows-path",
    DATABASE_URL: "postgresql://secret@live.example/live",
    REDIS_URL: "rediss://secret@live.example/0",
    RESEND_API_KEY: "private",
    API_FOOTBALL_KEY: "private",
    VERCEL_TOKEN: "private",
    TEST_DATABASE_URL: "postgresql://secret@live.example/live",
    TEST_REDIS_URL: "rediss://secret@live.example/0",
    NODE_OPTIONS: "--import malicious.js",
    HTTP_PROXY: "http://proxy.example",
    DOTENV_CONFIG_PATH: ".env.workers.local",
    RUN_WORKER_TESTS: "true",
  });
  expect(env.PATH).toBe("runtime-path");
  expect(env.SystemRoot).toBe("windows-path");
  for (const key of [
    "DATABASE_URL",
    "REDIS_URL",
    "RESEND_API_KEY",
    "API_FOOTBALL_KEY",
    "VERCEL_TOKEN",
    "NODE_OPTIONS",
    "HTTP_PROXY",
    "RUN_WORKER_TESTS",
  ])
    expect(env[key]).toBeUndefined();
  expect(env.DOTENV_CONFIG_PATH).toBe("__sandbox_no_dotenv_file__");
  expect(testEndpoints(env).redisUrl).toBe("redis://127.0.0.1:16379/1");
  expect(new URL(testEndpoints(env).databaseUrl).pathname).toBe(
    "/football_replay_test",
  );
});

it("declares only loopback infrastructure, no application or env-file services", () => {
  const compose = readFileSync(
    new URL("../../docker-compose.sandbox.yml", import.meta.url),
    "utf8",
  );
  expect(compose).toContain("127.0.0.1:15432:5432");
  expect(compose).toContain("127.0.0.1:16379:6379");
  expect(compose).not.toMatch(/env_file:|build:|container_name:/);
  expect(compose).toContain('restart: "no"');
});
