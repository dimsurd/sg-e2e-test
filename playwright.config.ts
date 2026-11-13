import { defineConfig, devices } from "@playwright/test";
import { API, APP, BO, E2E_DATABASE_URL } from "./fixtures/env";

/**
 * Starts its own copy of all three apps on separate ports with a separate
 * database, so the dev servers (4000/3000/3001) and dev data are untouched.
 *   E2E_SKIP_BUILD=1  reuse the last e2e build of the frontends
 *   E2E_REUSE=1       reuse servers that are already running on the e2e ports
 */
const build = process.env.E2E_SKIP_BUILD ? "" : "pnpm exec next build && ";
const frontendEnv = { API_URL: API, NEXT_DIST_DIR: ".next-e2e", NEXT_TELEMETRY_DISABLED: "1" };

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1, // one shared database
  retries: 0, // flakiness is a bug to investigate, not to hide
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    timezoneId: "Asia/Jakarta",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, grepInvert: /@ios/ },
    { name: "iphone", use: { ...devices["iPhone 14"] }, grep: /@ios/ },
  ],
  webServer: [
    {
      name: "api",
      cwd: "../sg-api",
      command: "bash db/reset.sh && pnpm exec tsx src/server.ts",
      url: `${API}/health`,
      env: { PORT: "4100", DATABASE_URL: E2E_DATABASE_URL, JWT_SECRET: "e2e-secret", NODE_ENV: "test" },
      reuseExistingServer: !!process.env.E2E_REUSE,
      timeout: 120_000,
    },
    {
      name: "app",
      cwd: "../sg-app",
      command: `${build}pnpm exec next start -p 3100`,
      url: `${APP}/login`,
      env: frontendEnv,
      reuseExistingServer: !!process.env.E2E_REUSE,
      timeout: 300_000,
    },
    {
      name: "backoffice",
      cwd: "../sg-backoffice",
      command: `${build}pnpm exec next start -p 3101`,
      url: `${BO}/login`,
      env: frontendEnv,
      reuseExistingServer: !!process.env.E2E_REUSE,
      timeout: 300_000,
    },
  ],
});
