import react from "@vitejs/plugin-react";
import { defineConfig, configDefaults } from "vitest/config";
import path from "node:path";

// Integration tests exercise the real local Supabase stack (see
// **/*.integration.test.ts). They are excluded from the default `vitest run`
// (vitest.config.ts) because they are non-hermetic; this config runs ONLY the
// integration suites and expects a running DB plus its env (SUPABASE_* keys,
// e.g. from `supabase status` or .env.local). Invoke via `pnpm test:integration`.
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
    include: ["src/**/*.integration.test.{ts,tsx}"],
    exclude: [...configDefaults.exclude],
  },
});
