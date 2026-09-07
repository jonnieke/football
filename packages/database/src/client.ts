import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.ts";

let client: PrismaClient | undefined;

export function createPrisma(
  databaseUrl: string,
  options: { schema?: string; connectionTimeoutMillis?: number } = {},
): PrismaClient {
  const adapter = new PrismaPg(
    {
      connectionString: databaseUrl,
      ...(options.connectionTimeoutMillis === undefined
        ? {}
        : { connectionTimeoutMillis: options.connectionTimeoutMillis }),
    },
    options.schema === undefined ? undefined : { schema: options.schema },
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
