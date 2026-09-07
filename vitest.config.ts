import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    coverage: { reporter: ["text", "json", "html"] },
  },
  resolve: {
    alias: {
      "@fcp/shared": new URL("./packages/shared/src/index.ts", import.meta.url)
        .pathname,
      "@fcp/database": new URL(
        "./packages/database/src/index.ts",
        import.meta.url,
      ).pathname,
      "@fcp/football-core": new URL(
        "./packages/football-core/src/index.ts",
        import.meta.url,
      ).pathname,
      "@fcp/football-provider": new URL(
        "./packages/football-provider/src/index.ts",
        import.meta.url,
      ).pathname,
      "@fcp/content-core": new URL(
        "./packages/content-core/src/index.ts",
        import.meta.url,
      ).pathname,
      "@fcp/api": new URL("./apps/api/src/app.ts", import.meta.url).pathname,
    },
  },
});
