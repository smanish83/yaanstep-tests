import { test, expect, type Page } from '@playwright/test';
import { axeViolations, bareSprouts, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';
import { knownBug } from '../support/known-bugs';
import { BANDS, CHAPTERS, band, boot, dayTime, lessonArithmeticProblems, lessonPictureProblems, lessonThenQuestions, next, openChapter, playQuestions, rightAnswer, snapshot, tap, wrongAnswer } from '../support/maths-draft';

// The maths games page (maths.html, released 22 Nov 2026; was the hidden maths-draft.html, SCRUM-409). It is not in the menu and not in the site profile, so it has its own
// spec. Expected answers are worked out in the support file from what is on the screen, never read from the page's code.
// Timers run on a fake clock: the pause after a right answer and the dates are controlled by the test.

const KEY = 'sprouts:demo';
const CHAPTER_KEY = 'demo-ch';
const GARDEN_KEY = 'demo-garden'; // added 17 Nov with the growing garden

test.beforeEach(() => { knownBug(); test.setTimeout(240_000); });

const points = async (page: Page) => +(((await page.locator('#prog').innerText()).match(/(\d+) points/) ?? [])[1] ?? NaN);
/** Menu -> band -> first lesson step shown. */
async function begin(page: Page, b: string, opts: { day?: number; seed?: number } = {}) {
  await boot(page, opts);
  await band(page, b).click();
}
/** Menu -> band -> skip the lesson -> first question. */
async function questions(page: Page, b: string, opts: { day?: number; seed?: number } = {}) {
  await begin(page, b, opts);
  await lessonThenQuestions(page, true);
}

test('loads as a public page linked from Learning: indexable, notice for parents, no errors, nothing sent, no outside requests', async ({ page, request }) => {
  const reqs = watchRequests(page);
  await boot(page);
  expect(await page.locator('meta[name=robots][content*=noindex]').count(), 'the released page must not be noindex').toBe(0);
  await expect(page.locator('h1')).toHaveText('Yaanstep maths');
  await expect(page.locator('.note')).toContainText('parent and child together');
  await expect(page.locator('.note')).toContainText('Not yet tested with children');
  await expect(page.locator('.note')).toContainText('kept only in this browser');
  await expect(page.locator('a[href="sprouts.html"]')).toHaveCount(1);
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect(reqs.carryingData()).toEqual([]);
  const learning = await (await request.get('/sprouts.html')).text();
  expect(learning, 'sprouts.html links to maths.html').toContain('href="maths.html"');
  const old = await (await request.get('/maths-draft.html')).text();
  expect(old, 'the old draft address points to maths.html').toContain('url=maths.html');
});

test('maths draft: has an icon link like the other pages', async ({ page }) => {
  // Chrome asks for /favicon.ico only some of the time, so the check is on the page itself, not on the console.
  await boot(page);
  expect(await page.locator('link[rel~=icon]').count(), 'no <link rel="icon"> on the page').toBeGreaterThan(0);
});

test('maths draft: no console errors and no failed requests through a lesson and a chapter', async ({ page }) => {
  await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204 })); // covered by the icon-link test above
  const errors = watchErrors(page);
  await begin(page, '5-6');
  await lessonThenQuestions(page);
  await playQuestions(page, '5-6');
  expect(errors).toEqual([]);
});

test('uses the product name only in full, as "Yaanstep Sprouts"', async ({ page }) => {
  await boot(page);
  expect(bareSprouts(await page.locator('body').innerText())).toEqual([]);
  expect(bareSprouts(await page.title())).toEqual([]);
});

test('menu: the five age bands and the parent area; nothing else showing', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#bands button')).toHaveCount(5);
  for (const [i, b] of BANDS.entries()) await expect(page.locator('#bands button').nth(i)).toHaveText(`Ages ${b.replace('-', ' to ')}`);
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#game')).toBeHidden();
  await expect(page.locator('#chaps')).toBeHidden();
  await expect(page.locator('#reset')).toBeVisible();
  await expect(page.locator('#confirm')).toBeHidden();
});

