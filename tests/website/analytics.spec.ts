import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { axeViolations, watchErrors } from '../support/checks';

// Visit counting (Manish, 24 Nov 2026): "Add the counter on the site, somewhere where user cannot see. Like make a page
// analytics. Which should be accessible only through url. Add easy password for now. The page should contain configuration
// setting, how many users are visited, ... which feature is used most vs which one is least used. What age groups are
// using" and "Yes analytic service should be cookie free. ... Also check for new accounts vs return users."
// assets/analytics.js counts with Umami Cloud. It never runs under automated tests (navigator.webdriver), so these tests
// switch that off, swap in a site code, and replace Umami's script with a stub that records what would be sent.

const SITE = process.env.SITE_DIR ?? '../yaanstep-website';
const UMAMI = 'https://cloud.umami.is/script.js';
const ALLOWED_KEYS = ['page', 'age', 'returning', 'game'];

type Sent = { name: string; data: Record<string, string> };

async function countingOn(context: BrowserContext, opts: { enabled?: boolean } = {}) {
  await context.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); });
  await context.route('**/assets/analytics-config.js', (r) => r.fulfill({
    contentType: 'application/javascript',
    body: `window.YS_ANALYTICS_CONFIG = { enabled: ${opts.enabled ?? true}, websiteId: 'test-site-code', scriptSrc: '${UMAMI}', shareUrl: '' };`,
  }));
  const loads: string[] = [];
  await context.route(UMAMI, (r) => {
    loads.push(r.request().url());
    return r.fulfill({ contentType: 'application/javascript', body: 'window.__sent = window.__sent || []; window.umami = { track: function (n, d) { window.__sent.push({ name: n, data: d }); } };' });
  });
  return loads;
}
const sent = (page: Page) => page.evaluate(() => ((window as any).__sent || []) as Sent[]);
const umamiTag = (page: Page) => page.locator(`script[src="${UMAMI}"]`);

test.describe('counting visits', () => {
  test('a first visit is counted as new, with the page and age band only, and no cookies', async ({ page, context }) => {
    const errors = watchErrors(page);
    await countingOn(context);
    await page.goto('/sprouts.html');
    await expect(umamiTag(page)).toHaveAttribute('data-website-id', 'test-site-code');
    await expect(umamiTag(page)).toHaveAttribute('data-do-not-track', 'true');
    await expect.poll(() => sent(page)).toEqual([{ name: 'visit', data: { page: 'sprouts', age: 'none', returning: 'no' } }]);
    expect(await context.cookies()).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the same visit is counted once; a later visit from the same browser is returning', async ({ page, context }) => {
    await countingOn(context);
    await page.goto('/index.html');
    await expect.poll(async () => (await sent(page)).length).toBe(1);
    await page.goto('/sprouts.html');
    await expect(umamiTag(page)).toHaveCount(1);
    await page.waitForTimeout(300);
    expect((await sent(page)).filter((e) => e.name === 'visit')).toEqual([]);
    // A new tab is a new visit: sessionStorage starts empty, but this browser has been seen before.
    const later = await context.newPage();
    await later.goto('/sprouts.html');
    await expect.poll(() => sent(later)).toEqual([{ name: 'visit', data: { page: 'sprouts', age: 'none', returning: 'yes' } }]);
  });

  test('the age band comes from the child profile, and games opened and finished are counted by name', async ({ page, context }) => {
    await countingOn(context);
    await context.addInitScript(() => { localStorage.setItem('ys-profile', JSON.stringify({ age: 7 })); });
    await page.goto('/opposites.html');
    await expect.poll(async () => (await sent(page))[0]).toEqual({ name: 'visit', data: { page: 'opposites', age: '7-8', returning: 'no' } });
    await page.locator('#play-find').click();
    await expect.poll(async () => (await sent(page)).map((e) => e.name)).toContain('game-open');
    const open = (await sent(page)).find((e) => e.name === 'game-open')!;
    expect(open.data).toEqual({ page: 'opposites', age: '7-8', game: 'Find the opposite' });
    for (const e of await sent(page)) {
      for (const k of Object.keys(e.data)) expect(ALLOWED_KEYS, `${e.name} sends only short labels`).toContain(k);
    }
  });

  for (const [why, setup] of [
    ['the browser was set not to be counted', async (c: BrowserContext) => { await c.addInitScript(() => localStorage.setItem('ys-analytics-off', '1')); }],
    ['the browser asks not to be tracked', async (c: BrowserContext) => { await c.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true })); }],
    ['counting is turned off for the whole site', null],
  ] as const) {
    test(`nothing is loaded, sent or kept when ${why}`, async ({ page, context }) => {
      const loads = await countingOn(context, { enabled: setup !== null });
      if (setup) await setup(context);
      await page.goto('/sprouts.html');
      await page.waitForLoadState('load');
      await page.waitForTimeout(300);
      expect(loads).toEqual([]);
      expect(await page.evaluate(() => [localStorage.getItem('ys-seen'), sessionStorage.getItem('ys-visit')])).toEqual([null, null]);
    });
  }

  test('teens pages and the analytics page are never counted', async ({ page, context }) => {
    const loads = await countingOn(context);
    for (const p of ['/teens.html', '/analytics.html']) {
      await page.goto(p);
      await page.waitForLoadState('load');
    }
    await page.waitForTimeout(300);
    expect(loads).toEqual([]);
  });

  test('every page loads the counting script, after its settings', () => {
    for (const f of readdirSync(SITE).filter((n) => n.endsWith('.html') && n !== 'analytics.html')) {
      const html = readFileSync(join(SITE, f), 'utf8');
      const cfg = html.indexOf('assets/analytics-config.js'), js = html.indexOf('assets/analytics.js');
      expect(cfg, `${f} loads the settings`).toBeGreaterThan(-1);
      expect(js, `${f} loads the counter after the settings`).toBeGreaterThan(cfg);
    }
  });
});

