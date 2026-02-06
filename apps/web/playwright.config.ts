import { defineConfig } from "@playwright/test";

const WEB_URL = process.env.WEB_URL || "http://localhost:5173";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 12_000 },
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: WEB_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  reporter: [["list"]],
});