for (const b of BANDS) {
  test(`age ${b}: choosing the band opens chapter 1 with a lesson; the chapter list has the planned chapters in order`, async ({ page }) => {
    await begin(page, b);
    await expect(page.locator('#game')).toBeVisible();
    await expect(page.locator('#menu')).toBeHidden(); // game mode: only the game on screen
    await expect(page.locator('#q')).toHaveText(`Let us learn: ${CHAPTERS[b][0]}.`);
    await expect(page.locator('#msg')).toContainText('Lesson: step 1 of ');
    await page.locator('#chbtn').click();
    await expect(page.locator('#chaps')).toBeVisible();
    await expect(page.locator('#chtitle')).toHaveText(`Ages ${b.replace('-', ' to ')} chapters`);
    const rows = (await page.locator('#chlist button').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').replace(/[✔]/g, '').trim());
    expect(rows).toEqual(CHAPTERS[b].map((t, i) => `${i + 1}. ${t}`));
    await page.locator('#chback').click();
    await expect(page.locator('#menu')).toBeVisible();
  });
}

for (const b of BANDS) {
  test(`age ${b}: every lesson is true — the sums written in it are right, pictures agree with the words, Back/Next/Skip work`, async ({ page }) => {
    await boot(page, { seed: 5 });
    const problems: string[] = [];
    for (const [ci, title] of CHAPTERS[b].entries()) {
      await openChapter(page, b, ci);
      const first = (await page.locator('#q').innerText()).trim();
      if (first !== `Let us learn: ${title.replace(/[.?!]+$/, '')}.`) problems.push(`chapter "${title}": first lesson step says "${first}"`);
      const steps: string[] = [];
      for (let i = 0; i < 30; i++) {
        const say = (await page.locator('#q').innerText()).trim();
        const big = await page.locator('#art .bigtxt').allInnerTexts();
        steps.push(say);
        for (const p of [...lessonArithmeticProblems(say), ...big.flatMap(lessonArithmeticProblems), ...(await lessonPictureProblems(page))]) problems.push(`chapter "${title}" step ${i + 1}: ${p}`);
        if ((await page.locator('#msg').innerText()).trim() !== `Lesson: step ${i + 1} of ${(await page.locator('#msg').innerText()).match(/of (\d+)/)![1]}`) problems.push(`chapter "${title}": step counter is "${await page.locator('#msg').innerText()}" on step ${i + 1}`);
        if (i === 0 && (await page.locator('#tb').count())) problems.push(`chapter "${title}": Back is offered on the first step`);
        if (i > 0 && !(await page.locator('#tb').count())) problems.push(`chapter "${title}": no Back on step ${i + 1}`);
        const label = (await page.locator('#tn').innerText()).trim();
        if (label === 'Start the questions') {
          if (await page.locator('#ts').count()) problems.push(`chapter "${title}": "Skip the lesson" is still offered on the last step`);
          if (i >= 1) { await page.locator('#tb').click(); await expect(page.locator('#q')).toHaveText(steps[i - 1]); await page.locator('#tn').click(); } // Back then Next returns to the same step
          await page.locator('#tn').click();
          break;
        }
        await page.locator('#tn').click();
      }
      if (steps.length < 2) problems.push(`chapter "${title}": the lesson has ${steps.length} step(s)`);
      await expect(page.locator('#prog')).toContainText('points'); // we are in the questions now
      const q = await snapshot(page);
      if (!q.prompt) problems.push(`chapter "${title}": no first question`);
    }
    expect(problems).toEqual([]);
  });
}

test('"Skip the lesson" goes straight to the questions; a chapter has ten questions then an end screen', async ({ page }) => {
  await questions(page, '7-8');
  await expect(page.locator('#bar .seg')).toHaveCount(10);
  const seen = await playQuestions(page, '7-8', { limit: 12 });
  expect(seen, 'a chapter has exactly ten questions').toHaveLength(10);
  await expect(page.locator('#q')).toHaveText(/^Chapter complete! (You got 10 on the first try|10 of 10 right first time)\.$/);
  await expect(page.locator('#msg')).toContainText('Next chapter: Taking away within 100');
  await expect(page.locator('#b1')).toHaveText('Next chapter');
  await expect(page.locator('#b2')).toHaveText('Play a mixed game instead'); // changed 17 Nov: the mixed game is offered after a passed chapter
});

test('passing needs 8 of 10 right first time: 8 passes and unlocks the next chapter; 7 does not and says nothing is lost', async ({ page }) => {
  await questions(page, '7-8');
  await playQuestions(page, '7-8', { wrongFirst: 3 }); // 7 right first time
  await expect(page.locator('#q')).toHaveText('7 of 10 right first time. Good effort!');
  await expect(page.locator('#msg')).toContainText('No points are lost');
  await expect(page.locator('#b1')).toHaveText('Watch the lesson again');
  await expect(page.locator('#b2')).toHaveText('Try again');
  await page.locator('#chbtn').click();
  await expect(page.locator('#chlist button[data-i="0"]')).not.toContainText('✔');
  await page.locator('#chlist button[data-i="0"]').click();
  await lessonThenQuestions(page, true);
  await playQuestions(page, '7-8', { wrongFirst: 2 }); // 8 right first time
  await expect(page.locator('#q')).toHaveText('Chapter complete! 8 of 10 right first time.');
  await page.locator('#chbtn').click();
  await expect(page.locator('#chlist button[data-i="0"]')).toContainText('✔');
  await expect(page.locator('#chlist button[data-i="1"]')).not.toContainText('✔');
  // choosing the band again continues at the first unfinished chapter
  await page.locator('#chback').click();
  await band(page, '7-8').click();
  await expect(page.locator('#q')).toHaveText('Let us learn: Taking away within 100.');
});

test('a wrong answer gets a kind hint, is switched off, takes nothing away, turns the progress segment red, and the right answer still works', async ({ page }) => {
  await questions(page, '7-8');
  const s = await snapshot(page);
  const wrong = wrongAnswer(s)!.text!;
  const right = rightAnswer(s).text!;
  const wrongButton = page.locator('#opts button', { hasText: new RegExp(`^\\s*${wrong}\\s*$`) });
  const before = await points(page);
  await wrongButton.click();
  await expect(page.locator('#msg')).toContainText('Not yet. Here is a hint: ');
  await expect(page.locator('#msg')).toContainText('Try again.');
  await expect(wrongButton).toBeDisabled();
  await expect(page.locator('#msg')).not.toContainText(/wrong|incorrect|fail|bad|lose|lost|minus|-\s?\d+ points/i);
  // A sum with a "?" also shows the wrong try as a sum and a picture (Manish, 23 Nov 2026).
  const drawable = /^\d+ [+\-−] (\d+|\?) = (\d+|\?)$/.test(s.prompt) && Math.max(...(s.prompt.match(/\d+/g) ?? ['0']).map(Number), Number(wrong)) <= 20;
  if (drawable) {
    await expect(page.locator('#msg .sum-try')).toBeVisible();
    await expect(page.locator('#msg .sum-try')).toContainText(wrong);
  }
  await expect(page.locator('#bar .seg.now')).toHaveClass(/miss/);
  expect(await points(page), 'nothing is taken away').toBe(before);
  await page.locator('#opts button', { hasText: new RegExp(`^\\s*${right}\\s*$`) }).click();
  await expect(page.locator('#msg .good')).toContainText(/You got it!/);
  if (s.prompt.includes('?') && /=/.test(s.prompt)) await expect(page.locator('#q'), 'the ? becomes the answer').toHaveText(s.prompt.replace('?', right));
  expect(await points(page), 'a right answer after a mistake earns 5').toBe(before + 5);
  await expect(page.locator('#opts button:not([disabled])')).toHaveCount(0);
  await next(page);
  await expect(page.locator('#bar .seg.miss')).toHaveCount(1); // the first segment stays red
});

test('a right answer first time earns 10 points, shows a clear "good job" message with a Next button, and waits for the tap (never moves on by itself)', async ({ page }) => {
  await questions(page, '7-8');
  await page.clock.pauseAt(new Date(dayTime(300).getTime() + 10 * 60_000)); // stop the clock: only runFor moves time, so the check cannot be hit by a slow machine
  const first = (await snapshot(page)).prompt;
  const before = await points(page);
  await tap(page, rightAnswer(await snapshot(page)));
  await expect(page.locator('#msg .good')).toBeVisible();
  await expect(page.locator('#msg .good')).toHaveAttribute('role', 'status');
  await expect(page.locator('#msg')).toContainText(/Good job!|Great work!|Well done!|Super!|Brilliant!/);
  await expect(page.locator('#msg .wait #skip')).toHaveText('Next');
  await expect(page.locator('#msg .spin')).toHaveCount(0);
  expect(await points(page)).toBe(before + 10);
  await page.clock.runFor(10_000);
  expect((await snapshot(page)).prompt, 'still the same question after 10 seconds: nothing plays on by itself').toBe(first);
  await page.locator('#skip').click();
  await expect(page.locator('#bar .seg.now')).toBeVisible();
  await expect(page.locator('#msg .good')).toHaveCount(0);
});

test('the Next button moves on at once', async ({ page }) => {
  await questions(page, '5-6');
  await tap(page, rightAnswer(await snapshot(page)));
  await page.locator('#skip').click();
  await expect(page.locator('#msg .good')).toHaveCount(0);
  await expect(page.locator('#bar .seg.done')).toHaveCount(1);
  expect((await page.locator('#bar').getAttribute('aria-label')) ?? '').toMatch(/^Question 2 of 10\. 1 right first time so far$/);
});

test('ten-frame (ages 3 to 4, "Fill the frame"): taps fill and empty circles, a live count shows, the question ends exactly at the asked number', async ({ page }) => {
  await begin(page, '3-4');
  await openChapter(page, '3-4', 4);
  await lessonThenQuestions(page, true);
  let s = await snapshot(page);
  // The questions get bigger as they go; answer the small ones until one asks for 3 or more, so there is room to tap and un-tap.
  for (let i = 0; i < 9 && rightAnswer(s).cells! < 3; i++) { await tap(page, rightAnswer(s)); await next(page); s = await snapshot(page); }
  expect(s.kind).toBe('frame');
  const n = rightAnswer(s).cells!;
  expect(n, 'a frame asking for 3 or more turned up').toBeGreaterThanOrEqual(3);
  const cells = page.locator('#art button.cell');
  await expect(cells).toHaveCount(10);
  await expect(page.locator('#count')).toHaveText('0');
  await cells.nth(0).click();
  await expect(cells.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#count')).toHaveText('1');
  await cells.nth(0).click(); // tap again takes it away
  await expect(cells.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#count')).toHaveText('0');
  for (let i = 0; i < n - 1; i++) await cells.nth(i).click();
  await expect(page.locator('#msg .good')).toHaveCount(0); // not done yet at n - 1
  await cells.nth(n - 1).click();
  await expect(page.locator('#count')).toHaveText(String(n));
  await expect(page.locator('#msg .good')).toBeVisible();
  await expect(page.locator('#art button.cell:not([disabled])')).toHaveCount(0);
});

test('number-line hop game (small adding and taking-away): hopping lands on the right number and stops', async ({ page }) => {
  await boot(page, { seed: 11 });
  await openChapter(page, '5-6', CHAPTERS['5-6'].indexOf('Adding up to 5')); // chapter 1 is now the blocks chapter, which asks missing-number questions
  await lessonThenQuestions(page, true);
  let hops = 0;
  for (let i = 0; i < 10 && hops < 3; i++) {
    const s = await snapshot(page);
    if (s.hop) {
      hops++;
      const m = s.prompt.match(/^(\d+) ([+-]) (\d+) = \?$/)!;
      const answer = m[2] === '+' ? +m[1] + +m[3] : +m[1] - +m[3];
      for (let k = 0; k < +m[3]; k++) await page.locator('#hop').click();
      await expect(page.locator('#hopn')).toContainText(`you landed on ${answer}`);
      await expect(page.locator('#hop')).toBeDisabled();
      await expect(page.locator('#art .bead.here')).toHaveText(String(answer));
    }
    await tap(page, rightAnswer(s));
    await next(page);
  }
  expect(hops, 'a hop game turned up').toBeGreaterThan(0);
});

test('the same-day streak: one answer a day counts; consecutive days add up; one rest day a week is forgiven; a longer gap starts again at 1', async ({ page }) => {
  await boot(page, { day: 301 });
  const dayStreak = async (day: number) => {
    await page.clock.setSystemTime(dayTime(day));
    if (await page.locator('#menu').isHidden()) await page.locator('#exit').click();
    await band(page, '5-6').click();
    await lessonThenQuestions(page, true);
    await tap(page, rightAnswer(await snapshot(page)));
    await page.locator('#exit').click();
    return +(await page.locator('#streak').innerText());
  };
  expect(await dayStreak(301)).toBe(1);
  expect(await dayStreak(301), 'a second answer on the same day does not add').toBe(1);
  expect(await dayStreak(302)).toBe(2);
  expect(await dayStreak(304), 'one missed day is forgiven').toBe(3);
  expect(await dayStreak(306), 'a second missed day in the same week is not forgiven').toBe(1);
  expect(await dayStreak(310), 'a gap of four days starts again').toBe(1);
  expect(await dayStreak(311)).toBe(2);
});

test('Exit goes back to the menu mid-chapter and keeps the points so far', async ({ page }) => {
  await questions(page, '7-8');
  await tap(page, rightAnswer(await snapshot(page)));
  await next(page);
  await page.locator('#exit').click();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#game')).toBeHidden();
  await expect(page.locator('#pts')).toHaveText('10');
});

test('progress is kept only in this browser (three keys), survives a reload, holds no personal data; no cookies or other storage', async ({ page, context }) => {
  await questions(page, '7-8');
  await playQuestions(page, '7-8');
  const s = await storedData(page, context);
  expect(s.local.sort(), 'localStorage keys').toEqual([CHAPTER_KEY, GARDEN_KEY, KEY].sort());
  expect(s.cookies).toEqual([]);
  expect(s.session).toEqual([]);
  expect(s.databases).toEqual([]);
  expect(s.caches).toEqual([]);
  expect(s.workers).toBe(0);
  const saved = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), KEY))!);
  expect(Object.keys(saved).sort()).toEqual(['lastDay', 'milestones', 'points', 'restDaysUsed', 'streak']); // no name, no text, no birth date
  const chapters = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), CHAPTER_KEY))!);
  expect(chapters).toEqual({ '7-8': 1 }); // only a band and how many chapters are done
  const garden = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), GARDEN_KEY))!);
  expect(Object.keys(garden).sort(), 'the garden holds only a count of water drops and a day number').toEqual(['d', 'w']);
  expect(garden.w).toBe(1);
  expect(saved.points).toBe(100);
  await page.reload();
  await expect(page.locator('#pts')).toHaveText('100');
});

