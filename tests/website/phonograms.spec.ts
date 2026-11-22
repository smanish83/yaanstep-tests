import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';

// Phonogram games (phonograms.html, Manish 22 Nov 2026): what a phonogram is, split a word into phonograms,
// spell with them and read with them. Moving pictures; original words and drawings only.

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); };`;

interface Word { w: string; p: string[]; lv: number }
async function open(page: Page) {
  await page.addInitScript(VOICE);
  await page.goto('/phonograms.html');
}
const current = (page: Page) => page.evaluate(() => (window as any).YS_PHONOGRAMS.current()) as Promise<Word & { at?: number }>;
const said = (page: Page) => page.evaluate(() => (window as any).__said as string[]);

test('the page is linked from Yaanstep Sprouts, loads nothing from other sites and stores nothing', async ({ page, context }) => {
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await page.goto('/sprouts.html');
  await page.locator('a[href="phonograms.html"]').click();
  await expect(page.locator('h1')).toHaveText('Phonogram games');
  await expect(page.locator('#menu')).toContainText('A phonogram is a letter, or a team of letters, that writes one sound.');
  await expect(page.locator('#menu .step')).toHaveCount(4);
  expect(await axeViolations(page)).toEqual([]);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  const s = await storedData(page, context);
  expect(s.local).toEqual([]);
  expect(errors).toEqual([]);
});

test('every word is split correctly, every phonogram has an example word that is not a game word, and every word has a picture', async ({ page }) => {
  await open(page);
  const { words, as, pics } = await page.evaluate(() => ({ words: (window as any).YS_PHONOGRAMS.words, as: (window as any).YS_PHONOGRAMS.as, pics: Object.keys((window as any).YS_PICTURES) }));
  const all = (words as Word[]).map((w) => w.w);
  for (const w of words as Word[]) {
    expect(w.p.join(''), w.w).toBe(w.w);
    expect(pics, w.w).toContain(w.w);
    for (const ph of w.p) {
      expect(as[ph], `${w.w}: ${ph} has an example word`).toBeTruthy();
      if (ph.length > 1) expect(all, `${ph}: its example word is not a game word`).not.toContain(as[ph]);
    }
    if (w.lv === 1) expect(w.p.every((x) => x.length === 1), w.w).toBe(true);
    else expect(w.p.some((x) => x.length > 1), w.w).toBe(true);
  }
  // The wrong ways to split always use the same letters and are never the right split.
  const bad = await page.evaluate(() => {
    const P = (window as any).YS_PHONOGRAMS, out: string[] = [];
    for (let n = 0; n < 50; n++) for (const w of P.words.filter((x: Word) => x.lv > 1)) {
      const ws = P.wrongSplits(w);
      if (ws.length !== 2) out.push(`${w.w}: ${ws.length} wrong splits`);
      for (const s of ws) if (s.join('') !== w.w || s.join('|') === w.p.join('|')) out.push(`${w.w}: ${s.join('|')}`);
    }
    return out;
  });
  expect(bad).toEqual([]);
});

test('What is a phonogram? walks through six parts with a moving picture, and offers the games at the end', async ({ page }) => {
  await open(page);
  await page.locator('#play-learn').click();
  const titles = ['One letter, one sound', 'Letters can team up', 'Vowels team up too', 'Split a word', 'Read with phonograms', 'Spell with phonograms'];
  for (let i = 0; i < titles.length; i++) {
    await expect(page.locator('#count')).toHaveText(`Part ${i + 1} of 6`);
    await expect(page.locator('#lesson-title')).toHaveText(titles[i]);
    await expect(page.locator('#area svg[role=img]')).toHaveAttribute('aria-label', /split into its phonograms/);
    if (i === 0) expect(await axeViolations(page, '#game')).toEqual([]);
    if (i < titles.length - 1) await page.locator('#more').click();
  }
  await expect(page.locator('#area [data-go]')).toHaveText(['Play Split the word', 'Play Build the word', 'Play Read and match']);
  await page.locator('#area [data-go=split]').click();
  await expect(page.locator('#title')).toHaveText('Split the word');
});

test('with calm mode or reduced motion, the moving picture shows its last picture straight away', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await page.locator('#play-learn').click();
  await page.locator('#more').click();
  const hidden = await page.locator('#area svg .mv-in').evaluateAll((es) => es.filter((e) => getComputedStyle(e).opacity !== '1').length);
  expect(hidden).toBe(0);
});

test('Split the word: a wrong split says "Not yet" and offers a lesson on another word; the right one explains the teams', async ({ page }) => {
  await open(page);
  await page.locator('#play-split').click();
  const r = await current(page);
  expect(r.lv).toBeGreaterThan(1);
  await expect(page.locator('#choices button')).toHaveCount(3);
  const right = r.p.join('|');
  const wrong = (await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-split')!))).find((s) => s !== right)!;
  await page.locator(`#choices button[data-split="${wrong}"]`).click();
  await expect(page.locator('#sub')).toContainText('Not yet');
  await page.locator('#howbtn').click();
  await expect(page.locator('#lesson h3')).toBeFocused();
  await expect(page.locator('#lesson-say')).not.toContainText(`${r.w} has`);
  expect(await axeViolations(page, '#game')).toEqual([]);
  await page.locator(`#choices button[data-split="${right}"]`).click();
  await expect(page.locator('#sub')).toContainText(`${r.w} has ${r.p.length} phonograms: ${r.p.join(', ')}.`);
  await expect(page.locator('#howbox')).toBeEmpty();
  await expect(page.locator('#more')).toBeFocused();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test('Build the word: only the next phonogram goes in, each one is said with its example word, and 8 words end on a break', async ({ page }) => {
  await open(page);
  await page.locator('#play-build').click();
  const as = await page.evaluate(() => (window as any).YS_PHONOGRAMS.as);
  for (let k = 0; k < 8; k++) {
    await expect(page.locator('#count')).toHaveText(`Round ${k + 1} of 8`);
    const r = await current(page);
    const tiles = await page.locator('#tiles button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-ph')!));
    expect(tiles.length).toBe(r.p.length + 2);
    for (const ph of r.p) expect(tiles).toContain(ph);
    if (k === 0) {
      const off = tiles.find((t) => !r.p.includes(t))!;
      await page.locator(`#tiles button[data-ph="${off}"]`).click();
      await expect(page.locator('#sub')).toContainText('Not yet');
      await expect(page.locator('#slots .pbox.placed')).toHaveCount(0);
      expect(await axeViolations(page, '#game')).toEqual([]);
    }
    for (const ph of r.p) {
      await page.locator(`#tiles button[data-ph="${ph}"]:not([disabled])`).first().click();
      if (k === 0) expect(await said(page)).toContain(`${ph}, as in ${as[ph]}`);
    }
    await expect(page.locator('#slots .pbox')).toHaveText(r.p);
    await expect(page.locator('#sub')).toContainText(`Yes! ${r.w}`);
    await page.locator('#more').click();
  }
  await expect(page.locator('#alldone')).toBeVisible();
  await expect(page.locator('#keep')).toBeFocused();
});

