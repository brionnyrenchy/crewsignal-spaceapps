import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "@playwright/test";

function findCachedChromium(): string | undefined {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return undefined;
  const msPlaywright = path.join(localAppData, "ms-playwright");
  if (!fs.existsSync(msPlaywright)) return undefined;
  const dirs = fs
    .readdirSync(msPlaywright)
    .filter((d) => d.startsWith("chromium-"))
    .sort()
    .reverse();
  for (const dir of dirs) {
    const candidate = path.join(msPlaywright, dir, "chrome-win64", "chrome.exe");
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || findCachedChromium();
// Deterministic software WebGL2 so the 3D Explorer model renders headless.
const webglArgs = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:1420",
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath, args: webglArgs } : { args: webglArgs },
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 1420",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
