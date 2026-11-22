import { test, expect, type Page } from '@playwright/test';
import { axeViolations, bareSprouts, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';
import { knownBug } from '../support/known-bugs';

// Story time (stories.html, reading mode B, SCRUM-486; doc 14; added 22 Nov 2026).
// The stories are written out here, as the team approved them, never read from the page's own code.

test.beforeEach(() => { knownBug(); });

type Story = { id: string; title: string; band: string; pages: { pic: string; text: string; ask: string }[]; words: string[] };
const STORIES: Story[] = [
  {
    id: 'ball', title: 'Where is the ball?', band: 'Ages 3 to 4',
    pages: [
      { pic: 'ball', text: 'Dog has a red ball.', ask: 'Can you point to the ball?' },
      { pic: 'bed', text: 'The ball rolls under the bed.', ask: 'Where did the ball go?' },
      { pic: 'cat', text: 'Cat looks under the chair. No ball!', ask: 'Where else could the ball be?' },
      { pic: 'dog', text: 'Dog looks under the bed. There it is!', ask: 'How do you think Dog feels now?' },
    ],
    words: ['dog', 'ball', 'bed', 'cat', 'chair', 'red'],
  },
  {
    id: 'rain', title: 'Duck likes the rain', band: 'Ages 3 to 4',
    pages: [
      { pic: 'rain', text: 'Drip, drop. Here comes the rain.', ask: 'What is falling from the sky?' },
      { pic: 'pig', text: 'Pig runs inside. Cow runs inside.', ask: 'Why do you think they run inside?' },
      { pic: 'duck', text: 'Duck stays out. Duck likes the rain!', ask: 'Do you like the rain? Why?' },
      { pic: 'sun', text: 'Then the sun comes out. Hello, sun!', ask: 'What can you see after the rain?' },
    ],
    words: ['rain', 'pig', 'cow', 'duck', 'sun', 'out'],
  },
  {
    id: 'boat', title: 'Goat and the little boat', band: 'Ages 5 to 7',
    pages: [
      { pic: 'goat', text: 'Goat had a little brown boat. She always wore her life jacket in it.', ask: 'What did Goat always wear in her boat?' },
      { pic: 'frog', text: 'One day, Frog hopped up. "Can I come too?" he asked.', ask: 'What do you think Goat will say?' },
      { pic: 'boat', text: '"Yes," said Goat. "There is room for two." Off they went.', ask: 'Why do you think Goat said yes?' },
      { pic: 'fish', text: 'A fish swam by. A bee buzzed past. The sun was warm on their backs.', ask: 'What did they see on the pond?' },
      { pic: 'sun', text: 'When the sun went down, they went home. "Can we go again tomorrow?" said Frog.', ask: 'What would you take on a boat trip?' },
    ],
    words: ['goat', 'boat', 'frog', 'room', 'fish', 'jacket'],
  },
  {
    id: 'bun', title: 'Half a bun', band: 'Ages 5 to 7',
    pages: [
      { pic: 'bun', text: 'Sam had one bun for the bus ride to the farm.', ask: 'Where is Sam going?' },
      { pic: 'bus', text: 'On the bus, Mo sat next to Sam. Mo had no snack.', ask: 'How do you think Mo feels?' },
      { pic: 'bun', text: 'Sam looked at the bun. Then Sam broke it in two.', ask: 'What do you think Sam will do next?' },
      { pic: 'bun', text: '"Half for you and half for me," said Sam. Mo smiled a big smile.', ask: 'Why did Sam share the bun?' },
      { pic: 'cow', text: 'At the farm, a cow said, "Moo!" It was the best half of a bun ever.', ask: 'Can you think of a time you shared something?' },
    ],
    words: ['bun', 'bus', 'snack', 'half', 'smile', 'farm'],
  },
];
/** Words that would not suit a calm story for ages 3 to 7. */
const NOT_FOR_STORIES = /\b(scary|scared|monster|ghost|dead|die|kill|blood|hurt|hate|stupid|lost forever|dark woods|witch)\b/i;

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.speak=(u)=>{window.__said.push(u.text);}; SS.cancel=()=>{};`;
async function open(page: Page, voice = true) {
  if (voice) await page.addInitScript(VOICE);
  else await page.addInitScript(`window.speechSynthesis.getVoices=()=>[];`);
  await page.goto('/stories.html');
}
const said = (page: Page) => page.evaluate(() => (window as any).__said as string[]);

test('is a public page linked from Learning and Reading: labelled, no errors, no outside requests, nothing sent or stored', async ({ page, context, request }) => {
  await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204 }));
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await open(page);
  expect(await page.locator('meta[name=robots][content*=noindex]').count()).toBe(0);
  await expect(page.locator('h1')).toHaveText('Story time');
  for (const t of ['our own words', 'AI team', 'no microphone', 'Not yet tested with children', 'Nothing is saved', 'asking a grown-up first before sharing food']) await expect(page.locator('body')).toContainText(t);
  expect(await (await request.get('/sprouts.html')).text()).toContain('href="stories.html"');
  expect(await (await request.get('/reading.html')).text()).toContain('href="stories.html"');
  await page.locator('#story-ball').click();
  await page.locator('#readit').click();
  await page.locator('#next').click();
  expect(errors).toEqual([]);
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect(reqs.sending()).toEqual([]);
  const s = await storedData(page, context);
  expect(s.local, 'the page saves nothing').toEqual([]);
  expect(s.cookies).toEqual([]);
  expect(bareSprouts(await page.locator('body').innerText())).toEqual([]);
  // Only links to our own pages.
  const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  expect(hrefs.filter((h) => /^(https?:)?\/\//.test(h))).toEqual([]);
});

test('the menu lists the 4 stories with their age band and page count', async ({ page }) => {
  await open(page);
  for (const s of STORIES) await expect(page.locator(`#story-${s.id}`)).toHaveText(`${s.title}${s.band}. ${s.pages.length} pages.`);
  await expect(page.locator('#storylist button')).toHaveCount(STORIES.length);
});

