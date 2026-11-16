import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';
import { knownBug } from '../support/known-bugs';
import { BANDS, MULT_LIMIT, PAGE, dayTime, playSet, rightAnswer, snapshot, tap, wrongAnswer } from '../support/maths-draft';

// The hidden maths draft page (maths-draft.html, SCRUM-409). It is not in the menu and is not in the site profile,
// so it has its own spec. Expected answers are worked out HERE from the question text, never read from the page's code.

const KEY = 'sprouts:demo';

test.beforeEach(() => { knownBug(); test.setTimeout(240_000); });

async function open(page: Page, day = 300) {
  await page.clock.setFixedTime(dayTime(day));
  await page.goto(PAGE);
}
const band = (page: Page, b: string) => page.locator(`#bands button[data-b="${b}"]`);
/** Step 1 (pick an age band) and step 2 (daily five or star test). */
async function start(page: Page, b: string, mode: 'daily' | 'mile' = 'daily') {
  await band(page, b).click();
  await page.locator(mode === 'daily' ? '#daily' : '#mile').click();
}
const optionTexts = async (page: Page) => (await page.locator('#opts button').allInnerTexts()).map((t) => t.trim());
const points = async (page: Page) => +(await page.locator('#pts').innerText());
const streak = async (page: Page) => +(await page.locator('#streak').innerText());

test('loads as a hidden page: noindex, no menu link from any other page, no errors, nothing sent, no outside requests', async ({ page, request }) => {
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await open(page);
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('h1')).toHaveText('Yaanstep maths (draft preview)');
  await expect(page.locator('.note')).toContainText('Not reviewed, not tested by QA, not for children yet');
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect(reqs.carryingData()).toEqual([]);
  for (const p of ['index', 'learning', 'team', 'privacy', 'how-it-works', 'try-it', 'time-calculator', 'pricing', 'terms', 'accessibility', 'testers']) {
    const html = await (await request.get(`/${p}.html`)).text();
    expect(html, `${p}.html must not link to the hidden page`).not.toContain('maths-draft');
  }
});

test('maths draft: has an icon link like the other pages', async ({ page }) => {
  // Chrome asks for /favicon.ico only some of the time, so the check is on the page itself, not on the console.
  await open(page);
  expect(await page.locator('link[rel~=icon]').count(), 'no <link rel="icon"> on the page').toBeGreaterThan(0);
});

test('maths draft: no console errors and no failed requests', async ({ page }) => {
  await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204 })); // covered by the icon-link test above
  const errors = watchErrors(page);
  await open(page);
  await start(page, '5-6');
  await playSet(page, '5-6');
  expect(errors).toEqual([]);
});

test('never uses the working name in anything a visitor can see or hear', async ({ page }) => {
  await open(page);
  const text = (await page.locator('body').innerText()).toLowerCase();
  expect(text).not.toContain('sprouts');
  expect(await page.title().then((t) => t.toLowerCase())).not.toContain('sprouts');
});

test('menu step 1: only the five age bands (and the parent area); no way to start yet', async ({ page }) => {
  await open(page);
  await expect(page.locator('#pick')).toBeVisible();
  await expect(page.locator('#bands button')).toHaveCount(5);
  await expect(page.locator('#play')).toBeHidden();
  await expect(page.locator('#daily')).toBeHidden();
  await expect(page.locator('#mile')).toBeHidden();
  await expect(page.locator('#game')).toBeHidden();
  await expect(page.locator('#done')).toBeHidden();
  for (const [i, b] of BANDS.entries()) await expect(page.locator('#bands button').nth(i)).toHaveText(`Ages ${b.replace('-', ' to ')}`);
});

test('menu step 2: after choosing a band, it says which, offers the two ways to start, and "Change age band" goes back', async ({ page }) => {
  await open(page);
  await band(page, '7-8').click();
  await expect(page.locator('#pick')).toBeHidden();
  await expect(page.locator('#chosen')).toHaveText('Ages 7 to 8');
  await expect(page.locator('#daily')).toHaveText("Today's 5 puzzles");
  await expect(page.locator('#mile')).toHaveText('Star test (10 puzzles)');
  await expect(page.locator('#daily')).toBeFocused(); // focus moves to the next step for keyboard and screen reader users
  await page.locator('#change').click();
  await expect(page.locator('#pick')).toBeVisible();
  await expect(page.locator('#play')).toBeHidden();
});

