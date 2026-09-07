import { randomUUID } from "node:crypto";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function endpoint(value: string | undefined, field: string): URL {
  if (!value)
    throw new Error(
      `${field} is required; application URLs are never used as defaults`,
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }
  if (!loopbackHosts.has(url.hostname) || url.search || url.hash) {
    throw new Error(
      `${field} must use a loopback host without query parameters or fragments`,
    );
  }
  return url;
}

function sameStore(
  test: URL,
  application: string | undefined,
  defaultPort: string,
): boolean {
  if (!application) return false;
  try {
    const other = new URL(application);
    return (
      loopbackHosts.has(other.hostname) &&
      (test.port || defaultPort) === (other.port || defaultPort) &&
      (test.pathname || "/0") === (other.pathname || "/0")
    );
  } catch {
    return false;
  }
}

/** Run before constructing any database or Redis client. Never echo credentials. */
export function testEndpoints(environment: NodeJS.ProcessEnv): {
  databaseUrl: string;
  redisUrl: string;
} {
  const database = endpoint(environment.TEST_DATABASE_URL, "TEST_DATABASE_URL");
  const redis = endpoint(environment.TEST_REDIS_URL, "TEST_REDIS_URL");
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !/^\/[a-z0-9_]*test(?:_[a-z0-9_]+)?$/.test(database.pathname) ||
    !/(?:^|_)test(?:_|$)/.test(database.pathname.slice(1))
  ) {
    throw new Error(
      "TEST_DATABASE_URL must name a PostgreSQL database with a test name segment",
    );
  }
  if (
    redis.protocol !== "redis:" ||
    !/^\/(?:[1-9]|1[0-5])$/.test(redis.pathname)
  ) {
    throw new Error(
      "TEST_REDIS_URL must select an explicit Redis database from 1 through 15",
    );
  }
  if (
    sameStore(database, environment.DATABASE_URL, "5432") ||
    sameStore(redis, environment.REDIS_URL, "6379")
  ) {
    throw new Error(
      "Test stores must differ from configured application stores",
    );
  }
  return { databaseUrl: database.toString(), redisUrl: redis.toString() };
}

export function newTestNamespace(): string {
  return `fcp_test_${randomUUID().replaceAll("-", "")}`;
}

export function schemaIdentifier(namespace: string): string {
  if (!/^fcp_test_[a-f0-9]{32}$/.test(namespace))
    throw new Error("Invalid test-owned schema identifier");
  return `"${namespace}"`;
}

interface RedisBackend {
  ping(): Promise<string>;
  get(key: string): Promise<string | null>;
  eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
}

/** Only API operations are exposed. No raw client, FLUSHDB, SCAN, or wildcard deletion. */
export class IsolatedRedis {
  private readonly keys = new Set<string>();
  constructor(
    private readonly backend: RedisBackend,
    private readonly namespace: string,
  ) {
    schemaIdentifier(namespace);
  }
  private key(value: string): string {
    const key = `${this.namespace}:${value}`;
    this.keys.add(key);
    return key;
  }
  ping(): Promise<string> {
    return this.backend.ping();
  }
  get(key: string): Promise<string | null> {
    return this.backend.get(this.key(key));
  }
  eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown> {
    if (
      !Number.isInteger(numberOfKeys) ||
      numberOfKeys < 1 ||
      args.length < numberOfKeys
    ) {
      throw new Error("Test Redis scripts require explicit keys");
    }
    return this.backend.eval(
      script,
      numberOfKeys,
      ...args.map((value, index) =>
        index < numberOfKeys ? this.key(String(value)) : value,
      ),
    );
  }
  async cleanup(): Promise<void> {
    // An exact list of keys touched by this wrapper, never a store-wide operation.
    for (const key of this.keys) await this.backend.del(key);
    this.keys.clear();
  }
}
