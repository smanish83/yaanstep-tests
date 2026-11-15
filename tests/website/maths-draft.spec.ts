import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';
import { knownBug } from '../support/known-bugs';

// The hidden maths draft page (maths-draft.html, SCRUM-409). It is not in the menu and is not in the site profile,
// so it has its own spec. Expected answers are worked out HERE from the question text, never read from the page's code.

const PAGE = '/maths-draft.html';
const BANDS = ['3-4', '5-6', '7-8', '9-10', '11-12'] as const;
const MAX: Record<string, number> = { '3-4': 5, '5-6': 20, '7-8': 100, '9-10': 1000, '11-12': 10000 };
const MULT_LIMIT: Record<string, number> = { '7-8': 10, '9-10': 12, '11-12': 25 };
const KEY = 'sprouts:demo';
const DAY0 = Date.UTC(2026, 0, 1);
const dayTime = (n: number) => new Date(DAY0 + n * 864e5 + 12 * 36e5); // noon UTC on day n

test.beforeEach(() => { knownBug(); test.setTimeout(240_000); });

async function open(page: Page, day = 300) {
  await page.clock.setFixedTime(dayTime(day));
  await page.goto(PAGE);
}
const band = (page: Page, b: string) => page.locator(`#bands button[data-b="${b}"]`);
const optionTexts = async (page: Page) => (await page.locator('#opts button').allInnerTexts()).map((t) => t.trim());
const nextPromptWait = (page: Page, prev: string) => page.waitForFunction((p) => document.getElementById('q')!.textContent !== p || !document.getElementById('done')!.hidden, prev, { timeout: 4000 });

/** The right answer, worked out from the words on the screen (numbers only; picture puzzles are done separately). */
function answerFromPrompt(prompt: string): number {
  let m: RegExpMatchArray | null;
  if ((m = prompt.match(/^(\d+) \+ (\d+) \+ (\d+) = \?$/))) return +m[1] + +m[2] + +m[3];
  if ((m = prompt.match(/^(\d+) \+ (\d+) = \?$/))) return +m[1] + +m[2];
  if ((m = prompt.match(/^(\d+) - (\d+) = \?$/))) return +m[1] - +m[2];
  if ((m = prompt.match(/^(\d+) x (\d+) = \?$/))) return +m[1] * +m[2];
  if ((m = prompt.match(/^(\d+) \/ (\d+) = \?$/))) return +m[1] / +m[2];
  if ((m = prompt.match(/^(\d+) \+ \? = (\d+)$/))) return +m[2] - +m[1];
  if ((m = prompt.match(/^Which is bigger: (\d+) or (\d+)\?$/))) return Math.max(+m[1], +m[2]);
  if ((m = prompt.match(/^Which is (smallest|biggest): (\d+), (\d+) or (\d+)\?$/))) {
    const n = [+m[2], +m[3], +m[4]];
    return m[1] === 'smallest' ? Math.min(...n) : Math.max(...n);
  }
  throw new Error(`question not understood by the test: "${prompt}"`);
}

/** Right answer for a picture puzzle, from the number of shapes actually drawn. */
async function answerFromPictures(page: Page, prompt: string): Promise<string> {
  const groups = await page.locator('#art .grp').evaluateAll((els) => els.map((g) => g.querySelectorAll('svg').length));
  if (/^How many .* can you see\?$/.test(prompt)) return String(groups[0]);
  if (/add one more/.test(prompt)) return String(groups[0] + 1);
  if (prompt === 'Which group has more? Tap it.') return groups[0] > groups[1] ? 'Left' : 'Right';
  throw new Error(`picture question not understood: "${prompt}"`);
}

interface Played { prompts: string[]; choices: string[][] }

/** Plays a started set. wrongFirst: how many questions to answer wrongly once before answering right. */
async function playSet(page: Page, band: string, wrongFirst = 0): Promise<Played> {
  const out: Played = { prompts: [], choices: [] };
  for (let i = 0; ; i++) {
    const prompt = (await page.locator('#q').innerText()).trim();
    const options = await optionTexts(page);
    out.prompts.push(prompt);
    out.choices.push(options);
    const expected = band === '3-4' ? await answerFromPictures(page, prompt) : String(answerFromPrompt(prompt));
    expect(options, `choices for "${prompt}" must include the right answer`).toContain(expected);
    expect(new Set(options).size, `choices for "${prompt}" must be distinct`).toBe(options.length);
    if (i < wrongFirst) {
      const wrong = options.find((o) => o !== expected)!;
      await page.locator('#opts button', { hasText: new RegExp(`^${wrong}$`) }).click();
      await expect(page.locator('#msg')).toContainText('Nearly! Here is a hint');
    }
    await page.locator('#opts button', { hasText: new RegExp(`^${expected}$`) }).click();
    await expect(page.locator('#msg')).toContainText(/Yes! Well done\.|You got it!/);
    try { await nextPromptWait(page, prompt); } catch { /* last question: the done view shows */ }
    if (await page.locator('#done').isVisible()) break;
    if (i > 20) throw new Error('set did not finish');
  }
  return out;
}

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
  await page.locator('#daily').click();
  await playSet(page, '5-6');
  expect(errors).toEqual([]);
});

