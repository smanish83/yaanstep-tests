import { test, expect } from '../support/test';
import { site, url } from '../support/site';

// The site promises that every page still works with JavaScript off (README, Accessibility page). SCRUM-386.
// Limit: when a test switches JavaScript off, Chrome still does not draw the text inside <noscript>, so the
// two short "needs JavaScript" notices cannot be checked here. They are in the manual test cases instead.

test.use({ javaScriptEnabled: false });

for (const p of site.pages) {
  test(`${p} shows its heading, menu and footer with JavaScript off`, async ({ page }) => {
    await page.goto(url(p));
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('header nav a').first()).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();
    expect((await page.locator('main').innerText()).length, 'main has real text').toBeGreaterThan(200);
  });
}

test('Try it shows the example steps as a table instead of the demo', async ({ page }) => {
  await page.goto(url('try-it'));
  await expect(page.locator('#demo')).toBeHidden();
  await expect(page.locator('#static-list')).toBeVisible();
  await expect(page.locator('#static-list tbody tr')).toHaveCount(5);
});

test('Time calculator shows a worked example instead of the form', async ({ page }) => {
  await page.goto(url('time-calculator'));
  await expect(page.locator('#calc')).toBeHidden();
  await expect(page.locator('#static-example')).toContainText('1,095 hours');
});

test('How it works shows its example table', async ({ page }) => {
  await page.goto(url('how-it-works'));
  await expect(page.locator('main table').first()).toBeVisible();
});

test('Learning shows what the games cover instead of the games', async ({ page }) => {
  await page.goto(url('learning'));
  await expect(page.locator('#learn')).toBeHidden();
  await expect(page.locator('#static-lessons')).toBeVisible();
  await expect(page.locator('#static-lessons tbody tr')).toHaveCount(2);
});
