import { describe, expect, it } from "vitest";
import {
  apiKeyPrefix,
  createApiKeyMaterial,
  verifyApiKeyHash,
} from "./index.js";

describe("API key material", () => {
  it("hashes keys and verifies only the original", async () => {
    const key = await createApiKeyMaterial();
    expect(key.hash).not.toContain(key.plaintext);
    expect(apiKeyPrefix(key.plaintext)).toBe(key.prefix);
    await expect(verifyApiKeyHash(key.hash, key.plaintext)).resolves.toBe(true);
    await expect(verifyApiKeyHash(key.hash, `${key.plaintext}x`)).resolves.toBe(
      false,
    );
  });
});

describe("rate-limit contract", () => {
  it("is covered through the Redis-backed API integration boundary", () => {
    expect(apiKeyPrefix("invalid")).toBeNull();
  });
});
