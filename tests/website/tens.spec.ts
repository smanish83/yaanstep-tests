import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';
import { knownBug } from '../support/known-bugs';

// Tens and ones (tens-and-ones.html, place value with pictures for ages 6 to 8, added 22 Nov 2026). Our own games:
// read the rods and cubes, build a number, and compare two numbers. Every answer here is worked out by the test
// from the words or the picture on the screen, never read from the page's code.

test.beforeEach(() => { knownBug(); });

const GAMES = [
  { id: 'read', title: 'How many?' },
  { id: 'build', title: 'Build the number' },
  { id: 'compare', title: 'Which is more?' },
] as const;

const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const tensOnes = (n: number) => `${pl(Math.floor(n / 10), 'ten')} and ${pl(n % 10, 'one')} make ${n}.`;

async function open(page: Page) { await page.goto('/tens-and-ones.html'); }
const nums = (page: Page) => page.locator('#choices button').evaluateAll((bs) => bs.map((b) => Number(b.getAttribute('data-v'))));

/** Plays one round, checking the picture at each step. */
async function playOne(page: Page, game: string, i: number, wrongFirst = false) {
  await expect(page.locator('#count')).toHaveText(`Round ${i + 1} of 8`);
  const text = (await page.locator('#say').innerText()).trim();
  expect(text, 'one thing is never written as plural').not.toMatch(/\b1 (tens|ones|rods)\b/);
  await expect(page.locator('#go')).toBeHidden();
  let ans = -1;
  let right = '';

  if (game === 'read') {
    expect(text).toBe('Each rod is ten. Each cube is one. How many in all?');
    const t = await page.locator('#art .rod').count();
    const o = await page.locator('#art .cube').count();
    ans = t * 10 + o;
    expect(ans).toBeGreaterThanOrEqual(11); expect(ans).toBeLessThanOrEqual(99);
    expect(o).toBeLessThanOrEqual(9);
    await expect(page.locator('#art svg')).toHaveAttribute('aria-label', `${pl(t, 'rod')} of ten and ${pl(o, 'single cube')}.`);
    right = tensOnes(ans);
  }
  if (game === 'compare') {
    const m = text.match(/^Which number is (more|less), (\d+) or (\d+)\?$/);
    expect(m, text).not.toBeNull();
    const a = +m![2], b = +m![3], more = m![1] === 'more';
    expect(a).not.toBe(b);
    for (const n of [a, b]) {
      await expect(page.locator(`#art .side[data-n="${n}"] .rod`)).toHaveCount(Math.floor(n / 10));
      await expect(page.locator(`#art .side[data-n="${n}"] .cube`)).toHaveCount(n % 10);
    }
    ans = more ? Math.max(a, b) : Math.min(a, b);
    const other = ans === a ? b : a;
    const tx = Math.floor(ans / 10), ty = Math.floor(other / 10);
    right = `${ans} is ${m![1]} than ${other}. ` + (tx !== ty
      ? `${ans} has ${pl(tx, 'ten')}, and ${other} has ${pl(ty, 'ten')}.`
      : `Both have ${pl(tx, 'ten')}, so look at the ones: ${pl(ans % 10, 'one')} and ${pl(other % 10, 'one')}.`);
    expect((await nums(page)).sort()).toEqual([a, b].sort());
  }
  if (game === 'build') {
    const m = text.match(/^Make (\d+) with rods and cubes\.$/);
    expect(m, text).not.toBeNull();
    const n = +m![1];
    expect(n).toBeGreaterThanOrEqual(11); expect(n).toBeLessThanOrEqual(99);
    await expect(page.locator('#have')).toHaveText('0 tens and 0 ones make 0.');
    await expect(page.locator('#art svg')).toHaveAttribute('aria-label', 'No blocks yet.');
    if (wrongFirst) {
      // A wrong build says "Not yet" and waits; too many ones says to use a rod.
      await page.locator('#add-one').click();
      await page.locator('#check').click();
      await expect(page.locator('#tip')).toHaveText('Not yet. Count the tens, then the ones.');
      await expect(page.locator('#go')).toBeHidden();
      for (let k = 0; k < 8; k++) await page.locator('#add-one').click();
      await expect(page.locator('#art .cube')).toHaveCount(9);
      await page.locator('#add-one').click();
      await expect(page.locator('#tip')).toHaveText('10 ones make a ten. Use a rod instead.');
      await expect(page.locator('#art .cube')).toHaveCount(9);
      for (let k = 0; k < 9; k++) await page.locator('#take-one').click();
      await expect(page.locator('#art .cube')).toHaveCount(0);
    }
    const t = Math.floor(n / 10), o = n % 10;
    for (let k = 0; k < t; k++) await page.locator('#add-ten').click();
    for (let k = 0; k < o; k++) await page.locator('#add-one').click();
    await expect(page.locator('#art .rod')).toHaveCount(t);
    await expect(page.locator('#art .cube')).toHaveCount(o);
    await expect(page.locator('#have')).toHaveText(tensOnes(n));
    await page.locator('#check').click();
    await expect(page.locator('#right')).toHaveText(tensOnes(n));
    await expect(page.locator('#builders')).toHaveCount(0);
  } else {
    const opts = await nums(page);
    expect(opts.length).toBe(game === 'compare' ? 2 : 3);
    expect(new Set(opts).size).toBe(opts.length);
    expect(opts).toContain(ans);
    for (const v of opts) { expect(v).toBeGreaterThanOrEqual(10); expect(v).toBeLessThanOrEqual(99); }
    if (wrongFirst) {
      const wrong = opts.find((v) => v !== ans)!;
      await page.locator(`#choices button[data-v="${wrong}"]`).click();
      await expect(page.locator('#tip')).toContainText('Not yet');
      await expect(page.locator(`#choices button[data-v="${wrong}"]`)).toBeDisabled();
      await expect(page.locator('#go')).toBeHidden();
    }
    await page.locator(`#choices button[data-v="${ans}"]`).click();
    await expect(page.locator('#right')).toHaveText(right);
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
  await expect(page.locator('h1')).toHaveText('Tens and ones');
  for (const t of ['our own', 'AI team', 'Not yet tested with children', 'nothing is saved']) await expect(page.locator('body')).toContainText(t);
  expect(await (await request.get('/learning.html')).text()).toContain('href="tens-and-ones.html"');
  await page.locator('#play-build').click();
  await playOne(page, 'build', 0);
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

test('2000 rounds of each game: numbers stay from 11 to 99, choices hold the answer, and the sentences add up', async ({ page }) => {
  await open(page);
  const rounds = await page.evaluate(() => {
    const T = (window as any).YS_TENS; const out: any[] = [];
    for (let i = 0; i < 2000; i++) for (const g of ['read', 'build', 'compare']) { const r = T.make[g](); out.push({ ...r, c: g === 'compare' ? null : T.choices(r.ans) }); }
    return out;
  });
  for (const r of rounds) {
    if (r.game !== 'compare') {
      expect(r.t * 10 + r.o, JSON.stringify(r)).toBe(r.n);
      expect(r.n).toBeGreaterThanOrEqual(11); expect(r.n).toBeLessThanOrEqual(99);
      expect(r.right).toBe(tensOnes(r.n));
      expect(r.c.length).toBe(3); expect(new Set(r.c).size).toBe(3); expect(r.c).toContain(r.n);
      for (const v of r.c) { expect(v).toBeGreaterThanOrEqual(10); expect(v).toBeLessThanOrEqual(99); }
    } else {
      expect(r.a).not.toBe(r.b);
      expect(r.ans).toBe(r.more ? Math.max(r.a, r.b) : Math.min(r.a, r.b));
      expect(r.say).toBe(`Which number is ${r.more ? 'more' : 'less'}, ${r.a} or ${r.b}?`);
    }
    expect(`${r.say} ${r.right}`, 'grammar').not.toMatch(/\b1 (tens|ones)\b|\b([02-9]|\d\d) (ten|one)\b(?!s)/);
  }
});

test('a wrong answer only says "Not yet" and waits: nothing moves on by itself', async ({ page }) => {
  await page.clock.install();
  await open(page);
  await page.locator('#play-read').click();
  const ans = (await page.locator('#art .rod').count()) * 10 + (await page.locator('#art .cube').count());
  const wrong = (await nums(page)).find((v) => v !== ans)!;
  await page.locator(`#choices button[data-v="${wrong}"]`).click();
  await expect(page.locator('#tip')).toHaveText('Not yet. Count the rods in tens, then count on the cubes.');
  await page.clock.runFor(60_000);
  await expect(page.locator('#count')).toHaveText('Round 1 of 8');
  await expect(page.locator('#go')).toBeHidden();
});

test('every button is at least 48 by 48 px', async ({ page }) => {
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
    await page.locator(`#play-${g.id}`).click();
    await check();
    await page.locator('#exit').click();
  }
});

for (const view of ['menu', 'read', 'build', 'compare'] as const) {
  for (const width of [0, 320]) {
    test(`tens and ones: ${view} view fits the screen and passes the accessibility scan${width ? ' at 320 px' : ''}`, async ({ page }) => {
      if (width) await page.setViewportSize({ width, height: 700 });
      await open(page);
      if (view !== 'menu') await page.locator(`#play-${view}`).click();
      if (view === 'build') { await page.locator('#add-ten').click(); await page.locator('#add-one').click(); }
      expect(await horizontalOverflow(page), 'overflow').toBeLessThanOrEqual(1);
      expect(await axeViolations(page), `${view} view`).toEqual([]);
    });
  }
}
