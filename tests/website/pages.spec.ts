import { test, expect } from '../support/test';
import { site, url } from '../support/site';
import { axeViolations, expectNothingStored, horizontalOverflow, watchErrors, watchRequests } from '../support/checks';
import { knownBug } from '../support/known-bugs';

// Checks that every page of the website must pass. SCRUM-386.

for (const p of site.pages) {
  test.describe(`page ${p}`, () => {
    test('loads with a title, a description, one h1, landmarks and no errors', async ({ page }) => {
      knownBug();
      const errors = watchErrors(page);
      const res = await page.goto(url(p));
      expect(res?.status()).toBe(200);
      await expect(page).toHaveTitle(/\S.* \| Yaanstep$/);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      expect((await page.locator('meta[name="description"]').getAttribute('content'))?.length ?? 0, 'meta description').toBeGreaterThan(30);
      await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /width=device-width/);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('header')).toHaveCount(1);
      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.locator('footer')).toHaveCount(1);
      expect(errors).toEqual([]);
    });

    test('main menu is the shared menu and marks the current page', async ({ page }) => {
      knownBug();
      await page.goto(url(p));
      const links = page.locator('header nav a');
      const labels = (await links.allTextContents()).map((l) => l.trim());
      if (site.exactMenu) {
        expect(labels).toEqual(site.menu.map((m) => m.label));
        expect(await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual(site.menu.map((m) => m.href));
        const current = await page.locator('header nav a[aria-current="page"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
        expect(current).toEqual(site.menu.some((m) => m.href === `${p}.html`) ? [`${p}.html`] : []);
      } else {
        for (const m of site.menu) expect(labels).toContain(m.label);
      }
    });

    test('skip link is the first stop for the keyboard and points at the main content', async ({ page }) => {
      knownBug();
      await page.goto(url(p));
      await page.keyboard.press('Tab');
      const skip = page.locator('a.skip');
      await expect(skip).toBeFocused();
      await expect(skip).toHaveAttribute('href', '#main');
      await expect(skip).toBeInViewport();
      await expect(page.locator('main#main')).toHaveCount(1);
    });

    test('fits the screen: no sideways scroll, also at 320 px wide', async ({ page }) => {
      knownBug();
      await page.goto(url(p));
      expect(await horizontalOverflow(page), 'at the device width').toBeLessThanOrEqual(1);
      await page.setViewportSize({ width: 320, height: 640 }); // WCAG 1.4.10 Reflow
      expect(await horizontalOverflow(page), 'at 320 px').toBeLessThanOrEqual(1);
    });

    test('no trackers: same-origin requests only, nothing sent, nothing stored', async ({ page, context, baseURL }) => {
      knownBug();
      const requests = watchRequests(page);
      await page.goto(url(p));
      await page.waitForLoadState('networkidle');
      expect(requests.external(new URL(baseURL!).origin), 'requests to other sites').toEqual([]);
      expect(requests.sending(), 'requests that send data').toEqual([]);
      await expectNothingStored(page, context);
    });

    test('accessibility scan (axe, WCAG 2.2 A and AA) finds no violations', async ({ page }) => {
      knownBug();
      await page.goto(url(p));
      expect(await axeViolations(page)).toEqual([]);
    });
  });
}

test('every page has its own title and description', async ({ page }) => {
  const titles: string[] = [];
  const descriptions: string[] = [];
  for (const p of site.pages) {
    await page.goto(url(p));
    titles.push(await page.title());
    descriptions.push((await page.locator('meta[name="description"]').getAttribute('content')) ?? '');
  }
  expect(new Set(titles).size, `titles: ${titles.join(' / ')}`).toBe(site.pages.length);
  expect(new Set(descriptions).size, 'descriptions').toBe(site.pages.length);
});

test('a page that does not exist answers 404, not a blank or wrong page', async ({ request }) => {
  const res = await request.get('/this-page-does-not-exist.html');
  expect(res.status()).toBe(404);
});
