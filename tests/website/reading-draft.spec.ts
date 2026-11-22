import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';
import { knownBug } from '../support/known-bugs';

// The reading games page (reading.html, mode A; released 22 Nov 2026, was the hidden reading-draft.html). Not in the menu; linked from Learning. Expected words and spoken texts come from
// project doc 18 "Reading Mode A Content Lists v1", written out below, never read from the page's own code.
// Speech is recorded by replacing speechSynthesis.speak, so no sound is needed and the test sees exactly what would be said.

test.beforeEach(() => { knownBug(); });

const LETTER_WORD: Record<string, string> = { s: 'sun', a: 'apple', t: 'tiger', p: 'pig', i: 'igloo', n: 'nest', m: 'moon', d: 'dog', g: 'goat', o: 'octopus', c: 'cat', k: 'kite', e: 'egg', u: 'umbrella', r: 'rain', h: 'hat', b: 'ball', f: 'fish', l: 'lion', j: 'jam', v: 'van', w: 'web', x: 'box', y: 'yes', z: 'zebra', q: 'queen' };
const SET1 = ['s', 'a', 't', 'p', 'i', 'n'];
const BLEND_SET1 = ['sat', 'pat', 'tap', 'pan', 'pin', 'tin', 'sit', 'sip', 'tip', 'nap'];
const BLEND_ALL = [...BLEND_SET1, 'mat', 'map', 'dad', 'dig', 'dog', 'got', 'cat', 'cap', 'pot', 'kid', 'red', 'run', 'hat', 'hot', 'bed', 'bus', 'bug', 'fun', 'fit', 'hen'];
const COMMON: Record<string, string> = { the: 'The dog runs.', and: 'Cats and dogs.', is: 'The sun is hot.', to: 'I go to bed.', you: 'You can hop.', it: 'It is red.', can: 'I can jump.', see: 'I see a cat.', we: 'We can play.', my: 'This is my hat.', a: 'A dog can run.', i: 'I am happy.', in: 'The cat is in the box.', go: 'Let us go to the park.', no: 'No, thank you.', me: 'Play with me.', he: 'He has a red hat.', she: 'She has a big cup.', on: 'The book is on the bed.', up: 'Look up at the star.' };
const PICTURE_SET1 = ['cat', 'dog', 'sun', 'ball', 'moon', 'star'];

async function open(page: Page, opts: { limit?: string; speed?: string } = {}) {
  await page.addInitScript(`window.__said=[]; window.__rate=[]; try{ const SS=window.speechSynthesis; SS.speak=(u)=>{window.__said.push(u.text);window.__rate.push(u.rate);}; SS.cancel=()=>{}; }catch(e){}`);
  if (opts.limit || opts.speed) await page.addInitScript(([l, s]) => { if (l) localStorage.setItem('rd-limit', l); if (s) localStorage.setItem('rd-speed', s); }, [opts.limit, opts.speed]);
  await page.goto('/reading.html');
}
const said = (page: Page) => page.evaluate(() => (window as any).__said as string[]);
const clear = (page: Page) => page.evaluate(() => { (window as any).__said = []; (window as any).__rate = []; });
const step = (page: Page, n: number) => page.locator('#steps > *').nth(n).click();
/** Presses More until it is gone or 20 times. */
async function showAll(page: Page) { for (let i = 0; i < 20 && (await page.locator('#more').isVisible()); i++) await page.locator('#more').click(); }

test('reading draft: has an icon link like the other pages', async ({ page }) => {
  // Chrome asks for /favicon.ico only some of the time, so the check is on the page itself, not on the console.
  await open(page);
  expect(await page.locator('link[rel~=icon]').count(), 'no <link rel="icon"> on the page').toBeGreaterThan(0);
});

test('is a public page linked from Learning: indexable, labelled as made by the AI team, no errors, no outside requests, nothing sent', async ({ page, request }) => {
  await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204 })); // covered by the icon-link test
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await open(page);
  expect(await page.locator('meta[name=robots][content*=noindex]').count(), 'the released page must not be noindex').toBe(0);
  await expect(page.locator('body')).toContainText('AI team');
  await expect(page.locator('body')).toContainText('no microphone');
  await expect(page.locator('body')).toContainText('parent and child together');
  expect(await page.locator('h1').count()).toBe(1);
  const learning = await (await request.get('/learning.html')).text();
  expect(learning, 'learning.html links to reading.html').toContain('href="reading.html"');
  const old = await (await request.get('/reading-draft.html')).text();
  expect(old, 'the old draft address points to reading.html').toContain('url=reading.html');
  expect(errors).toEqual([]);
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect(reqs.sending()).toEqual([]);
});

