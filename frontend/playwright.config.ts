import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: "./e2e", workers: 1, fullyParallel: false, retries: 0, timeout: 30000,
  expect: { timeout: 10000 },
  use: { baseURL: "http://127.0.0.1:3326", viewport: { width: 1440, height: 1200 }, screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: [
    { command: "node ../backend/dist/test/browser-server.js", url: "http://127.0.0.1:3826/workspace", reuseExistingServer: false,
      env: { INCIDENT_TEST_STATE: resolve(".e2e/workspace.json"), ANTHROPIC_API_KEY: "" },
      gracefulShutdown: { signal: "SIGTERM", timeout: 3000 } },
    { command: "npm run start -- --hostname 127.0.0.1 --port 3326", url: "http://127.0.0.1:3326", reuseExistingServer: false,
      env: { MASTRA_BASE_URL: "http://127.0.0.1:3426", COPILOTKIT_TELEMETRY_DISABLED: "true", NEXT_TELEMETRY_DISABLED: "1" },
      gracefulShutdown: { signal: "SIGTERM", timeout: 3000 } },
  ],
});
