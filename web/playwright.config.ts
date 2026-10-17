import { defineConfig, devices } from '@playwright/test';

const publicURL = process.env.GHOSTCHARS_BROWSER_URL;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.pw.ts',
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  use: { baseURL: publicURL ?? 'http://127.0.0.1:4322/ghostchars/', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: publicURL ? undefined : {
    command: `"${process.execPath}" node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4322 --strictPort`,
    wait: { stdout: /http:\/\/127\.0\.0\.1:4322\/ghostchars\// },
  },
});
