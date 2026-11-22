import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';
import { knownBug } from '../support/known-bugs';

// Fractions (fractions.html, picture maths for ages 7 to 9, added 22 Nov 2026). Our own games: name the shaded
// fraction, find the bar cut into equal parts, and shade a fraction. Every answer here is worked out by the test
// from the words or the picture on the screen, never read from the page's code.

test.beforeEach(() => { knownBug(); });

const GAMES = [
  { id: 'name', title: 'Name the fraction' },
  { id: 'equal', title: 'Equal parts' },
  { id: 'shade', title: 'Shade it' },
] as const;

const WORDS: Record<number, [string, string]> = { 2: ['half', 'halves'], 3: ['third', 'thirds'], 4: ['quarter', 'quarters'], 6: ['sixth', 'sixths'], 8: ['eighth', 'eighths'] };
const BY_WORD: Record<string, number> = Object.fromEntries(Object.entries(WORDS).flatMap(([d, w]) => [[w[0], +d], [w[1], +d]]));
const fw = (k: number, d: number) => `${k} ${WORDS[d][k === 1 ? 0 : 1]}`;
const shaded = (k: number, d: number) => `${k} of the ${d} equal parts ${k === 1 ? 'is' : 'are'} shaded. That is ${fw(k, d)}, ${k}/${d}.`;

async function open(page: Page) { await page.goto('/fractions.html'); }
const values = (page: Page) => page.locator('#choices button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-v') ?? ''));
/** For each bar on the screen: how many parts it has and whether they are all the same width. */
const barShapes = (page: Page) => page.locator('#choices .barpick').evaluateAll((bs) => bs.map((b) => {
  const w = Array.from(b.querySelectorAll('rect.part')).map((r) => Number(r.getAttribute('width')));
  return { parts: w.length, equal: Math.max(...w) - Math.min(...w) < 0.5, v: b.getAttribute('data-v') };
}));

