import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const project = process.argv[2] ?? ".";
assert.ok([".", "apps/api"].includes(project));
const output = resolve(root, project, ".vercel/output");
const source = resolve(output, "functions/api.func");
const routing = JSON.parse(
  await readFile(resolve(output, "config.json"), "utf8"),
);
assert.equal(routing.version, 3);
assert.deepEqual(routing.routes, [{ src: "/(.*)", dest: "/api" }]);
// Reject links back into the checkout and accidental environment files BEFORE copying.
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    assert.ok(
      !/^\.env(?:\.|$)/.test(entry.name),
      `Environment file in artifact: ${path}`,
    );
    if (entry.isSymbolicLink()) {
      const target = relative(source, await realpath(path));
      assert.ok(
        !target.startsWith("..") && !isAbsolute(target),
        `External link: ${path}`,
      );
    } else if (entry.isDirectory()) await inspect(path);
  }
}
await inspect(source);
const temporary = await mkdtemp(resolve(tmpdir(), "fcp-vercel-"));
try {
  // Relocate internal links too, including absolute Windows junctions. Do not
  // dereference the entire graph: packages may have cyclic peer dependencies.
  const isolated = resolve(temporary, "api.func");
  async function relocate(directory) {
    const copied = resolve(isolated, relative(source, directory));
    await mkdir(copied, { recursive: true });
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const target = resolve(copied, entry.name);
      if (entry.isSymbolicLink()) {
        const relocated = resolve(
          isolated,
          relative(source, await realpath(path)),
        );
        await symlink(
          process.platform === "win32"
            ? relocated
            : relative(dirname(target), relocated),
          target,
          process.platform === "win32" ? "junction" : undefined,
        );
      } else if (entry.isDirectory()) await relocate(path);
      else await copyFile(path, target);
    }
  }
  await relocate(source);
  const config = JSON.parse(
    await readFile(resolve(isolated, ".vc-config.json"), "utf8"),
  );
  assert.equal(config.runtime, "nodejs24.x");
  assert.equal(config.handler, "dist/handler.js");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME)$/i.test(key),
    ),
  );
  const probe = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import handler from './dist/handler.js';
    import { buildApp } from './dist/app.js';
    import { createApiKeyMaterial, verifyApiKeyHash } from '@fcp/database';
    import { loadConfig, createLogger } from '@fcp/shared';
    const key = await createApiKeyMaterial();
    assert.equal(await verifyApiKeyHash(key.hash, key.plaintext), true);
    await assert.rejects(handler({}, {}), /Invalid environment configuration/);
    const config = loadConfig({ NODE_ENV:'test', DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused', REDIS_URL:'redis://127.0.0.1:1', API_FOOTBALL_BASE_URL:'https://example.invalid', API_FOOTBALL_KEY:'not-used', CURSOR_SIGNING_SECRET:'isolated-artifact-test-secret-long-enough' });
    const app = await buildApp({ config, prisma:{}, redis:{}, logger:createLogger('silent') });
    const response = await app.inject({ method:'GET', url:'/docs/json' });
    assert.equal(response.statusCode, 200);
    assert.match(response.json().openapi, /^3[.]/);
    const unauthorized = await app.inject({ method:'GET', url:'/v1/feed' });
    assert.equal(unauthorized.statusCode, 401);
    await app.close();
    console.log('PASS: isolated Vercel handler, workspace packages, native Argon2, and API docs');
  `,
    ],
    { cwd: isolated, env, encoding: "utf8", timeout: 30_000 },
  );
  assert.ifError(probe.error);
  assert.equal(probe.status, 0, probe.stderr);
  console.log(probe.stdout.trim());
} finally {
  // Owned mkdtemp directory only, outside the repository.
  await rm(temporary, { recursive: true, force: true });
}