test('Reset asks first, "No, keep my progress" keeps everything and returns focus to Reset', async ({ page }) => {
  await questions(page, '7-8');
  await playQuestions(page, '7-8');
  await page.locator('#chbtn').click();
  await page.locator('#chback').click();
  await expect(page.locator('#confirm')).toBeHidden();
  await page.locator('#reset').click();
  await expect(page.locator('#confirm')).toBeVisible();
  await expect(page.locator('#confirm')).toHaveAttribute('role', 'alertdialog');
  await expect(page.locator('#confirm')).toContainText('cannot be undone');
  await expect(page.locator('#keep')).toBeFocused(); // the safe choice is the one focused
  await page.locator('#keep').click();
  await expect(page.locator('#confirm')).toBeHidden();
  await expect(page.locator('#reset')).toBeFocused();
  await expect(page.locator('#pts')).toHaveText('100');
});

test('Reset after confirming clears points, streak AND the chapters done, so the child starts fresh', async ({ page }) => {
  await questions(page, '7-8');
  await playQuestions(page, '7-8');
  await page.locator('#chbtn').click();
  await page.locator('#chback').click();
  await page.locator('#reset').click();
  await page.locator('#wipe').click();
  await expect(page.locator('#pts')).toHaveText('0');
  await expect(page.locator('#streak')).toHaveText('0');
  expect(await page.evaluate((k) => localStorage.getItem(k), CHAPTER_KEY), 'chapters done must be cleared too').toBeFalsy();
  await band(page, '7-8').click();
  await expect(page.locator('#q'), 'after a reset the band starts again at chapter 1').toHaveText('Let us learn: Adding up to 100.');
  await page.reload();
  await band(page, '7-8').click();
  await expect(page.locator('#q'), 'and still after a reload').toHaveText('Let us learn: Adding up to 100.');
});