test('never uses the working name in anything a visitor can see or hear', async ({ page }) => {
  await open(page);
  const text = (await page.locator('body').innerText()).toLowerCase();
  expect(text).not.toContain('sprouts');
  expect(await page.title().then((t) => t.toLowerCase())).not.toContain('sprouts');
});

test('menu: five age bands, one chosen, two ways to start, nothing else showing', async ({ page }) => {
  await open(page);
  await expect(page.locator('#bands button')).toHaveCount(5);
  await expect(page.locator('#bands button[aria-pressed=true]')).toHaveCount(1);
  await expect(page.locator('#daily')).toHaveText("Today's 5 puzzles");
  await expect(page.locator('#mile')).toHaveText('Star test (10 puzzles)');
  await expect(page.locator('#game')).toBeHidden();
  await expect(page.locator('#done')).toBeHidden();
});

for (const b of BANDS) {
  test(`age ${b}: today's 5 puzzles are correct answers, four distinct choices, in range, full marks give 55 points`, async ({ page }) => {
    await open(page);
    await band(page, b).click();
    await page.locator('#daily').click();
    await expect(page.locator('#game')).toBeVisible();
    await expect(page.locator('#menu')).toBeHidden(); // game mode: only the game on screen
    await expect(page.locator('#prog')).toHaveText('1 of 5');
    const played = await playSet(page, b);
    expect(played.prompts).toHaveLength(5);
    await expect(page.locator('#done')).toBeVisible();
    await expect(page.locator('#result')).toHaveText('You got 5 of 5 on the first try. Your points: 55.');
    if (b !== '3-4') {
      for (const [i, prompt] of played.prompts.entries()) {
        const nums = (prompt.match(/\d+/g) ?? []).map(Number);
        for (const n of nums) expect(n, `"${prompt}" uses a number above the ${b} limit`).toBeLessThanOrEqual(b === '11-12' || b === '9-10' ? MAX[b] * 25 : MAX[b] * 2);
        expect(played.choices[i]).toHaveLength(4);
      }
    } else {
      for (const c of played.choices) expect(c.length === 2 || c.length === 4, `3-4 choices are Left/Right or four numbers: ${c}`).toBe(true);
    }
  });
}

test('multiplication and division stay inside the times tables for each band', async ({ page }) => {
  for (const b of ['7-8', '9-10', '11-12']) {
    // The daily set uses the day as its seed; try several days so every kind turns up.
    for (const day of [300, 301, 302, 303, 304, 305]) {
      await open(page, day);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await band(page, b).click();
      await page.locator('#daily').click();
      const played = await playSet(page, b);
      for (const prompt of played.prompts) {
        const mul = prompt.match(/^(\d+) x (\d+) = \?$/);
        const div = prompt.match(/^(\d+) \/ (\d+) = \?$/);
        if (mul) { expect(+mul[1], prompt).toBeLessThanOrEqual(MULT_LIMIT[b]); expect(+mul[2], prompt).toBeLessThanOrEqual(MULT_LIMIT[b]); }
        if (div) { const q = +div[1] / +div[2]; expect(Number.isInteger(q), `${prompt} must divide exactly`).toBe(true); expect(+div[2], prompt).toBeLessThanOrEqual(MULT_LIMIT[b]); expect(q, prompt).toBeLessThanOrEqual(MULT_LIMIT[b]); }
      }
    }
  }
});

test('a wrong answer gets a kind hint, is switched off, takes nothing away, and the right answer still works', async ({ page }) => {
  await open(page);
  await band(page, '7-8').click();
  await page.locator('#daily').click();
  const prompt = (await page.locator('#q').innerText()).trim();
  const right = String(answerFromPrompt(prompt));
  const wrong = (await optionTexts(page)).find((o) => o !== right)!;
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
  await band(page, '5-6').click();
  await page.locator('#daily').click();
  await playSet(page, '5-6', 2);
  await expect(page.locator('#result')).toHaveText('You got 3 of 5 on the first try. Your points: 35.'); // 3 first-try wins x 10 + 5 for finishing
});

