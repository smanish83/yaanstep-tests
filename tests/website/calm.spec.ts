import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';

// The calm corner (calm.html, SCRUM-498; Manish, 22 Nov 2026). Calm play for any child: slow bubbles, a breathing circle,
// a picture to color and a "First, then" picture plan. No score, no timer, no losing, tap only, no sound but the device voice.
// Nothing in localStorage; the plan lives in sessionStorage only and is gone when the tab closes.

const ORIGIN = 'http://127.0.0.1:4173';
const PLAN_KEY = 'ys-first-then';
const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); };`;
const said = (page: Page) => page.evaluate(() => (window as any).__said as string[]);

test('linked from Yaanstep Sprouts; loads nothing from other sites, keeps nothing in localStorage, passes the accessibility scan', async ({ page, context }) => {
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await page.goto('/sprouts.html');
  await page.locator('.games-cards a[href="calm.html"]').click();
  await expect(page.locator('h1')).toHaveText('Calm corner');
  await expect(page).toHaveTitle('Calm corner | Yaanstep');
  await expect(page.locator('main .note').first()).toContainText('No score, no timer and no way to lose.');
  await expect(page.locator('main h2')).toHaveText(['Slow bubbles', 'Breathing circle', 'Color a picture', 'First, then']);
  expect(await axeViolations(page)).toEqual([]);
  await page.locator('#bubble-field button').first().click();
  await page.locator('#plan-cards button').first().click();
  await page.locator('#plan .done-btn').first().click();
  expect(await axeViolations(page), 'after playing').toEqual([]);
  expect(reqs.external(ORIGIN)).toEqual([]);
  expect(reqs.sending()).toEqual([]);
  const s = await storedData(page, context);
  expect(s.local, 'localStorage').toEqual([]);
  expect(s.session, 'sessionStorage holds only the plan').toEqual([PLAN_KEY]);
  expect(s.cookies).toEqual([]);
  expect(s.databases).toEqual([]);
  expect(errors).toEqual([]);
});

for (const width of [320, 0]) {
  test(`fits the screen${width ? ' at 320 px' : ''}, every button is at least 48 px, and each picture part is big enough to tap`, async ({ page }) => {
    if (width) await page.setViewportSize({ width, height: 700 });
    await page.goto('/calm.html');
    await page.locator('#plan-cards button').nth(1).click();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    const small = await page.locator('main button:visible').evaluateAll((bs) => bs.filter((b) => { const r = b.getBoundingClientRect(); return r.height < 47.5 || r.width < 47.5; }).map((b) => b.textContent));
    expect(small).toEqual([]);
    const parts = await page.locator('#picture .part').evaluateAll((ps) => ps.map((p) => { const r = p.getBoundingClientRect(); return { id: p.getAttribute('data-part'), w: r.width, h: r.height }; }));
    expect(parts).toHaveLength(8);
    expect(parts.filter((p) => p.w < 47.5 || p.h < 47.5)).toEqual([]);
    if (width) expect(await axeViolations(page)).toEqual([]);
  });
}

test('bubbles pop softly with no sound, and a new bubble comes back; there is no score', async ({ page }) => {
  await page.addInitScript(VOICE);
  await page.goto('/calm.html');
  const b = page.locator('#bubble-field button').first();
  await expect(page.locator('#bubble-field button')).toHaveCount(6);
  await expect(b).toHaveAccessibleName(/^Pop the \w+ bubble$/);
  await b.click();
  await expect(b).toHaveClass(/popped/);
  await expect(page.locator('#bubble-status')).toContainText('Pop!');
  await expect(b).not.toHaveClass(/popped/, { timeout: 4000 });
  await expect(b).toHaveAccessibleName(/^Pop the \w+ bubble$/);
  expect(await said(page), 'popping makes no sound').toEqual([]);
  expect(await page.locator('main').innerText()).not.toMatch(/\bscore\b.*\d|\bpoints?\b|\byou lose\b|\bgame over\b/i);
  await b.focus();
  await page.keyboard.press('Enter');
  await expect(b).toHaveClass(/popped/);
});

test('breathing circle: grows and shrinks at the chosen pace, and stops any time', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/calm.html');
  await expect(page.locator('#pace button')).toHaveText(['Slow', 'Slower', 'I tap for each step']);
  await expect(page.locator('#pace button[data-pace="4"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#breath-start').click();
  await expect(page.locator('#breath-word')).toHaveText('Breathe in…');
  await expect(page.locator('#breath')).toHaveClass(/big/);
  await expect(page.locator('#breath-count')).toHaveText('Breath 1 of 5');
  await expect(page.locator('#breath-stop')).toBeFocused();
  await expect(page.locator('#breath-word')).toHaveText('Breathe out…', { timeout: 6000 });
  await expect(page.locator('#breath')).not.toHaveClass(/big/);
  await page.locator('#breath-stop').click();
  await expect(page.locator('#breath-word')).toHaveText('Stopped. You can start again any time.');
  await expect(page.locator('#breath-start')).toBeFocused();
  await page.waitForTimeout(4500);
  await expect(page.locator('#breath-word'), 'nothing goes on after Stop').toHaveText('Stopped. You can start again any time.');
});

test('breathing circle: with reduce motion it shows text steps, one for each tap, and ends after 5 breaths', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/calm.html');
  await expect(page.locator('#pace')).toBeHidden();
  await page.locator('#breath-start').click();
  for (let n = 1; n <= 5; n++) {
    await expect(page.locator('#breath-word')).toHaveText('Breathe in…');
    await expect(page.locator('#breath-count')).toContainText(`Breath ${n} of 5`);
    await page.locator('#breath-next').click();
    await expect(page.locator('#breath-word')).toHaveText('Breathe out…');
    if (n === 1) {
      await page.waitForTimeout(1500);
      await expect(page.locator('#breath-word'), 'waits for the tap').toHaveText('Breathe out…');
      expect(await page.locator('#breath .b-grow').evaluate((c) => getComputedStyle(c).transitionDuration)).toMatch(/^0s/);
    }
    await page.locator('#breath-next').click();
  }
  await expect(page.locator('#breath-word')).toHaveText('All done. Well done. You can start again any time.');
  await expect(page.locator('#breath-start')).toHaveText('Start again');
});

test('color a picture: pick a color, tap or press Enter on a part; Start again clears it', async ({ page }) => {
  await page.goto('/calm.html');
  await expect(page.locator('#palette button')).toHaveCount(9);
  await page.locator('#palette button[data-paint="blue"]').click();
  await expect(page.locator('#palette button[data-paint="blue"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#palette button[data-paint="blue"]')).toHaveAccessibleName('Blue');
  const sky = page.locator('#picture .part[data-part="sky"]');
  await expect(sky).toHaveAccessibleName('Color the sky');
  await sky.click({ position: { x: 20, y: 20 } });
  await expect(sky).toHaveAttribute('fill', '#5b9bd8');
  await expect(page.locator('#color-status')).toHaveText('The sky is blue now.');
  await page.locator('#palette button[data-paint="yellow"]').click();
  const door = page.locator('#picture .part[data-part="door"]');
  await door.focus();
  await page.keyboard.press('Enter');
  await expect(door).toHaveAttribute('fill', '#f6d34a');
  await page.locator('#color-clear').click();
  for (const p of await page.locator('#picture .part').all()) await expect(p).toHaveAttribute('fill', '#fff');
});

test('First, then: up to 4 pictures in order, big Done ticks, kept in this tab only, gone in a new tab', async ({ page, context }) => {
  await page.goto('/calm.html');
  await expect(page.locator('main')).toContainText('The plan is kept only while this browser tab is open. It is gone when you close the tab.');
  await expect(page.locator('#plan-cards button')).toHaveCount(8);
  await expect(page.locator('#plan-cards button').first()).toHaveAccessibleName('Add Maths game');
  for (const id of ['maths', 'break', 'story', 'drawing']) await page.locator(`#plan-cards button[data-card="${id}"]`).click();
  await expect(page.locator('#plan li')).toHaveCount(4);
  await expect(page.locator('#plan li .what b')).toHaveText(['First', 'Then', 'Next', 'Last']);
  await expect(page.locator('#plan li .what')).toContainText(['Maths game', 'Break', 'Story', 'Drawing']);
  for (const b of await page.locator('#plan-cards button').all()) await expect(b).toBeDisabled();
  await expect(page.locator('#plan-status')).toContainText('The plan is full.');
  const done = page.locator('#plan .done-btn').first();
  await expect(done).toHaveAccessibleName('Done: Maths game');
  await done.click();
  await expect(done).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#plan li').first()).toHaveClass(/is-done/);
  await expect(page.locator('#plan li').first().locator('svg.tick')).toBeVisible();
  await expect(page.locator('#plan-status')).toHaveText('Maths game is done. 3 more, then finished.');
  const box = (await done.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(47.5);
  expect(JSON.parse((await page.evaluate((k) => sessionStorage.getItem(k), PLAN_KEY))!)).toEqual([
    { id: 'maths', done: true }, { id: 'break', done: false }, { id: 'story', done: false }, { id: 'drawing', done: false },
  ]);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await page.reload();
  await expect(page.locator('#plan li'), 'kept while the tab is open').toHaveCount(4);
  for (const b of await page.locator('#plan .done-btn').all()) if ((await b.getAttribute('aria-pressed')) === 'false') await b.click();
  await expect(page.locator('#plan-all')).toHaveText('All finished! Well done.');
  const other = await context.newPage();
  await other.goto('/calm.html');
  await expect(other.locator('#plan li'), 'a new tab starts empty').toHaveCount(0);
  await other.close();
  await page.locator('#plan-clear').click();
  await expect(page.locator('#plan li')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
});

test('every instruction has a Hear it button that speaks it with the device voice', async ({ page }) => {
  await page.addInitScript(VOICE);
  await page.goto('/calm.html');
  const hears = page.locator('main .hear');
  await expect(hears).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    await expect(hears.nth(i)).toHaveAccessibleName('Hear it');
    await hears.nth(i).click();
    const text = await page.locator(`#${await hears.nth(i).getAttribute('data-say')}`).innerText();
    await expect.poll(async () => (await said(page)).at(-1)).toBe(text.trim());
  }
});

test('no health claims and no time pressure in the words', async ({ page }) => {
  await page.goto('/calm.html');
  const text = await page.locator('main').innerText();
  for (const bad of [/\bheals?\b/i, /\breduces? (stress|anxiety)\b/i, /\bimproves?\b/i, /\bhurry\b/i, /\bquick(ly)?\b/i, /\bseconds? left\b/i]) expect(text).not.toMatch(bad);
  await expect(page.locator('main')).toContainText('They are not advice from a doctor or teacher.');
});