async function playOne(page: Page, game: string, i: number, wrongFirst = false) {
  await expect(page.locator('#count')).toHaveText(`Round ${i + 1} of 8`);
  const text = (await page.locator('#say').innerText()).trim();
  expect(text, 'grammar').not.toMatch(/\b1 (halves|thirds|quarters|sixths|eighths)\b|\b[2-9] (half|third|quarter|sixth|eighth)\b/);
  await expect(page.locator('#go')).toBeHidden();

  if (game === 'name') {
    const m = text.match(/^The (bar|circle) is cut into equal parts\. What fraction is shaded\?$/);
    expect(m, text).not.toBeNull();
    const d = await page.locator('#art .part').count();
    const k = await page.locator('#art .part[data-shaded="1"]').count();
    expect(Object.keys(WORDS).map(Number)).toContain(d);
    expect(k).toBeGreaterThanOrEqual(1); expect(k).toBeLessThan(d);
    await expect(page.locator(m![1] === 'bar' ? '#art rect.part' : '#art path.part')).toHaveCount(d);
    if (m![1] === 'bar') {
      const w = await page.locator('#art rect.part').evaluateAll((rs) => rs.map((r) => Number(r.getAttribute('width'))));
      expect(Math.max(...w) - Math.min(...w), 'the parts are equal').toBeLessThan(0.5);
    }
    const ans = `${k}/${d}`;
    const opts = await values(page);
    expect(opts.length).toBe(3); expect(new Set(opts).size).toBe(3); expect(opts).toContain(ans);
    for (const v of opts) { const [a, b] = v.split('/').map(Number); expect(a).toBeGreaterThanOrEqual(1); expect(a).toBeLessThan(b); }
    await expect(page.locator(`#choices button[data-v="${ans}"]`)).toContainText(fw(k, d));
    if (wrongFirst) {
      const wrong = opts.find((v) => v !== ans)!;
      await page.locator(`#choices button[data-v="${wrong}"]`).click();
      await expect(page.locator('#tip')).toHaveText('Not yet. Count all the parts, then the shaded ones.');
      await expect(page.locator(`#choices button[data-v="${wrong}"]`)).toBeDisabled();
      await expect(page.locator('#go')).toBeHidden();
    }
    await page.locator(`#choices button[data-v="${ans}"]`).click();
    await expect(page.locator('#right')).toHaveText(shaded(k, d));
  }
  if (game === 'equal') {
    const m = text.match(/^Which bar is cut into (halves|thirds|quarters)\?$/);
    expect(m, text).not.toBeNull();
    const d = BY_WORD[m![1]];
    const bars = await barShapes(page);
    expect(bars.length).toBe(3);
    const good = bars.filter((b) => b.parts === d && b.equal);
    expect(good.length, 'exactly one bar is cut into equal parts of the right number').toBe(1);
    expect(bars.some((b) => b.parts === d && !b.equal), 'one bar has the right number of parts, not equal').toBe(true);
    if (wrongFirst) {
      const wrong = bars.find((b) => b !== good[0])!;
      await page.locator(`#choices .barpick[data-v="${wrong.v}"]`).click();
      await expect(page.locator('#tip')).toHaveText(wrong.parts === d ? 'Not yet. Those parts are not all the same size.' : 'Not yet. Count the parts.');
      await expect(page.locator(`#choices .barpick[data-v="${wrong.v}"]`)).toBeDisabled();
      await expect(page.locator('#go')).toBeHidden();
    }
    await page.locator(`#choices .barpick[data-v="${good[0].v}"]`).click();
    await expect(page.locator('#right')).toHaveText(`That bar has ${d} equal parts, so each part is ${fw(1, d)}.`);
  }
  if (game === 'shade') {
    const m = text.match(/^Shade (\d+) (\w+) of the shape\.$/);
    expect(m, text).not.toBeNull();
    const k = +m![1], d = BY_WORD[m![2]];
    expect(d, text).toBeDefined();
    expect(WORDS[d][k === 1 ? 0 : 1], 'the word fits the number').toBe(m![2]);
    expect(k).toBeGreaterThanOrEqual(1); expect(k).toBeLessThan(d);
    const parts = page.locator('#fgrid .fpart');
    await expect(parts).toHaveCount(d);
    await expect(page.locator('#have')).toHaveText(`Shaded: 0 of ${d} parts`);
    if (wrongFirst) {
      await page.locator('#check').click();
      await expect(page.locator('#tip')).toHaveText('Not yet. Shade some more parts.');
      for (let j = 0; j <= k; j++) await parts.nth(j).click();
      await page.locator('#check').click();
      await expect(page.locator('#tip')).toHaveText('Not yet. That is too many parts.');
      await parts.nth(0).click();
      await expect(parts.nth(0)).toHaveAttribute('aria-pressed', 'false');
    } else {
      for (let j = d - 1; j >= d - k; j--) await parts.nth(j).click();
    }
    await expect(page.locator('#fgrid .fpart[aria-pressed="true"]')).toHaveCount(k);
    await expect(page.locator('#have')).toHaveText(`Shaded: ${k} of ${d} parts`);
    await expect(page.locator('#go')).toBeHidden();
    await page.locator('#check').click();
    await expect(page.locator('#right')).toHaveText(shaded(k, d));
    await expect(page.locator('#check')).toHaveCount(0);
  }
  await expect(page.locator('#go')).toHaveText(i < 7 ? 'Next round' : 'Finish');
  await page.locator('#go').click();
}

test('is a public page linked from Learning: labelled, no errors, no outside requests, nothing sent or stored', async ({ page, context, request }) => {
  await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204 }));
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await open(page);
  expect(await page.locator('meta[name=robots][content*=noindex]').count()).toBe(0);
  await expect(page.locator('h1')).toHaveText('Fractions');
  for (const t of ['our own', 'AI team', 'Not yet tested with children', 'nothing is saved']) await expect(page.locator('body')).toContainText(t);
  expect(await (await request.get('/sprouts.html')).text()).toContain('href="fractions.html"');
  await page.locator('#play-shade').click();
  await playOne(page, 'shade', 0);
  expect(errors).toEqual([]);
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect(reqs.sending()).toEqual([]);
  const s = await storedData(page, context);
  expect(s.local, 'the page saves nothing').toEqual([]);
  expect(s.cookies).toEqual([]);
  const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  expect(hrefs.filter((h) => /^(https?:)?\/\//.test(h))).toEqual([]);
});

for (const g of GAMES) {
  test(`${g.title}: 8 rounds, each worked out from the words or picture, then the end screen`, async ({ page }) => {
    await open(page);
    await page.locator(`#play-${g.id}`).click();
    await expect(page.locator('#title')).toHaveText(g.title);
    for (let i = 0; i < 8; i++) await playOne(page, g.id, i, i === 2);
    await expect(page.locator('#alldone')).toBeVisible();
    await expect(page.locator('#alldone')).toContainText('You finished 8 rounds');
    await page.locator('#again').click();
    await expect(page.locator('#count')).toHaveText('Round 1 of 8');
    await page.locator('#exit').click();
    await expect(page.locator('#menu')).toBeVisible();
  });
}

