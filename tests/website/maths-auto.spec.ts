import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, watchErrors, watchRequests } from '../support/checks';
import { feedback, gameStyle, next, numberButton, openLearning, rightAnswer, stage, startAutoMaths, title } from '../support/learning';

// Maths picked for the child (SCRUM-494, Manish 22 Nov 2026): no option menus. It starts easy for the age
// (number hunt with adding first), mixes one harder story question into every set, and moves the level up or
// down from the answers. After a miss, a short moving-picture lesson is one tap away (SCRUM-494 point 5, SCRUM-495).

const LEVEL_KEY = 'sprouts:maths-level';
const level = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), LEVEL_KEY);

async function withAge(page: Page, age: number) {
  await page.evaluate((a) => localStorage.setItem('ys-profile', JSON.stringify({ age: a, color: 0, nick: '' })), age);
  await page.reload();
}

/** Plays to the end. plan[i] false means question i gets one wrong answer first. Returns the game style of each question. */
async function playSet(page: Page, plan: boolean[] = [true, true, true, true, true]) {
  const styles: string[] = [];
  let q = 0;
  for (let guard = 0; guard < 20; guard++) {
    const t = await title(page).innerText();
    if (await next(page).isHidden()) return styles;
    if (t === 'Lesson: your turn' || t.startsWith('Question')) {
      const { value, buttons } = await rightAnswer(page);
      if (t.startsWith('Question')) {
        styles.push(await gameStyle(page));
        if (plan[q++] === false) {
          const values = (await buttons.allInnerTexts()).map(Number);
          await numberButton(buttons, values.find((v) => v !== value)!).click();
          await expect(feedback(page)).toContainText(/^Not yet\./);
        }
      }
      await numberButton(buttons, value).click();
      await expect(feedback(page)).toHaveClass(/\byes\b/);
    }
    await next(page).click();
  }
  throw new Error('did not reach the end');
}

test.beforeEach(async ({ page }) => { await openLearning(page); });

test('shows one Start button; the option menus wait behind "Grown-up: choose the game yourself"', async ({ page }) => {
  await expect(page.locator('#start-maths-auto')).toBeVisible();
  await expect(page.locator('#maths-own')).not.toHaveAttribute('open', '');
  await expect(page.locator('input[name=style]').first()).toBeHidden();
  await page.locator('#maths-own summary').click();
  await expect(page.locator('input[name=style]').first()).toBeVisible();
});

test('age 6: a short lesson, then number hunt with adding, one story question in the middle, and a harder game next time', async ({ page }) => {
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await withAge(page, 6);
  await startAutoMaths(page);
  await expect(title(page)).toHaveText('Lesson: see it with dots');
  await expect(page.locator('#player-say')).toContainText('Adding means putting two groups together.');
  await expect(stage(page).locator('svg.moving[role=img]')).toHaveAttribute('aria-label', /^Moving dots\. /);
  const styles = await playSet(page);
  expect(styles).toEqual(['hunt', 'hunt', 'hunt', 'questions', 'hunt']);
  await expect(stage(page)).toContainText('Right on the first try: 5.');
  await expect(stage(page).locator('#auto-next')).toHaveText('Next time: a little harder.');
  expect((await level(page)).level, 'all right, story question too: two steps up').toBe(2);
  await stage(page).getByRole('button', { name: 'Keep going' }).click();
  // Two steps up the ladder is the dice game, still adding to 10, so no lesson this time.
  await expect(title(page)).toHaveText('Question 1 of 5');
  expect(await gameStyle(page)).toBe('dice');
  expect(errors).toEqual([]);
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
});

test('the start depends on the age: age 12 starts with the race game, harder than age 6', async ({ page }) => {
  await withAge(page, 12);
  await startAutoMaths(page);
  const styles = await playSet(page);
  expect(styles[0]).toBe('race');
  expect((await level(page)).level).toBeGreaterThanOrEqual(8);
});

test('two misses in a row make the next questions easier, and "Show me how" opens a short moving lesson', async ({ page }) => {
  await withAge(page, 8);
  await startAutoMaths(page);
  while (!(await title(page).innerText()).startsWith('Question')) {
    if ((await title(page).innerText()) === 'Lesson: your turn') {
      const { value, buttons } = await rightAnswer(page);
      await numberButton(buttons, value).click();
    }
    await next(page).click();
  }
  const { value, buttons } = await rightAnswer(page);
  await expect(page.locator('#show-how')).toHaveCount(0);
  await numberButton(buttons, (await buttons.allInnerTexts()).map(Number).find((v) => v !== value)!).click();
  await page.locator('#show-how').click();
  const how = stage(page).locator('.how-panel');
  await expect(how).toContainText('Short lesson');
  await expect(how.locator('svg.moving[role=img]')).toHaveCount(1);
  await expect(how.locator('svg[role=img][aria-label^="Bar picture"]')).toHaveCount(1);
  await expect(how.getByRole('button', { name: 'Watch again' })).toBeVisible();
  expect(await axeViolations(page, 'main'), 'accessibility scan with the lesson open').toEqual([]);
  await numberButton(buttons, value).click();
  await next(page).click();
  await playSet(page, [false, true, true, true]);
  await expect(stage(page).locator('#auto-next')).toHaveText('Next time: a little easier.');
  expect((await level(page)).level).toBeLessThan(5);
});

test('with "reduce motion" the moving dots show their final picture at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startAutoMaths(page);
  const anim = await stage(page).locator('svg.moving circle').first().evaluate((c) => getComputedStyle(c).animationName);
  expect(anim).toBe('none');
});

test('fits the screen and passes the accessibility scan', async ({ page }) => {
  await startAutoMaths(page);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  expect(await axeViolations(page, 'main')).toEqual([]);
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test('keeps only the level and the points, and Reset progress in the profile clears both', async ({ page }) => {
  await withAge(page, 7);
  await startAutoMaths(page);
  await playSet(page);
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  expect(keys).toEqual([LEVEL_KEY, 'sprouts:points', 'ys-profile']);
  const pts = JSON.parse((await page.evaluate(() => localStorage.getItem('sprouts:points')))!);
  expect(pts.maths, 'a maths point for each question answered').toBeGreaterThanOrEqual(5);
  expect([pts.english, pts.world]).toEqual([0, 0]);
  await page.locator('#player-close').click();
  await page.locator('#ys-badge').click();
  await page.locator('#ys-reset').click();
  await page.locator('#ys-wipe').click();
  expect(await level(page)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('sprouts:points'))).toBeNull();
});
