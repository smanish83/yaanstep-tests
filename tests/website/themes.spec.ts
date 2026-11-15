import { test, expect } from '@playwright/test';
import { site, url } from '../support/site';
import { axeViolations, expectNothingStored } from '../support/checks';

// Theme switcher (SCRUM-400, SCRUM-401). Only in the build that is waiting to be published.

test.describe('theme switcher', () => {
  test.skip(site.themes.length === 0, `The "${site.name}" site has no theme switcher. Run with SITE_PROFILE=next against the new build.`);

  test('offers the four approved themes, changes the page, and remembers the choice on other pages without a cookie', async ({ page, context }) => {
    await page.goto(url('index'));
    const select = page.locator('#theme-select');
    const options = await select.locator('option').allTextContents();
    expect(options.map((o) => o.trim())).toEqual(['Calm Teal', 'Sunrise', 'Midnight Focus', 'Playful Bloom']);
    const second = (await select.locator('option').nth(1).getAttribute('value'))!;
    await select.selectOption(second);
    await expect(page.locator('html')).toHaveAttribute('data-theme', second);
    await page.goto(url('team'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', second);
    await expect(page.locator('#theme-select')).toHaveValue(second);
    await expectNothingStored(page, context); // the theme key is the only key allowed (SCRUM-401)
  });

  test('the theme menu can be used with the keyboard and has a label', async ({ page }) => {
    await page.goto(url('index'));
    const select = page.locator('#theme-select');
    await expect(page.getByLabel(/theme/i)).toHaveAttribute('id', 'theme-select');
    await select.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('html')).toHaveAttribute('data-theme', /.+/);
  });

  test('the Privacy page says the theme choice is remembered in the browser', async ({ page }) => {
    await page.goto(url('privacy'));
    await expect(page.locator('main')).toContainText('It remembers your theme choice in your browser.');
  });

  for (const theme of site.themes) {
    for (const p of site.pages) {
      test(`${theme || 'default'} theme passes the accessibility scan on ${p}`, async ({ page }) => {
        await page.addInitScript((t) => { if (t) localStorage.setItem('yaanstep-theme', t); }, theme);
        await page.goto(url(p));
        expect(await axeViolations(page)).toEqual([]);
      });
    }
  }
});
