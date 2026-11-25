import { test, expect, type Page } from '../support/test';
import { knownBug } from '../support/known-bugs';
import { BANDS, CHAPTERS, FREE_KINDS, band, boot, chapterProblems, lessonThenQuestions, next, openChapter, problemsWith, rightAnswer, snapshot, tap, wrongAnswer, type Kind } from '../support/maths-draft';

// Sweeps over thousands of puzzles on the hidden maths draft (SCRUM-447 compare choices, SCRUM-448 odd one out, and everything else).
// The page builds each set of ten from Math.random, so Math.random is replaced by a seeded generator: the same seed gives the same
// puzzles, and a failure can be replayed. Timers run on a fake clock so the pause after a right answer costs nothing.
// Problems are collected over the whole sweep and reported together, so one run shows every kind of fault, not just the first.

const RUNS_PER_CHAPTER = 12; // sets of ten questions per chapter, per age band
const FREE_QUESTIONS = 120;  // free-play questions per band

test.beforeEach(() => { knownBug(); test.setTimeout(540_000); });

async function playChapter(page: Page, b: string, title: string, label: string, problems: string[], seen: Map<Kind, number>) {
  for (let i = 0; i < 10; i++) {
    const s = await snapshot(page);
    seen.set(s.kind, (seen.get(s.kind) ?? 0) + 1);
    for (const p of [...problemsWith(s, b), ...chapterProblems(title, b, s)]) {
      if (title === 'Bigger or smaller' && /number above 20/.test(p)) continue; // tracked separately (SCRUM-456), see the test below
      problems.push(`[${label} q${i + 1}] ${p}`);
    }
    await tap(page, rightAnswer(s));
    await next(page);
  }
  if ((await page.locator('#q').innerText()).trim() !== 'Chapter complete! 10 of 10 right first time.') problems.push(`[${label}] expected the chapter-complete screen after ten right answers, saw "${await page.locator('#q').innerText()}"`);
}

for (const [bi, b] of BANDS.entries()) {
  test(`sweep age ${b}: ${RUNS_PER_CHAPTER} sets of ten for every chapter — every question correct, answerable, with the right choices for its chapter`, async ({ page }) => {
    const seed = 2000 + bi;
    await boot(page, { seed });
    await band(page, b).click();
    const problems: string[] = [];
    const seen = new Map<Kind, number>();
    let sets = 0;
    for (const [ci, title] of CHAPTERS[b].entries()) {
      for (let n = 0; n < RUNS_PER_CHAPTER; n++) {
        await openChapter(page, b, ci);
        await lessonThenQuestions(page, true);
        await playChapter(page, b, title, `seed ${seed} chapter ${ci + 1} "${title}" run ${n + 1}`, problems, seen);
        sets++;
      }
    }
    test.info().annotations.push({ type: 'checked', description: `${sets * 10} questions; kinds ${JSON.stringify([...seen])}` });
    expect(problems.slice(0, 40), `${problems.length} problems in ${sets * 10} questions`).toEqual([]);
  });
}

for (const b of BANDS) {
  test(`free play age ${b}: ${FREE_QUESTIONS} questions after finishing the last chapter — correct, answerable, only the kinds planned for the age`, async ({ page }) => {
    const seed = 3000 + BANDS.indexOf(b);
    await boot(page, { seed });
    await band(page, b).click();
    await openChapter(page, b, CHAPTERS[b].length - 1);
    await lessonThenQuestions(page, true);
    const problems: string[] = [];
    const seen = new Map<Kind, number>();
    await playChapter(page, b, CHAPTERS[b][CHAPTERS[b].length - 1], 'last chapter', problems, seen);
    await expect(page.locator('#b2')).toHaveText('Free play');
    await page.locator('#b2').click();
    seen.clear();
    for (let i = 0; i < FREE_QUESTIONS; i++) {
      const s = await snapshot(page);
      seen.set(s.kind, (seen.get(s.kind) ?? 0) + 1);
      for (const p of problemsWith(s, b, FREE_KINDS[b])) problems.push(`[free q${i + 1}] ${p}`);
      await tap(page, rightAnswer(s));
      await next(page);
    }
    expect(await page.locator('#opts.endbtns').count(), 'free play never ends').toBe(0);
    for (const k of FREE_KINDS[b]) expect(seen.get(k) ?? 0, `free play ages ${b}: kind ${k} should turn up`).toBeGreaterThanOrEqual(3);
    expect(problems.slice(0, 40), `${problems.length} problems`).toEqual([]);
  });
}

test('compare questions (SCRUM-447): over 1 000 "Which is bigger" questions, both numbers shown are always offered', async ({ page }) => {
  await boot(page, { seed: 4711 });
  await band(page, '5-6').click();
  const problems: string[] = [];
  let compares = 0;
  for (let n = 0; n < 100; n++) {
    await openChapter(page, '5-6', CHAPTERS['5-6'].indexOf('Bigger or smaller'));
    await lessonThenQuestions(page, true);
    for (let i = 0; i < 10; i++) {
      const s = await snapshot(page);
      if (s.kind === 'compare') {
        compares++;
        for (const x of s.prompt.match(/\d+/g) ?? []) if (!s.options.includes(x)) problems.push(`"${s.prompt}" offers ${JSON.stringify(s.options)} without ${x}`);
      }
      await tap(page, rightAnswer(s));
      await next(page);
    }
  }
  expect(compares).toBe(1000);
  expect(problems.slice(0, 30)).toEqual([]);
});

