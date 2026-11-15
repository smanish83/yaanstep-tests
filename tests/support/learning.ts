import { expect, type Page } from '@playwright/test';
import { url } from './site';

/** Helpers that play the Learning page games the way a child and a grown-up would. */

export type Kind = 'mixed' | 'add' | 'take' | 'more';
export type Style = 'questions' | 'dice' | 'hunt' | 'race' | 'line';
export interface MathsOptions { kind?: Kind; size?: '10' | '20'; style?: Style; lesson?: boolean }

export const title = (page: Page) => page.locator('#player-title');
export const progress = (page: Page) => page.locator('#player-progress');
export const stage = (page: Page) => page.locator('#player-stage');
export const feedback = (page: Page) => page.locator('#player-feedback');
export const next = (page: Page) => page.locator('#player-next');
export const exit = (page: Page) => page.locator('#player-close');

export async function openLearning(page: Page) {
  await page.goto(url('learning'));
  await expect(page.locator('#learn')).toBeVisible();
}

export async function startMaths(page: Page, o: MathsOptions = {}) {
  await page.locator(`input[name=kind][value=${o.kind ?? 'mixed'}]`).check();
  await page.locator(`input[name=size][value="${o.size ?? '20'}"]`).check();
  await page.locator(`input[name=style][value=${o.style ?? 'questions'}]`).check();
  await page.locator('#with-lesson').setChecked(o.lesson ?? false);
  await page.locator('#start-maths').click();
  await expect(page.locator('#player')).toBeVisible();
}

export async function startSorting(page: Page) {
  await page.locator('#start-sorting').click();
  await expect(page.locator('#player')).toBeVisible();
}

/** The three sentences read aloud for a story question, and every number in them. */
export async function story(page: Page) {
  const lines = await page.locator('#player-say p:not(.who)').allInnerTexts();
  return { lines, numbers: (lines.join(' ').match(/\d+/g) ?? []).map(Number) };
}

/** Works the answer out from the story words alone, the way a grown-up reading aloud would. */
export function answerFromStory(lines: string[]): number {
  const n = (s: string) => Number(s.match(/\d+/)![0]);
  const [first, second, ask] = lines;
  if (/How many more does/.test(ask)) return n(first) - n(second);
  if (/How many are left/.test(ask)) return n(first) - n(second);
  if (/How many .* now\?/.test(ask)) return n(first) + n(second);
  throw new Error(`Unknown kind of story: ${lines.join(' ')}`);
}

/** Works the answer out from the bar picture's text description (what a screen reader hears). */
export function answerFromPicture(label: string): number {
  if (label.startsWith('Two bars')) {
    const [a, b] = [...label.matchAll(/: (\d+)\./g)].map((m) => Number(m[1]));
    return a - b;
  }
  const whole = label.match(/Whole bar: (unknown|\d+)/)![1];
  const parts = label.split('Parts: ')[1].split(', ').map((p) => p.trim());
  const known = parts.filter((p) => /^\d+/.test(p)).map((p) => parseInt(p, 10));
  return whole === 'unknown' ? known.reduce((s, v) => s + v, 0) : Number(whole) - known[0];
}

/** Reads a number card such as "7 + 5 = ?" or "12 − 4 = ?". */
export function answerFromCard(card: string): number {
  const m = card.match(/(\d+)\s*([+−-])\s*(\d+)/)!;
  return m[2] === '+' ? Number(m[1]) + Number(m[3]) : Number(m[1]) - Number(m[3]);
}

/** Finds the right answer for the step on screen, without using anything hidden in the page's code. */
export async function rightAnswer(page: Page): Promise<{ value: number; buttons: ReturnType<Page['locator']> }> {
  const s = stage(page);
  if (await s.locator('.dice-table').count()) {
    if (await s.getByRole('button', { name: 'Roll', exact: true }).isEnabled()) await s.getByRole('button', { name: 'Roll', exact: true }).click();
    const dice = (await s.locator('.dice-table svg[role=img]').evaluateAll((d) => d.map((x) => x.getAttribute('aria-label') ?? ''))).map((l) => Number(l.match(/\d+/)![0]));
    const plus = (await s.locator('.dice-sign').innerText()).trim() === '+';
    return { value: plus ? dice[0] + dice[1] : dice[0] - dice[1], buttons: s.locator('.num-row button') };
  }
  if (await s.locator('.hunt-grid').count()) return { value: answerFromCard(await s.locator('.fact-card').innerText()), buttons: s.locator('.hunt-grid button') };
  if (await s.locator('.num-line').count()) return { value: answerFromCard(await s.locator('.fact-card').innerText()), buttons: s.locator('.num-line button') };
  const label = (await s.locator('.drop-pic svg[role=img]').getAttribute('aria-label')) ?? '';
  return { value: answerFromPicture(label), buttons: s.locator('.num-row button') };
}

export const numberButton = (buttons: ReturnType<Page['locator']>, n: number) => buttons.filter({ hasText: new RegExp(`^${n}$`) });

/** Plays every step to the end, always giving the right answer first time. Returns the step titles seen. */
export async function playMathsPerfectly(page: Page): Promise<string[]> {
  const titles: string[] = [];
  for (let guard = 0; guard < 20; guard++) {
    const t = await title(page).innerText();
    titles.push(t);
    if (await next(page).isHidden()) return titles; // the end screen has no Next button
    if (!/^Lesson: (see it with dots|the bar picture)$/.test(t)) {
      const { value, buttons } = await rightAnswer(page);
      await numberButton(buttons, value).click();
      await expect(feedback(page), `feedback after answering ${value} on "${t}"`).toHaveClass(/\byes\b/);
    }
    await expect(next(page)).toBeEnabled();
    await next(page).click();
  }
  throw new Error('The game did not reach its end screen in 20 steps');
}

/** Plays the three sorting steps by tapping. */
export async function playSortingPerfectly(page: Page) {
  // Step 1: two socks are the same.
  const socks = stage(page).locator('.tray button.item-btn');
  const labels = await socks.evaluateAll((b) => b.map((x) => x.getAttribute('aria-label') ?? ''));
  const twin = labels.find((l, i) => labels.indexOf(l) !== i)!;
  const at = labels.map((l, i) => (l === twin ? i : -1)).filter((i) => i >= 0);
  await socks.nth(at[0]).click();
  await socks.nth(at[1]).click();
  await expect(feedback(page)).toContainText('Yes! Those two socks are the same.');
  await next(page).click();
  // Step 2: one thing is different.
  const things = stage(page).locator('.tray button.item-btn');
  const names = await things.evaluateAll((b) => b.map((x) => x.getAttribute('aria-label') ?? ''));
  await things.nth(names.findIndex((l) => names.indexOf(l) === names.lastIndexOf(l))).click();
  await expect(feedback(page)).toContainText(/Yes! The (ball|star|block) is different\./);
  await next(page).click();
  // Step 3: sort six blocks into two baskets.
  for (let i = 0; i < 6; i++) {
    const block = stage(page).locator('.tray button[data-color]').first();
    const color = await block.getAttribute('data-color');
    await block.click();
    await stage(page).locator(`button.basket[data-color=${color}]`).click();
  }
  await expect(feedback(page)).toContainText('All sorted! Well done.');
  await next(page).click();
}
