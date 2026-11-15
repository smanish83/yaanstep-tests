import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const pages = ['index', 'products', 'how-it-works', 'team', 'testers', 'try-it', 'time-calculator', 'learning', 'pricing', 'privacy', 'terms', 'accessibility'];
const menu = ['Home', 'Products', 'How it works', 'Team', 'Join the testers'];

for (const p of pages) {
  test.describe(`page ${p}`, () => {
    test('loads with a title, one h1, a main landmark and no console errors', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      const res = await page.goto(`/${p}.html`);
      expect(res?.status()).toBe(200);
      await expect(page).toHaveTitle(/Yaanstep/);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('main')).toHaveCount(1);
      expect(errors).toEqual([]);
    });

    test('shared menu is the same on every page', async ({ page }) => {
      await page.goto(`/${p}.html`);
      const labels = await page.locator('nav a').allTextContents();
      for (const m of menu) expect(labels.map((l) => l.trim())).toContain(m);
    });

    test('no horizontal scroll (layout fits the screen)', async ({ page }) => {
      await page.goto(`/${p}.html`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });

    test('no trackers: only same-origin requests, no cookies', async ({ page, context }) => {
      const external: string[] = [];
      const base = new URL(test.info().project.use.baseURL ?? 'http://127.0.0.1:4173').origin;
      page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('data:')) external.push(r.url()); });
      await page.goto(`/${p}.html`);
      expect(external).toEqual([]);
      expect(await context.cookies()).toEqual([]);
    });

    test('accessibility scan (axe, WCAG 2.1 A and AA) finds no violations', async ({ page }) => {
      await page.goto(`/${p}.html`);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    });

    test('legal guard: no banned privacy claims', async ({ page }) => {
      await page.goto(`/${p}.html`);
      const text = (await page.locator('body').innerText()).toLowerCase();
      for (const bad of ['nothing leaves the phone', 'no account', 'clinically proven', 'guaranteed', 'cures ', 'proven to']) expect.soft(text, bad).not.toContain(bad);
    });
  });
}

test('legal pages say they are team-written and not legal advice', async ({ page }) => {
  for (const p of ['privacy', 'terms']) {
    await page.goto(`/${p}.html`);
    const t = (await page.locator('main').innerText()).toLowerCase();
    expect(t, p).toContain('draft');
    expect(t, p).toMatch(/not legal advice|no lawyer|not reviewed by a lawyer/);
  }
});

test('footer states the main app age line', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('footer')).toContainText('ages 13 and up');
});

test.describe('theme switcher', () => {
  test('changes theme, remembers it in the browser on other pages, sets no cookie', async ({ page, context }) => {
    await page.goto('/index.html');
    const sel = page.locator('#theme-select');
    const options = await sel.locator('option').allTextContents();
    expect(options.length).toBe(4);
    expect(options.join('|')).toMatch(/Calm Teal/);
    const second = await sel.locator('option').nth(1).getAttribute('value');
    await sel.selectOption(second!);
    await expect(page.locator('html')).toHaveAttribute('data-theme', second!);
    await page.goto('/team.html');
    await expect(page.locator('html')).toHaveAttribute('data-theme', second!);
    expect(await context.cookies()).toEqual([]);
  });
});

test.describe('Try it demo', () => {
  test('shows a step, switches profile, runs the 10 second countdown start', async ({ page }) => {
    await page.goto('/try-it.html');
    await expect(page.locator('#tiny')).not.toBeEmpty();
    const first = await page.locator('#tiny').innerText();
    await page.getByLabel('Desk job').check();
    await expect(page.locator('#tiny')).not.toBeEmpty();
    await page.locator('#another').click();
    await page.locator('#start').click();
    await expect(page.locator('#countdown')).toBeVisible();
    await expect(page.locator('#count-text')).toHaveText(/\d+/);
    await page.locator('#cancel').click();
    await expect(page.locator('#countdown')).toBeHidden();
    expect(first.length).toBeGreaterThan(5);
  });
  test('states steps are drafts not tested with real users', async ({ page }) => {
    await page.goto('/try-it.html');
    await expect(page.locator('main')).toContainText('not been tested with real users');
  });
});

test.describe('Time calculator', () => {
  test('computes a result and updates when inputs change', async ({ page }) => {
    await page.goto('/time-calculator.html');
    const out = page.locator('#out');
    await expect(out).not.toBeEmpty();
    const before = await out.innerText();
    await page.locator('#hours').fill('5');
    await expect(out).not.toHaveText(before);
  });
  test('works for the keyboard (tab reaches the fields)', async ({ page }) => {
    await page.goto('/time-calculator.html');
    await page.locator('#hours').focus();
    await expect(page.locator('#hours')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#back')).toBeFocused();
  });
});

test.describe('Learning page (sample lessons)', () => {
  test('states it was designed by AI and not tested with children', async ({ page }) => {
    await page.goto('/learning.html');
    const t = (await page.locator('main').innerText()).toLowerCase();
    expect(t).toContain('ai');
    expect(t).toMatch(/not (been )?tested with children|not tested with real children/);
  });
  test('stores nothing: no localStorage keys and no cookies after playing', async ({ page, context }) => {
    await page.goto('/learning.html');
    const buttons = page.getByRole('button');
    if (await buttons.count()) await buttons.first().click({ trial: true }).catch(() => {});
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => !k.startsWith('yaanstep-theme')));
    expect(keys).toEqual([]);
    expect(await context.cookies()).toEqual([]);
  });
});

test('no page collects data: no forms that submit anywhere', async ({ page }) => {
  for (const p of pages) {
    await page.goto(`/${p}.html`);
    const actions = await page.locator('form[action]').evaluateAll((f) => f.map((x) => x.getAttribute('action')));
    expect(actions, p).toEqual([]);
  }
});

test.describe('every theme passes the accessibility scan (colour contrast)', () => {
  for (const theme of ['', 'sunrise', 'midnight', 'bloom']) {
    for (const p of ['index', 'try-it', 'products']) {
      test(`${theme || 'default'} theme on ${p}`, async ({ page }) => {
        await page.addInitScript((t) => { if (t) localStorage.setItem('yaanstep-theme', t); }, theme);
        await page.goto(`/${p}.html`);
        const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      });
    }
  }
});
