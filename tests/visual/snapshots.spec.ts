import { test, expect } from '../support/test';
import { KEY_PAGES } from '../support/pages';
import { knownBug } from '../support/known-bugs';

// LIMITED VISUAL CHECKS: one screenshot of the top of each key page, on desktop and phone. This catches a broken layout,
// a missing style sheet or a changed colour scheme; it is not a pixel-perfect check of everything (that would break on
// every wording change). Pictures live in tests/visual/__snapshots__ and are the approved look.
// When a change to the look is intended: npm run test:visual:update, look at the new pictures, commit them.
// Differences up to 2% of pixels are allowed (see playwright.config.ts).

for (const p of KEY_PAGES) {
  test(`visual: ${p} top of page looks as approved`, async ({ page }) => {
    knownBug();
    await page.goto(`/${p}.html`);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`${p}.png`);
  });
}

test('visual: the Midnight theme still looks as approved (home page)', async ({ page }) => {
  knownBug();
  await page.addInitScript(() => localStorage.setItem('yaanstep-theme', 'midnight'));
  await page.goto('/index.html');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('index-midnight.png');
});
