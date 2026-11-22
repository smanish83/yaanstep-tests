import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';
import { knownBug } from '../support/known-bugs';

// Rhymes and letter teams page (rhymes.html, reading foundations SCRUM-472 items 3 and 4, doc 25; added 22 Nov 2026).
// The rhyme endings and the sounds in each picture word are written out here, never read from the page's own code.

/** Capital letter at the start of a sentence (review SCRUM-480, 22 Nov 2026). */
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

test.beforeEach(() => { knownBug(); });

/** How each picture word that may appear as a rhyme choice ends. Words rhyme when the endings match. */
const ENDING: Record<string, string> = {
  cat: 'at', hat: 'at', dog: 'og', frog: 'og', star: 'ar', car: 'ar', sun: 'un', bun: 'un', tree: 'ee', bee: 'ee',
  boat: 'oat', goat: 'oat', duck: 'uck', truck: 'uck', moon: 'oon', spoon: 'oon',
  ball: 'all', pig: 'ig', fish: 'ish', cup: 'up', bus: 'us', bed: 'ed', egg: 'eg',
};

/** Letter team -> the example word that is said (never pictured) and the picture words that have it. */
const TEAMS: Record<string, { anchor: string; words: string[] }> = {
  sh: { anchor: 'shoe', words: ['ship', 'fish'] },
  ch: { anchor: 'cheese', words: ['chair'] },
  th: { anchor: 'three', words: ['thumb'] },
  ck: { anchor: 'sock', words: ['duck', 'truck', 'rocket'] },
  ng: { anchor: 'king', words: ['ring'] },
  ai: { anchor: 'snail', words: ['rain'] },
  ee: { anchor: 'feet', words: ['tree', 'bee'] },
  oa: { anchor: 'coat', words: ['boat', 'goat'] },
  oo: { anchor: 'food', words: ['moon', 'spoon', 'igloo'] },
  ar: { anchor: 'farm', words: ['car', 'star'] },
  or: { anchor: 'corn', words: ['fork'] },
  ow: { anchor: 'owl', words: ['cow'] },
};
/** Every picture word, with the team sounds a listener could hear in it (ck = the k sound; some accents included). */
const HEARS: Record<string, string[]> = {
  cat: ['ck'], dog: ['or'], sun: [], ball: ['or'], moon: ['oo'], star: ['ar'], hat: [], bus: [], cup: ['ck'], pig: [],
  fish: ['sh'], frog: ['or'], tree: ['ee'], book: ['ck'], bed: [], car: ['ck', 'ar'], egg: [], cow: ['ck', 'ow'],
  duck: ['ck'], milk: ['ck'], apple: [], igloo: ['oo'], carrot: ['ck', 'ar'], rocket: ['ck'], pencil: [], teapot: ['ee'],
  banana: ['ar'], umbrella: [], octopus: ['ck'], bun: [], bee: ['ee'], boat: ['oa'], goat: ['oa'], truck: ['ck'],
  spoon: ['oo'], ship: ['sh'], chair: ['ch'], thumb: ['th'], ring: ['ng'], rain: ['ai'], fork: ['ck', 'or'],
};

