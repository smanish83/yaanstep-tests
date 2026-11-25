import { test, expect } from '../support/test';
import { allPages, HIDDEN } from '../support/pages';
import { watchErrors } from '../support/checks';
import { knownBug } from '../support/known-bugs';

// SMOKE: the quickest answer to "is the site standing up?". Every page of the site (found in the site folder, so a new
// page is included automatically) must load, say what it is, and not throw errors. Detailed checks live in tests/website.

for (const p of allPages()) {
  test(`smoke: ${p} loads with a title, one h1, a menu and no errors`, async ({ page }) => {
    knownBug();
    const errors = watchErrors(page);
    const res = await page.goto(`/${p}.html`);
    expect(res?.status(), 'HTTP status').toBe(200);
    await expect(page).toHaveTitle(/\S/);
    await expect(page.locator('h1').first()).toBeVisible();
    expect(await page.locator('h1').count(), 'number of h1 headings').toBe(1);
    await expect(page.locator('main').first()).toBeVisible();
    if (!HIDDEN.includes(p)) await expect(page.locator('header nav a').first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('smoke: a page that does not exist answers 404', async ({ page }) => {
  const res = await page.goto('/this-page-does-not-exist.html');
  expect(res?.status()).toBe(404);
});

test('smoke: the home page links to the products page and it opens', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('header nav a', { hasText: 'Products' }).first().click();
  await expect(page).toHaveURL(/products\.html$/);
  await expect(page.locator('h1')).toBeVisible();
});
