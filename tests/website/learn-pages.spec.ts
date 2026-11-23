import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';

// Learn-then-play pages added 22 Nov 2026 at Manish's ask: Money and coins, Clocks and time, Weather and temperature.
// Each has a moving lesson in parts, then games where a miss says what happened and offers a lesson with another example.
// Answers are checked against the round the page reports (window.YS_SHELL.current()), and the maths in the words on screen.

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); };`;

const PAGES = [
  { file: 'money', h1: 'Money and coins', parts: 6, games: ['count', 'pay', 'change'] },
  // Clocks also has Time around the world and Set the kitchen timer (23 Nov 2026); clocks-world-timer.spec.ts plays those.
  { file: 'clocks', h1: 'Clocks and time', parts: 7, games: ['read', 'set', 'howlong'], others: ['world', 'timer'] },
  { file: 'weather', h1: 'Weather and temperature', parts: 6, games: ['find', 'dress', 'read', 'compare'] },
] as const;

/** Menu games this file does not play (another spec does). */
const others = (p: (typeof PAGES)[number]) => ('others' in p ? p.others.length : 0);

async function open(page: Page, file: string) {
  await page.addInitScript(VOICE);
  await page.goto(`/${file}.html`);
}
const current = (page: Page) => page.evaluate(() => (window as any).YS_SHELL.current());

/** Answers the round on screen correctly, whatever the game. */
async function answer(page: Page, file: string, game: string) {
  const r = await current(page);
  if (file === 'money' && game === 'pay') {
    const have = await page.locator('#purse button').evaluateAll((bs) => bs.map((b) => b.id.replace('add-', '')));
    const coins = await page.evaluate(([price, have]) => (window as any).YS_MONEY.makeAmount(price, have), [r.price, have] as const);
    for (const k of coins) await page.locator(`#add-${k}`).click();
    await expect(page.locator('#paid')).toHaveText(`You put in ${r.price}¢. The price is ${r.price}¢.`);
    await page.locator('#pay').click();
    return;
  }
  if (file === 'clocks' && game === 'set') {
    for (let i = 0; i < r.h % 12; i++) await page.locator('#hour-on').click();
    if (r.m) {
      const step = Number((await page.locator('#min-on').innerText()).match(/\d+/)![0]);
      for (let i = 0; i < r.m / step; i++) await page.locator('#min-on').click();
    }
    await page.locator('#check').click();
    return;
  }
  await page.locator(`#choices button[data-v="${r.ans}"]`).click();
}
/** Makes one wrong move on the round on screen. */
async function missOnce(page: Page, file: string, game: string) {
  const r = await current(page);
  if ((file === 'money' && game === 'pay') || (file === 'clocks' && game === 'set')) {
    await page.locator(game === 'pay' ? '#pay' : '#check').click();
    return;
  }
  const wrong = await page.locator('#choices button').evaluateAll((bs, right) => bs.map((b) => b.getAttribute('data-v')!).filter((v) => !right.includes(v)), (r.right ?? [r.ans]).map(String));
  await page.locator(`#choices button[data-v="${wrong[0]}"]`).click();
}

for (const p of PAGES) {
  test(`${p.h1}: linked from Yaanstep Sprouts, loads nothing from other sites, stores nothing, passes the accessibility scan`, async ({ page, context }) => {
    const errors = watchErrors(page);
    const reqs = watchRequests(page);
    await page.goto('/sprouts.html');
    await page.locator(`a[href="${p.file}.html"]`).click();
    await expect(page.locator('h1')).toHaveText(p.h1);
    await expect(page.locator('#menu .step')).toHaveCount(p.games.length + others(p) + 1);
    expect(await axeViolations(page)).toEqual([]);
    await page.setViewportSize({ width: 320, height: 700 });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
    expect((await storedData(page, context)).local).toEqual([]);
    expect(errors).toEqual([]);
  });

  test(`${p.h1}: the lesson has ${p.parts} parts, each with a moving picture, and ends with a way into every game`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, p.file);
    await page.locator('#play-learn').click();
    for (let i = 1; i <= p.parts; i++) {
      await expect(page.locator('#count')).toHaveText(`Part ${i} of ${p.parts}`);
      await expect(page.locator('#area svg[role=img]').first()).toBeVisible();
      expect((await page.locator('#lesson-text').innerText()).length).toBeGreaterThan(30);
      const hidden = await page.locator('#area svg .mv-in').evaluateAll((es) => es.filter((e) => getComputedStyle(e).opacity !== '1').length);
      expect(hidden, 'reduced motion shows the finished picture').toBe(0);
      if (i < p.parts) await page.locator('#nextpart').click();
    }
    await expect(page.locator('#nextpart')).toHaveCount(0);
    await expect(page.locator('[data-go]')).toHaveCount(p.games.length + others(p));
    expect(await axeViolations(page, '#game')).toEqual([]);
    await page.locator(`[data-go="${p.games[0]}"]`).click();
    await expect(page.locator('#count')).toHaveText('Round 1 of 8');
  });

  for (const g of p.games) {
    test(`${p.h1}, ${g}: a miss offers a moving lesson; 8 rounds end on a break`, async ({ page }) => {
      const errors = watchErrors(page);
      await open(page, p.file);
      await page.locator(`#play-${g}`).click();
      for (let k = 0; k < 8; k++) {
        await expect(page.locator('#count')).toHaveText(`Round ${k + 1} of 8`);
        if (k === 0 || k === 6) {
          await missOnce(page, p.file, g);
          await expect(page.locator('#sub')).toHaveClass(/try/);
          await expect(page.locator('#sub')).not.toContainText(/wrong|incorrect/i);
          await page.locator('#howbtn').click();
          await expect(page.locator('#lesson h3')).toBeFocused();
          await expect(page.locator('#lesson svg[role=img]').first()).toBeVisible();
          if (k === 0) {
            expect(await axeViolations(page, '#game')).toEqual([]);
            expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
          }
        }
        await answer(page, p.file, g);
        await expect(page.locator('#sub')).toContainText('Yes!');
        await expect(page.locator('#howbox')).toBeEmpty();
        await page.locator('#more').click();
      }
      await expect(page.locator('#alldone')).toBeVisible();
      await page.locator('#stop').click();
      await expect(page.locator(`#play-${g}`)).toBeFocused();
      expect(errors).toEqual([]);
    });
  }

  test(`${p.h1}: every button is at least 48 by 48 px in every game`, async ({ page }) => {
    await open(page, p.file);
    for (const g of ['learn', ...p.games]) {
      await page.locator(`#play-${g}`).click();
      for (const b of await page.locator('button:visible').all()) {
        const box = (await b.boundingBox())!;
        expect(box.width, `${g}: ${await b.innerText()}`).toBeGreaterThanOrEqual(47.5);
        expect(box.height, `${g}: ${await b.innerText()}`).toBeGreaterThanOrEqual(47.5);
      }
      await page.locator('#exit').click();
    }
  });
}

