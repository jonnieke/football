import { testEndpoints } from "../tests/support/isolation.js";

/** No dotenv, production credentials, provider key, mail key, or worker launch. */
export function sandboxEnvironment(
  parent: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // Copy only runtime basics; exclude NODE_OPTIONS, package-manager hooks,
  // application URLs, Resend, cloud tokens, proxies, and arbitrary parent env.
  const allowed = new Set([
    "path",
    "systemroot",
    "windir",
    "comspec",
    "temp",
    "tmp",
    "tmpdir",
    "home",
    "userprofile",
    "appdata",
    "localappdata",
    "pathext",
  ]);
  for (const [key, value] of Object.entries(parent))
    if (allowed.has(key.toLowerCase()) && value !== undefined) env[key] = value;
  env.NODE_ENV = "test";
  env.TEST_DATABASE_URL =
    "postgresql://football_test:local_test_only@127.0.0.1:15432/football_replay_test";
  env.TEST_REDIS_URL = "redis://127.0.0.1:16379/1";
  // dotenv cannot populate live values when Prisma's CLI loads its config.
  env.DOTENV_CONFIG_PATH = "__sandbox_no_dotenv_file__";
  testEndpoints(env);
  return env;
}
