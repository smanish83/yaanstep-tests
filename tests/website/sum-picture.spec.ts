import { test, expect, type Page } from '@playwright/test';
import { axeViolations, watchErrors } from '../support/checks';

// Missing-number sums (Manish, 23 Nov 2026): "After answering 7 + ? = 10 the question mark should be replaced with the
// right answer. If user give wrong answer, lets say 7 + ? = 10, user input is 2. Then show 7 + 2 = 9 ... or graphical
// representation so user can guess how much are they off from the real answer."
// assets/sum-picture.js draws the wrong try; the maths chapters, number bonds and quick maths use it.

type Pic = { html: string } | null;
const picture = (page: Page, sum: string, guess: number) => page.evaluate(([s, g]) => (window as any).YSSum.picture(s, g), [sum, guess] as const) as Promise<Pic>;
const text = (p: Pic) => (p?.html ?? '').replace(/<svg[\s\S]*<\/svg>/, '').replace(/<[^>]+>/g, '');
const label = (p: Pic) => (p?.html.match(/aria-label="([^"]*)"/) ?? [])[1] ?? '';

test.describe('the picture of a wrong try', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/number-bonds.html'); });

  test('7 + ? = 10 with 2 says "7 + 2 = 9. We want 10." and shows one empty place in a frame of 10', async ({ page }) => {
    const p = await picture(page, '7 + ? = 10', 2);
    expect(text(p)).toBe('7 + 2 = 9. We want 10.');
    expect(label(p)).toBe('A frame with 10 places for 10. 7 and 2 make 9 counters. 1 place is still empty.');
    expect(p!.html.match(/<circle/g)).toHaveLength(9);
  });

  test('going over shows the counters that do not fit', async ({ page }) => {
    const p = await picture(page, '7 + ? = 10', 5);
    expect(text(p)).toBe('7 + 5 = 12. We want 10.');
    expect(label(p)).toContain('2 counters did not fit in the frame.');
  });

  test('taking away crosses out the child\'s number and shows the places we want left', async ({ page }) => {
    const p = await picture(page, '10 − ? = 6', 2);
    expect(text(p)).toBe('10 − 2 = 8. We want 6.');
    expect(label(p)).toBe('Your try: 10 counters with 2 crossed out leaves 8 counters. We want 6 counters left, shown as 6 empty places.');
  });

  test('a missing answer shows the sum as counters with the child\'s number under it', async ({ page }) => {
    const p = await picture(page, '8 + 5 = ?', 12);
    expect(text(p)).toBe('You said 12. Count all the counters to check.');
    expect(label(p)).toBe('8 teal counters and 5 orange counters. Under them, your 12 counters.');
  });

  test('big numbers get the sentence only, and sums it cannot draw get nothing', async ({ page }) => {
    const p = await picture(page, '30 + ? = 50', 10);
    expect(text(p)).toBe('30 + 10 = 40. We want 50.');
    expect(p!.html).not.toContain('<svg');
    expect(await picture(page, '3 x 4 = ?', 5)).toBeNull();
    expect(await page.evaluate(() => (window as any).YSSum.solved('7 + ? = 10', 3))).toBe('7 + 3 = 10');
  });
});

test('Number bonds: a wrong answer shows the try as a sum and a picture; the right one fills in the "?"', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/number-bonds.html');
  await page.locator('#play-take').click();
  const r = await page.evaluate(() => (window as any).YS_BONDS.current()) as { t: number; k: number; ans: number };
  const opts = (await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => Number(b.getAttribute('data-v'))))) as number[];
  const wrong = opts.find((v) => v !== r.ans)!;
  await page.locator(`#choices button[data-v="${wrong}"]`).click();
  const tryBox = page.locator('#panel .sum-try');
  await expect(tryBox).toBeVisible();
  await expect(tryBox.locator('p')).toHaveText(`You said ${wrong}. Count the counters that are left to check.`);
  await expect(tryBox.locator('svg[role=img]')).toHaveAttribute('aria-label', `${r.t} counters with ${r.k} crossed out. Under them, your ${wrong} counter${wrong === 1 ? '' : 's'}.`);
  expect(await axeViolations(page)).toEqual([]);
  await page.locator(`#choices button[data-v="${r.ans}"]`).click();
  await expect(page.locator('#sum')).toHaveText(`${r.t} − ${r.k} = ${r.ans}`);
  await expect(page.locator('#panel .sum-try')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Number bonds: a missing part shows how far the try is from the whole', async ({ page }) => {
  await page.goto('/number-bonds.html');
  await page.locator('#play-bonds').click();
  for (let i = 0; i < 20; i++) {
    const r = await page.evaluate(() => (window as any).YS_BONDS.current()) as { a: number; b: number; whole: number; hide: string; ans: number };
    if (r.hide === 'b') {
      const opts = (await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => Number(b.getAttribute('data-v'))))) as number[];
      const wrong = opts.find((v) => v !== r.ans)!;
      await page.locator(`#choices button[data-v="${wrong}"]`).click();
      await expect(page.locator('#panel .sum-try p')).toHaveText(`${r.a} + ${wrong} = ${r.a + wrong}. We want ${r.whole}.`);
      return;
    }
    await page.locator(`#choices button[data-v="${r.ans}"]`).click();
    await page.locator('#go').click();
    if (await page.locator('#again').isVisible()) await page.locator('#again').click();
  }
  throw new Error('no round with a missing part came up in 20 rounds');
});
