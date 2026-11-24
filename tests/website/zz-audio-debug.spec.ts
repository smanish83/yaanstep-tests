import { test } from '@playwright/test';

test('debug: how each page of A dog plays', async ({ page }) => {
  test.setTimeout(90000);
  const log: string[] = [];
  page.on('console', (m) => log.push('console ' + m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => log.push('requestfailed: ' + r.url() + ' ' + r.failure()?.errorText));
  page.on('response', (r) => { if (r.url().includes('/audio/')) log.push(`response ${r.status()} ${r.headers()['content-type']} ${r.url().split('/').slice(-2).join('/')}`); });
  await page.goto('/library.html');
  await page.locator('#ages').selectOption('all');
  await page.locator('#q').fill('A dog');
  await page.locator('#shelf .bookbtn[data-id="asp-a-dog"]').click();
  await page.locator('#readall').click();
  const t0 = Date.now();
  let last = '';
  for (let i = 0; i < 300; i++) {
    const s = await page.evaluate(() => {
      const p = (window as any).YS_READ.player();
      return [document.getElementById('rcount')!.textContent, p && p.src.split('/').pop(), p && p.paused, p && p.currentTime.toFixed(2), p && p.readyState, p && p.networkState, p && p.error && p.error.code, p && p.ended, (window as any).YS_READ.recorded()].join(' | ');
    });
    if (s !== last) { log.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`); last = s; }
    if (s.startsWith('The end')) break;
    await page.waitForTimeout(200);
  }
  console.log(log.join('\n'));
});
