import { test, expect } from '@playwright/test';
import { axeViolations, watchErrors } from '../support/checks';

// Manish's products feedback (22 Nov 2026, SCRUM-492): product names, icons, and space between the two Habits buttons.
// The products are on the home page now, so nobody has to open another page; the old products.html address still works.
// The young-children product is "Yaanstep Sprouts" and lives at sprouts.html; the old learning.html address still works.

test('names the three products: Yaanstep Sprouts, Yaanstep Teens, Yaanstep Habits', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('.products h3')).toHaveText(['Yaanstep Sprouts', 'Yaanstep Teens', 'Yaanstep Habits']);
  await expect(page.locator('.products li').first().locator('a.btn')).toHaveAttribute('href', 'sprouts.html');
  await expect(page.locator('.products li').first()).toContainText('For children aged 3 to 12');
});

test('each product has its own drawn icon beside its name, hidden from screen readers because the name follows', async ({ page }) => {
  await page.goto('/index.html');
  const icons = page.locator('.products li .p-head svg.p-icon');
  await expect(icons).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(icons.nth(i)).toHaveAttribute('aria-hidden', 'true');
    await expect(icons.nth(i)).toBeVisible();
  }
  const drawn = await icons.evaluateAll((all) => all.map((x) => x.innerHTML));
  expect(new Set(drawn).size, 'three different icons').toBe(3);
});

test('"Try a tiny step" and "Time calculator" have space between them, side by side or stacked', async ({ page }) => {
  await page.goto('/index.html');
  const a = await page.getByRole('link', { name: 'Try a tiny step' }).boundingBox();
  const b = await page.getByRole('link', { name: 'Time calculator' }).boundingBox();
  expect(a && b).toBeTruthy();
  const sameRow = Math.abs(a!.y - b!.y) < 4;
  const gap = sameRow ? b!.x - (a!.x + a!.width) : b!.y - (a!.y + a!.height);
  expect(gap, sameRow ? 'gap across' : 'gap down').toBeGreaterThanOrEqual(8);
  expect(await axeViolations(page)).toEqual([]);
});

test('the Yaanstep Sprouts page is named in its title and heading', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/sprouts.html');
  await expect(page).toHaveTitle(/^Yaanstep Sprouts/);
  await expect(page.locator('h1')).toHaveText('Yaanstep Sprouts');
  expect(errors).toEqual([]);
});

test('the old address learning.html takes you to sprouts.html, keeping the part after #', async ({ page }) => {
  await page.goto('/learning.html#games-h');
  await expect(page).toHaveURL(/\/sprouts\.html#games-h$/);
  await expect(page.locator('h1')).toHaveText('Yaanstep Sprouts');
});

test('the home page shows the products without another click, and the old products.html address takes you there', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#products h2')).toHaveText('Our products');
  expect((await page.locator('header nav a').allTextContents()).map((t) => t.trim())).not.toContain('Products');
  await expect(page.locator('main a.btn').first()).toHaveAttribute('href', 'sprouts.html');
  await page.goto('/products.html');
  await expect(page).toHaveURL(/\/index\.html#products$/);
  await expect(page.locator('#products')).toBeVisible();
});
