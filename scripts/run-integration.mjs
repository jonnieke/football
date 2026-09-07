import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

// Explicit integration invocation must never silently skip its tests.
const root = new URL("../", import.meta.url);
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL("node_modules/vitest/vitest.mjs", root)),
    "run",
    "tests/integration",
  ],
  {
    cwd: fileURLToPath(root),
    stdio: "inherit",
    env: { ...process.env, RUN_INTEGRATION_TESTS: "true" },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
