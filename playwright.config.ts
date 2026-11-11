import { defineConfig } from "@playwright/test";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少浏览器验收环境变量 ${name}`);
  return value;
}

const jsonReport = requiredEnvironment("ARENA_BROWSER_JSON_REPORT");
const outputDir = requiredEnvironment("ARENA_BROWSER_OUTPUT_DIR");

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  outputDir,
  reporter: [
    ["line"],
    ["json", { outputFile: jsonReport }],
  ],
  use: {
    browserName: "chromium",
    colorScheme: "dark",
    headless: true,
    locale: "zh-CN",
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium-1366x768",
      use: { viewport: { width: 1366, height: 768 } },
    },
    {
      name: "chromium-1920x1080",
      use: { viewport: { width: 1920, height: 1080 } },
    },
  ],
});
