import react from "@vitejs/plugin-react";
import { defineConfig, configDefaults } from "vitest/config";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Next-only marker module; not installed as a package, so stub it.
      "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Integration tests hit the live local Supabase stack and are NOT hermetic;
    // keep them out of the default `vitest run` so a clean checkout passes
    // without a running DB. Run them via `npm run test:integration`.
    exclude: [...configDefaults.exclude, "**/*.integration.test.{ts,tsx}"],
    coverage: { reporter: ["text", "json", "html"] },
  },
});
