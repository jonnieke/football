import { randomBytes } from "node:crypto";
import argon2 from "argon2";

const keyPattern = /^fcp_([a-zA-Z0-9_-]{12})_([a-zA-Z0-9_-]{32,})$/;

export interface CreatedApiKey {
  plaintext: string;
  prefix: string;
  hash: string;
}

export async function createApiKeyMaterial(): Promise<CreatedApiKey> {
  const prefix = randomBytes(9).toString("base64url").slice(0, 12);
  const secret = randomBytes(32).toString("base64url");
  const plaintext = `fcp_${prefix}_${secret}`;
  const hash = await argon2.hash(plaintext, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  return { plaintext, prefix, hash };
}

export function apiKeyPrefix(plaintext: string): string | null {
  if (plaintext.length > 512) return null;
  return keyPattern.exec(plaintext)?.[1] ?? null;
}

export async function verifyApiKeyHash(
  hash: string,
  plaintext: string,
): Promise<boolean> {
  if (apiKeyPrefix(plaintext) === null) return false;
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}
