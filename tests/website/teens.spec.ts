import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';

// Yaanstep Teens planner, first slice (SCRUM-500: 501 shell and storage, 502 events, 503 countdown, 504 day page,
// 506 category rules, 507 test preparation). Manish asked for it on 22 Nov 2026 and said "Start building".
// The page keeps everything under one localStorage key, only after the user adds something, and sends nothing.

const NOW = new Date('2026-11-23T10:00:00'); // a Monday, in the browser's own time zone
const T = (page: Page) => page.evaluate(() => (window as any).YS_TEENS);

async function open(page: Page) {
  // the clock stands still at NOW until a test moves it, so countdowns are exact
  await page.clock.install({ time: new Date(NOW.getTime() - 1000) });
  await page.clock.pauseAt(NOW);
  await page.goto('/teens.html');
  await expect(page.locator('#app')).toBeVisible();
}

async function addEvent(page: Page, title: string, date: string, start: string, more: { repeat?: 'daily' | 'weekly'; days?: string[] } = {}) {
  await page.locator('#ev-title').fill(title);
  await page.locator('#ev-date').fill(date);
  await page.locator('#ev-start').fill(start);
  if (more.repeat) {
    await page.locator('#ev-repeat').selectOption(more.repeat);
    for (const d of more.days ?? []) await page.locator('#ev-days').getByLabel(d).check();
  }
  await page.locator('#ev-save').click();
}

test.describe('Teens planner rules (worked out by hand)', () => {
  test('countdown words change at the right boundaries', async ({ page }) => {
    await open(page);
    const min = 60000, hour = 60 * min, day = 24 * hour;
    const cases: [number, string][] = [
      [0, 'now'], [-5 * min, 'now'], [1, 'in 1 min'], [14 * min, 'in 14 min'], [59 * min, 'in 59 min'], [60 * min, 'in 1 h'],
      [3 * hour + 20 * min, 'in 3 h 20 min'], [23 * hour + 59 * min, 'in 23 h 59 min'], [day, 'in 1 day'], [day + hour, 'in 1 day 1 hour'],
      [2 * day + 4 * hour + 30 * min, 'in 2 days 4 hours'], [6 * day + 23 * hour, 'in 6 days 23 hours'], [7 * day, 'in 7 days'], [12 * day + 5 * hour, 'in 12 days'],
    ];
    const got = await page.evaluate((c) => c.map(([ms]) => (window as any).YS_TEENS.formatCountdown(ms)), cases);
    expect(got).toEqual(cases.map((c) => c[1]));
  });

  test('works out the kind of event and the subject from the title', async ({ page }) => {
    await open(page);
    const cases: [string, string, string][] = [
      ['Maths test', 'test', 'Maths'], ['Algebra quiz Friday', 'test', 'Maths'], ['Biology final exam', 'test', 'Science'],
      ['English essay due', 'assignment', 'English'], ['History project', 'assignment', 'History'], ["Sam's party", 'social', ''],
      ['Movie with friends', 'social', ''], ['Soccer practice', 'sport', ''], ['Dentist appointment', 'health', ''],
      ['Dinner at grandma', 'family', ''], ['Chemistry class', 'school', 'Science'], ['Spanish', 'school', 'Languages'], ['Buy a new charger', 'other', ''],
    ];
    const got = await page.evaluate((c) => c.map(([t]) => (window as any).YS_TEENS.detectCategory(t)), cases);
    expect(got).toEqual(cases.map(([, cat, subject]) => ({ cat, subject })));
  });

  for (const n of [0, 1, 3, 7, 14, 20]) {
    test(`study plan for a test ${n} day(s) away: one block a day, weakest topic first, final review last`, async ({ page }) => {
      await open(page);
      const plan = await page.evaluate((n) => {
        const Y = (window as any).YS_TEENS;
        const d = new Date(2026, 10, 23 + n);
        const testDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return Y.buildStudyPlan({ today: '2026-11-23', testDay, subject: 'Maths', how: 'practice', time: '18:00',
          topics: [{ name: 'Fractions', conf: 4 }, { name: 'Ratios', conf: 1 }, { name: '', conf: 3 }] });
      }, n);
      if (n === 0) {
        expect(plan).toHaveLength(1);
        expect(plan[0].title).toBe('Quick review: Maths: Ratios, Fractions');
        expect(plan[0].date).toBe('2026-11-23');
        return;
      }
      const blocks = Math.min(n, 14);
      expect(plan).toHaveLength(blocks);
      const dates = plan.map((b: any) => b.date);
      expect(new Set(dates).size, 'one block a day').toBe(blocks);
      expect(plan.every((b: any) => b.start === '18:00')).toBe(true);
      expect(plan[blocks - 1].title).toBe('Final review: Maths: all topics');
      if (blocks > 1) expect(plan[0].title, 'weakest topic first').toBe('Study Maths: Ratios');
      const ratios = plan.filter((b: any) => b.title.endsWith('Ratios')).length;
      const fractions = plan.filter((b: any) => b.title.endsWith('Fractions')).length;
      expect(ratios, 'the topic you feel least sure about gets at least as many blocks').toBeGreaterThanOrEqual(fractions);
      // the last block is the day before the test
      const last = new Date(2026, 10, 23 + n - 1);
      expect(dates[blocks - 1]).toBe(`${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`);
    });
  }

  test('repeats: every day, chosen weekdays, and an end date', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(() => {
      const Y = (window as any).YS_TEENS;
      const weekly = { date: '2026-11-23', start: '16:00', repeat: { kind: 'weekly', days: [1, 3], until: '2026-12-09' } };
      const daily = { date: '2026-11-23', start: '07:00', repeat: { kind: 'daily', days: [], until: '' } };
      return {
        mon: Y.occursOn(weekly, '2026-11-30'), wed: Y.occursOn(weekly, '2026-11-25'), tue: Y.occursOn(weekly, '2026-11-24'),
        afterUntil: Y.occursOn(weekly, '2026-12-14'), before: Y.occursOn(weekly, '2026-11-16'),
        dailyLater: Y.occursOn(daily, '2027-03-01'), dst: Y.daysBetween('2027-03-13', '2027-03-15'),
      };
    });
    expect(r).toEqual({ mon: true, wed: true, tue: false, afterUntil: false, before: false, dailyLater: true, dst: 2 });
  });
});

