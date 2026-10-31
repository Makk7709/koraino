import { defineConfig, devices } from "@playwright/test";

const HOST = "http://127.0.0.1:8765";

/**
 * E2E runs against the in-memory demo, NEVER a real Supabase instance.
 * Tests intercept Brandfetch; no real client ID or CDN availability is required.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 12_000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: HOST,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run dev --host 127.0.0.1 --port 8765 --strictPort",
    url: HOST + "/entreprises",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      // Explicitly override repository .env, which may reference production.
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      SUPABASE_PUBLISHABLE_KEY: "",
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_PUBLISHABLE_KEY: "",
      AI_API_KEY: "",
      VITE_BRANDFETCH_CLIENT_ID: "e2e_test_client",
    },
  },
});
