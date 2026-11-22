import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';
import { knownBug } from '../support/known-bugs';

// Sounds and beats page (sounds.html, reading foundations SCRUM-472, doc 25; added 22 Nov 2026).
// The expected content is written out here from doc 25, never read from the page's own code.
// Speech is recorded by replacing speechSynthesis, so no sound is needed and the test sees exactly what would be said.

/** Capital letter at the start of a sentence (review SCRUM-480, 22 Nov 2026). */
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

test.beforeEach(() => { knownBug(); });

/** Letter -> the example word the game says ("s, as in sock") and the picture words that start with that sound. */
const FIRST: Record<string, { anchor: string; words: string[] }> = {
  s: { anchor: 'sock', words: ['sun'] },
  c: { anchor: 'cap', words: ['cat', 'car', 'cow', 'cup'] },
  d: { anchor: 'door', words: ['dog', 'duck'] },
  b: { anchor: 'bag', words: ['ball', 'bus', 'bed', 'book'] },
  h: { anchor: 'hen', words: ['hat'] },
  m: { anchor: 'map', words: ['moon', 'milk'] },
  f: { anchor: 'fox', words: ['fish'] },
  p: { anchor: 'pen', words: ['pig'] },
};
/** First sound of every picture word that may appear (c and k sound the same). */
const sound = (w: string) => (w[0] === 'k' ? 'c' : w[0]);

