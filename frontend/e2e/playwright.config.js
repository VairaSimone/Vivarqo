import { defineConfig, devices } from "@playwright/test";

const inCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.js",
  fullyParallel: false,
  forbidOnly: inCI,
  retries: inCI ? 1 : 0,
  workers: inCI ? 2 : undefined,
  reporter: inCI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    serviceWorkers: "block"
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["iPhone 13"], browserName: "chromium" } }
  ],
  webServer: {
    command: "cd ../.. && pnpm --filter @vivarqo/frontend dev -- --host 127.0.0.1 --port 5173 --strictPort",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !inCI,
    timeout: 120000
  }
});
