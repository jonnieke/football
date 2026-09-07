import { spawnSync } from "node:child_process";
import { lstat, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const project = process.argv[2] ?? ".";
if (![".", "apps/api"].includes(project))
  throw new Error("Expected project root . or apps/api");
const output = resolve(root, project, ".vercel/output");
// Only these two generated artifact directories may be rebuilt; never .vercel metadata.
if (
  ![
    resolve(root, ".vercel/output"),
    resolve(root, "apps/api/.vercel/output"),
  ].includes(output)
)
  throw new Error("Unsafe build output");
function pnpm(args) {
  // npm_execpath avoids cmd.exe quoting and works with pnpm's standalone executable.
  const executable = process.env.npm_execpath;
  if (!executable) throw new Error("Run this script with pnpm build:vercel");
  const result = executable.endsWith(".exe")
    ? spawnSync(executable, args, { cwd: root, stdio: "inherit" })
    : spawnSync(process.execPath, [executable, ...args], {
        cwd: root,
        stdio: "inherit",
      });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pnpm ${args[0]} failed`);
}
pnpm(["db:generate"]);
pnpm(["--filter", "@fcp/api...", "build"]);
await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "functions"), { recursive: true });
const destination = resolve(output, "functions/api.func");
pnpm([
  "--filter",
  "@fcp/api",
  "deploy",
  "--legacy",
  "--prod",
  "--config.auto-install-peers=false",
  "--config.resolve-peers-from-workspace-root=false",
  destination,
]);
// Legacy deploy adds a hoisted self-link to the original application. It is not
// an API dependency and must not escape the uploaded function (or create a cycle).
const selfLink = resolve(
  destination,
  "node_modules/.pnpm/node_modules/@fcp/api",
);
const selfStat = await lstat(selfLink).catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
if (selfStat !== null) {
  if (!selfStat.isSymbolicLink())
    throw new Error("Unexpected API self-link shape");
  await unlink(selfLink);
}
await writeFile(
  resolve(destination, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs24.x",
      handler: "dist/handler.js",
      launcherType: "Nodejs",
      shouldAddHelpers: true,
    },
    null,
    2,
  ),
);
await writeFile(
  resolve(output, "config.json"),
  JSON.stringify(
    { version: 3, routes: [{ src: "/(.*)", dest: "/api" }] },
    null,
    2,
  ),
);
const verified = spawnSync(
  process.execPath,
  [resolve(root, "scripts/verify-vercel.mjs"), project],
  { cwd: root, stdio: "inherit" },
);
if (verified.error) throw verified.error;
if (verified.status !== 0)
  throw new Error("Vercel artifact verification failed");
