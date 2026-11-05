import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
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
  },
});