test('a browser that blocks storage still works for the session (no crash)', async ({ page }) => {
  await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204 })); // the missing icon link is SCRUM-446
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  await questions(page, '5-6');
  await playQuestions(page, '5-6');
  await expect(page.locator('#q')).toContainText(/right first time|on the first try/);
  expect(errors).toEqual([]);
});

test('keyboard only: choose a band, go through the lesson, answer with Enter, the focus ring is visible', async ({ page }) => {
  await boot(page);
  await band(page, '7-8').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#q')).toHaveText('Let us learn: Adding up to 100.');
  await page.locator('#tn').focus();
  await expect(page.locator('#tn')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#msg')).toContainText('step 2 of');
  await page.locator('#ts').focus();
  await page.keyboard.press('Enter');
  const s = await snapshot(page);
  const right = page.locator('#opts button', { hasText: new RegExp(`^\\s*${rightAnswer(s).text}\\s*$`) });
  await right.focus();
  const outline = await right.evaluate((e) => getComputedStyle(e).outlineStyle + ' ' + getComputedStyle(e).outlineWidth);
  expect(outline).toMatch(/solid [3-9]px/);
  await page.keyboard.press('Enter');
  await expect(page.locator('#msg')).toContainText(/Good job!|Great work!|Well done!|Super!|Brilliant!/);
});

test('keyboard only: odd-one-out shapes and "which group has more" cards can be reached and answered with Enter', async ({ page }) => {
  await boot(page, { seed: 3 });
  await band(page, '3-4').click();
  const found = new Set<string>();
  for (const [ci, kind] of [[2, 'more'], [3, 'odd']] as const) {
    await openChapter(page, '3-4', ci);
    await lessonThenQuestions(page, true);
    const s = await snapshot(page);
    expect(s.kind).toBe(kind);
    const a = rightAnswer(s);
    const target = kind === 'odd' ? page.locator('#art .pick').nth(a.pick!) : page.locator('#art .card').nth(a.card!);
    await target.focus();
    await expect(target).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#msg .good')).toBeVisible();
    found.add(kind);
  }
  expect([...found].sort()).toEqual(['more', 'odd']);
});

test('screen reader hooks: progress and messages are live regions; the question is a heading; the progress bar says where you are; buttons are at least 48 px', async ({ page }) => {
  await questions(page, '5-6');
  await expect(page.locator('#prog')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#msg')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#q')).toHaveAttribute('role', 'heading');
  expect((await page.locator('#bar').getAttribute('aria-label')) ?? '').toBe('Question 1 of 10. 0 right first time so far');
  for (const b of await page.locator('button:visible').all()) {
    const box = await b.boundingBox();
    expect(box!.width, await b.innerText()).toBeGreaterThanOrEqual(47.5);
    expect(box!.height, await b.innerText()).toBeGreaterThanOrEqual(47.5);
  }
});

// Layout and accessibility scan of every kind of screen, at the device width and at 320 px.
const VIEWS = ['menu', 'chapter list', 'lesson', 'number question', 'picture question', 'end screen'] as const;
for (const view of VIEWS) {
  for (const width of [0, 320]) {
    test(`maths draft: ${view} view fits the screen and passes the accessibility scan${width ? ' at 320 px' : ''}`, async ({ page }) => {
      if (width) await page.setViewportSize({ width, height: 700 });
      await boot(page, { seed: 2 });
      if (view === 'chapter list') { await band(page, '5-6').click(); await page.locator('#chbtn').click(); }
      if (view === 'lesson') await band(page, '5-6').click();
      if (view === 'number question') { await band(page, '7-8').click(); await lessonThenQuestions(page, true); }
      if (view === 'picture question') { await band(page, '3-4').click(); await lessonThenQuestions(page, true); }
      if (view === 'end screen') { await band(page, '7-8').click(); await lessonThenQuestions(page, true); await playQuestions(page, '7-8'); }
      expect(await horizontalOverflow(page), 'overflow').toBeLessThanOrEqual(1);
      expect(await axeViolations(page), `${view} view`).toEqual([]);
    });
  }
}

test('maths draft: "Hear it" speaks words, not symbols ("12 - 4" must not be read as "12 by 4")', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__spoken = [];
    (window as any).SpeechSynthesisUtterance = function (t: string) { this.text = t; };
    Object.defineProperty(window, 'speechSynthesis', { value: { getVoices() { return [{ name: 'Local Sam', lang: 'en-US', localService: true, voiceURI: 'ls' }]; }, cancel() {}, speak(u: any) { (window as any).__spoken.push(u.text); } } });
  });
  const problems: string[] = [];
  const hear = async (what: string) => {
    await page.evaluate(() => ((window as any).__spoken.length = 0));
    await page.locator('#say').click();
    const spoken: string[] = await page.evaluate(() => (window as any).__spoken);
    if (!spoken.length) problems.push(`${what}: "Hear it" said nothing`);
    for (const t of spoken) if (/[-+/=−×÷]|\dx\d|\bx\b/.test(t.replace(/^Which is .*/, ''))) problems.push(`${what}: spoken as "${t}": symbols are left for the voice to guess`);
  };
  await boot(page, { seed: 9 });
  for (const b of ['5-6', '7-8', '9-10', '11-12']) {
    if (await page.locator('#game').isVisible()) await page.locator('#exit').click();
    await band(page, b).click();
    // the lesson (first chapter), every step
    for (let i = 0; i < 30; i++) {
      await hear(`ages ${b} lesson step ${i + 1}`);
      const label = (await page.locator('#tn').innerText()).trim();
      await page.locator('#tn').click();
      if (label === 'Start the questions') break;
    }
    for (let i = 0; i < 4; i++) {
      const s = await snapshot(page);
      await hear(`ages ${b} question "${s.prompt}"`);
      await tap(page, rightAnswer(s));
      await next(page);
    }
  }
  expect([...new Set(problems)].slice(0, 20)).toEqual([]);
});

