import { test, expect, type Page } from '@playwright/test';
import { axeViolations, bareSprouts, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';
import { knownBug } from '../support/known-bugs';

// Parts of a sentence (sentences.html, reading mode D1, SCRUM-429; doc 19 as updated 16 Nov 2026; added 22 Nov 2026).
// The sentences and the one right word for each are written out here, never read from the page's own code.

test.beforeEach(() => { knownBug(); });

/** Every sentence the game may build, with the gap as ___ and the one word that fits. */
const SENTENCES: Record<string, { answer: string; pic: string }> = {
  // who or what
  'The ___ hops.': { answer: 'frog', pic: 'frog' },
  'The ___ swims.': { answer: 'fish', pic: 'fish' },
  'The ___ barks.': { answer: 'dog', pic: 'dog' },
  'The ___ moos.': { answer: 'cow', pic: 'cow' },
  'The ___ quacks.': { answer: 'duck', pic: 'duck' },
  'The ___ oinks.': { answer: 'pig', pic: 'pig' },
  // what is it doing
  'The dog ___.': { answer: 'barks', pic: 'dog' },
  'The cow ___.': { answer: 'moos', pic: 'cow' },
  'The duck ___.': { answer: 'quacks', pic: 'duck' },
  'The pig ___.': { answer: 'oinks', pic: 'pig' },
  'The cat ___.': { answer: 'meows', pic: 'cat' },
  'The frog ___.': { answer: 'hops', pic: 'frog' },
  'The fish ___.': { answer: 'swims', pic: 'fish' },
  // where
  'The sun is in the ___.': { answer: 'sky', pic: 'sun' },
  'The moon is in the ___.': { answer: 'sky', pic: 'moon' },
  'The star is in the ___.': { answer: 'sky', pic: 'star' },
  'The cat sleeps on the ___.': { answer: 'bed', pic: 'cat' },
  'The car is on the ___.': { answer: 'road', pic: 'car' },
  'The fish swims in the ___.': { answer: 'water', pic: 'fish' },
  'The cow eats grass in the ___.': { answer: 'field', pic: 'cow' },
  // what is it like (the colour of the drawing)
  'The frog is ___.': { answer: 'green', pic: 'frog' },
  'The ball is ___.': { answer: 'red', pic: 'ball' },
  'The hat is ___.': { answer: 'blue', pic: 'hat' },
  'The fish is ___.': { answer: 'orange', pic: 'fish' },
  'The pig is ___.': { answer: 'pink', pic: 'pig' },
  'The duck is ___.': { answer: 'yellow', pic: 'duck' },
  'The cup is ___.': { answer: 'blue', pic: 'cup' },
  'The car is ___.': { answer: 'red', pic: 'car' },
  'The sun is ___.': { answer: 'yellow', pic: 'sun' },
};
/** Words that would also make sense (so must never be offered as a wrong choice). */
const ALSO_FITS: Record<string, string[]> = {
  'The duck is ___.': ['orange'], 'The sun is ___.': ['orange'], 'The car is ___.': ['blue'],
  'The ___ hops.': ['ball', 'rabbit'], 'The ___ swims.': ['duck', 'frog', 'dog'], 'The car is on the ___.': ['moon'],
};

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.speak=(u)=>{window.__said.push(u.text);}; SS.cancel=()=>{};`;
async function open(page: Page) {
  await page.addInitScript(VOICE);
  await page.goto('/sentences.html');
}
const said = (page: Page) => page.evaluate(() => (window as any).__said as string[]);
const choices = (page: Page) => page.locator('#area button.choice');
async function gapSentence(page: Page) {
  return page.evaluate(() => {
    const line = document.getElementById('gapline')!;
    return Array.from(line.childNodes).map((n) => ((n as Element).id === 'gap' ? '___' : n.textContent)).join('').replace(/\s+/g, ' ').trim();
  });
}

test('is a public page linked from Learning and Reading: labelled, no errors, no outside requests, nothing sent or stored', async ({ page, context, request }) => {
  await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204 }));
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await open(page);
  expect(await page.locator('meta[name=robots][content*=noindex]').count()).toBe(0);
  await expect(page.locator('h1')).toHaveText('Parts of a sentence');
  for (const t of ['AI team', 'no microphone', 'parent and child together', 'Not yet tested with children']) await expect(page.locator('body')).toContainText(t);
  expect(await (await request.get('/sprouts.html')).text()).toContain('href="sentences.html"');
  expect(await (await request.get('/reading.html')).text()).toContain('href="sentences.html"');
  await page.locator('#play-game').click();
  await choices(page).first().click();
  expect(errors).toEqual([]);
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect(reqs.sending()).toEqual([]);
  const s = await storedData(page, context);
  expect(s.local, 'the page saves nothing').toEqual([]);
  expect(s.cookies).toEqual([]);
  expect(bareSprouts(await page.locator('body').innerText())).toEqual([]);
});

test('the lesson has 3 screens, each read aloud, with a capital letter at the start and a full stop at the end, then leads to the game', async ({ page }) => {
  await open(page);
  await page.locator('#play-lesson').click();
  const sentences = ['The cat naps.', 'The dog runs.', 'The big dog runs to the tree.'];
  for (let i = 0; i < 3; i++) {
    await expect(page.locator('#count')).toHaveText(`Lesson ${i + 1} of 3`);
    const text = (await page.locator('#parts .part').allInnerTexts()).join(' ').replace(/ \./, '.');
    expect(text).toBe(sentences[i]);
    expect((await said(page)).at(-1)).toBe(await page.locator('#lessonsay').innerText());
    await page.locator('#more').click();
  }
  await expect(page.locator('#title')).toHaveText('Fill the gap');
  await expect(page.locator('#count')).toHaveText('Round 1 of 5');
});

test('fill the gap: 60 rounds, every sentence is a listed one, exactly one choice fits, the picture matches, and every kind turns up', async ({ page }) => {
  await open(page);
  await page.locator('#play-game').click();
  const problems: string[] = [];
  const kinds = new Set<string>();
  for (let r = 0; r < 60; r++) {
    if (await page.locator('#alldone').isVisible()) await page.locator('#keep').click();
    const sentence = await gapSentence(page);
    const words = await choices(page).evaluateAll((bs) => bs.map((b) => b.getAttribute('data-word') ?? ''));
    const pic = await page.locator('#pic').getAttribute('data-word');
    kinds.add((await page.locator('#gapline').getAttribute('data-kind')) ?? '');
    const where = `[round ${r + 1}] "${sentence}" ${JSON.stringify(words)}`;
    const item = SENTENCES[sentence];
    if (!item) { problems.push(`${where}: not a listed sentence`); continue; }
    if (pic !== item.pic) problems.push(`${where}: picture is ${pic}, expected ${item.pic}`);
    if ((await page.locator('#pic svg').count()) !== 1) problems.push(`${where}: no picture`);
    if (words.length !== 3 || new Set(words).size !== 3) problems.push(`${where}: expected 3 different choices`);
    if (words.filter((w) => w === item.answer).length !== 1) problems.push(`${where}: the right word ${item.answer} is not offered once`);
    const alsoFits = words.filter((w) => w !== item.answer && (ALSO_FITS[sentence] ?? []).includes(w));
    if (alsoFits.length) problems.push(`${where}: offers ${alsoFits} as wrong, but it also fits`);
    await page.locator(`#area button.choice[data-word="${item.answer}"]`).click();
    const full = sentence.replace('___', item.answer);
    await expect(page.locator('#sub')).toHaveText(`Yes! ${full}`);
    if ((await said(page)).at(-1) !== full) problems.push(`${where}: read aloud "${(await said(page)).at(-1)}"`);
    await expect(page.locator('#gap')).toHaveText(item.answer);
    await page.locator('#more').click();
  }
  expect(problems).toEqual([]);
  expect([...kinds].sort()).toEqual(['doing', 'like', 'where', 'who']);
});