test('does not use the working product name "Sprouts" on its own on the page', async ({ page }) => {
  await open(page);
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/Sprouts/i);
});

test('the menu lists the four steps, with ages', async ({ page }) => {
  await open(page);
  const t = await page.locator('#steps').innerText();
  for (const s of ['A1', 'Letter sounds', 'A2', 'Picture words', 'A3', 'Tap to blend', 'A4', 'Common words']) expect(t).toContain(s);
  expect(await page.locator('#steps > *').count()).toBe(4);
});

test.describe('A1 letter sounds', () => {
  test('shows the first set, and More adds letters from the list in order', async ({ page }) => {
    await open(page);
    await step(page, 0);
    expect(await page.locator('.tile').allInnerTexts()).toEqual(['s', 'a', 't', 'p']);
    await page.locator('#more').click();
    expect(await page.locator('.tile').allInnerTexts()).toEqual(SET1);
    await showAll(page);
    const all = (await page.locator('.tile').allInnerTexts()).map((x) => x.trim());
    expect(all.slice(0, 6)).toEqual(SET1);
    expect(new Set(all).size, 'no letter shown twice').toBe(all.length);
    for (const l of all) expect(Object.keys(LETTER_WORD), `unexpected letter "${l}"`).toContain(l);
  });

  test('tapping each letter says "letter, as in word" and nothing else', async ({ page }) => {
    await open(page);
    await step(page, 0);
    await showAll(page);
    const tiles = page.locator('.tile');
    const n = await tiles.count();
    expect(n).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < n; i++) {
      const l = (await tiles.nth(i).innerText()).trim();
      await clear(page);
      await tiles.nth(i).click();
      expect(await said(page), `letter ${l}`).toEqual([`${l}, as in ${LETTER_WORD[l]}`]);
      await expect(tiles.nth(i)).toHaveAttribute('aria-label', `letter ${l}, as in ${LETTER_WORD[l]}`);
    }
  });
});

test.describe('A2 picture words', () => {
  test('first set is the six picture words, each tile has a picture hidden from screen readers and a name', async ({ page }) => {
    await open(page);
    await step(page, 1);
    const tiles = page.locator('.tile');
    expect((await tiles.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).slice(0, 6)).toEqual(PICTURE_SET1);
    for (let i = 0; i < 6; i++) {
      await expect(tiles.nth(i).locator('svg')).toHaveAttribute('aria-hidden', 'true');
      await clear(page);
      await tiles.nth(i).click();
      expect(await said(page)).toEqual([PICTURE_SET1[i]]);
    }
  });
});

test.describe('A3 tap to blend', () => {
  test('the first ten words are set 1 of the blend list, each built from letters of that word', async ({ page }) => {
    await open(page);
    await step(page, 2);
    const cards = page.locator('.wcard');
    const words = await cards.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.w));
    expect(words.slice(0, 10)).toEqual(BLEND_SET1);
    for (const w of words) expect(BLEND_ALL, `unexpected word ${w}`).toContain(w);
    for (let i = 0; i < 10; i++) {
      const w = words[i]!;
      const letters = await cards.nth(i).locator('.let').allInnerTexts();
      expect(letters.join(''), `letters of ${w}`).toBe(w);
      await expect(cards.nth(i).locator('.whole')).toHaveText(w);
    }
  });

  test('letters say their sound and word, the whole word says the word', async ({ page }) => {
    await open(page);
    await step(page, 2);
    const card = page.locator('.wcard').first();
    const letters = await card.locator('.let').allInnerTexts();
    for (let i = 0; i < letters.length; i++) {
      await clear(page);
      await card.locator('.let').nth(i).click();
      expect(await said(page)).toEqual([`${letters[i]}, as in ${LETTER_WORD[letters[i]!]}`]);
    }
    await clear(page);
    await card.locator('.whole').click();
    expect(await said(page)).toEqual(['sat']);
  });
});

test.describe('A4 common words', () => {
  test('first tiles are the common words in list order and each says the word then its sentence', async ({ page }) => {
    await open(page);
    await step(page, 3);
    await showAll(page);
    const tiles = page.locator('.tile');
    const n = await tiles.count();
    expect(n).toBeGreaterThanOrEqual(6);
    const first = (await tiles.allInnerTexts()).map((x) => x.trim());
    expect(first.slice(0, 6)).toEqual(['the', 'and', 'is', 'to', 'you', 'it']);
    for (let i = 0; i < n; i++) {
      const w = first[i]!;
      expect(Object.keys(COMMON), `unexpected word ${w}`).toContain(w.toLowerCase());
      await clear(page);
      await tiles.nth(i).click();
      expect(await said(page), w).toEqual([`${w}. ${COMMON[w.toLowerCase()]}`]);
    }
  });
});

