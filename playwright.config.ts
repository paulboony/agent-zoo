import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  globalSetup: "./tests/global-setup.ts",
  webServer: [
    {
      command: "pnpm --filter @agent-zoo/server dev",
      port: 7777,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
      env: { CLAUDE_HOME: "/tmp/agent-zoo-empty" },
    },
    {
      command: "pnpm --filter @agent-zoo/web dev --host 127.0.0.1",
      port: 5173,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
