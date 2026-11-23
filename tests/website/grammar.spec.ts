import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';

// Grammar: how sentences work (grammar.html; Manish, 23 Nov 2026; SCRUM-516). 14 topics, each with a short lesson
// (words colored by the job they do, with more examples) and practice that starts at the child's age and adapts.
// Fragments: "Whole sentence or a piece?", then fix the piece.

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); };`;

const TOPICS = ['nouns', 'verbs', 'adjectives', 'plurals', 'pronouns', 'tenses', 'adverbs', 'capitals', 'endmarks', 'building', 'fragments', 'joining', 'commas', 'subject'];

async function open(page: Page, opts: { age?: number; hash?: string } = {}) {
  await page.addInitScript(VOICE);
  if (opts.age) await page.addInitScript((a) => { if (!localStorage.getItem('ys-profile')) localStorage.setItem('ys-profile', JSON.stringify({ age: a, color: 0 })); }, opts.age);
  await page.goto(`/grammar.html${opts.hash ?? ''}`);
}
const current = (page: Page) => page.evaluate(() => (window as any).YS_SHELL.current());

/** Answers the practice round on screen correctly. */
async function answer(page: Page) {
  const r = await current(page);
  const tap = (sel: string, v: string) => page.evaluate(([sel, v]) => {
    const b = [...document.querySelectorAll(sel)].find((x) => (x as HTMLElement).dataset.v === v || (x as HTMLElement).dataset.w === v) as HTMLButtonElement;
    b.click();
  }, [sel, v] as const);
  if (r.k === 'build') { for (const w of r.words as string[]) await tap('#pool button', w); return; }
  if (r.k === 'whole' && r.step === 'which') {
    await tap('#choices button', String(r.ans));
    if (r.whole) return;
    const fix = await current(page);
    await tap('#fixes button', String(fix.ans));
    return;
  }
  await tap('#choices button', String(r.ans));
}

test('the page lists every topic, passes the accessibility scan, fits a small phone, loads nothing from other sites and stores nothing', async ({ page, context }) => {
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await open(page);
  await expect(page.locator('h1')).toHaveText('Grammar: how sentences work');
  await expect(page.locator('#picker')).toBeVisible();
  await expect(page.locator('#menu')).toBeHidden();
  const ids = await page.evaluate(() => (window as any).YS_GRAMMAR_PAGE.topics as string[]);
  expect([...ids].sort()).toEqual([...TOPICS].sort());
  await expect(page.locator('#topic-list button')).toHaveCount(TOPICS.length);
  expect(await axeViolations(page)).toEqual([]);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect((await storedData(page, context)).local).toEqual([]);
  expect(errors).toEqual([]);
});

for (const id of ['nouns', 'plurals', 'fragments', 'subject']) {
  test(`${id}: the lesson shows colored word blocks on every part, with more examples, and ends with a way into practice`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, { hash: `#${id}` });
    await expect(page.locator('#menu')).toBeVisible();
    await page.locator('#play-lesson').click();
    const parts = await page.evaluate((t) => (window as any).YS_GRAMMAR.find((x: any) => x.id === t).learn.length, id);
    for (let i = 1; i <= parts; i++) {
      await expect(page.locator('#count')).toHaveText(`Part ${i} of ${parts}`);
      expect(await page.locator('#area .sentence .wb, #area .change .wb').count()).toBeGreaterThan(0);
      await expect(page.locator('#lesson-text')).not.toBeEmpty();
      if (i < parts) await page.locator('#more').click();
    }
    const more = await page.evaluate((t) => (window as any).YS_GRAMMAR.find((x: any) => x.id === t).learn.filter((p: any) => (p.more || []).length >= 2).length, id);
    expect(more, 'parts with 2 or more extra examples').toBeGreaterThanOrEqual(parts - 1);
    expect(await axeViolations(page, '#game')).toEqual([]);
    await page.locator('#prevpart').click();
    await expect(page.locator('#count')).toHaveText(`Part ${parts - 1} of ${parts}`);
    await page.locator('#more').click();
    await page.locator('#to-practice').click();
    await expect(page.locator('#title')).toHaveText('Practice');
  });
}

test('fragments practice: a piece is spotted and then fixed; a miss explains kindly and offers a short lesson; English points with a profile', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, { age: 8, hash: '#fragments' });
  await page.locator('#play-play').click();
  let missed = false;
  for (let i = 0; i < 8; i++) {
    if (i > 0) await page.locator('#more').click();
    const r = await current(page);
    expect(r.level).toBeGreaterThanOrEqual(6);
    if (!missed) {
      const wrong = await page.locator('#choices button').evaluateAll((bs, right) => bs.map((b) => b.getAttribute('data-v')!).filter((v) => !right.includes(v))[0], (r.right ?? [r.ans]).map(String));
      if (wrong !== undefined) {
        await page.locator(`#choices button[data-v="${wrong}"]`).click();
        await expect(page.locator('#sub')).toHaveClass(/try/);
        await page.locator('#howbtn').click();
        await expect(page.locator('#lesson-say')).not.toBeEmpty();
        expect(await axeViolations(page, '#game')).toEqual([]);
        missed = true;
      }
    }
    await answer(page);
    await expect(page.locator('#sub')).toHaveClass(/yes/);
  }
  expect(missed).toBe(true);
  await page.locator('#more').click();
  await expect(page.locator('#alldone')).toBeVisible();
  const pts = await page.evaluate(() => JSON.parse(localStorage.getItem('sprouts:points') || 'null'));
  expect(pts.english).toBe(8);
  expect(errors).toEqual([]);
});

test('practice starts at the child\'s age: a 4 year old gets easy noun questions, and two right answers move the level up', async ({ page }) => {
  await open(page, { age: 4, hash: '#nouns' });
  await page.locator('#play-play').click();
  const first = await current(page);
  expect(first.level).toBe(4);
  const ages = await page.evaluate(() => (window as any).YS_GRAMMAR.find((t: any) => t.id === 'nouns').q.map((q: any) => q.age));
  expect(Math.min(...ages)).toBeLessThanOrEqual(4);
  await answer(page);
  await page.locator('#more').click();
  await answer(page);
  expect(await page.evaluate(() => (window as any).YS_GRAMMAR_PAGE.level())).toBe(5);
});

test('every topic can be practised for a full game without a dead end', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, { age: 9 });
  for (const id of TOPICS) {
    await page.locator(`#topic-${id}`).click();
    await page.locator('#play-play').click();
    for (let i = 0; i < 8; i++) {
      if (i > 0) await page.locator('#more').click();
      await answer(page);
      await expect(page.locator('#sub'), `${id} round ${i + 1}`).toHaveClass(/yes/);
    }
    await page.locator('#more').click();
    await expect(page.locator('#alldone')).toBeVisible();
    await page.locator('#stop').click();
    await page.locator('#other-topic').click();
  }
});