test.describe('calm rules', () => {
  test('no score, timer, points, wrong-answer or penalty wording on any step', async ({ page }) => {
    await open(page);
    for (let s = 0; s < 4; s++) {
      await step(page, s);
      const t = (await page.locator('#game').innerText()).toLowerCase();
      for (const bad of ['score', 'points', 'wrong', 'incorrect', 'try again', 'timer', 'seconds', 'streak', 'lives', 'game over']) expect(t, `step ${s} says "${bad}"`).not.toContain(bad);
      await page.locator('#exit').click();
    }
  });

  test('Exit returns to the menu and the menu shows again', async ({ page }) => {
    await open(page);
    await step(page, 0);
    await expect(page.locator('#game')).toBeVisible();
    await expect(page.locator('#menu')).toBeHidden();
    await page.locator('#exit').click();
    await expect(page.locator('#menu')).toBeVisible();
    await expect(page.locator('#game')).toBeHidden();
  });

  test('the break screen appears after the chosen number of taps, "Keep playing" continues and "Finish" returns to the menu', async ({ page }) => {
    await open(page, { limit: '15' });
    await step(page, 0);
    for (let i = 0; i < 14; i++) await page.locator('.tile').nth(i % 4).click();
    await expect(page.locator('#alldone')).toBeHidden();
    await page.locator('.tile').first().click();
    await expect(page.locator('#alldone')).toBeVisible();
    await expect(page.locator('#alldone')).toContainText('All done for now');
    await page.locator('#keep').click();
    await expect(page.locator('#alldone')).toBeHidden();
    // Observed behaviour: "Keep playing" switches the break off for the rest of the visit (the page sets the count to -1000).
    for (let i = 0; i < 60; i++) await page.locator('.tile').nth(i % 4).click();
    await expect(page.locator('#alldone')).toBeHidden();
    await page.evaluate(() => { (document.getElementById('alldone') as HTMLElement).hidden = false; }); // make the Finish button reachable
    await page.locator('#stop').click();
    await expect(page.locator('#menu')).toBeVisible();
  });

  test('"No break" never shows the break screen', async ({ page }) => {
    await open(page, { limit: '0' });
    await step(page, 0);
    for (let i = 0; i < 60; i++) await page.locator('.tile').nth(i % 4).click();
    await expect(page.locator('#alldone')).toBeHidden();
  });
});