test.describe('the hidden analytics page', () => {
  test('is hidden from search engines and not linked from any page', async ({ page }) => {
    await page.goto('/analytics.html');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    for (const f of readdirSync(SITE).filter((n) => n.endsWith('.html') && n !== 'analytics.html')) {
      expect(readFileSync(join(SITE, f), 'utf8'), `${f} does not link to it`).not.toMatch(/analytics\.html/);
    }
  });

  test('a wrong password shows nothing; the right one shows the settings and how to read the numbers', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/analytics.html');
    await expect(page.locator('#counts')).toBeHidden();
    expect(await axeViolations(page)).toEqual([]);
    await page.locator('#pw').fill('wrong');
    await page.locator('#gate button[type=submit]').click();
    await expect(page.locator('#pw-err')).toBeVisible();
    await expect(page.locator('#counts')).toBeHidden();
    expect(await page.content()).not.toContain('sprouts2026');
    await page.locator('#pw').fill('sprouts2026');
    await page.locator('#pw').press('Enter');
    await expect(page.locator('#counts')).toBeVisible();
    await expect(page.locator('#h-status')).toBeFocused();
    await expect(page.locator('#st-on')).toHaveText('On, but nothing is sent until the site code is filled in');
    await expect(page.locator('#st-code')).toHaveText('Not filled in yet');
    await expect(page.locator('#dash')).toContainText('No dashboard link yet');
    await expect(page.locator('#counts')).toContainText(/New or returning/);
    await expect(page.locator('#counts')).toContainText(/Age groups/);
    expect(await axeViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('"Don\'t count this browser" is kept in this browser only and can be turned back on', async ({ page }) => {
    await page.goto('/analytics.html');
    await page.locator('#pw').fill('sprouts2026');
    await page.locator('#gate button[type=submit]').click();
    const btn = page.locator('#me-off');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#me-state')).toHaveText('This browser is not counted.');
    expect(await page.evaluate(() => localStorage.getItem('ys-analytics-off'))).toBe('1');
    await btn.click();
    expect(await page.evaluate(() => localStorage.getItem('ys-analytics-off'))).toBeNull();
  });
});
