import { defineConfig } from '@playwright/test';

/* Smoke tests against the built app (vite preview), so they see what GitHub Pages serves. */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173/time-calculator/',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    // CHROMIUM_PATH: a Chromium already on the machine, instead of the one `playwright install` downloads
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
  },
  webServer: {
    command: 'bunx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/time-calculator/',
    reuseExistingServer: !process.env.CI,
  },
});
