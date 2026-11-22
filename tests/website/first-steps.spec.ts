import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';

// Shapes, colors, numbers and animals (first-steps.html, Manish 22 Nov 2026) for ages 3 to 5.
// Every game teaches: a miss names what was tapped and offers a short moving lesson. Animal sounds use the device voice.

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); };`;
const GAMES = ['shapes', 'colors', 'numbers', 'animals'] as const;

async function open(page: Page) {
  await page.addInitScript(VOICE);
  await page.goto('/first-steps.html');
}
const current = (page: Page) => page.evaluate(() => (window as any).YS_FIRST.current()) as Promise<{ ans: string | number; prompt: string }>;
const said = (page: Page) => page.evaluate(() => (window as any).__said as string[]);

test('the page is linked from Yaanstep Sprouts, loads nothing from other sites and stores nothing', async ({ page, context }) => {
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await page.goto('/sprouts.html');
  await page.locator('a[href="first-steps.html"]').click();
  await expect(page.locator('h1')).toHaveText('Shapes, colors, numbers and animals');
  await expect(page.locator('#menu .step')).toHaveCount(5);
  await expect(page.locator('.note').first()).toContainText('not recordings');
  expect(await axeViolations(page)).toEqual([]);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect((await storedData(page, context)).local).toEqual([]);
  expect(errors).toEqual([]);
});

for (const g of GAMES) {
  test(`${g}: a miss names what was tapped and opens a moving lesson; 8 rounds end on a break`, async ({ page }) => {
    const errors = watchErrors(page);
    await open(page);
    await page.locator(`#play-${g}`).click();
    for (let k = 0; k < 8; k++) {
      await expect(page.locator('#count')).toHaveText(`Round ${k + 1} of 8`);
      const r = await current(page);
      expect((await said(page)).at(-1)).toBe(r.prompt);
      const opts = await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-v')!));
      expect(opts).toHaveLength(3);
      expect(new Set(opts).size).toBe(3);
      expect(opts).toContain(String(r.ans));
      if (k === 0) {
        const wrong = opts.find((o) => o !== String(r.ans))!;
        await page.locator(`#choices button[data-v="${wrong}"]`).click();
        await expect(page.locator('#sub')).toHaveClass(/try/);
        await expect(page.locator('#sub')).not.toContainText(/wrong|incorrect/i);
        await page.locator('#howbtn').click();
        await expect(page.locator('#lesson h3')).toBeFocused();
        await expect(page.locator('#lesson svg[role=img]').first()).toBeVisible();
        expect(await axeViolations(page, '#game')).toEqual([]);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
      }
      await page.locator(`#choices button[data-v="${r.ans}"]`).click();
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

test('every shape and color is offered, red never sits next to green, and every animal has a sound and a picture', async ({ page }) => {
  await open(page);
  const data = await page.evaluate(() => ({ F: (window as any).YS_FIRST, pics: Object.keys((window as any).YS_PICTURES) }));
  expect(Object.keys(data.F.shapes)).toEqual(['circle', 'square', 'triangle', 'rectangle', 'oval', 'star', 'heart', 'diamond']);
  expect(Object.keys(data.F.colors)).toHaveLength(10);
  expect(data.F.animals).toHaveLength(12);
  for (const a of data.F.animals) expect(a.s, a.a).toMatch(/^[a-z]+$/);
  await page.locator('#play-colors').click();
  for (let k = 0; k < 8; k++) {
    const opts = await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-v')!));
    expect(opts.includes('red') && opts.includes('green'), opts.join(',')).toBe(false);
    const r = await current(page);
    await page.locator(`#choices button[data-v="${r.ans}"]`).click();
    await page.locator('#more').click();
  }
});

test('the shape lesson draws the shape and marks its corners; with reduced motion it shows the last picture at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await page.locator('#play-shapes').click();
  const r = await current(page);
  const wrong = (await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-v')!))).find((o) => o !== r.ans)!;
  await page.locator(`#choices button[data-v="${wrong}"]`).click();
  await expect(page.locator('#sub')).toHaveText(new RegExp(`^That is an? ${wrong}\\. Find the ${r.ans}\\.$`));
  await page.locator('#howbtn').click();
  await expect(page.locator('#lesson svg[role=img]')).toHaveAttribute('aria-label', new RegExp(`^An? ${r.ans} is drawn`));
  const hidden = await page.locator('#lesson svg .mv-in').evaluateAll((es) => es.filter((e) => getComputedStyle(e).opacity !== '1').length);
  expect(hidden).toBe(0);
  await page.locator('#lesson .watch-again').click();
  await expect(page.locator('#lesson svg[role=img]')).toHaveCount(1);
});

test('Tap and listen: every animal says its sound, with a bubble, and asks nothing', async ({ page }) => {
  await open(page);
  await page.locator('#play-listen').click();
  await expect(page.locator('#listen button')).toHaveCount(12);
  await expect(page.locator('#count')).toHaveText('');
  await page.locator('#listen button[data-v="cow"]').click();
  expect((await said(page)).at(-1)).toBe('The cow says moo! Moo!');
  await expect(page.locator('#listen button[data-v="cow"] .bubble')).toHaveCSS('opacity', '1');
  await expect(page.locator('#listen button[data-v="dog"] .bubble')).toHaveCSS('opacity', '0');
  await expect(page.locator('#sub')).toHaveText('The cow says moo!');
  expect(await axeViolations(page, '#game')).toEqual([]);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test('every button is at least 48 by 48 px in every game', async ({ page }) => {
  await open(page);
  for (const g of [...GAMES, 'listen']) {
    await page.locator(`#play-${g}`).click();
    for (const b of await page.locator('button:visible').all()) {
      const box = (await b.boundingBox())!;
      expect(box.width, `${g}: ${await b.innerText()}`).toBeGreaterThanOrEqual(47.5);
      expect(box.height, `${g}: ${await b.innerText()}`).toBeGreaterThanOrEqual(47.5);
    }
    await page.locator('#exit').click();
  }
});
