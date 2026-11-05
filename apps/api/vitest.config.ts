import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
    alias: {
      "@tuition-escrow/contract-bindings": path.resolve(
        __dirname,
        "../../packages/contract-bindings/src",
      ),
      "@tuition-escrow/shared": path.resolve(
        __dirname,
        "../../packages/shared/src",
      ),
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});
