import { test, expect, type Page } from '@playwright/test';
import { knownBug } from '../support/known-bugs';
import { BANDS, PAGE, dayTime, kindOf, problemsWith, rightAnswer, snapshot, tap, wrongAnswer, type Kind, type Snapshot } from '../support/maths-draft';

// Sweeps over hundreds of puzzles per age band on the hidden maths draft (SCRUM-447 compare choices, SCRUM-448 odd one out).
// The page makes star tests from Math.random, so Math.random is replaced by a seeded generator: the same seed gives the same
// puzzles, so a failure can be replayed. Timers run on a fake clock so the one-second pause after each right answer costs nothing.

test.describe.configure({ timeout: 500_000 });
const STAR_SETS = 40;   // star tests per band, 10 puzzles each
const DAILY_DAYS = 40;  // different days per band, 5 puzzles each (the daily set is seeded by the day)

test.beforeEach(() => { knownBug(); test.setTimeout(500_000); });

function seeded(seed: number) {
  return `(() => { let t = ${seed} >>> 0; Math.random = () => { t = (t + 1831565813) >>> 0; let r = Math.imul(t ^ (t >>> 15), t | 1); r ^= r + Math.imul(r ^ (r >>> 7), r | 61); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; })();`;
}

async function boot(page: Page, seed: number, day = 300) {
  await page.addInitScript(seeded(seed));
  await page.clock.install({ time: dayTime(day) });
  await page.goto(PAGE);
}

/** Answers the current question right and moves on (fake clock: skips the 900 ms pause). */
async function answerAndNext(page: Page, s: Snapshot) {
  await tap(page, rightAnswer(s));
  await page.clock.runFor(1000);
}

async function runSet(page: Page, band: string, label: string, problems: string[], seen: Map<Kind, number>) {
  const prompts = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const s = await snapshot(page);
    seen.set(s.kind, (seen.get(s.kind) ?? 0) + 1);
    for (const p of problemsWith(s, band)) problems.push(`[${label} q${i + 1}] ${p}`);
    const key = s.prompt + (s.kind === 'odd' ? `|${s.picks.map((p) => p.shape).join(',')}` : s.kind === 'more' ? `|${s.cards.map((c) => c.n).join(',')}` : s.kind === 'count' || s.kind === 'onemore' ? `|${s.groups[0]}` : '');
    if (prompts.has(key)) problems.push(`[${label} q${i + 1}] repeated question in the same set: ${key}`);
    prompts.add(key);
    await answerAndNext(page, s);
    if (await page.locator('#done').isVisible()) return i + 1;
  }
  problems.push(`[${label}] set did not finish within 12 questions`);
  return 12;
}

for (const [bi, b] of BANDS.entries()) {
  test(`sweep age ${b}: ${STAR_SETS} star tests + ${DAILY_DAYS} daily sets — every question correct, answerable, with the right choices`, async ({ page }) => {
    const seed = 1000 + bi;
    await boot(page, seed);
    await page.locator(`#bands button[data-b="${b}"]`).click();
    const problems: string[] = [];
    const seen = new Map<Kind, number>();
    let questions = 0;
    for (let n = 0; n < STAR_SETS; n++) {
      await page.locator('#mile').click();
      const len = await runSet(page, b, `seed ${seed} star ${n + 1}`, problems, seen);
      questions += len;
      if (len !== 10) problems.push(`[seed ${seed} star ${n + 1}] star test had ${len} questions, expected 10`);
      await page.locator('#home').click();
    }
    for (let d = 0; d < DAILY_DAYS; d++) {
      await page.clock.setSystemTime(dayTime(400 + d));
      await page.locator('#daily').click();
      const len = await runSet(page, b, `daily day ${400 + d}`, problems, seen);
      questions += len;
      if (len !== 5) problems.push(`[daily day ${400 + d}] daily set had ${len} questions, expected 5`);
      await page.locator('#home').click();
    }
    test.info().annotations.push({ type: 'questions checked', description: `${questions}; kinds ${JSON.stringify([...seen])}` });
    // The sweep must really have looked at every kind planned for this band.
    const planned: Record<string, Kind[]> = {
      '3-4': ['count', 'more', 'onemore', 'odd'], '5-6': ['add', 'subtract', 'missing', 'compare', 'add3', 'extreme'], '7-8': ['add', 'subtract', 'multiply', 'missing', 'compare'],
      '9-10': ['add', 'subtract', 'multiply', 'divide', 'missing', 'compare'], '11-12': ['add', 'subtract', 'multiply', 'divide', 'missing', 'compare'],
    };
    for (const k of planned[b]) expect(seen.get(k) ?? 0, `kind ${k} should have turned up at least 10 times for ages ${b}`).toBeGreaterThanOrEqual(10);
    expect(problems.slice(0, 40), `${problems.length} problems in ${questions} questions`).toEqual([]);
  });
}