test('odd one out (SCRUM-448): over 500 of them each show 3 to 5 tappable shapes in one box, never two boxes; tapping the odd one wins', async ({ page }) => {
  await boot(page, { seed: 99 });
  await band(page, '3-4').click();
  const problems: string[] = [];
  let odds = 0;
  for (let n = 0; n < 50; n++) {
    await openChapter(page, '3-4', 3); // "Odd one out"
    await lessonThenQuestions(page, true);
    for (let i = 0; i < 10; i++) {
      const s = await snapshot(page);
      if (s.kind === 'odd') {
        odds++;
        for (const p of problemsWith(s, '3-4')) problems.push(`[run ${n + 1} q${i + 1}] ${p}`);
      } else problems.push(`[run ${n + 1} q${i + 1}] the Odd one out chapter asked a "${s.kind}" question`);
      await tap(page, rightAnswer(s));
      await next(page);
    }
  }
  expect(odds).toBe(500);
  expect(problems.slice(0, 30)).toEqual([]);
});

test('odd one out: a wrong tap is kind and switched off; after two misses the right shape glows; then the right tap finishes the question', async ({ page }) => {
  await boot(page, { seed: 7 });
  await band(page, '3-4').click();
  await openChapter(page, '3-4', 3);
  await lessonThenQuestions(page, true);
  const s = await snapshot(page);
  const right = rightAnswer(s).pick!;
  const wrongs = s.picks.map((_, k) => k).filter((k) => k !== right);
  await page.locator('#art .pick').nth(wrongs[0]).click();
  await expect(page.locator('#msg')).toHaveText('Nearly! Look again.');
  await expect(page.locator('#art .pick').nth(wrongs[0])).toBeDisabled();
  expect((await snapshot(page)).picks[right].glowing, 'the right shape must not glow after one miss').toBe(false);
  await page.locator('#art .pick').nth(wrongs[1]).click();
  await expect(page.locator('#msg')).toHaveText('Look at the glowing one.');
  await expect(page.locator('#art .pick').nth(right)).toHaveClass(/\bon\b/);
  expect((await snapshot(page)).picks.filter((p) => p.glowing)).toHaveLength(1);
  await page.locator('#art .pick').nth(right).click();
  await expect(page.locator('#msg .good')).toContainText('You got it!');
});

test('every question kind that has a wrong tap keeps the question open, says "Nearly!", and costs no points', async ({ page }) => {
  await boot(page, { seed: 31 });
  const done = new Set<Kind>();
  for (const b of BANDS) {
    if (await page.locator('#game').isVisible()) await page.locator('#exit').click();
    await band(page, b).click();
    for (const [ci] of CHAPTERS[b].entries()) {
      await openChapter(page, b, ci);
      await lessonThenQuestions(page, true);
      const s = await snapshot(page);
      const wrong = wrongAnswer(s);
      if (!done.has(s.kind) && wrong) {
        done.add(s.kind);
        const before = +((await page.locator('#prog').innerText()).match(/(\d+) points/)?.[1] ?? NaN);
        await tap(page, wrong);
        await expect(page.locator('#msg'), `${s.kind}: message after a wrong answer`).toContainText('Nearly!');
        await expect(page.locator('#msg')).not.toContainText(/wrong|incorrect|fail|bad|lose|lost|minus/i);
        expect((await snapshot(page)).prompt, `${s.kind}: the question must stay on screen after a wrong answer`).toBe(s.prompt);
        expect(+((await page.locator('#prog').innerText()).match(/(\d+) points/)?.[1] ?? NaN), `${s.kind}: points unchanged`).toBe(before);
      }
    }
  }
  expect([...done].sort()).toEqual(['add', 'add3', 'compare', 'count', 'divide', 'extreme', 'subtract', 'missing', 'more', 'multiply', 'odd', 'onemore'].sort());
});

test('ages 5-6 chapter "Bigger or smaller" stays within 20 (SCRUM-456)', async ({ page }) => {
  await boot(page, { seed: 2001 });
  await band(page, '5-6').click();
  const over: string[] = [];
  for (let n = 0; n < 60; n++) {
    await openChapter(page, '5-6', CHAPTERS['5-6'].indexOf('Bigger or smaller'));
    await lessonThenQuestions(page, true);
    for (let i = 0; i < 10; i++) {
      const s = await snapshot(page);
      if ((s.prompt.match(/\d+/g) ?? []).some((x) => +x > 20)) over.push(s.prompt);
      await tap(page, rightAnswer(s));
      await next(page);
    }
  }
  expect([...new Set(over)]).toEqual([]);
});