test('2000 rounds of each game: proper fractions only, choices hold the answer, and the sentences add up', async ({ page }) => {
  await open(page);
  const rounds = await page.evaluate(() => {
    const F = (window as any).YS_FRACTIONS; const out: any[] = [];
    for (let i = 0; i < 2000; i++) for (const g of ['name', 'equal', 'shade']) { const r = F.make[g](); out.push({ ...r, c: g === 'name' ? F.choices(r.k, r.d) : null }); }
    return out;
  });
  for (const r of rounds) {
    const s = JSON.stringify(r);
    if (r.game === 'name' || r.game === 'shade') {
      expect(Object.keys(WORDS).map(Number), s).toContain(r.d);
      expect(r.k, s).toBeGreaterThanOrEqual(1); expect(r.k, s).toBeLessThan(r.d);
      expect(r.right, s).toBe(shaded(r.k, r.d));
    }
    if (r.game === 'name') {
      expect(r.parts.length, s).toBe(r.k); expect(new Set(r.parts).size, s).toBe(r.k);
      expect(r.c.length, s).toBe(3); expect(new Set(r.c).size, s).toBe(3); expect(r.c, s).toContain(`${r.k}/${r.d}`);
      for (const v of r.c) { const [a, b] = v.split('/').map(Number); expect(a, s).toBeGreaterThanOrEqual(1); expect(a, s).toBeLessThan(b); }
    }
    if (r.game === 'shade') expect(r.say, s).toBe(`Shade ${fw(r.k, r.d)} of the shape.`);
    if (r.game === 'equal') {
      expect([2, 3, 4], s).toContain(r.d);
      const right = r.tiles.filter((t: any) => t.parts === r.d && t.kind === 'right');
      expect(right.length, s).toBe(1);
      expect(r.tiles[r.ans].kind, s).toBe('right');
      for (const t of r.tiles) {
        const e = [0, ...t.cuts, 1]; const w = e.slice(1).map((x: number, j: number) => x - e[j]);
        expect(w.length, s).toBe(t.parts);
        if (t.kind === 'uneven') expect(Math.max(...w) - Math.min(...w), s).toBeGreaterThanOrEqual(0.15);
        else expect(Math.max(...w) - Math.min(...w), s).toBeLessThan(1e-9);
      }
    }
  }
});

test('a wrong answer only says "Not yet" and waits: nothing moves on by itself', async ({ page }) => {
  await page.clock.install();
  await open(page);
  await page.locator('#play-shade').click();
  await page.locator('#check').click();
  await expect(page.locator('#tip')).toHaveText('Not yet. Shade some more parts.');
  await page.clock.runFor(60_000);
  await expect(page.locator('#count')).toHaveText('Round 1 of 8');
  await expect(page.locator('#go')).toBeHidden();
});

test('every button is at least 48 by 48 px, even with eighths on a small phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await open(page);
  const check = async () => {
    for (const b of await page.locator('button:visible').all()) {
      const box = (await b.boundingBox())!;
      expect(box.width, await b.innerText()).toBeGreaterThanOrEqual(47.5);
      expect(box.height, await b.innerText()).toBeGreaterThanOrEqual(47.5);
    }
  };
  await check();
  for (const g of GAMES) {
    for (let n = 0; n < (g.id === 'shade' ? 12 : 1); n++) {
      await page.locator(`#play-${g.id}`).click();
      await check();
      await page.locator('#exit').click();
    }
  }
});

for (const view of ['menu', 'name', 'equal', 'shade'] as const) {
  for (const width of [0, 320]) {
    test(`fractions: ${view} view fits the screen and passes the accessibility scan${width ? ' at 320 px' : ''}`, async ({ page }) => {
      if (width) await page.setViewportSize({ width, height: 700 });
      await open(page);
      if (view !== 'menu') await page.locator(`#play-${view}`).click();
      if (view === 'shade') await page.locator('#fgrid .fpart').first().click();
      expect(await horizontalOverflow(page), 'overflow').toBeLessThanOrEqual(1);
      expect(await axeViolations(page), `${view} view`).toEqual([]);
    });
  }
}