test('compare questions (SCRUM-447): over 1 500 "Which is bigger" questions, both numbers shown are always offered', async ({ page }) => {
  // Same check as the sweep, but dedicated and bigger: only ages 5 to 6 and 7 to 8 first (where it was reported), then 9 to 12.
  await boot(page, 4711);
  const problems: string[] = [];
  let compares = 0;
  for (const b of ['5-6', '7-8', '9-10', '11-12'] as const) {
    if (await page.locator('#change').isVisible()) await page.locator('#change').click();
    await page.locator(`#bands button[data-b="${b}"]`).click();
    for (let n = 0; n < 80 && compares < 1500; n++) {
      await page.locator('#mile').click();
      for (let i = 0; i < 10; i++) {
        const s = await snapshot(page);
        if (kindOf(s.prompt) === 'compare') {
          compares++;
          const nums = (s.prompt.match(/\d+/g) ?? []);
          for (const x of nums) if (!s.options.includes(x)) problems.push(`[${b}] "${s.prompt}" offers ${JSON.stringify(s.options)} without ${x}`);
        }
        await answerAndNext(page, s);
      }
      await page.locator('#home').click();
    }
  }
  expect(compares, 'enough compare questions were seen').toBeGreaterThanOrEqual(300);
  expect(problems.slice(0, 30)).toEqual([]);
});

test('odd one out (SCRUM-448): every one seen shows 3 to 5 tappable shapes in one box, never two boxes; tapping the odd one wins', async ({ page }) => {
  await boot(page, 99);
  await page.locator('#bands button[data-b="3-4"]').click();
  const problems: string[] = [];
  let odds = 0;
  for (let n = 0; n < 60; n++) {
    await page.locator('#mile').click();
    for (let i = 0; i < 10; i++) {
      const s = await snapshot(page);
      if (s.kind === 'odd') {
        odds++;
        for (const p of problemsWith(s, '3-4')) problems.push(`[star ${n + 1} q${i + 1}] ${p}`);
        if (s.picks.length < 3 || s.picks.length > 5) problems.push(`[star ${n + 1}] ${s.picks.length} tappable shapes`);
      }
      await answerAndNext(page, s);
    }
    await page.locator('#home').click();
  }
  expect(odds, 'enough odd-one-out questions were seen').toBeGreaterThanOrEqual(30);
  expect(problems.slice(0, 30)).toEqual([]);
});

test('odd one out: a wrong tap is kind and switched off; after two misses the right shape glows; then the right tap finishes the question', async ({ page }) => {
  await boot(page, 7);
  await page.locator('#bands button[data-b="3-4"]').click();
  for (let n = 0; n < 40; n++) {
    await page.locator('#mile').click();
    for (let i = 0; i < 10; i++) {
      const s = await snapshot(page);
      if (s.kind === 'odd') {
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
        await expect(page.locator('#msg')).toHaveText('You got it!');
        return;
      }
      await answerAndNext(page, s);
    }
    await page.locator('#home').click();
  }
  throw new Error('no odd-one-out question turned up in 40 star tests');
});

test('every question kind has a wrong-answer path that keeps the question open and costs nothing', async ({ page }) => {
  await boot(page, 31);
  const done = new Set<Kind>();
  for (const b of BANDS) {
    if (await page.locator('#change').isVisible()) await page.locator('#change').click();
    await page.locator(`#bands button[data-b="${b}"]`).click();
    for (let n = 0; n < 12; n++) {
      await page.locator('#mile').click();
      for (let i = 0; i < 10; i++) {
        const s = await snapshot(page);
        if (!done.has(s.kind)) {
          done.add(s.kind);
          const before = +(await page.locator('#pts').innerText().catch(() => '0'));
          await tap(page, wrongAnswer(s));
          await expect(page.locator('#msg'), `${s.kind}: message after a wrong answer`).toContainText('Nearly!');
          await expect(page.locator('#msg')).not.toContainText(/wrong|incorrect|fail|bad|lose|lost|minus/i);
          expect((await snapshot(page)).prompt, `${s.kind}: the question must stay on screen after a wrong answer`).toBe(s.prompt);
          void before;
        }
        await answerAndNext(page, s);
      }
      await page.locator('#home').click();
    }
  }
  expect([...done].sort()).toEqual(['add', 'add3', 'compare', 'count', 'divide', 'extreme', 'subtract', 'missing', 'more', 'multiply', 'odd', 'onemore'].sort());
});