/** The four original rhymes: title and the pairs of words (in bold) that rhyme. */
const POEMS: { title: string; pairs: [string, string][] }[] = [
  { title: 'Little cat', pairs: [['cat', 'hat'], ['out', 'about']] },
  { title: 'Frog on a log', pairs: [['frog', 'log'], ['goes', 'toes']] },
  { title: 'Goat in a boat', pairs: [['sea', 'bee'], ['Hum', 'drum']] },
  { title: 'The big red bus', pairs: [['bus', 'us'], ['shop', 'stop']] },
];

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.speak=(u)=>{window.__said.push(u.text);}; SS.cancel=()=>{};`;

async function open(page: Page, voice = true) {
  if (voice) await page.addInitScript(VOICE);
  else await page.addInitScript(`const SS=window.speechSynthesis; SS.getVoices=()=>[]; SS.speak=()=>{throw new Error('spoke without a voice')}; SS.cancel=()=>{};`);
  await page.goto('/rhymes.html');
}
const said = (page: Page) => page.evaluate(() => (window as any).__said as string[]);
const choices = (page: Page) => page.locator('#area button.choice');
const words = (page: Page) => choices(page).evaluateAll((bs) => bs.map((b) => b.getAttribute('data-word') ?? ''));

test('is a public page linked from Learning and Reading: labelled, no errors, no outside requests, nothing sent or stored', async ({ page, context, request }) => {
  await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204 }));
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await open(page);
  expect(await page.locator('meta[name=robots][content*=noindex]').count()).toBe(0);
  await expect(page.locator('h1')).toHaveText('Rhymes and letter teams');
  for (const t of ['AI team', 'no microphone', 'parent and child together', 'Not yet tested with children', 'our own words']) await expect(page.locator('body')).toContainText(t);
  await expect(page.locator('a', { hasText: 'Back to Learning' })).toHaveAttribute('href', 'learning.html');
  expect(await (await request.get('/learning.html')).text()).toContain('href="rhymes.html"');
  expect(await (await request.get('/reading.html')).text()).toContain('href="rhymes.html"');
  for (const id of ['#play-rhyme', '#play-poems', '#play-teams']) {
    await page.locator(id).click();
    if (id === '#play-poems') await page.locator('#again').click(); else await choices(page).first().click();
    await page.locator('#exit').click();
  }
  expect(errors).toEqual([]);
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect(reqs.sending()).toEqual([]);
  const s = await storedData(page, context);
  expect(s.local, 'the page saves nothing').toEqual([]);
  expect(s.cookies).toEqual([]);
  expect(s.session).toEqual([]);
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/Sprouts/i);
  expect(text, 'no copied lines from the traditional rhyme').not.toMatch(/my son John|one shoe off/i);
});

test('rhymes: 50 rounds, the shown word has a picture, exactly one choice rhymes with it, and the right answer is praised', async ({ page }) => {
  await open(page);
  await page.locator('#play-rhyme').click();
  const problems: string[] = [];
  const targets = new Set<string>();
  for (let r = 0; r < 50; r++) {
    if (await page.locator('#alldone').isVisible()) await page.locator('#keep').click();
    const target = (await page.locator('#target').getAttribute('data-word')) ?? '';
    const ws = await words(page);
    const where = `[round ${r + 1}] ${target} ${JSON.stringify(ws)}`;
    targets.add(target);
    if (!ENDING[target]) { problems.push(`${where}: target not in the list`); continue; }
    if ((await page.locator('#target svg').count()) !== 1) problems.push(`${where}: no picture for the target`);
    await expect(page.locator('#ask')).toHaveText(`Which picture rhymes with ${target}?`);
    if ((await said(page)).at(-1) !== `Which picture rhymes with ${target}?`) problems.push(`${where}: question not spoken`);
    if (ws.length !== 3 || new Set(ws).size !== 3) problems.push(`${where}: expected 3 different pictures`);
    if (ws.includes(target)) problems.push(`${where}: the target is also a choice`);
    const unknown = ws.filter((w) => !ENDING[w]);
    if (unknown.length) { problems.push(`${where}: unlisted choices ${unknown}`); continue; }
    const rhyming = ws.filter((w) => ENDING[w] === ENDING[target]);
    if (rhyming.length !== 1) { problems.push(`${where}: ${rhyming.length} choices rhyme, expected 1`); continue; }
    await page.locator(`#area button.choice[data-word="${rhyming[0]}"]`).click();
    await expect(page.locator('#sub')).toHaveText(new RegExp(`^(Yes!|You found it!) ${cap(target)} and ${rhyming[0]} rhyme\\.$`));
    await page.locator('#more').click();
  }
  expect(problems).toEqual([]);
  expect(targets.size, 'many different target words should turn up').toBeGreaterThanOrEqual(10);
});

test('rhymes: a wrong tap says "Not yet", names the picture, keeps the round open, and never shows a cross', async ({ page }) => {
  await open(page);
  await page.locator('#play-rhyme').click();
  const target = (await page.locator('#target').getAttribute('data-word'))!;
  const ws = await words(page);
  const wrong = ws.find((w) => ENDING[w] !== ENDING[target])!;
  await page.locator(`#area button.choice[data-word="${wrong}"]`).click();
  await expect(page.locator('#sub')).toHaveText(`Not yet. That is ${wrong}. Say ${target}, then find a word that ends the same way.`);
  await expect(page.locator('#more')).toBeHidden();
  await expect(page.locator('body')).not.toContainText('✗');
  const right = ws.find((w) => ENDING[w] === ENDING[target])!;
  await page.locator(`#area button.choice[data-word="${right}"]`).click();
  await expect(page.locator('#sub')).toHaveText(`You found it! ${cap(target)} and ${right} rhyme.`);
});

test('rhyme time: four original rhymes, rhyming words in bold, read aloud only when asked, then "All done for now"', async ({ page }) => {
  await open(page);
  await page.locator('#play-poems').click();
  for (let i = 0; i < POEMS.length; i++) {
    const p = POEMS[i];
    await expect(page.locator('#count')).toHaveText(`Rhyme ${i + 1} of 4`);
    await expect(page.locator('#poemtitle')).toHaveText(p.title);
    const bold = await page.locator('#poem b').allInnerTexts();
    expect(bold, p.title).toEqual(p.pairs.flat());
    const before = (await said(page)).length;
    await page.waitForTimeout(300);
    expect((await said(page)).length, 'nothing plays by itself').toBe(before);
    await expect(page.locator('#again')).toHaveText('Read it to me');
    await page.locator('#again').click();
    const spoken = (await said(page)).at(-1)!;
    const shown = (await page.locator('#poem').innerText()).replace(/\s+/g, ' ').trim();
    expect(spoken, 'reads the rhyme as shown').toBe(shown);
    expect(spoken).not.toContain('*');
    await page.locator('#more').click();
  }
  await expect(page.locator('#alldone')).toBeVisible();
});

