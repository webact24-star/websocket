import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright Configuration for Chaos Testing
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Run tests sequentially for WebSocket stability
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for WebSocket tests
  reporter: [
    ["html", { outputFolder: "playwright-report" }],
    ["json", { outputFile: "playwright-results.json" }],
    ["list"],
  ],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    video: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
