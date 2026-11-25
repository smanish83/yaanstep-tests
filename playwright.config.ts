import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// What to test:
//   SITE_DIR      folder with the website files (default: ../yaanstep-website). A small local server is started for it.
//   BASE_URL      test a real address instead, for example https://yaanstep.com
//   SITE_PROFILE  "live" (default) = the site as published today; "next" = the build waiting to be published.
// See tests/support/site.ts.
const siteDir = process.env.SITE_DIR ?? '../yaanstep-website';
const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
// Use the computer's own Chrome when Playwright's browser download is not available.
const localChrome = !process.env.CI && existsSync('/usr/bin/google-chrome') ? { executablePath: '/usr/bin/google-chrome' } : {};

// Which group of tests to run (SUITE=...). Nothing set = everything.
//   smoke       every page loads, has a title and one h1, no console errors (about 1 minute)
//   a11y        axe accessibility scan of every page
//   regression  the detailed checks in tests/website (without the long random sweeps)
//   sweeps      the long random-puzzle sweeps of the maths draft
//   e2e         visitor journeys across several pages
//   visual      a few screenshot comparisons (limited on purpose)
const SUITES: Record<string, { match?: RegExp; ignore?: RegExp }> = {
  smoke: { match: /smoke\/.*\.spec\.ts/ },
  a11y: { match: /a11y\/.*\.spec\.ts/ },
  regression: { match: /website\/.*\.spec\.ts/, ignore: /sweep\.spec\.ts/ },
  sweeps: { match: /sweep\.spec\.ts/ },
  e2e: { match: /e2e\/.*\.spec\.ts/ },
  visual: { match: /visual\/.*\.spec\.ts/ },
};
const suite = process.env.SUITE ? SUITES[process.env.SUITE] : undefined;
if (process.env.SUITE && !suite) throw new Error(`Unknown SUITE "${process.env.SUITE}". Use one of: ${Object.keys(SUITES).join(', ')}`);

export default defineConfig({
  testDir: './tests',
  testMatch: suite?.match,
  testIgnore: suite?.ignore,
  // Run test files and tests side by side. Workers = browser windows at once: half the computer's cores by default
  // (at least 1); set WORKERS=4 to choose. A test never depends on another, so order does not matter.
  fullyParallel: true,
  workers: process.env.WORKERS ? Number(process.env.WORKERS) : process.env.CI ? 2 : '50%',
  forbidOnly: !!process.env.CI,
  retries: 0, // a test that only passes on a second try is a finding, not a pass
  reporter: [['list'], ['html', { outputFolder: 'reports/html', open: 'never' }], ['json', { outputFile: 'reports/results.json' }]],
  // Screenshot comparison (visual suite only): small differences in text smoothing are allowed, layout changes are not.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled', caret: 'hide' } },
  snapshotPathTemplate: '{testDir}/visual/__snapshots__/{testFileName}/{arg}-{projectName}{ext}',
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: process.env.BASE_URL ? undefined : { command: `npx http-server "${siteDir}" -p 4173 -s -c-1`, url: baseURL, reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: localChrome } },
    { name: 'phone', use: { ...devices['Pixel 7'], launchOptions: localChrome } },
    // Tablet size: layout, menu and the Learning games only (the other checks do not depend on width).
    { name: 'tablet', testMatch: /(pages|learning)\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, hasTouch: true, launchOptions: localChrome } },
  ],
});