test.describe('Teens planner page', () => {
  test('add a maths test, get asked how to prepare, and get study blocks with countdowns', async ({ page, context, baseURL }) => {
    const errors = watchErrors(page);
    const requests = watchRequests(page);
    await open(page);
    await expect(page.locator('#next-banner')).toHaveText('Nothing coming up yet. Add your first event below.');
    await page.locator('#ev-title').fill('Maths test');
    await expect(page.locator('#ev-guess')).toHaveText('Looks like: Test in Maths. You can change the type.');
    await addEvent(page, 'Maths test', '2026-11-26', '09:00');
    await expect(page.locator('#add-msg')).toHaveText('Added Maths test (Test), in 2 days 23 hours.');

    const prep = page.locator('#prep');
    await expect(prep).toBeVisible();
    await expect(prep.getByRole('group', { name: 'How do you want to prepare?' })).toBeVisible();
    await expect(page.locator('#prep-intro')).toContainText('Your Maths test is in 2 days 23 hours.');
    await page.getByLabel('Flashcards').check();
    await page.locator('#topic-1').fill('Fractions');
    await page.locator('#conf-1').selectOption('4');
    await page.locator('#topic-2').fill('Ratios');
    await page.locator('#conf-2').selectOption('1');
    expect(await axeViolations(page, '#prep')).toEqual([]);
    await page.getByRole('button', { name: 'Yes, make my plan' }).click();
    await expect(page.locator('#prep-plan li')).toHaveCount(3);
    await expect(page.locator('#prep-plan li').first()).toHaveText('Monday, November 23, 5:00 PM, 40 min: Study Maths: Ratios. Flashcards.');
    await expect(page.locator('#prep-plan li').last()).toContainText('Wednesday, November 25, 5:00 PM, 45 min: Final review: Maths: all topics.');
    await expect(page.locator('#add-msg')).toHaveText('Added 3 study blocks to your planner for Maths test.');

    // the first study block is today, so it is next up
    await expect(page.locator('#next-banner')).toHaveText('Next up: Study Maths: Ratios, in 7 h (today at 5:00 PM)');
    await expect(page.locator('#upcoming li')).toHaveCount(4);
    await expect(page.locator('#upcoming li').last()).toContainText('Maths test');
    await expect(page.locator('#upcoming li').last().locator('.count')).toHaveText('in 2 days 23 hours');

    // the countdowns move on their own
    await page.clock.fastForward('06:30:00');
    await expect(page.locator('#next-banner')).toHaveText('Next up: Study Maths: Ratios, in 30 min (today at 5:00 PM)');
    await expect(page.locator('#upcoming li').last().locator('.count')).toHaveText('in 2 days 16 hours');

    // open the test's card
    await page.locator('#upcoming').getByRole('button', { name: 'Maths test' }).click();
    await expect(page.locator('#detail-title')).toHaveText('Maths test');
    await expect(page.locator('#detail-count')).toHaveText('Starts in 2 days 16 hours');
    await expect(page.locator('#detail-help')).toContainText('You have a preparation plan with 3 study blocks.');

    // kept after a reload, under one key only
    await page.reload();
    await expect(page.locator('#upcoming li')).toHaveCount(4);
    const s = await storedData(page, context);
    expect(s.local.sort()).toEqual(['yaanstep-teens']);
    expect(s.cookies).toEqual([]);
    expect(s.session).toEqual([]);
    expect(s.databases).toEqual([]);
    expect(requests.external(new URL(baseURL!).origin), 'requests to other sites').toEqual([]);
    expect(requests.carryingData(), 'nothing sent').toEqual([]);
    expect(errors).toEqual([]);
  });

  test('say no to a plan, then make one later from the test card', async ({ page }) => {
    await open(page);
    await addEvent(page, 'Science quiz', '2026-11-25', '11:00');
    await page.getByRole('button', { name: 'No thanks' }).click();
    await expect(page.locator('#prep')).toBeHidden();
    await expect(page.locator('#add-msg')).toHaveText("No plan made. You can make one later from the test's card.");
    await page.locator('#day-events').getByRole('button', { name: 'Science quiz' }).click();
    await expect(page.locator('#detail-help')).toContainText('No preparation plan yet.');
    await page.getByRole('button', { name: 'Make a preparation guide' }).click();
    await expect(page.locator('#prep')).toBeVisible();
    await page.getByRole('button', { name: 'Yes, make my plan' }).click();
    await expect(page.locator('#prep-plan li')).toHaveCount(2);
  });

  test('day page: to-dos, a note, moving between days, and a weekly class on the right days', async ({ page }) => {
    await open(page);
    await expect(page.locator('#day-title')).toHaveText('Today, Monday, November 23');
    await page.locator('#todo-text').fill('Pack gym clothes');
    await page.locator('#todo-text').press('Enter');
    await page.locator('#todo-text').fill('Return library book');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByLabel('Pack gym clothes', { exact: true }).check();
    await page.locator('#day-note').fill('Ask about the field trip form');
    await page.locator('#day-note').blur();

    await addEvent(page, 'Guitar lesson', '2026-11-23', '16:30', { repeat: 'weekly', days: ['Wed'] });
    await expect(page.locator('#day-events li')).toHaveCount(1);
    await expect(page.locator('#day-events li .tag')).toHaveText('School');
    await page.getByRole('button', { name: 'Next day' }).click();
    await expect(page.locator('#day-title')).toHaveText('Tuesday, November 24');
    await expect(page.locator('#day-empty')).toBeVisible();
    await expect(page.locator('#todos li')).toHaveCount(0);
    await page.getByRole('button', { name: 'Next day' }).click();
    await expect(page.locator('#day-events li')).toHaveCount(1);
    await expect(page.locator('#day-events li .count')).toHaveText('in 2 days 6 hours');

    await page.reload();
    await expect(page.locator('#day-title')).toHaveText('Today, Monday, November 23');
    await expect(page.getByLabel('Pack gym clothes', { exact: true })).toBeChecked();
    await expect(page.getByLabel('Return library book', { exact: true })).not.toBeChecked();
    await expect(page.locator('#day-note')).toHaveValue('Ask about the field trip form');
    await page.getByRole('button', { name: 'Remove to-do: Return library book' }).click();
    await expect(page.locator('#todos li')).toHaveCount(1);
  });

  test('delete one event, then delete everything', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await open(page);
    await addEvent(page, 'Movie with friends', '2026-11-28', '19:00');
    await expect(page.locator('#add-msg')).toContainText('(Outing)');
    await addEvent(page, 'Swim practice', '2026-11-24', '06:30');
    await page.locator('#upcoming').getByRole('button', { name: 'Movie with friends' }).click();
    await page.getByRole('button', { name: 'Delete event' }).click();
    await expect(page.locator('#upcoming li')).toHaveCount(1);
    await page.getByRole('button', { name: 'Delete everything' }).click();
    await expect(page.locator('#wipe-msg')).toHaveText('Everything was deleted from this browser.');
    await expect(page.locator('#upcoming li')).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  });

  test('opening the page stores nothing until you add something', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  });

  test('fits a 320 px screen with events and the plan open, and passes the accessibility scan', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await open(page);
    await addEvent(page, 'Geometry midterm exam', '2026-11-30', '08:15');
    await page.locator('#topic-1').fill('Angles and parallel lines');
    await page.getByRole('button', { name: 'Yes, make my plan' }).click();
    // seven study blocks come first in Coming up, so open the exam from its own day page
    await page.locator('#day-events').getByRole('button', { name: 'Geometry midterm exam' }).click();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    expect(await axeViolations(page, 'main')).toEqual([]);
  });

  test('the home page links to the planner from the Yaanstep Teens card', async ({ page }) => {
    await page.goto('/index.html');
    const card = page.locator('.products li').nth(1);
    await expect(card.locator('h3')).toHaveText('Yaanstep Teens');
    await expect(card.getByRole('link', { name: 'Open the Teens planner' })).toHaveAttribute('href', 'teens.html');
  });
});
