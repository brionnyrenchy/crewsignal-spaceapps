import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

function resolveLocalChromiumExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  const cacheBase =
    process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright')
      : path.join(os.homedir(), '.cache', 'ms-playwright');

  if (!fs.existsSync(cacheBase)) return undefined;
  const entries = fs
    .readdirSync(cacheBase)
    .filter((d) => d.startsWith('chromium-'))
    .sort()
    .reverse();

  for (const dir of entries) {
    const candidate =
      process.platform === 'win32'
        ? path.join(cacheBase, dir, 'chrome-win64', 'chrome.exe')
        : path.join(cacheBase, dir, 'chrome-linux64', 'chrome');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

const executablePath = resolveLocalChromiumExecutable();

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    acceptDownloads: true,
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