test('Read and match: each phonogram is said with its example word, Blend it says the word, and the picture checks it', async ({ page }) => {
  await open(page);
  await page.locator('#play-read').click();
  const r = await current(page);
  const as = await page.evaluate(() => (window as any).YS_PHONOGRAMS.as);
  await expect(page.locator('#readrow button')).toHaveText(r.p);
  await page.locator('#readrow button').first().click();
  expect((await said(page)).at(-1)).toBe(`${r.p[0]}, as in ${as[r.p[0]]}`);
  await page.locator('#blend').click();
  expect((await said(page)).at(-1)).toBe(r.w);
  const wrong = (await page.locator('#pics button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-w')!))).find((w) => w !== r.w)!;
  await page.locator(`#pics button[data-w="${wrong}"]`).click();
  await expect(page.locator('#sub')).toContainText('Not yet');
  await page.locator(`#pics button[data-w="${r.w}"]`).click();
  await expect(page.locator('#sub')).toHaveText(`Yes! ${r.p.join(', ')} makes ${r.w}.`);
  expect(await axeViolations(page, '#game')).toEqual([]);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

test('every button is at least 48 by 48 px in every game', async ({ page }) => {
  await open(page);
  for (const g of ['learn', 'split', 'build', 'read']) {
    await page.locator(`#play-${g}`).click();
    for (const b of await page.locator('button:visible').all()) {
      const box = (await b.boundingBox())!;
      expect(box.width, `${g}: ${await b.innerText()}`).toBeGreaterThanOrEqual(47.5);
      expect(box.height, `${g}: ${await b.innerText()}`).toBeGreaterThanOrEqual(47.5);
    }
    await page.locator('#exit').click();
  }
});