for (const b of BANDS) {
  test(`age ${b}: today's 5 puzzles are correct answers, four distinct choices, in range, full marks give 55 points`, async ({ page }) => {
    await open(page);
    await start(page, b);
    await expect(page.locator('#game')).toBeVisible();
    await expect(page.locator('#menu')).toBeHidden(); // game mode: only the game on screen
    await expect(page.locator('#prog')).toHaveText('1 of 5');
    const played = await playSet(page, b);
    expect(played).toHaveLength(5);
    await expect(page.locator('#done')).toBeVisible();
    await expect(page.locator('#result')).toHaveText('You got 5 of 5 on the first try. Your points: 55.');
  });
}

test('multiplication and division stay inside the times tables for each band', async ({ page }) => {
  for (const b of ['7-8', '9-10', '11-12']) {
    // The daily set uses the day as its seed; try several days so every kind turns up.
    for (const day of [300, 301, 302, 303, 304, 305]) {
      await open(page, day);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await start(page, b);
      const played = await playSet(page, b);
      for (const q of played) {
        const mul = q.prompt.match(/^(\d+) x (\d+) = \?$/);
        const div = q.prompt.match(/^(\d+) \/ (\d+) = \?$/);
        if (mul) { expect(+mul[1], q.prompt).toBeLessThanOrEqual(MULT_LIMIT[b]); expect(+mul[2], q.prompt).toBeLessThanOrEqual(MULT_LIMIT[b]); }
        if (div) { const r = +div[1] / +div[2]; expect(Number.isInteger(r), `${q.prompt} must divide exactly`).toBe(true); expect(+div[2], q.prompt).toBeLessThanOrEqual(MULT_LIMIT[b]); expect(r, q.prompt).toBeLessThanOrEqual(MULT_LIMIT[b]); }
      }
    }
  }
});

test('a wrong answer gets a kind hint, is switched off, takes nothing away, and the right answer still works', async ({ page }) => {
  await open(page);
  await start(page, '7-8');
  const s = await snapshot(page);
  const right = rightAnswer(s).text!;
  const wrong = wrongAnswer(s).text!;
  const wrongButton = page.locator('#opts button', { hasText: new RegExp(`^${wrong}$`) });
  await wrongButton.click();
  await expect(page.locator('#msg')).toContainText('Nearly! Here is a hint: ');
  await expect(page.locator('#msg')).toContainText('Try again.');
  await expect(wrongButton).toBeDisabled();
  await expect(page.locator('#msg')).not.toContainText(/wrong|incorrect|fail|bad|lose|lost|minus|-\s?\d+ points/i);
  expect(await points(page)).toBe(0); // nothing is taken away
  await page.locator('#opts button', { hasText: new RegExp(`^${right}$`) }).click();
  await expect(page.locator('#msg')).toHaveText('You got it!');
  await expect(page.locator('#opts button[disabled]')).toHaveCount(4);
});

test('a question answered right only after a mistake does not count as a first-try win', async ({ page }) => {
  await open(page);
  await start(page, '5-6');
  await playSet(page, '5-6', 2);
  await expect(page.locator('#result')).toHaveText('You got 3 of 5 on the first try. Your points: 35.'); // 3 first-try wins x 10 + 5 for finishing
});

test('a mistake on a picture puzzle (ages 3 to 4) is also first-try-lost, kind, and takes nothing away', async ({ page }) => {
  await open(page);
  await start(page, '3-4');
  await playSet(page, '3-4', 2);
  await expect(page.locator('#result')).toHaveText('You got 3 of 5 on the first try. Your points: 35.');
});

test('the same day twice gives points once', async ({ page }) => {
  await open(page);
  await start(page, '5-6');
  await playSet(page, '5-6');
  await page.locator('#home').click();
  expect(await points(page)).toBe(55);
  await page.locator('#daily').click();
  await playSet(page, '5-6');
  await page.locator('#home').click();
  expect(await points(page), 'second run on the same day must not add points').toBe(55);
  expect(await streak(page)).toBe(1);
});

test('streak by day: consecutive days add up; one rest day a week is forgiven; a longer gap starts again at 1', async ({ page }) => {
  // Days are counted from 1 Jan 2026 UTC. Pick days inside one week bucket (floor(day/7)).
  const run = async (day: number) => {
    await open(page, day);
    await start(page, '5-6');
    await playSet(page, '5-6');
    await page.locator('#home').click();
  };
  await run(301); expect(await streak(page)).toBe(1);
  await run(302); expect(await streak(page)).toBe(2);
  await run(304); expect(await streak(page), 'one missed day is forgiven').toBe(3);
  await run(306); expect(await streak(page), 'a second missed day in the same week is not forgiven').toBe(1);
  await run(310); expect(await streak(page), 'a gap of four days starts again').toBe(1);
  await run(311); expect(await streak(page)).toBe(2);
});