test('Money: the coin counts, the change and the lesson sums add up in 300 rounds', async ({ page }) => {
  await open(page, 'money');
  for (const g of ['count', 'change']) {
    await page.locator(`#play-${g}`).click();
    for (let k = 0; k < 8; k++) {
      const r = await current(page);
      const want = g === 'count' ? r.coins.reduce((t: number, c: string) => t + ({ penny: 1, nickel: 5, dime: 10, quarter: 25, dollar: 100, five: 500 } as Record<string, number>)[c], 0) : r.paid - r.price;
      expect(r.ans).toBe(want);
      const prompt = await page.locator('#prompt').innerText();
      if (g === 'change') expect(prompt).toMatch(/costs (\d+¢|\$\d+\.\d\d)\. You pay with a \$(1|5)\.00 bill\./);
      await answer(page, 'money', g);
      await page.locator('#more').click();
    }
    await page.locator('#stop').click();
  }
  const bad = await page.evaluate(() => {
    const M = (window as any).YS_MONEY, out: string[] = [];
    for (let c = 1; c < 500; c++) {
      const coins = M.makeAmount(c, ['dollar', 'quarter', 'dime', 'nickel', 'penny']);
      const t = coins.reduce((s: number, k: string) => s + M.coins[k].v, 0);
      if (t !== c) out.push(`make ${c}`);
      const s = M.stops(c, 500);
      if (s[0] !== c || s[s.length - 1] !== 500) out.push(`stops ${c}`);
    }
    if (M.fmt(5) !== '5¢' || M.fmt(235) !== '$2.35' || M.words(101) !== '1 dollar and 1 cent') out.push('format');
    return out;
  });
  expect(bad).toEqual([]);
});

test('Clocks: the hands point the right way for every time, and the clock reads the time it shows', async ({ page }) => {
  await open(page, 'clocks');
  const a = await page.evaluate(() => { const C = (window as any).YS_CLOCKS; return [C.angles(3, 0), C.angles(4, 30), C.angles(12, 45), C.fmt(13, 5), C.named(7, 45), C.dur(150)]; });
  expect(a).toEqual([{ h: 90, m: 0 }, { h: 135, m: 180 }, { h: 22.5, m: 270 }, '1:05', 'quarter to 8', '2 hours 30 minutes']);
  await page.locator('#play-read').click();
  for (let k = 0; k < 8; k++) {
    const r = await current(page);
    const label = (await page.locator('#clock svg').getAttribute('aria-label'))!;
    // Read the time back from the description of the hands.
    const hour = Number(label.match(/short hand (?:points at|is (?:halfway )?between) the (\d+)/)![1]);
    const min = /long hand points straight up/.test(label) ? 0 : Number(label.match(/long hand points at the (\d+)/)![1]) * 5;
    expect(`${hour}:${String(min).padStart(2, '0')}`).toBe(r.ans);
    await answer(page, 'clocks', 'read');
    await page.locator('#more').click();
  }
});

test('Weather: the degrees switch changes the thermometer to °C, and comparisons never go below zero', async ({ page }) => {
  await open(page, 'weather');
  await expect(page.locator('#unit-f')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#unit-c').click();
  await expect(page.locator('#unit-c')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#play-read').click();
  await expect(page.locator('#thermo svg')).toHaveAttribute('aria-label', /degrees Celsius/);
  for (let k = 0; k < 8; k++) {
    const r = await current(page);
    expect(r.unit).toBe('C');
    await expect(page.locator(`#choices button[data-v="${r.ans}"]`)).toContainText(`${r.ans}°C`);
    await answer(page, 'weather', 'read');
    await page.locator('#more').click();
  }
  await page.locator('#stop').click();
  await page.locator('#play-compare').click();
  for (let k = 0; k < 8; k++) {
    const r = await current(page);
    expect(Math.min(r.a, r.b)).toBeGreaterThanOrEqual(0);
    if (k >= 4) expect(r.ans).toBe(Math.abs(r.a - r.b));
    await answer(page, 'weather', 'compare');
    await page.locator('#more').click();
  }
});