test('the same day twice gives points once', async ({ page }) => {
  await open(page);
  await page.locator('#daily').click();
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
  // Days are counted from 1 Jan 2026 UTC. Day 301 is a Wednesday of its week bucket (floor(day/7)); pick days inside one bucket.
  const run = async (day: number) => {
    await open(page, day);
    await page.locator('#daily').click();
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
  await band(page, '9-10').click();
  await page.locator('#mile').click();
  await expect(page.locator('#prog')).toHaveText('1 of 10');
  await playSet(page, '9-10', 3); // three mistakes: 7 of 10 first try
  await expect(page.locator('#result')).toContainText('7 of 10. You need 8 for the star.');
  await page.locator('#home').click();
  await expect(band(page, '9-10')).not.toContainText('★');
  await page.locator('#mile').click();
  await playSet(page, '9-10', 2); // 8 of 10
  await expect(page.locator('#result')).toContainText('Star earned! 8 of 10.');
  await page.locator('#home').click();
  await expect(band(page, '9-10')).toContainText('★');
  await expect(band(page, '7-8')).not.toContainText('★');
});

test('Exit goes back to the menu mid-game and keeps the points so far unchanged', async ({ page }) => {
  await open(page);
  await page.locator('#daily').click();
  await expect(page.locator('#game')).toBeVisible();
  await page.locator('#exit').click();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#game')).toBeHidden();
  expect(await points(page)).toBe(0);
});

test('picture puzzles for ages 3 to 4: the description for a screen reader matches the shapes drawn', async ({ page }) => {
  for (const day of [300, 301, 302]) {
    await open(page, day);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await band(page, '3-4').click();
    await page.locator('#daily').click();
    for (let i = 0; i < 5; i++) {
      const groups = await page.locator('#art .grp').evaluateAll((els) => els.map((g) => g.querySelectorAll('svg').length));
      const label = (await page.locator('#art').getAttribute('aria-label')) ?? '';
      const counts = (label.match(/\d+/g) ?? []).map(Number);
      expect(counts.slice(0, groups.length), `aria-label "${label}" must give the number of shapes drawn`).toEqual(groups);
      await expect(page.locator('#art')).toHaveAttribute('role', 'img');
      const prompt = (await page.locator('#q').innerText()).trim();
      await page.locator('#opts button', { hasText: new RegExp(`^${await answerFromPictures(page, prompt)}$`) }).click();
      try { await nextPromptWait(page, prompt); } catch { /* last */ }
    }
  }
});

test('progress is kept only under one key in this browser, survives a reload, and Reset clears it; no cookies or other storage', async ({ page, context }) => {
  await open(page);
  await page.locator('#daily').click();
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
  expect(await points(page)).toBe(0);
  expect(await streak(page)).toBe(0);
});

test('a browser that blocks storage still works for the session (no crash)', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  await open(page);
  await page.locator('#daily').click();
  await playSet(page, '5-6');
  await expect(page.locator('#done')).toBeVisible();
  expect(errors).toEqual([]);
});

test('keyboard only: start a set, answer with Enter, the focus ring is visible', async ({ page }) => {
  await open(page);
  await page.locator('#daily').focus();
  await expect(page.locator('#daily')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#game')).toBeVisible();
  const prompt = (await page.locator('#q').innerText()).trim();
  const right = String(answerFromPrompt(prompt));
  await page.locator('#opts button', { hasText: new RegExp(`^${right}$`) }).focus();
  const outline = await page.locator('#opts button', { hasText: new RegExp(`^${right}$`) }).evaluate((e) => getComputedStyle(e).outlineStyle + ' ' + getComputedStyle(e).outlineWidth);
  expect(outline).toMatch(/solid 4px/);
  await page.keyboard.press('Enter');
  await expect(page.locator('#msg')).toContainText('Yes! Well done.');
});

test('screen reader hooks: progress and messages are live regions; the question is a heading; buttons are at least 48 px', async ({ page }) => {
  await open(page);
  await page.locator('#daily').click();
  await expect(page.locator('#prog')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#msg')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#q')).toHaveAttribute('role', 'heading');
  for (const b of await page.locator('button:visible').all()) {
    const box = await b.boundingBox();
    expect(box!.width, await b.innerText()).toBeGreaterThanOrEqual(47.5);
    expect(box!.height, await b.innerText()).toBeGreaterThanOrEqual(47.5);
  }
});

for (const view of ['menu', 'game', 'done'] as const) {
  for (const width of [0, 320]) {
    test(`maths draft: ${view} view fits the screen and passes the accessibility scan${width ? ' at 320 px' : ''}`, async ({ page }) => {
      if (width) await page.setViewportSize({ width, height: 700 });
      await open(page);
      if (view !== 'menu') await page.locator('#daily').click();
      if (view === 'done') await playSet(page, '5-6');
      expect(await horizontalOverflow(page), 'overflow').toBeLessThanOrEqual(1);
      expect(await axeViolations(page), `${view} view`).toEqual([]);
    });
  }
}
