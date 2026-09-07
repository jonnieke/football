import { defineConfig } from "tsup";

export default defineConfig({
  // Resolve workspace packages through their compiled exports. Inlining them
  // also inlines undeclared transitive/native dependencies into ESM bundles.
  external: [/^@fcp\//],
  platform: "node",
  target: "node24",
});
