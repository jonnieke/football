import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.ts";

let client: PrismaClient | undefined;

export function createPrisma(
  databaseUrl: string,
  options: { schema?: string; connectionTimeoutMillis?: number } = {},
): PrismaClient {
  const schema =
    options.schema ??
    new URL(databaseUrl).searchParams.get("schema") ??
    undefined;
  if (schema !== undefined && !/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(schema))
    throw new Error("Invalid database schema name");
  const adapter = new PrismaPg(
    {
      connectionString: databaseUrl,
      ...(options.connectionTimeoutMillis === undefined
        ? {}
        : { connectionTimeoutMillis: options.connectionTimeoutMillis }),
    },
    schema === undefined ? undefined : { schema },
  );
  return new PrismaClient({ adapter });
}

export function getPrisma(
  databaseUrl = process.env.DATABASE_URL,
): PrismaClient {
  if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
  client ??= createPrisma(databaseUrl);
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}

export type DatabaseClient = PrismaClient;
