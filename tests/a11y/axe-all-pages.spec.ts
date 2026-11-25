import { test, expect } from '../support/test';
import { allPages } from '../support/pages';
import { axeViolations, horizontalOverflow } from '../support/checks';
import { knownBug } from '../support/known-bugs';

// ACCESSIBILITY BY AUTOMATION (axe-core, WCAG 2.0, 2.1 and 2.2 levels A and AA, the standard the Accessibility page promises).
// Every page of the site, on a desktop and a phone screen. Pages are found in the site folder, so new pages are scanned
// automatically. Axe finds about a third of real accessibility problems: it does not replace the keyboard and screen reader
// checks Tomas wrote for Manish's devices (SCRUM-388), and these results are not an accessibility sign-off.

for (const p of allPages()) {
  test(`a11y: ${p} has no axe violations`, async ({ page }) => {
    knownBug();
    await page.goto(`/${p}.html`);
    await page.waitForLoadState('networkidle');
    expect(await axeViolations(page)).toEqual([]);
  });

  test(`a11y: ${p} fits the screen without sideways scrolling`, async ({ page }) => {
    knownBug();
    await page.goto(`/${p}.html`);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });
}

// Keyboard basics on every page: the first Tab stop is the skip link, and every button and link has a name.
for (const p of allPages()) {
  test(`a11y: ${p} first Tab stop is a skip link and every control has a name`, async ({ page }) => {
    knownBug();
    await page.goto(`/${p}.html`);
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return { text: a?.textContent?.trim() ?? '', href: a?.getAttribute('href') ?? '' }; });
    expect(first.href, `first focus: "${first.text}"`).toMatch(/^#/);
    const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea')]
      .filter((el) => { const h = el as HTMLElement; const s = getComputedStyle(h); return s.display !== 'none' && s.visibility !== 'hidden'; })
      .filter((el) => !(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || (el as HTMLElement).innerText?.trim() || (el as HTMLInputElement).labels?.length || el.querySelector('img[alt]:not([alt=""]), svg[aria-label], svg title')))
      .map((el) => el.outerHTML.slice(0, 90)));
    expect(unnamed, 'controls with no accessible name').toEqual([]);
  });
}
