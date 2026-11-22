import { test, expect } from '@playwright/test';
import { site, url } from '../support/site';
import { axeViolations, expectNothingStored } from '../support/checks';

// Theme switcher (SCRUM-400, SCRUM-401). Only in the build that is waiting to be published.

test.describe('theme switcher', () => {
  test.skip(site.themes.length === 0, `The "${site.name}" site has no theme switcher. Run with SITE_PROFILE=next against the new build.`);

  test('offers the four approved themes as colour buttons, changes the page, and remembers the choice on other pages without a cookie', async ({ page, context }) => {
    await page.goto(url('index'));
    const group = page.getByRole('group', { name: 'Colour theme' });
    const buttons = group.getByRole('button');
    expect(await buttons.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['Theme: Calm Teal', 'Theme: Sunrise', 'Theme: Midnight Focus', 'Theme: Playful Bloom']);
    await expect(buttons.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await buttons.nth(1).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sunrise');
    await expect(buttons.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(buttons.nth(0)).toHaveAttribute('aria-pressed', 'false');
    await page.goto(url('team'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sunrise');
    await expect(page.getByRole('group', { name: 'Colour theme' }).getByRole('button').nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expectNothingStored(page, context); // the theme key is the only key allowed (SCRUM-401)
  });

  test('going back to Calm Teal removes the stored choice', async ({ page }) => {
    await page.goto(url('index'));
    const buttons = page.getByRole('group', { name: 'Colour theme' }).getByRole('button');
    await buttons.nth(2).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');
    await buttons.nth(0).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
    expect(await page.evaluate(() => localStorage.getItem('yaanstep-theme'))).toBeNull();
  });

  test('the colour buttons are labelled, keyboard-operable and big enough to tap', async ({ page }) => {
    await page.goto(url('index'));
    const group = page.getByRole('group', { name: 'Colour theme' });
    const buttons = group.getByRole('button');
    for (let i = 0; i < 4; i++) {
      const box = (await buttons.nth(i).boundingBox())!;
      expect(box.width, `button ${i} width`).toBeGreaterThanOrEqual(44);
      expect(box.height, `button ${i} height`).toBeGreaterThanOrEqual(44);
    }
    await buttons.nth(3).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'bloom');
    await expect(buttons.nth(3)).toHaveAttribute('aria-pressed', 'true');
  });

  test('the Privacy page says the theme choice is remembered in the browser', async ({ page }) => {
    await page.goto(url('privacy'));
    await expect(page.locator('main')).toContainText('It remembers your theme choice, and progress in the learning games, only in your browser.');
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