/** Word -> its beats, split as the page shows them after the answer. */
const BEATS: Record<string, string[]> = {
  cat: ['cat'], dog: ['dog'], sun: ['sun'], bus: ['bus'], cup: ['cup'], pig: ['pig'], hat: ['hat'], fish: ['fish'], ball: ['ball'],
  moon: ['moon'], book: ['book'], bed: ['bed'], egg: ['egg'], duck: ['duck'], milk: ['milk'],
  apple: ['ap', 'ple'], igloo: ['ig', 'loo'], carrot: ['car', 'rot'], rocket: ['rock', 'et'], pencil: ['pen', 'cil'], teapot: ['tea', 'pot'],
  banana: ['ba', 'na', 'na'], umbrella: ['um', 'brel', 'la'], octopus: ['oc', 'to', 'pus'],
};

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.speak=(u)=>{window.__said.push(u.text);}; SS.cancel=()=>{};`;

async function open(page: Page, voice = true) {
  if (voice) await page.addInitScript(VOICE);
  else await page.addInitScript(`const SS=window.speechSynthesis; SS.getVoices=()=>[]; SS.speak=()=>{throw new Error('spoke without a voice')}; SS.cancel=()=>{};`);
  await page.goto('/sounds.html');
}
const said = (page: Page) => page.evaluate(() => (window as any).__said as string[]);
const choices = (page: Page) => page.locator('#area button.choice');

test('is a public page linked from Learning and Reading: labelled, no errors, no outside requests, nothing sent or stored', async ({ page, context, request }) => {
  await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204 }));
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await open(page);
  expect(await page.locator('meta[name=robots][content*=noindex]').count()).toBe(0);
  expect(await page.locator('link[rel~=icon]').count()).toBeGreaterThan(0);
  await expect(page.locator('h1')).toHaveText('Sounds and beats');
  await expect(page.locator('body')).toContainText('AI team');
  await expect(page.locator('body')).toContainText('no microphone');
  await expect(page.locator('body')).toContainText('parent and child together');
  await expect(page.locator('body')).toContainText('Not yet tested with children');
  await expect(page.locator('a', { hasText: 'Back to Learning' })).toHaveAttribute('href', 'learning.html');
  expect(await (await request.get('/learning.html')).text()).toContain('href="sounds.html"');
  expect(await (await request.get('/reading.html')).text()).toContain('href="sounds.html"');
  // play a little of both games
  await page.locator('#play-first').click();
  await choices(page).first().click();
  await page.locator('#exit').click();
  await page.locator('#play-beats').click();
  await choices(page).first().click();
  expect(errors).toEqual([]);
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect(reqs.sending()).toEqual([]);
  const s = await storedData(page, context);
  expect(s.local, 'the page saves nothing').toEqual([]);
  expect(s.cookies).toEqual([]);
  expect(s.session).toEqual([]);
});

test('does not use the working product name "Sprouts" on the page', async ({ page }) => {
  await open(page);
  expect(await page.locator('body').innerText()).not.toMatch(/Sprouts/i);
});

test('first sounds: 40 rounds, each with one right picture, two pictures with a different first sound, and the right question spoken', async ({ page }) => {
  await open(page);
  await page.locator('#play-first').click();
  const problems: string[] = [];
  for (let r = 0; r < 40; r++) {
    if (await page.locator('#alldone').isVisible()) await page.locator('#keep').click();
    const letter = (await page.locator('#letter').innerText()).trim();
    const ask = (await page.locator('#ask').innerText()).trim();
    const words = await choices(page).evaluateAll((bs) => bs.map((b) => b.getAttribute('data-word') ?? ''));
    const m = ask.match(/^Which picture starts with ([a-z]), as in ([a-z]+)\?$/);
    const where = `[round ${r + 1}] "${ask}" ${JSON.stringify(words)}`;
    if (!m) { problems.push(`${where}: question not in the expected form`); continue; }
    if (m[1] !== letter) problems.push(`${where}: the big letter ${letter} is not the letter asked`);
    const item = FIRST[letter];
    if (!item) { problems.push(`${where}: letter ${letter} is not in the list`); continue; }
    if (m[2] !== item.anchor) problems.push(`${where}: example word should be ${item.anchor}`);
    if (words.includes(item.anchor)) problems.push(`${where}: the example word is also a picture, which gives the answer away`);
    if (words.length !== 3) problems.push(`${where}: expected 3 pictures`);
    const right = words.filter((w) => sound(w) === letter);
    if (right.length !== 1) problems.push(`${where}: ${right.length} pictures start with ${letter}, expected exactly 1`);
    else if (!item.words.includes(right[0])) problems.push(`${where}: ${right[0]} is not a listed ${letter} word`);
    for (const b of await choices(page).all()) {
      if ((await b.locator('svg').count()) !== 1) problems.push(`${where}: a picture is missing`);
      if (!(await b.getAttribute('aria-label'))) problems.push(`${where}: a picture has no name for a screen reader`);
    }
    if ((await said(page)).at(-1) !== ask) problems.push(`${where}: spoke "${(await said(page)).at(-1)}"`);
    await page.locator(`#area button.choice[data-word="${right[0]}"]`).click();
    await expect(page.locator('#sub')).toHaveText(new RegExp(`^(Yes!|You found it!) ${cap(right[0])} starts with ${letter}\\.$`));
    await page.locator('#more').click();
  }
  expect(problems).toEqual([]);
});

test('first sounds: a wrong tap says "Not yet", names the picture, keeps the round open, and never shows a cross', async ({ page }) => {
  await open(page);
  await page.locator('#play-first').click();
  const letter = (await page.locator('#letter').innerText()).trim();
  const words = await choices(page).evaluateAll((bs) => bs.map((b) => b.getAttribute('data-word') ?? ''));
  const wrong = words.find((w) => sound(w) !== letter)!;
  await page.locator(`#area button.choice[data-word="${wrong}"]`).click();
  await expect(page.locator('#sub')).toHaveText(`Not yet. That is ${wrong}. Listen again: ${letter}, as in ${FIRST[letter].anchor}.`);
  await expect(page.locator('#more')).toBeHidden();
  await expect(page.locator('body')).not.toContainText('✗');
  await expect(page.locator('body')).not.toContainText('Wrong');
  const right = words.find((w) => sound(w) === letter)!;
  await page.locator(`#area button.choice[data-word="${right}"]`).click();
  await expect(page.locator('#sub')).toHaveText(`You found it! ${cap(right)} starts with ${letter}.`);
});

