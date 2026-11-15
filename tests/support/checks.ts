import { expect, type Page, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { site } from './site';

/** WCAG 2.0, 2.1 and 2.2 at levels A and AA (the Accessibility page promises 2.2 AA). */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Runs axe and returns one readable line per violation, so a failure says what and where. */
export async function axeViolations(page: Page, only?: string): Promise<string[]> {
  let scan = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (only) scan = scan.include(only); // scan one part of the page, so a shared header or footer bug is reported once
  const result = await scan.analyze();
  return result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

/** Records every request the page makes. Call before page.goto. */
export function watchRequests(page: Page) {
  const seen: { url: string; method: string }[] = [];
  page.on('request', (r) => seen.push({ url: r.url(), method: r.method() }));
  return {
    seen,
    /** Requests that leave the site's own address (a tracker, a font host, an analytics call). */
    external(origin: string) { return seen.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('data:') && !r.url.startsWith('blob:')).map((r) => r.url); },
    /** Anything that sends data (POST, PUT and so on). A static site should only ever GET. */
    sending() { return seen.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.url}`); },
    /** Requests that could carry what the visitor did: not a plain GET, or a GET with something after a "?". */
    carryingData() { return seen.filter((r) => r.method !== 'GET' || new URL(r.url).search !== '').map((r) => `${r.method} ${r.url}`); },
  };
}

/** Everything the browser has stored for this site after the test did its work. */
export async function storedData(page: Page, context: BrowserContext) {
  const inPage = await page.evaluate(async () => {
    let databases: string[] = [];
    let caches_: string[] = [];
    let workers = 0;
    try { databases = ((await indexedDB.databases?.()) ?? []).map((d) => d.name ?? ''); } catch { /* not available */ }
    try { caches_ = await caches.keys(); } catch { /* not available */ }
    try { workers = (await navigator.serviceWorker.getRegistrations()).length; } catch { /* not available */ }
    return { local: Object.keys(localStorage), session: Object.keys(sessionStorage), databases, caches: caches_, workers };
  });
  return { ...inPage, cookies: (await context.cookies()).map((c) => c.name) };
}

/** The site may store nothing, except keys Manish approved (see site.allowedStorageKeys). */
export async function expectNothingStored(page: Page, context: BrowserContext) {
  const s = await storedData(page, context);
  expect(s.cookies, 'cookies').toEqual([]);
  expect(s.local.filter((k) => !site.allowedStorageKeys.includes(k)), 'localStorage keys').toEqual([]);
  expect(s.session, 'sessionStorage keys').toEqual([]);
  expect(s.databases, 'IndexedDB databases').toEqual([]);
  expect(s.caches, 'Cache storage').toEqual([]);
  expect(s.workers, 'service workers').toBe(0);
}

/** How many pixels the page is wider than the screen. 0 or 1 means it fits. */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Collects script errors and console errors. Call before page.goto. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
  return errors;
}
