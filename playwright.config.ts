import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./scripts/e2e", workers: 1, fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:8792", trace: "off",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} },
  projects: [ { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } } ],
  webServer: { command: "node scripts/preview-fixture.mjs", url: "http://127.0.0.1:8792/api/health", reuseExistingServer: false },
});
