import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';
import { knownBug } from '../support/known-bugs';

// Number bonds (number-bonds.html, picture maths for ages 5 to 7, added 22 Nov 2026). Our own games:
// number bonds, take away, and hopping on a number track. Every answer here is worked out by the test from
// the words on the screen and checked against the picture, never read from the page's code.

test.beforeEach(() => { knownBug(); });

type Round = { game: 'bonds' | 'take' | 'track'; ans: number; whole?: number; a?: number; b?: number; t?: number; k?: number; start?: number; hops?: number; add?: boolean };

/** Reads a round's words and works it out. Returns null if the words fit no planned kind. */
function solve(text: string): Round | null {
  let m: RegExpMatchArray | null;
  if ((m = text.match(/^We have (\d+) teal counters? and (\d+) orange counters?\. How many counters in all\?$/))) {
    const a = +m[1], b = +m[2];
    return { game: 'bonds', a, b, whole: a + b, ans: a + b };
  }
  if ((m = text.match(/^There are (\d+) counters\. (\d+) (?:is|are) teal\. How many are orange\?$/))) {
    const w = +m[1], a = +m[2];
    return { game: 'bonds', a, b: w - a, whole: w, ans: w - a };
  }
  if ((m = text.match(/^There were (\d+) balloons\. (\d+) floated away\. How many are left\?$/))) {
    const t = +m[1], k = +m[2];
    return { game: 'take', t, k, ans: t - k };
  }
  if ((m = text.match(/^The frog starts on (\d+)\. It hops (\d+) squares? (on|back)\. Where does it land\?$/))) {
    const s = +m[1], h = +m[2], add = m[3] === 'on';
    return { game: 'track', start: s, hops: h, add, ans: add ? s + h : s - h };
  }
  return null;
}

const GAMES = [
  { id: 'bonds', title: 'Number bonds' },
  { id: 'take', title: 'Take away' },
  { id: 'track', title: 'Hop on the number track' },
] as const;

async function open(page: Page) { await page.goto('/number-bonds.html'); }
const values = (page: Page, sel: string) => page.locator(sel).evaluateAll((es) => es.map((e) => e.getAttribute('data-v')));