test('star test: 8 of 10 first-try earns the star on that band; 7 does not', async ({ page }) => {
  await open(page);
  await start(page, '9-10', 'mile');
  await expect(page.locator('#prog')).toHaveText('1 of 10');
  await playSet(page, '9-10', 3); // three mistakes: 7 of 10 first try
  await expect(page.locator('#result')).toContainText('7 of 10. You need 8 for the star.');
  await page.locator('#home').click();
  await expect(page.locator('#chosen')).not.toContainText('★');
  await page.locator('#mile').click();
  await playSet(page, '9-10', 2); // 8 of 10
  await expect(page.locator('#result')).toContainText('Star earned! 8 of 10.');
  await page.locator('#home').click();
  await expect(page.locator('#chosen')).toContainText('★');
  await page.locator('#change').click();
  await expect(band(page, '9-10')).toContainText('★');
  await expect(band(page, '7-8')).not.toContainText('★');
});

test('Exit goes back to the menu mid-game and keeps the points so far unchanged', async ({ page }) => {
  await open(page);
  await start(page, '5-6');
  await expect(page.locator('#game')).toBeVisible();
  await page.locator('#exit').click();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#game')).toBeHidden();
  expect(await points(page)).toBe(0);
});

test('progress is kept only under one key in this browser, survives a reload, and Reset (after confirming) clears it; no cookies or other storage', async ({ page, context }) => {
  await open(page);
  await start(page, '5-6');
  await playSet(page, '5-6');
  await page.locator('#home').click();
  const s = await storedData(page, context);
  expect(s.local).toEqual([KEY]);
  expect(s.cookies).toEqual([]);
  expect(s.session).toEqual([]);
  expect(s.databases).toEqual([]);
  expect(s.caches).toEqual([]);
  expect(s.workers).toBe(0);
  const saved = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), KEY))!);
  expect(Object.keys(saved).sort()).toEqual(['lastDay', 'milestones', 'points', 'restDaysUsed', 'streak']); // no name, no text, no birth date
  await page.reload();
  expect(await points(page)).toBe(55);
  await page.locator('#reset').click();
  await expect(page.locator('#confirm')).toBeVisible();
  expect(await points(page), 'nothing is deleted until the person confirms').toBe(55);
  await page.locator('#wipe').click();
  expect(await points(page)).toBe(0);
  expect(await streak(page)).toBe(0);
  await expect(page.locator('#pick')).toBeVisible();
});

test('reset is in the parent area, asks first, "No, keep my progress" keeps everything and returns focus to Reset', async ({ page }) => {
  await open(page);
  await start(page, '5-6');
  await playSet(page, '5-6');
  await page.locator('#home').click();
  await expect(page.locator('#confirm')).toBeHidden();
  await page.locator('#reset').click();
  await expect(page.locator('#confirm')).toBeVisible();
  await expect(page.locator('#confirm')).toHaveAttribute('role', 'alertdialog');
  await expect(page.locator('#confirm')).toContainText('cannot be undone');
  await expect(page.locator('#keep')).toBeFocused(); // the safe choice is the one focused
  await page.locator('#keep').click();
  await expect(page.locator('#confirm')).toBeHidden();
  await expect(page.locator('#reset')).toBeFocused();
  expect(await points(page)).toBe(55);
  await page.reload();
  expect(await points(page)).toBe(55);
});

test('a browser that blocks storage still works for the session (no crash)', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  await open(page);
  await start(page, '5-6');
  await playSet(page, '5-6');
  await expect(page.locator('#done')).toBeVisible();
  expect(errors).toEqual([]);
});

test('keyboard only: choose a band, start a set, answer with Enter, the focus ring is visible', async ({ page }) => {
  await open(page);
  await band(page, '7-8').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#daily')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#game')).toBeVisible();
  const s = await snapshot(page);
  const right = page.locator('#opts button', { hasText: new RegExp(`^${rightAnswer(s).text}$`) });
  await right.focus();
  const outline = await right.evaluate((e) => getComputedStyle(e).outlineStyle + ' ' + getComputedStyle(e).outlineWidth);
  expect(outline).toMatch(/solid 4px/);
  await page.keyboard.press('Enter');
  await expect(page.locator('#msg')).toContainText('Yes! Well done.');
});