// ---------- stretch break and growing garden (draft of 17 Nov, commit 120f721) ----------

/** Plays n questions right first time and moves on, without walking through the stretch break. */
async function playRight(page: Page, n: number) {
  for (let i = 0; i < n; i++) { await tap(page, rightAnswer(await snapshot(page))); await next(page); }
}

test('stretch break: appears once, after question 5 of 10, offers "I am ready" and "Skip the break", costs nothing and the chapter still has ten questions', async ({ page }) => {
  await questions(page, '7-8');
  await playRight(page, 5);
  await expect(page.locator('#q')).toHaveText('Stretch break! Find a clear space, then reach up high and hop 5 times.');
  await expect(page.locator('#msg')).toContainText('Halfway there');
  const buttons = page.locator('#opts button');
  expect((await buttons.allInnerTexts()).map((t) => t.trim())).toEqual(['I am ready', 'Skip the break']);
  for (let i = 0; i < 2; i++) { const box = (await buttons.nth(i).boundingBox())!; expect(box.height, `button ${i} height`).toBeGreaterThanOrEqual(48); expect(box.width, `button ${i} width`).toBeGreaterThanOrEqual(48); }
  const before = await points(page);
  const label = await page.locator('#art').getAttribute('aria-hidden');
  void label;
  await buttons.nth(0).click();
  await page.clock.runFor(1700);
  expect(await points(page), 'a stretch break earns and costs nothing').toBe(before);
  await expect(page.locator('#q')).not.toContainText('Stretch break');
  const rest = await playQuestions(page, '7-8', { limit: 12 });
  expect(rest, 'five questions after the break, and no second break').toHaveLength(5);
  await expect(page.locator('#q')).toHaveText(/^Chapter complete! (You got 10 on the first try|10 of 10 right first time)\.$/);
});