/** Plays one round from the words on the screen, checking the picture at each step. */
async function playOne(page: Page, game: string, i: number, wrongFirst = false) {
  await expect(page.locator('#count')).toHaveText(`Round ${i + 1} of 8`);
  const text = (await page.locator('#say').innerText()).trim();
  const r = solve(text);
  expect(r, `words fit a planned kind: ${text}`).not.toBeNull();
  expect(text, 'one thing is never written as plural').not.toMatch(/\b1 (teal counters|orange counters|squares|are)\b/);
  expect(text, 'more than one thing is never written as singular').not.toMatch(/\b([02-9]|1\d) (teal counter|orange counter|square)\b(?!s)|\b([02-9]|1\d) is\b/);
  expect(r!.game).toBe(game);
  expect(r!.ans, text).toBeGreaterThanOrEqual(0);

  if (r!.game === 'bonds') {
    expect(r!.a!).toBeGreaterThanOrEqual(1); expect(r!.b!).toBeGreaterThanOrEqual(1); expect(r!.whole!).toBeLessThanOrEqual(10);
    await expect(page.locator('#art .ctr[data-c="teal"]')).toHaveCount(r!.a!);
    await expect(page.locator('#art .ctr[data-c="orange"]')).toHaveCount(r!.b!);
    const whole = text.startsWith('There are ' + r!.whole + ' counters') ? String(r!.whole) : '?';
    expect(await values(page, '#art .bnode')).toEqual(whole === '?' ? ['?', String(r!.a), String(r!.b)] : [whole, String(r!.a), '?']);
  }
  if (r!.game === 'take') {
    expect(r!.t!).toBeLessThanOrEqual(10); expect(r!.ans).toBeGreaterThanOrEqual(1);
    await expect(page.locator('#art .bln')).toHaveCount(r!.t!);
    await expect(page.locator('#art .bln[data-gone="1"]')).toHaveCount(r!.k!);
    expect(await values(page, '#art .bnode')).toEqual([String(r!.t), String(r!.k), '?']);
    await expect(page.locator('#sum')).toHaveText(`${r!.t} − ${r!.k} = ?`);
  }
  if (r!.game === 'track') {
    expect(r!.ans).toBeGreaterThanOrEqual(0); expect(r!.ans).toBeLessThanOrEqual(20);
    await expect(page.locator('#sum')).toHaveText(`${r!.start} ${r!.add ? '+' : '−'} ${r!.hops} = ?`);
    await expect(page.locator('#art .frog')).toHaveAttribute('data-at', String(r!.start));
    await expect(page.locator('#hops')).toHaveText('Hops: none yet');
    await expect(page.locator('#choices')).toHaveCount(0);
    const landed: number[] = [];
    for (let h = 1; h <= r!.hops!; h++) {
      await expect(page.locator('#hop')).toHaveText(r!.add ? 'Hop on' : 'Hop back');
      await page.locator('#hop').click();
      const at = r!.add ? r!.start! + h : r!.start! - h;
      landed.push(at);
      await expect(page.locator('#art .frog')).toHaveAttribute('data-at', String(at));
      await expect(page.locator('#art .arc')).toHaveCount(h);
      await expect(page.locator(`#art .sq[data-n="${at}"]`)).toHaveCount(1);
      await expect(page.locator('#hops')).toHaveText('Hops: ' + landed.join(', '));
    }
    await expect(page.locator('#hop')).toHaveCount(0);
  }

  const opts = (await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => Number(b.getAttribute('data-v'))))) as number[];
  expect(opts.length).toBe(3);
  expect(new Set(opts).size).toBe(3);
  expect(opts).toContain(r!.ans);
  await expect(page.locator('#go')).toBeHidden();
  if (wrongFirst) {
    const wrong = opts.find((v) => v !== r!.ans)!;
    await page.locator(`#choices button[data-v="${wrong}"]`).click();
    await expect(page.locator('#tip')).toContainText('Not yet');
    await expect(page.locator(`#choices button[data-v="${wrong}"]`)).toBeDisabled();
    await expect(page.locator('#go')).toBeHidden();
  }
  await page.locator(`#choices button[data-v="${r!.ans}"]`).click();

  if (r!.game === 'bonds') {
    await expect(page.locator('#right')).toHaveText(`${r!.a} and ${r!.b} make ${r!.whole}.`);
    expect(await values(page, '#art .bnode')).toEqual([String(r!.whole), String(r!.a), String(r!.b)]);
  }
  if (r!.game === 'take') {
    const n = r!.ans;
    await expect(page.locator('#sum')).toHaveText(`${r!.t} − ${r!.k} = ${n}`);
    await expect(page.locator('#right')).toHaveText(`${r!.t} − ${r!.k} = ${n}. ${n} ${n === 1 ? 'balloon is' : 'balloons are'} left.`);
  }
  if (r!.game === 'track') {
    await expect(page.locator('#right')).toHaveText(`${r!.start} ${r!.add ? '+' : '−'} ${r!.hops} = ${r!.ans}. The frog lands on ${r!.ans}.`);
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
  await expect(page.locator('h1')).toHaveText('Number bonds');
  for (const t of ['our own', 'AI team', 'Not yet tested with children', 'never who you are', 'Points are kept only on this device']) await expect(page.locator('body')).toContainText(t);
  expect(await (await request.get('/sprouts.html')).text()).toContain('href="number-bonds.html"');
  await page.locator('#play-track').click();
  await playOne(page, 'track', 0);
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
  test(`${g.title}: 8 rounds, each worked out from the words and checked against the picture, then the end screen`, async ({ page }) => {
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

test('2000 rounds of each game: the numbers stay in range, and the choices always hold the answer', async ({ page }) => {
  await open(page);
  const bad = await page.evaluate(() => {
    const B = (window as any).YS_BONDS; const out: string[] = [];
    for (let i = 0; i < 2000; i++) {
      for (const g of ['bonds', 'take', 'track']) {
        const r = B.make[g]();
        const c: number[] = B.choices(r.ans);
        if (c.length !== 3 || new Set(c).size !== 3 || !c.includes(r.ans) || c.some((v) => v < 0 || v > 20)) out.push(`${g} choices ${c} for ${r.ans}`);
        out.push(r.say);
      }
    }
    return out;
  });
  for (const s of bad) {
    expect(s, 'choices').not.toMatch(/choices/);
    const r = solve(s);
    expect(r, s).not.toBeNull();
    if (r!.game === 'bonds') { expect(r!.a!, s).toBeGreaterThanOrEqual(1); expect(r!.b!, s).toBeGreaterThanOrEqual(1); expect(r!.whole!, s).toBeLessThanOrEqual(10); }
    if (r!.game === 'take') { expect(r!.t!, s).toBeLessThanOrEqual(10); expect(r!.ans, s).toBeGreaterThanOrEqual(1); }
    if (r!.game === 'track') { expect(r!.hops!, s).toBeLessThanOrEqual(3); expect(r!.ans, s).toBeGreaterThanOrEqual(0); expect(r!.ans, s).toBeLessThanOrEqual(20); }
  }
});

test('a wrong answer only says "Not yet" and waits: nothing moves on by itself', async ({ page }) => {
  await page.clock.install();
  await open(page);
  await page.locator('#play-bonds').click();
  const r = solve((await page.locator('#say').innerText()).trim())!;
  const wrong = (await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => Number(b.getAttribute('data-v'))))).find((v) => v !== r.ans)!;
  await page.locator(`#choices button[data-v="${wrong}"]`).click();
  await expect(page.locator('#tip')).toHaveText('Not yet. Count the counters again.');
  await page.clock.runFor(60_000);
  await expect(page.locator('#count')).toHaveText('Round 1 of 8');
  await expect(page.locator('#go')).toBeHidden();
});

for (const g of GAMES) {
  test(`${g.title}: after a miss, "Show me how" opens a short moving lesson on a different example (SCRUM-495)`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    await page.locator(`#play-${g.id}`).click();
    await expect(page.locator('#howbtn')).toHaveCount(0);
    for (let i = 0; i < 3 && (await page.locator('#hop').count()); i++) await page.locator('#hop').click();
    const r = await page.evaluate(() => (window as any).YS_BONDS.current());
    const wrong = (await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => Number(b.getAttribute('data-v'))))).find((v) => v !== r.ans)!;
    await page.locator(`#choices button[data-v="${wrong}"]`).click();
    await page.locator('#howbtn').click();
    const lesson = page.locator('#lesson');
    await expect(lesson.locator('h3')).toBeFocused();
    await expect(lesson.locator('svg[role=img]')).toHaveAttribute('aria-label', /at a time|what is left/);
    const said = await page.locator('#lesson-say').innerText();
    expect(said, 'the lesson must not give this answer away').not.toMatch(new RegExp(`(=|make|lands on) ${r.ans}\\.`));
    // With reduced motion the last picture shows at once: nothing is left hidden.
    const hidden = await lesson.locator('svg .mv-in').evaluateAll((es) => es.filter((e) => getComputedStyle(e).opacity !== '1').length);
    expect(hidden).toBe(0);
    await lesson.locator('#watch-again').click();
    await expect(lesson.locator('svg')).toHaveCount(1);
    expect(await axeViolations(page, '#game')).toEqual([]);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await page.locator(`#choices button[data-v="${r.ans}"]`).click();
    await expect(page.locator('#lesson')).toHaveCount(0);
    await expect(page.locator('#go')).toBeVisible();
  });
}

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

for (const view of ['menu', 'bonds', 'take', 'track'] as const) {
  for (const width of [0, 320]) {
    test(`number bonds: ${view} view fits the screen and passes the accessibility scan${width ? ' at 320 px' : ''}`, async ({ page }) => {
      if (width) await page.setViewportSize({ width, height: 700 });
      await open(page);
      if (view !== 'menu') await page.locator(`#play-${view}`).click();
      expect(await horizontalOverflow(page), 'overflow').toBeLessThanOrEqual(1);
      expect(await axeViolations(page), `${view} view`).toEqual([]);
    });
  }
}