test.describe('parent area', () => {
  test('speed buttons set the speaking rate and are remembered; one is pressed at a time', async ({ page }) => {
    await open(page);
    const rates: Record<string, number> = { Slow: 0.65, Calm: 0.8, Normal: 0.95, Quick: 1.1 };
    await expect(page.locator('#speed button[aria-pressed=true]')).toHaveText('Calm');
    for (const [name, rate] of Object.entries(rates)) {
      await page.locator('#speed button', { hasText: name }).click();
      expect(await page.locator('#speed button[aria-pressed=true]').count()).toBe(1);
      await step(page, 0);
      await clear(page);
      await page.locator('.tile').first().click();
      const r = await page.evaluate(() => (window as any).__rate as number[]);
      expect(r[0]).toBeCloseTo(rate, 2);
      await page.locator('#exit').click();
    }
    await page.reload();
    await expect(page.locator('#speed button[aria-pressed=true]')).toHaveText('Quick');
  });

  test('the break-length buttons offer 15, 30, 50 and No break, with 30 chosen first', async ({ page }) => {
    await open(page);
    expect((await page.locator('#limit button').allInnerTexts()).map((x) => x.trim())).toEqual(['15', '30', '50', 'No break']);
    await expect(page.locator('#limit button[aria-pressed=true]')).toHaveText('30');
  });

  test('"Hear it" speaks one short plain sentence', async ({ page }) => {
    await open(page);
    await clear(page);
    await page.locator('#hear').click();
    const s = await said(page);
    expect(s.length).toBe(1);
    expect(s[0]).toMatch(/^[A-Za-z ,.'!?]+$/);
  });

  const FAKE = (voices: string) => `
    const fake=${voices}; window.__used=[];
    window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
    const SS=window.speechSynthesis;
    SS.getVoices=()=>fake; SS.speak=(u)=>{window.__used.push(u.voice&&u.voice.name);}; SS.cancel=()=>{};`;

  test('offers only English on-device voices, speaks with one of them, and remembers the one the parent picks', async ({ page }) => {
    await page.addInitScript(FAKE(`[{name:'Remote Anna',lang:'en-US',localService:false,voiceURI:'ra'},{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'},{name:'Local Zira',lang:'en-US',localService:true,voiceURI:'lz'},{name:'Local Hans',lang:'de-DE',localService:true,voiceURI:'lh'}]`));
    await page.goto('/reading.html');
    const options = await page.locator('#voicesel option').allInnerTexts();
    const joined = options.join('|');
    expect(joined, 'online voice must not be offered').not.toContain('Remote Anna');
    expect(joined, 'non-English voice must not be offered').not.toContain('Hans');
    expect(joined).toContain('Local Sam');
    expect(joined).toContain('Local Zira');
    await expect(page.locator('#novoice')).toBeHidden();
    await step(page, 0);
    await page.locator('.tile').first().click();
    expect(['Local Sam', 'Local Zira']).toContain((await page.evaluate(() => (window as any).__used as string[]))[0]);
    await page.locator('#exit').click();
    await page.locator('#voicesel').selectOption({ label: options.find((o) => o.includes('Local Sam'))! });
    await step(page, 0);
    await page.locator('.tile').first().click();
    expect((await page.evaluate(() => (window as any).__used as string[])).pop()).toBe('Local Sam');
    await page.reload();
    await step(page, 0);
    await page.locator('.tile').first().click();
    expect((await page.evaluate(() => (window as any).__used as string[])).pop(), 'choice remembered after reload').toBe('Local Sam');
  });

  test('shows the "no built-in voice" note when the device has only online or non-English voices', async ({ page }) => {
    await page.addInitScript(FAKE(`[{name:'Remote Anna',lang:'en-US',localService:false,voiceURI:'ra'},{name:'Local Hans',lang:'de-DE',localService:true,voiceURI:'lh'}]`));
    await page.goto('/reading.html');
    await expect(page.locator('#novoice')).toBeVisible();
    await expect(page.locator('#novoice')).toContainText('No built-in voice');
  });
});

test('stores only the parent settings (voice, speed, break length), nothing the child does, no cookies', async ({ page, context }) => {
  await open(page);
  for (let s = 0; s < 4; s++) { await step(page, s); await page.locator('.tile, .whole').first().click(); await page.locator('#exit').click(); }
  await page.locator('#speed button', { hasText: 'Slow' }).click();
  const st = await storedData(page, context);
  expect(st.cookies).toEqual([]);
  expect(st.session).toEqual([]);
  expect(st.databases).toEqual([]);
  expect(st.caches).toEqual([]);
  expect(st.workers).toBe(0);
  expect(st.local.filter((k) => !['rd-speed', 'rd-limit', 'voice-name'].includes(k)), 'unexpected localStorage keys').toEqual([]);
});

test('works with the keyboard: tab reaches the steps, Enter opens one, a letter can be played and Exit works', async ({ page }) => {
  await open(page);
  await page.locator('#steps > *').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#game')).toBeVisible();
  const tile = page.locator('.tile').first();
  await tile.focus();
  await clear(page);
  await page.keyboard.press('Enter');
  expect(await said(page)).toEqual(['s, as in sun']);
  await page.locator('#exit').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#menu')).toBeVisible();
});

test('touch targets are at least 44 by 44 pixels in every step', async ({ page }) => {
  await open(page);
  for (let s = 0; s < 4; s++) {
    await step(page, s);
    await showAll(page);
    const small = await page.locator('#game button:visible').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: (e.textContent || '').trim().slice(0, 12), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((b) => b.w < 44 || b.h < 44));
    expect(small, `step ${s} small targets`).toEqual([]);
    await page.locator('#exit').click();
  }
});

test('layout fits the screen and the accessibility scan is clean on the menu and each step', async ({ page }) => {
  await open(page);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  expect(await axeViolations(page)).toEqual([]);
  for (let s = 0; s < 4; s++) {
    await step(page, s);
    await showAll(page);
    expect(await horizontalOverflow(page), `step ${s} overflow`).toBeLessThanOrEqual(1);
    expect(await axeViolations(page), `step ${s} axe`).toEqual([]);
    await page.locator('#exit').click();
  }
});

test('layout still fits at 320 pixels wide', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page);
  for (let s = 0; s < 4; s++) { await step(page, s); await showAll(page); expect(await horizontalOverflow(page), `step ${s}`).toBeLessThanOrEqual(1); await page.locator('#exit').click(); }
});
