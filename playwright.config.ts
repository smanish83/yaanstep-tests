import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// SITE_DIR: folder with the built website (default: ../yaanstep-website). A tiny static server is started for it.
// BASE_URL: set this to test a live URL instead (for example https://yaanstep.com).
const siteDir = process.env.SITE_DIR ?? '../yaanstep-website';
const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const localChrome = !process.env.CI && existsSync('/usr/bin/google-chrome') ? { executablePath: '/usr/bin/google-chrome' } : {};

export default defineConfig({
  testDir: './tests',
  reporter: [['list'], ['html', { outputFolder: 'reports/html', open: 'never' }], ['json', { outputFile: 'reports/results.json' }]],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: process.env.BASE_URL ? undefined : { command: `npx http-server ${siteDir} -p 4173 -s -c-1`, url: baseURL, reuseExistingServer: true },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: localChrome } },
    { name: 'phone', use: { ...devices['Pixel 7'], launchOptions: localChrome } },
  ],
});
