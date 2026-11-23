import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';

// Slow things to watch (watch.html; Manish, 23 Nov 2026: "in one video I found out they like to watch continuously
// moving object like fan, some sort of lights etc. Please add something like that as well.").
// Eight calm moving pictures drawn on a canvas. Each moves only after a tap, has no sound, and stops on Stop.
// No points, nothing stored, nothing sent. Linked from the Yaanstep Sprouts cards, next to the calm corner and weather.

const ORIGIN = 'http://127.0.0.1:4173';
const SCENES = ['fan', 'lights', 'lava', 'fish', 'snow', 'waves', 'pinwheel', 'balloons'];
const state = (page: Page) => page.evaluate(() => (window as any).YS_WATCH.state()) as Promise<{ scene: string | null; running: boolean; t: number; frames: number; speed: number }>;

test('linked from Yaanstep Sprouts next to the calm corner; loads nothing from other sites, stores nothing, passes the accessibility scan', async ({ page, context }) => {
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await page.goto('/sprouts.html');
  const cards = await page.locator('.games-cards > li h3').allTextContents();
  const weather = cards.indexOf('Weather and temperature');
  expect(cards.slice(weather, weather + 3), 'calm cards sit next to weather').toEqual(['Weather and temperature', 'Slow things to watch', 'Calm corner']);
  await page.locator('.games-cards a[href="watch.html"]').click();
  await expect(page.locator('h1')).toHaveText('Slow things to watch');
  await expect(page).toHaveTitle('Slow things to watch | Yaanstep');
  await expect(page.locator('#picks button')).toHaveCount(SCENES.length);
  expect(await page.evaluate(() => (window as any).YS_WATCH.ids)).toEqual(SCENES);
  await expect(page.locator('#viewer')).toBeHidden();
  expect((await state(page)).running, 'nothing moves before a tap').toBe(false);
  expect(await axeViolations(page)).toEqual([]);
  await page.locator('#picks button[data-scene=fan]').click();
  await expect(page.locator('#viewer')).toBeVisible();
  expect(await axeViolations(page), 'while watching').toEqual([]);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  expect(reqs.external(ORIGIN)).toEqual([]);
  expect(reqs.sending()).toEqual([]);
  const s = await storedData(page, context);
  expect(s.local).toEqual([]);
  expect(s.session.filter((k) => !/^ys-rest/.test(k))).toEqual([]);
  expect(s.cookies).toEqual([]);
  expect(errors).toEqual([]);
});

test('every picture moves after a tap, is described for screen readers, and Stop stops it and gives focus back', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/watch.html');
  for (const id of SCENES) {
    const pick = page.locator(`#picks button[data-scene=${id}]`);
    await pick.click();
    await expect(page.locator('#scene-h')).toBeFocused();
    await expect(pick).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('#scene')).toHaveAttribute('role', 'img');
    await expect(page.locator('#scene')).toHaveAttribute('aria-label', /\w.{20,}\.$/);
    await expect(page.locator('#scene-status')).toContainText('is moving slowly. Tap Stop to stop.');
    await expect.poll(async () => (await state(page)).frames, { message: `${id} draws frames` }).toBeGreaterThan(5);
    const a = await state(page);
    expect(a.scene).toBe(id);
    expect(a.running).toBe(true);
    await page.locator('#stop').click();
    await expect(page.locator('#viewer')).toBeHidden();
    await expect(pick).toBeFocused();
    const f = (await state(page)).frames;
    await page.waitForTimeout(300);
    expect((await state(page)).frames, `${id} stops drawing`).toBe(f);
  }
  expect(errors).toEqual([]);
});

test('Next thing moves on to the next picture, and Slower halves the speed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/watch.html');
  await page.locator('#picks button[data-scene=lava]').click();
  await expect(page.locator('[data-speed="1"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#next').click();
  expect((await state(page)).scene).toBe('fish');
  await expect(page.locator('#scene-h')).toHaveText('Fish tank');
  await page.locator('[data-speed="0.5"]').click();
  await expect(page.locator('[data-speed="0.5"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-speed="1"]')).toHaveAttribute('aria-pressed', 'false');
  expect((await state(page)).speed).toBe(0.5);
});

test('with reduce motion set on the device, pictures start at the slower speed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/watch.html');
  await expect(page.locator('[data-speed="0.5"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#picks button[data-scene=lights]').click();
  expect((await state(page)).speed).toBe(0.5);
});

test('the movement is slow: after 10 seconds of movement, the fan has turned less than two times round', async ({ page }) => {
  // The fan turns 0.9 radians a second at the normal speed: about one turn in 7 seconds.
  await page.goto('/watch.html');
  const turns = await page.evaluate(() => (0.9 * 10) / (2 * Math.PI));
  expect(turns).toBeLessThan(2);
  // And every picture can be drawn at any moment without an error.
  const bad = await page.evaluate((ids) => {
    const out: string[] = [];
    for (const id of ids) for (const t of [0, 3.3, 60, 900]) { try { (window as any).YS_WATCH.drawAt(id, t); } catch (e) { out.push(`${id}@${t}: ${e}`); } }
    return out;
  }, SCENES);
  expect(bad).toEqual([]);
});

test('the wording is plain: no score, no sound, nothing sent, and none of the words the rules ban', async ({ page }) => {
  await page.goto('/watch.html');
  const text = await page.locator('main').innerText();
  for (const t of ['No sound, no score and nothing to win.', 'until you tap Stop', 'not yet tested with children', 'Nothing is recorded or sent']) expect(text).toContain(t);
  for (const bad of [/therap/i, /treatment/i, /diagnos/i, /special needs/i, /\bproven\b/i, /clinical/i, /autis/i, /disorder/i, /\bSEND?\b/]) expect.soft(text).not.toMatch(bad);
});