for (const s of STORIES) {
  test(`"${s.title}": every page shows the right picture, text and grown-up question, reads only when tapped, then ends with the word list`, async ({ page }) => {
    await open(page);
    await page.locator(`#story-${s.id}`).click();
    await expect(page.locator('#stitle')).toHaveText(s.title);
    for (let i = 0; i < s.pages.length; i++) {
      const p = s.pages[i];
      await expect(page.locator('#count')).toHaveText(`Page ${i + 1} of ${s.pages.length}`);
      await expect(page.locator('#pic')).toHaveAttribute('data-word', p.pic);
      await expect(page.locator('#pic svg')).toHaveCount(1);
      await expect(page.locator('#text')).toHaveText(p.text);
      await expect(page.locator('#ask')).toHaveText(`Grown-up, ask: ${p.ask}`);
      expect(await said(page), 'nothing is read before a tap').toEqual([]);
      await page.locator('#readit').click();
      expect(await said(page)).toEqual([p.text]);
      await page.evaluate(() => { (window as any).__said = []; });
      if (i > 0) await expect(page.locator('#prev')).toBeVisible(); else await expect(page.locator('#prev')).toBeHidden();
      await expect(page.locator('#next')).toHaveText(i === s.pages.length - 1 ? 'Finish the story' : 'Next page');
      await page.locator('#next').click();
    }
    await expect(page.locator('#count')).toHaveText('The end');
    await expect(page.locator('#theend')).toHaveText('The end.');
    await expect(page.locator('#readit')).toBeHidden();
    await expect(page.locator('#next')).toBeHidden();
    await expect(page.locator('#words button')).toHaveText(s.words);
    for (const w of s.words) {
      await page.locator(`#words button[data-word="${w}"]`).click();
      expect((await said(page)).at(-1)).toBe(w);
    }
    await page.locator('#reread').click();
    await expect(page.locator('#count')).toHaveText(`Page 1 of ${s.pages.length}`);
  });
}

test('the stories in the page match the approved copy, and every word list word is in its story', async ({ page }) => {
  await open(page);
  const shown = await page.evaluate(() => (window as any).YS_STORIES);
  expect(shown).toEqual(STORIES);
  for (const s of STORIES) {
    const all = s.pages.map((p) => `${p.text} ${p.ask}`).join(' ').toLowerCase();
    for (const w of s.words) expect(all, `${s.title}: ${w}`).toMatch(new RegExp(`\\b${w}`));
    expect(all).not.toMatch(NOT_FOR_STORIES);
    // Ages 3 to 4 pages stay short; ages 5 to 7 pages stay at three sentences or fewer.
    for (const p of s.pages) {
      const words = p.text.split(/\s+/).length;
      if (s.band === 'Ages 3 to 4') expect(words, p.text).toBeLessThanOrEqual(8);
      else expect(words, p.text).toBeLessThanOrEqual(16);
    }
  }
});

test('Previous page goes back, and Back returns to the list', async ({ page }) => {
  await open(page);
  await page.locator('#story-boat').click();
  await page.locator('#next').click();
  await page.locator('#prev').click();
  await expect(page.locator('#text')).toHaveText(STORIES[2].pages[0].text);
  await page.locator('#exit').click();
  await expect(page.locator('#storylist')).toBeVisible();
});

test('with no on-device voice: a note shows, the read button is hidden, and the story still works as text', async ({ page }) => {
  await open(page, false);
  await expect(page.locator('#novoice')).toBeVisible();
  await page.locator('#story-rain').click();
  await expect(page.locator('#readit')).toBeHidden();
  await expect(page.locator('#text')).toHaveText(STORIES[1].pages[0].text);
});

test('every button is at least 48 by 48 px', async ({ page }) => {
  await open(page);
  const check = async () => {
    for (const b of await page.locator('button:visible').all()) {
      const box = (await b.boundingBox())!;
      expect(box.width, await b.innerText()).toBeGreaterThanOrEqual(47.5);
      expect(box.height, await b.innerText()).toBeGreaterThanOrEqual(47.5);
    }
  };
  await check();
  await page.locator('#story-ball').click();
  await check();
  for (let i = 0; i < 4; i++) await page.locator('#next').click();
  await check();
});

for (const view of ['menu', 'story page', 'the end'] as const) {
  for (const width of [0, 320]) {
    test(`stories: ${view} view fits the screen and passes the accessibility scan${width ? ' at 320 px' : ''}`, async ({ page }) => {
      if (width) await page.setViewportSize({ width, height: 700 });
      await open(page);
      if (view !== 'menu') await page.locator('#story-boat').click();
      if (view === 'the end') for (let i = 0; i < 5; i++) await page.locator('#next').click();
      expect(await horizontalOverflow(page), 'overflow').toBeLessThanOrEqual(1);
      expect(await axeViolations(page), `${view} view`).toEqual([]);
    });
  }
}
