import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sandboxEnvironment } from "./sandbox-config.js";

const mode = process.argv[2] ?? "--check";
if (
  ![
    "--check",
    "--integration",
    "--workers",
    "--collector",
    "--pipeline",
  ].includes(mode)
)
  throw new Error(
    "Use --check, --integration, --workers, --collector or --pipeline (local test stores only)",
  );
const env = sandboxEnvironment(process.env);
if (mode === "--check") {
  console.log(
    JSON.stringify({
      configuration: "PASS",
      connections_attempted: 0,
      workers_started: 0,
      production_credentials_loaded: false,
      provider_requests: 0,
      email_credentials_loaded: false,
      database_port: 15432,
      redis_port: 16379,
      note: "Configuration only. Local PostgreSQL/Redis must still be started and verified.",
    }),
  );
} else {
  if (process.versions.node.split(".")[0] !== "24")
    throw new Error("Node 24 required");
  const root = new URL("../", import.meta.url);
  if (["--workers", "--collector", "--pipeline"].includes(mode)) {
    // Rebuild the runtime artifacts that child workers actually import. No
    // package installation, provider requests or application startup here.
    for (const directory of [
      "packages/shared",
      "packages/football-core",
      "packages/content-core",
      "packages/football-provider",
      "packages/database",
      "workers/outbox-dispatcher",
      "workers/event-processor",
      "workers/content-generator",
      "workers/football-ingestion",
    ]) {
      const build = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL("node_modules/tsup/dist/cli-default.js", root)),
          "src/index.ts",
          "--format",
          "esm",
          ...(directory.startsWith("workers/")
            ? ["--config", "../../tsup.runtime.config.ts", "--sourcemap"]
            : []),
        ],
        {
          cwd: fileURLToPath(new URL(`${directory}/`, root)),
          env,
          stdio: "inherit",
          windowsHide: true,
          timeout: 90_000,
        },
      );
      if (build.error || build.status !== 0)
        throw new Error(`Sandbox worker build failed: ${directory}`);
    }
  }
  if (mode === "--collector" || mode === "--pipeline") {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("node_modules/vitest/vitest.mjs", root)),
        "run",
        "tests/workers/ingestion.test.ts",
        "--maxWorkers=1",
      ],
      {
        cwd: fileURLToPath(root),
        env: {
          ...env,
          RUN_WORKER_TESTS: "true",
          RUN_PIPELINE_TESTS: String(mode === "--pipeline"),
        },
        stdio: "inherit",
        windowsHide: true,
      },
    );
    if (result.error) throw new Error("Collector test runner could not start");
    process.exit(result.status ?? 1);
  }
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL(
          mode === "--workers"
            ? "scripts/run-worker-tests.mjs"
            : "scripts/run-integration.mjs",
          root,
        ),
      ),
      "--maxWorkers=1",
    ],
    { cwd: fileURLToPath(root), env, stdio: "inherit", windowsHide: true },
  );
  if (result.error)
    throw new Error("Local sandbox test runner could not start");
  process.exitCode = result.status ?? 1;
}