test('word beats: 40 rounds, every word has its picture, the right count is accepted, and the split shown matches', async ({ page }) => {
  await open(page);
  await page.locator('#play-beats').click();
  const problems: string[] = [];
  const counts = new Set<number>();
  for (let r = 0; r < 40; r++) {
    if (await page.locator('#alldone').isVisible()) await page.locator('#keep').click();
    const word = (await page.locator('#beatpic').getAttribute('data-word')) ?? '';
    const where = `[round ${r + 1}] ${word}`;
    const beats = BEATS[word];
    if (!beats) { problems.push(`${where}: word not in the list`); continue; }
    counts.add(beats.length);
    if ((await page.locator('#beatpic svg').count()) !== 1) problems.push(`${where}: no picture`);
    await expect(page.locator('#ask')).toHaveText(`How many beats in ${word}? Say it slowly and clap.`);
    expect(await choices(page).count()).toBe(3);
    await page.locator(`#area button.choice[data-beats="${beats.length}"]`).click();
    await expect(page.locator('#sub')).toHaveText(new RegExp(`^(Yes!|You got it!) ${cap(word)} has ${beats.length} beats?\\.$`));
    const split = (await page.locator('#split').innerText()).trim();
    if (split !== beats.join(' · ')) problems.push(`${where}: shows "${split}", expected "${beats.join(' · ')}"`);
    await page.locator('#more').click();
  }
  expect(problems).toEqual([]);
  expect([...counts].sort(), 'all three beat counts should turn up in 40 rounds').toEqual([1, 2, 3]);
});

test('word beats: a wrong count says "Not yet" and says the word again slowly', async ({ page }) => {
  await page.clock.install();
  await open(page);
  await page.locator('#play-beats').click();
  const word = (await page.locator('#beatpic').getAttribute('data-word'))!;
  const n = BEATS[word].length;
  await page.locator(`#area button.choice[data-beats="${n === 1 ? 2 : 1}"]`).click();
  await expect(page.locator('#sub')).toHaveText(`Not yet. Listen to ${word} slowly, and clap once for each beat.`);
  await page.clock.runFor(1500);
  expect((await said(page)).at(-1)).toBe(word);
  await expect(page.locator('#more')).toBeHidden();
});

test('after 8 rounds the game shows "All done for now", and Keep playing starts again', async ({ page }) => {
  await open(page);
  await page.locator('#play-beats').click();
  for (let r = 0; r < 8; r++) {
    const word = (await page.locator('#beatpic').getAttribute('data-word'))!;
    await page.locator(`#area button.choice[data-beats="${BEATS[word].length}"]`).click();
    await page.locator('#more').click();
  }
  await expect(page.locator('#alldone')).toBeVisible();
  await page.locator('#keep').click();
  await expect(page.locator('#count')).toHaveText('Round 1 of 8');
});

test('with no on-device voice the page says so and the games still work silently', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, false);
  await expect(page.locator('#novoice')).toBeVisible();
  await page.locator('#play-first').click();
  await expect(page.locator('#ask')).toContainText('Which picture starts with');
  await choices(page).first().click();
  expect(errors).toEqual([]);
});

test('every button is at least 48 by 48 px', async ({ page }) => {
  await open(page);
  for (const id of ['#play-first', '#play-beats']) {
    await page.locator(id).click();
    for (const b of await page.locator('button:visible').all()) {
      const box = (await b.boundingBox())!;
      expect(box.width, await b.innerText()).toBeGreaterThanOrEqual(47.5);
      expect(box.height, await b.innerText()).toBeGreaterThanOrEqual(47.5);
    }
    await page.locator('#exit').click();
  }
});

for (const view of ['menu', 'first sounds', 'word beats'] as const) {
  for (const width of [0, 320]) {
    test(`sounds: ${view} view fits the screen and passes the accessibility scan${width ? ' at 320 px' : ''}`, async ({ page }) => {
      if (width) await page.setViewportSize({ width, height: 700 });
      await open(page);
      if (view === 'first sounds') await page.locator('#play-first').click();
      if (view === 'word beats') await page.locator('#play-beats').click();
      expect(await horizontalOverflow(page), 'overflow').toBeLessThanOrEqual(1);
      expect(await axeViolations(page), `${view} view`).toEqual([]);
    });
  }
}