test('fill the gap: a wrong word says "Not yet" with a hint, keeps the round open, and never shows a cross', async ({ page }) => {
  await open(page);
  await page.locator('#play-game').click();
  const sentence = await gapSentence(page);
  const item = SENTENCES[sentence];
  const words = await choices(page).evaluateAll((bs) => bs.map((b) => b.getAttribute('data-word') ?? ''));
  await page.locator(`#area button.choice[data-word="${words.find((w) => w !== item.answer)}"]`).click();
  await expect(page.locator('#sub')).toHaveText(/^Not yet\. (Look at the picture\.|What does a|Where is the)/);
  await expect(page.locator('#more')).toBeHidden();
  await expect(page.locator('body')).not.toContainText('✗');
  await page.locator(`#area button.choice[data-word="${item.answer}"]`).click();
  await expect(page.locator('#sub')).toHaveText(`You got it! ${sentence.replace('___', item.answer)}`);
});

test('after 5 rounds the game shows "All done for now", and Play again starts a new set', async ({ page }) => {
  await open(page);
  await page.locator('#play-game').click();
  for (let r = 0; r < 5; r++) {
    await page.locator(`#area button.choice[data-word="${SENTENCES[await gapSentence(page)].answer}"]`).click();
    await page.locator('#more').click();
  }
  await expect(page.locator('#alldone')).toBeVisible();
  await page.locator('#keep').click();
  await expect(page.locator('#count')).toHaveText('Round 1 of 5');
});

