// Explicitly invoked provisioning helper. Never prints credentials or raw API responses.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { parse } from "dotenv";
const root = fileURLToPath(new URL("../", import.meta.url));
const cli =
  "C:/Users/peterson/AppData/Roaming/npm/node_modules/vercel/dist/vc.js";
const scope = "kariukinjoroge13-gmailcoms-projects";
const team = "team_Nct8c22SL5Utw9Y7wAVjvUjq";
const name = "football-control-room";
function api(path, method = "GET", body) {
  const args = [
    cli,
    "api",
    path,
    "--scope",
    scope,
    "--raw",
    "--method",
    method,
  ];
  if (body) args.push("--input", "-");
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    input: body ? JSON.stringify(body) : undefined,
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
  });
  if (result.status !== 0) {
    // Only expose a short diagnostic after stripping every submitted value.
    let diagnostic = result.stderr;
    const values = Array.isArray(body) ? body.map((e) => e.value) : [];
    for (const value of values.filter(
      (v) => typeof v === "string" && v.length > 0,
    )) {
      diagnostic = diagnostic.split(value).join("[REDACTED]");
      diagnostic = diagnostic
        .split(JSON.stringify(value).slice(1, -1))
        .join("[REDACTED]");
    }
    diagnostic = diagnostic
      .replace(/(?:postgres(?:ql)?|rediss?|https?):\/\/\S+/g, "[URL REDACTED]")
      .replace(/re_[a-zA-Z0-9_-]+/g, "[KEY REDACTED]");
    console.log(diagnostic.slice(0, 1000));
    throw new Error("VERCEL_REQUEST_FAILED");
  }
  const output = JSON.parse(result.stdout);
  if (output.error) throw new Error("VERCEL_API_ERROR");
  return output;
}
try {
  const mode = process.argv[2];
  if (mode === "create") {
    const project = api("/v10/projects", "POST", {
      name,
      framework: null,
      rootDirectory: "apps/admin",
      installCommand: "cd ../.. && pnpm install --frozen-lockfile",
      buildCommand: "cd ../.. && pnpm build:vercel apps/admin",
      outputDirectory: ".vercel/output",
    });
    if (project.name !== name || project.accountId !== team)
      throw new Error("PROJECT_GUARD");
    api(`/v9/projects/${project.id}`, "PATCH", {
      nodeVersion: "24.x",
      sourceFilesOutsideRootDirectory: true,
    });
    console.log(
      JSON.stringify({
        created: true,
        name: project.name,
        id: project.id,
        rootDirectory: project.rootDirectory,
      }),
    );
  } else {
    const project = api(`/v9/projects/${name}`);
    if (
      project.name !== name ||
      project.accountId !== team ||
      project.rootDirectory !== "apps/admin"
    )
      throw new Error("PROJECT_GUARD");
    if (mode === "inspect") {
      const variables = api(`/v9/projects/${project.id}/env`);
      const domains = api(`/v9/projects/${project.id}/domains`);
      console.log(
        JSON.stringify({
          name,
          id: project.id,
          rootDirectory: project.rootDirectory,
          nodeVersion: project.nodeVersion,
          domains: (domains.domains ?? []).map((d) => d.name),
          production_keys: (variables.envs ?? [])
            .filter((e) => e.target?.includes("production"))
            .map((e) => e.key),
        }),
      );
    } else if (mode === "configure") {
      const workers = parse(
        readFileSync(new URL("../.env.workers.local", import.meta.url)),
      );
      const email = parse(
        readFileSync(new URL("../.env.admin.local", import.meta.url)),
      );
      const db = new URL(workers.DATABASE_URL);
      const redis = new URL(workers.REDIS_URL);
      if (
        decodeURIComponent(db.username) !== "postgres.dsholtmeyivyjwiuzedb" ||
        !db.hostname.endsWith(".supabase.com") ||
        redis.protocol !== "rediss:" ||
        !redis.hostname.endsWith(".aivencloud.com") ||
        !email.RESEND_API_KEY?.startsWith("re_") ||
        email.ADMIN_EMAILS !== "kariukinjoroge13@gmail.com" ||
        email.RESEND_FROM !== "onboarding@resend.dev"
      )
        throw new Error("ENVIRONMENT_GUARD");
      const existing = api(`/v9/projects/${project.id}/env`);
      const settings = {
        DATABASE_URL: workers.DATABASE_URL,
        REDIS_URL: workers.REDIS_URL,
        DATABASE_CA: "supabase-2021",
        NODE_ENV: "production",
        ADMIN_ORIGIN: `https://${name}.vercel.app`,
        ADMIN_NAMESPACE: `football_admin_${randomBytes(6).toString("hex")}`,
        ADMIN_EMAILS: email.ADMIN_EMAILS,
        RESEND_FROM: email.RESEND_FROM,
        RESEND_API_KEY: email.RESEND_API_KEY.trim(),
        QUEUE_PREFIX: workers.QUEUE_PREFIX ?? "bull",
      };
      const link = JSON.parse(
        readFileSync(
          new URL("../apps/admin/.vercel/project.json", import.meta.url),
          "utf8",
        ),
      );
      if (link.projectId !== project.id || link.orgId !== team)
        throw new Error("PROJECT_GUARD");
      const present = new Set(
        (existing.envs ?? [])
          .filter((e) => e.target?.includes("production"))
          .map((e) => e.key),
      );
      if ([...present].some((key) => !(key in settings)))
        throw new Error("EXISTING_ENVIRONMENT_REQUIRES_REVIEW");
      for (const [key, value] of Object.entries(settings)) {
        if (present.has(key)) continue;
        const result = spawnSync(
          process.execPath,
          [
            cli,
            "env",
            "add",
            key,
            "production",
            "--yes",
            "--scope",
            scope,
            "--cwd",
            "apps/admin",
          ],
          {
            cwd: root,
            input: value + "\n",
            encoding: "utf8",
            timeout: 30000,
            windowsHide: true,
          },
        );
        if (result.status !== 0) {
          console.log(JSON.stringify({ failed_key: key }));
          throw new Error("VERCEL_REQUEST_FAILED");
        }
        console.log(JSON.stringify({ saved_key: key }));
      }
      console.log(
        JSON.stringify({
          configured: true,
          name,
          keys: Object.keys(settings),
          values_displayed: false,
        }),
      );
    } else throw new Error("EXPECTED_create_configure_OR_inspect");
  }
} catch (error) {
  const known = [
    "VERCEL_REQUEST_FAILED",
    "VERCEL_API_ERROR",
    "PROJECT_GUARD",
    "ENVIRONMENT_GUARD",
    "EXISTING_ENVIRONMENT_REQUIRES_REVIEW",
  ];
  console.log(
    JSON.stringify({
      failed: known.includes(error.message)
        ? error.message
        : "PROVISIONING_FAILED",
    }),
  );
  process.exitCode = 1;
}
