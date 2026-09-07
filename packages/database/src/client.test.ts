import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ adapter: vi.fn() }));
vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(...args: unknown[]) {
      mocks.adapter(...args);
    }
  },
}));
vi.mock("./generated/prisma/client.ts", () => ({ PrismaClient: class {} }));
import { createPrisma } from "./client.js";

describe("database schema scoping for standalone processes", () => {
  it("passes a URL schema to the adapter rather than silently using public", () => {
    createPrisma(
      "postgresql://test:test@localhost/football_test?schema=fcp_test_example",
    );
    expect(mocks.adapter).toHaveBeenLastCalledWith(expect.any(Object), {
      schema: "fcp_test_example",
    });
  });
  it("preserves an explicit caller schema override", () => {
    createPrisma(
      "postgresql://test:test@localhost/football_test?schema=url_schema",
      { schema: "explicit_schema" },
    );
    expect(mocks.adapter).toHaveBeenLastCalledWith(expect.any(Object), {
      schema: "explicit_schema",
    });
  });
  it("rejects invalid schema identifiers before constructing a client", () => {
    mocks.adapter.mockClear();
    expect(() =>
      createPrisma(
        "postgresql://test:test@localhost/football_test?schema=bad%3Bschema",
      ),
    ).toThrow("Invalid database schema");
    expect(mocks.adapter).not.toHaveBeenCalled();
  });
});