test('every button is at least 48 by 48 px', async ({ page }) => {
  await open(page);
  for (const id of ['#play-lesson', '#play-game']) {
    await page.locator(id).click();
    for (const b of await page.locator('button:visible').all()) {
      const box = (await b.boundingBox())!;
      expect(box.width, await b.innerText()).toBeGreaterThanOrEqual(47.5);
      expect(box.height, await b.innerText()).toBeGreaterThanOrEqual(47.5);
    }
    await page.locator('#exit').click();
  }
});

for (const view of ['menu', 'lesson', 'fill the gap'] as const) {
  for (const width of [0, 320]) {
    test(`sentences: ${view} view fits the screen and passes the accessibility scan${width ? ' at 320 px' : ''}`, async ({ page }) => {
      if (width) await page.setViewportSize({ width, height: 700 });
      await open(page);
      if (view === 'lesson') await page.locator('#play-lesson').click();
      if (view === 'fill the gap') await page.locator('#play-game').click();
      expect(await horizontalOverflow(page), 'overflow').toBeLessThanOrEqual(1);
      expect(await axeViolations(page), `${view} view`).toEqual([]);
    });
  }
}

// Read-along (SCRUM-496, Manish 22 Nov 2026): the sentence being read has a marker on the word being read.
test('read-along: the lesson line lights up word by word as the voice reads it, then clears', async ({ page }) => {
  await page.addInitScript(`window.__said=[];
    window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
    const SS=window.speechSynthesis;
    SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
    SS.cancel=()=>{};
    SS.speak=(u)=>{ window.__said.push(u.text); window.__u=u; };
    window.__boundary=(i)=>{ const u=window.__u; const at=[...u.text.matchAll(/\\S+/g)][i].index; u.onboundary&&u.onboundary({name:'word',charIndex:at}); };
    window.__end=()=>{ window.__u.onend&&window.__u.onend({}); };`);
  await page.goto('/sentences.html');
  await page.locator('#play-lesson').click();
  const line = page.locator('#lessonsay');
  const words = (await line.innerText()).split(/\s+/);
  await expect(line.locator('.w')).toHaveCount(words.length);
  await page.evaluate(() => (window as any).__boundary(1));
  await expect(line.locator('.w.now')).toHaveText(words[1]);
  await page.evaluate(() => (window as any).__end());
  await expect(line.locator('.w.now')).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
});