test('stretch break: "Skip the break" goes straight on, and the break does not hide the progress bar', async ({ page }) => {
  await questions(page, '7-8');
  await playRight(page, 5);
  await expect(page.locator('#q')).toContainText('Stretch break');
  await expect(page.locator('#bar .seg')).toHaveCount(10);
  expect(await page.locator('#bar .seg.done, #bar .seg.ok, #bar .seg.right').count() + (await page.locator('#bar .seg').evaluateAll((els) => els.filter((e) => !/now|miss/.test(e.className) && e.className !== 'seg').length)) , 'five segments show as done').toBeGreaterThanOrEqual(5);
  await page.locator('#opts button', { hasText: 'Skip the break' }).click();
  await page.clock.runFor(1700);
  await expect(page.locator('#q')).not.toContainText('Stretch break');
  expect((await snapshot(page)).options.length).toBeGreaterThan(1);
});

test('growing garden: a drop of water for each finished set, a flower for every four drops, and no extra drop for coming back on a new day', async ({ page }) => {
  await boot(page, { day: 300 });
  await band(page, '5-6').click();
  const finishAndNext = async (last = false) => {
    await playQuestions(page, '5-6', { limit: 12 });
    await expect(page.locator('#q')).toContainText('Chapter complete!');
    if (!last) { await page.locator('#b1').click(); await lessonThenQuestions(page, true); }
  };
  const gardenLabel = () => page.locator('#msg .garden').getAttribute('aria-label');
  await lessonThenQuestions(page, true);
  await finishAndNext(true);
  await expect(page.locator('#msg')).toContainText('A drop of water for your garden!');
  expect(await gardenLabel()).toBe('Your garden: 0 flowers and one growing');
  await page.locator('#b1').click(); await lessonThenQuestions(page, true);
  await finishAndNext(true);
  await page.locator('#b1').click(); await lessonThenQuestions(page, true);
  await finishAndNext(true);
  expect(await gardenLabel(), 'three drops: still growing').toBe('Your garden: 0 flowers and one growing');
  await page.locator('#b1').click(); await lessonThenQuestions(page, true);
  await finishAndNext(true);
  expect(await gardenLabel(), 'four drops make a flower').toBe('Your garden: 1 flower');
  expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), GARDEN_KEY))!).w).toBe(4);
  // next day: still one drop, with no "come back tomorrow" pull (review SCRUM-477/478, 22 Nov 2026)
  await expect(page.locator('#msg')).not.toContainText('Come back tomorrow');
  await expect(page.locator('#msg')).toContainText('Your garden grows a little every time you finish a chapter.');
  await page.clock.setSystemTime(dayTime(301));
  await page.locator('#b1').click(); await lessonThenQuestions(page, true);
  await finishAndNext(true);
  await expect(page.locator('#msg')).toContainText('A drop of water for your garden!');
  await expect(page.locator('#msg')).not.toContainText('Welcome back');
  expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), GARDEN_KEY))!).w, 'one drop on a new day too').toBe(5);
  expect(await gardenLabel()).toBe('Your garden: 1 flower and one growing');
});

test('growing garden: a set that is not passed does not take anything away from the garden', async ({ page }) => {
  await questions(page, '7-8');
  await playQuestions(page, '7-8');
  const w1 = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), GARDEN_KEY))!).w;
  await openChapter(page, '7-8', 0); // do the same chapter again from the chapter list
  await lessonThenQuestions(page, true);
  await playQuestions(page, '7-8', { wrongFirst: 3 }); // 7 of 10: not passed
  const w2 = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), GARDEN_KEY))!).w;
  expect(w2, 'the garden never shrinks').toBeGreaterThanOrEqual(w1);
  // "No points are lost." is the page's own reassurance, so take it out before looking for loss words
  const said = ((await page.locator('#msg').textContent()) ?? '').replace(/no points are lost/gi, '');
  expect(said).not.toMatch(/lost|lose|wilt|died|dead/i);
});
