import { test, expect } from '@playwright/test';
import { site, url } from '../support/site';

// Every link, picture, style sheet and script on every page must lead somewhere. SCRUM-386.

/** Links that leave the site. A new one must be added here on purpose, after review. */
const ALLOWED_EXTERNAL = [/^mailto:hello@yaanstep\.com(\?subject=[\w%.-]+)?$/];

test('no broken links or missing files on any page', async ({ page, request, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const broken: string[] = [];
  const checked = new Map<string, number>();
  for (const p of site.pages) {
    await page.goto(url(p));
    const refs = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll('a[href], link[href]').forEach((e) => out.push((e as HTMLAnchorElement).href));
      document.querySelectorAll('img[src], script[src]').forEach((e) => out.push((e as HTMLImageElement).src));
      return out;
    });
    for (const ref of refs) {
      if (!ref.startsWith(origin)) {
        if (!ALLOWED_EXTERNAL.some((ok) => ok.test(ref))) broken.push(`${p}: link leaves the site and is not on the allowed list: ${ref}`);
        continue;
      }
      const [file, fragment] = ref.split('#');
      if (!checked.has(file)) checked.set(file, (await request.get(file)).status());
      if (checked.get(file) !== 200) { broken.push(`${p}: ${ref} answered ${checked.get(file)}`); continue; }
      if (fragment && file === page.url().split('#')[0] && (await page.locator(`[id="${fragment}"]`).count()) === 0) {
        broken.push(`${p}: no element with id "${fragment}" for ${ref}`);
      }
    }
  }
  expect(broken).toEqual([]);
});

test('every page of the site can be reached from the home page menu or footer', async ({ page }) => {
  await page.goto(url('index'));
  const reachable = new Set(await page.locator('a[href$=".html"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!.replace('.html', ''))));
  // Second level: pages linked from the pages the home page links to (for example pages under Products).
  for (const first of [...reachable]) {
    await page.goto(url(first));
    for (const h of await page.locator('a[href$=".html"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!.replace('.html', '')))) reachable.add(h);
  }
  expect(site.pages.filter((p) => !reachable.has(p)), 'pages nobody links to').toEqual([]);
});