test('keyboard only: odd-one-out shapes and "which group has more" cards can be reached with Tab and answered with Enter', async ({ page }) => {
  await open(page);
  await band(page, '3-4').click();
  let found = new Set<string>();
  for (let attempt = 0; attempt < 12 && found.size < 2; attempt++) {
    await page.locator('#mile').click();
    for (let i = 0; i < 10; i++) {
      const s = await snapshot(page);
      const a = rightAnswer(s);
      if ((s.kind === 'odd' || s.kind === 'more') && !found.has(s.kind)) {
        found.add(s.kind);
        const target = s.kind === 'odd' ? page.locator('#art .pick').nth(a.pick!) : page.locator('#art .card').nth(a.card!);
        await target.focus();
        await expect(target).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.locator('#msg')).toContainText(/Yes! Well done\./);
      } else await tap(page, a);
      try { await page.waitForFunction((p) => document.getElementById('prog')!.textContent !== p || !document.getElementById('done')!.hidden, (await page.locator('#prog').textContent()) ?? '', { timeout: 4000 }); } catch { /* */ }
      if (await page.locator('#done').isVisible()) break;
    }
    await page.locator('#home').click();
  }
  expect([...found].sort(), 'both tap-the-picture kinds should turn up within 12 star tests').toEqual(['more', 'odd']);
});

test('screen reader hooks: progress and messages are live regions; the question is a heading; buttons are at least 48 px', async ({ page }) => {
  await open(page);
  await start(page, '5-6');
  await expect(page.locator('#prog')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#msg')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#q')).toHaveAttribute('role', 'heading');
  for (const b of await page.locator('button:visible').all()) {
    const box = await b.boundingBox();
    expect(box!.width, await b.innerText()).toBeGreaterThanOrEqual(47.5);
    expect(box!.height, await b.innerText()).toBeGreaterThanOrEqual(47.5);
  }
});

for (const view of ['menu', 'menu after choosing an age band', 'game', 'done'] as const) {
  for (const width of [0, 320]) {
    test(`maths draft: ${view} view fits the screen and passes the accessibility scan${width ? ' at 320 px' : ''}`, async ({ page }) => {
      if (width) await page.setViewportSize({ width, height: 700 });
      await open(page);
      if (view === 'menu after choosing an age band') await band(page, '5-6').click();
      if (view === 'game' || view === 'done') await start(page, '5-6');
      if (view === 'done') await playSet(page, '5-6');
      expect(await horizontalOverflow(page), 'overflow').toBeLessThanOrEqual(1);
      expect(await axeViolations(page), `${view} view`).toEqual([]);
    });
  }
}

test('maths draft: "Hear it" speaks words, not symbols ("12 - 4" must not be read as "12 by 4")', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__spoken = [];
    (window as any).SpeechSynthesisUtterance = function (t: string) { this.text = t; };
    Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak(u: any) { (window as any).__spoken.push(u.text); } } });
  });
  const problems: string[] = [];
  await open(page);
  for (const b of ['5-6', '7-8', '9-10', '11-12']) {
    if (await page.locator('#change').isVisible()) await page.locator('#change').click();
    await start(page, b, 'mile');
    for (let i = 0; i < 10; i++) {
      const s = await snapshot(page);
      await page.evaluate(() => ((window as any).__spoken.length = 0));
      await page.locator('#say').click();
      const spoken: string[] = await page.evaluate(() => (window as any).__spoken);
      const arithmetic = /[-+x/=]/.test(s.prompt.replace(/Which is .*/, ''));
      if (arithmetic) for (const t of spoken) if (/[-+/=]|\dx\d|\bx\b/.test(t)) problems.push(`"${s.prompt}" is spoken as "${t}": symbols are left for the voice to guess`);
      if (!spoken.length) problems.push(`"${s.prompt}": "Hear it" said nothing`);
      await tap(page, rightAnswer(s));
      await page.waitForFunction((p) => document.getElementById('prog')!.textContent !== p || !document.getElementById('done')!.hidden, `${i + 1} of 10`, { timeout: 4000 });
      if (await page.locator('#done').isVisible()) break;
    }
    await page.locator('#home').click();
  }
  expect([...new Set(problems)].slice(0, 15)).toEqual([]);
});
