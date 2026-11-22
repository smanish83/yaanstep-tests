import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// What to test:
//   SITE_DIR      folder with the website files (default: ../yaanstep-website). A small local server is started for it.
//   BASE_URL      test a real address instead, for example https://yaanstep.com
// See tests/support/site.ts.
const siteDir = process.env.SITE_DIR ?? '../yaanstep-website';
const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
// Use the computer's own Chrome when Playwright's browser download is not available.
const localChrome = !process.env.CI && existsSync('/usr/bin/google-chrome') ? { executablePath: '/usr/bin/google-chrome' } : {};

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // a test that only passes on a second try is a finding, not a pass
  reporter: [['list'], ['html', { outputFolder: 'reports/html', open: 'never' }], ['json', { outputFile: 'reports/results.json' }]],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: process.env.BASE_URL ? undefined : { command: `npx http-server "${siteDir}" -p 4173 -s -c-1`, url: baseURL, reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: localChrome } },
    { name: 'phone', use: { ...devices['Pixel 7'], launchOptions: localChrome } },
    // Tablet size: layout, menu and the Learning games only (the other checks do not depend on width).
    { name: 'tablet', testMatch: /(pages|learning)\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, hasTouch: true, launchOptions: localChrome } },
  ],
});