test('letter teams: 60 rounds, one right picture that has the team, two that have neither its letters nor its sound', async ({ page }) => {
  await open(page);
  await page.locator('#play-teams').click();
  const problems: string[] = [];
  const seen = new Set<string>();
  for (let r = 0; r < 60; r++) {
    if (await page.locator('#alldone').isVisible()) await page.locator('#keep').click();
    const team = (await page.locator('#letter').innerText()).trim();
    const ask = (await page.locator('#ask').innerText()).trim();
    const ws = await words(page);
    const where = `[round ${r + 1}] "${ask}" ${JSON.stringify(ws)}`;
    seen.add(team);
    const item = TEAMS[team];
    if (!item) { problems.push(`${where}: team ${team} not in the list`); continue; }
    if (ask !== `Which picture has ${team}, as in ${item.anchor}?`) problems.push(`${where}: question not in the expected form`);
    if ((await said(page)).at(-1) !== ask) problems.push(`${where}: question not spoken`);
    if (ws.includes(item.anchor)) problems.push(`${where}: the example word is also a picture`);
    if (ws.length !== 3 || new Set(ws).size !== 3) problems.push(`${where}: expected 3 different pictures`);
    const unknown = ws.filter((w) => !HEARS[w]);
    if (unknown.length) { problems.push(`${where}: unlisted pictures ${unknown}`); continue; }
    const right = ws.filter((w) => item.words.includes(w));
    if (right.length !== 1) { problems.push(`${where}: ${right.length} right pictures, expected 1`); continue; }
    for (const w of ws.filter((x) => x !== right[0])) {
      if (w.includes(team)) problems.push(`${where}: wrong choice ${w} is spelled with ${team}`);
      if (HEARS[w].includes(team)) problems.push(`${where}: wrong choice ${w} has the ${team} sound`);
    }
    await page.locator(`#area button.choice[data-word="${right[0]}"]`).click();
    await expect(page.locator('#sub')).toHaveText(new RegExp(`^(Yes!|You found it!) ${cap(right[0])} has ${team}\\.$`));
    const label = page.locator(`#area button.choice[data-word="${right[0]}"] .w`);
    await expect(label).toHaveText(right[0]);
    await expect(label.locator('b')).toHaveText(team);
    await page.locator('#more').click();
  }
  expect(problems).toEqual([]);
  expect(seen.size, 'most teams should turn up in 60 rounds').toBeGreaterThanOrEqual(9);
});

test('letter teams: shows the grown-up prompt, and a wrong tap says "Not yet" with the example word again', async ({ page }) => {
  await open(page);
  await page.locator('#play-teams').click();
  await expect(page.locator('#area')).toContainText('Grown-up: say the sound together');
  const team = (await page.locator('#letter').innerText()).trim();
  const ws = await words(page);
  const wrong = ws.find((w) => !TEAMS[team].words.includes(w))!;
  await page.locator(`#area button.choice[data-word="${wrong}"]`).click();
  await expect(page.locator('#sub')).toHaveText(`Not yet. That is ${wrong}. Listen again: ${team}, as in ${TEAMS[team].anchor}.`);
  await expect(page.locator('#more')).toBeHidden();
});

test('with no on-device voice the page says so and the games still work silently', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, false);
  await expect(page.locator('#novoice')).toBeVisible();
  await page.locator('#play-teams').click();
  await choices(page).first().click();
  await page.locator('#exit').click();
  await page.locator('#play-poems').click();
  await page.locator('#again').click();
  expect(errors).toEqual([]);
});

test('every button is at least 48 by 48 px', async ({ page }) => {
  await open(page);
  for (const id of ['#play-rhyme', '#play-poems', '#play-teams']) {
    await page.locator(id).click();
    for (const b of await page.locator('button:visible').all()) {
      const box = (await b.boundingBox())!;
      expect(box.width, await b.innerText()).toBeGreaterThanOrEqual(47.5);
      expect(box.height, await b.innerText()).toBeGreaterThanOrEqual(47.5);
    }
    await page.locator('#exit').click();
  }
});

for (const view of ['menu', 'rhymes', 'rhyme time', 'letter teams'] as const) {
  for (const width of [0, 320]) {
    test(`rhymes: ${view} view fits the screen and passes the accessibility scan${width ? ' at 320 px' : ''}`, async ({ page }) => {
      if (width) await page.setViewportSize({ width, height: 700 });
      await open(page);
      if (view === 'rhymes') await page.locator('#play-rhyme').click();
      if (view === 'rhyme time') await page.locator('#play-poems').click();
      if (view === 'letter teams') await page.locator('#play-teams').click();
      expect(await horizontalOverflow(page), 'overflow').toBeLessThanOrEqual(1);
      expect(await axeViolations(page), `${view} view`).toEqual([]);
    });
  }
}
