import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';
import { BLOCKED_WORDS, blockedIn } from '../support/kid-safe';

// Word of the day and picture dictionary (words.html; Manish, 23 Nov 2026; SCRUM-516). Each word shows its meaning, a
// colored split into parts, sentences, a word family, words that mean the same and the opposite, and where it comes from.
// The word of the day is the same for everyone of an age group on a date. "Play with words" gives English points with a
// child profile and adapts to how the child does.

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); };`;

async function open(page: Page, opts: { date?: string; age?: number; hash?: string } = {}) {
  await page.addInitScript(VOICE);
  if (opts.date) await page.addInitScript((d) => { (window as any).YS_TODAY = d; }, opts.date);
  if (opts.age) await page.addInitScript((a) => { if (!localStorage.getItem('ys-profile')) localStorage.setItem('ys-profile', JSON.stringify({ age: a, color: 0 })); }, opts.age);
  await page.goto(`/words.html${opts.hash ?? ''}`);
}
const current = (page: Page) => page.evaluate(() => (window as any).YS_SHELL.current());

test('the page loads with a word of the day, passes the accessibility scan, fits a small phone, loads nothing from other sites and stores nothing', async ({ page, context }) => {
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await open(page, { date: '2026-11-23' });
  await expect(page.locator('h1')).toHaveText('Word of the day');
  await expect(page.locator('#wotd .kicker')).toContainText('Word of the day');
  await expect(page.locator('#wotd .headword')).not.toBeEmpty();
  expect(await axeViolations(page)).toEqual([]);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect(reqs.sending()).toEqual([]);
  expect((await storedData(page, context)).local).toEqual([]);
  expect(errors).toEqual([]);
});

test('the word of the day is the same on every visit for a date and age group, changes the next day, and fits the age', async ({ page }) => {
  await open(page, { date: '2026-11-23' });
  const first = await page.locator('#wotd').getAttribute('data-word');
  await page.reload();
  await expect(page.locator('#wotd')).toHaveAttribute('data-word', first!);
  const r = await page.evaluate(() => {
    const P = (window as any).YS_WORDS_PAGE, by: Record<string, any> = {};
    P.list.forEach((e: any) => { by[e.w] = e; });
    const days: string[] = [];
    for (let i = 0; i < 30; i++) days.push(new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10));
    const young = days.map((d) => P.wordOfDay(d, 4)), mid = days.map((d) => P.wordOfDay(d, 7)), old = days.map((d) => P.wordOfDay(d, 11));
    return {
      distinct: new Set(mid).size,
      youngAges: young.map((w) => by[w].age), oldAges: old.map((w) => by[w].age),
      today: P.wordOfDay('2026-11-23', 7), tomorrow: P.wordOfDay('2026-11-24', 7),
    };
  });
  expect(r.distinct, 'no word repeats within a month').toBe(30);
  expect(r.today).not.toBe(r.tomorrow);
  expect(r.today).toBe(first);
  expect(Math.max(...r.youngAges)).toBeLessThanOrEqual(5);
  expect(Math.min(...r.oldAges)).toBeGreaterThanOrEqual(9);
});

test('a child profile picks the word for that age group, and a grown-up can switch age group', async ({ page }) => {
  await open(page, { date: '2026-11-23', age: 4 });
  const young = await page.evaluate(() => (window as any).YS_WORDS_PAGE.wordOfDay('2026-11-23', 4));
  await expect(page.locator('#wotd')).toHaveAttribute('data-word', young);
  await expect(page.locator('#band-small')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#band-big').click();
  const old = await page.evaluate(() => (window as any).YS_WORDS_PAGE.wordOfDay('2026-11-23', 10));
  await expect(page.locator('#wotd')).toHaveAttribute('data-word', old);
});

test('Another word, next to Word of the day, shows a full card for a random word of the same age group, never repeats in a visit, and goes back to today', async ({ page }) => {
  await open(page, { date: '2026-11-23', age: 4 });
  const today = await page.locator('#wotd').getAttribute('data-word');
  const btn = page.locator('#wotd .kickrow #next-word');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText('Another word');
  await expect(page.locator('#back-today')).toHaveCount(0);
  const seen = [today!];
  for (let i = 0; i < 12; i++) {
    await page.locator('#next-word').click();
    const w = (await page.locator('#wotd').getAttribute('data-word'))!;
    expect(seen, `"${w}" came twice in one visit`).not.toContain(w);
    seen.push(w);
  }
  await expect(page.locator('#wotd .kicker')).toHaveText('Another word for ages 3 to 5');
  await expect(page.locator('#wotd-h')).toBeFocused();
  for (const cls of ['mean', 'splitpart', 'examples', 'family', 'synopp', 'from']) await expect(page.locator(`#wotd .${cls}`)).toBeVisible();
  const ages = await page.evaluate((ws) => { const by: Record<string, number> = {}; (window as any).YS_WORDS_PAGE.list.forEach((e: any) => { by[e.w] = e.age; }); return ws.map((w) => by[w]); }, seen);
  expect(Math.max(...ages), 'only words for ages 3 to 5').toBeLessThanOrEqual(5);
  expect(await axeViolations(page)).toEqual([]);
  expect(await horizontalOverflow(page)).toBe(0);
  await page.locator('#back-today').click();
  await expect(page.locator('#wotd')).toHaveAttribute('data-word', today!);
  await expect(page.locator('#wotd .kicker')).toContainText('Word of the day');
  await expect(page.locator('#back-today')).toHaveCount(0);
  await page.locator('#next-word').click();
  await page.locator('#band-big').click();
  const old = await page.evaluate(() => (window as any).YS_WORDS_PAGE.wordOfDay('2026-11-23', 10));
  await expect(page.locator('#wotd')).toHaveAttribute('data-word', old);
});

test('a word card shows the meaning, the colored split, many sentences, the family, same and opposite, and where it comes from', async ({ page }) => {
  await open(page, { hash: '#unhappy' });
  const card = page.locator('#word-card');
  await expect(card).toHaveAttribute('data-word', 'unhappy');
  await expect(page.locator('#entry')).toBeVisible();
  await expect(card.locator('.meaning')).not.toBeEmpty();
  await expect(card.locator('.split .block.pre .bt')).toHaveText('un');
  await expect(card.locator('.split .block.pre .bm')).not.toBeEmpty();
  const joined = (await card.locator('.split .block .bt').allInnerTexts()).join('');
  expect(joined).toBe('unhappy');
  expect(await card.locator('.exrow').count()).toBeGreaterThanOrEqual(3);
  expect(await card.locator('.exrow:visible mark').count()).toBeGreaterThanOrEqual(3);
  expect(await card.locator('.family .chip.fam').count()).toBeGreaterThanOrEqual(2);
  expect(await card.locator('.chip.syn').count()).toBeGreaterThanOrEqual(1);
  expect(await card.locator('.chip.opp').count()).toBeGreaterThanOrEqual(1);
  await expect(card.locator('.from p')).not.toBeEmpty();
  // A family or opposite word that is in the dictionary opens its own card.
  await card.locator('.chip.opp', { hasText: /^happy$/ }).click();
  await expect(page.locator('#word-card')).toHaveAttribute('data-word', 'happy');
  await page.locator('#word-card-hear').click();
  expect((await page.evaluate(() => (window as any).__said as string[])).pop()).toMatch(/^happy\. /);
  expect(await axeViolations(page, '#entry')).toEqual([]);
});

test('look up by picture group, by letter and by typing; what is typed is never shown back', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.locator('#go-browse').click();
  await expect(page.locator('#browse-h')).toBeFocused();
  expect(await page.locator('#cats .cat').count()).toBeGreaterThanOrEqual(12);
  await page.locator('#cat-animals').click();
  await expect(page.locator('#results-head')).toHaveText('Animals');
  expect(await page.locator('#results .wbtn').count()).toBeGreaterThanOrEqual(40);
  await page.locator('#letter-t').click();
  const t = await page.locator('#results .wbtn').evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.w!));
  expect(t.length).toBeGreaterThan(5);
  expect(t.every((w) => w.startsWith('t'))).toBe(true);
  await page.locator('#q').fill('happi');
  await page.locator('#find button').click();
  await expect(page.locator('#results .wbtn[data-w="happy"]')).toBeVisible();
  // A word that is not on the list, and a blocked word, find nothing and are not printed on the page.
  for (const typed of ['zzqqxx', BLOCKED_WORDS[0]]) {
    await page.locator('#q').fill(typed);
    await page.locator('#find button').click();
    await expect(page.locator('#nothing')).toBeVisible();
    const shown = await page.locator('main').evaluate((m) => (m as HTMLElement).innerText);
    expect(shown.toLowerCase()).not.toContain(typed.toLowerCase());
  }
  expect(blockedIn(await page.locator('main').innerText())).toEqual([]);
  await page.locator('#q').fill('tiger');
  await page.locator('#find button').click();
  await page.locator('#results .wbtn[data-w="tiger"]').click();
  await expect(page.locator('#word-card-h')).toBeFocused();
  await page.locator('#entry-back').click();
  await expect(page.locator('#browse')).toBeVisible();
  expect(await axeViolations(page, '#browse')).toEqual([]);
  expect(errors).toEqual([]);
});

/** Answers the round on screen correctly. */
async function answer(page: Page) {
  const r = await current(page);
  if (r.kind === 'build') { for (let i = 0; i < r.parts.length; i++) await page.locator(`#parts button[data-i="${i}"]`).click(); return; }
  await page.locator(`#choices button[data-v="${r.ans}"]`).click();
}

test('Play with words: 8 rounds, a miss teaches kindly and makes it easier, right answers make it harder, English points with a profile', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, { age: 7 });
  await page.locator('#play-play').click();
  await expect(page.locator('#game')).toBeVisible();
  expect(await page.evaluate(() => (window as any).YS_WORDS_PAGE.level())).toBe(7);
  // A miss on the first round.
  const r = await current(page);
  if (r.kind === 'build') {
    const wrongPart = await page.locator('#parts button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-i')).filter((i) => i !== '0')[0]);
    await page.locator(`#parts button[data-i="${wrongPart}"]`).click();
  } else {
    const wrong = await page.locator('#choices button').evaluateAll((bs, a) => bs.map((b) => b.getAttribute('data-v')!).filter((v) => v !== a)[0], String(r.ans));
    await page.locator(`#choices button[data-v="${wrong}"]`).click();
  }
  await expect(page.locator('#sub')).toHaveClass(/try/);
  await page.locator('#howbtn').click();
  await expect(page.locator('#lesson .split .block').first()).toBeVisible();
  expect(await page.evaluate(() => (window as any).YS_WORDS_PAGE.level())).toBe(6);
  expect(await axeViolations(page, '#game')).toEqual([]);
  await answer(page);
  for (let i = 1; i < 8; i++) {
    await page.locator('#more').click();
    await answer(page);
    await expect(page.locator('#sub')).toHaveClass(/yes/);
  }
  expect(await page.evaluate(() => (window as any).YS_WORDS_PAGE.level())).toBeGreaterThan(6);
  await page.locator('#more').click();
  await expect(page.locator('#alldone')).toBeVisible();
  const pts = await page.evaluate(() => JSON.parse(localStorage.getItem('sprouts:points') || 'null'));
  expect(pts).toEqual({ maths: 0, english: 8, world: 0 });
  expect(errors).toEqual([]);
});

test('without a profile the game stores nothing', async ({ page, context }) => {
  await open(page);
  await page.locator('#play-play').click();
  await answer(page);
  await expect(page.locator('#sub')).toHaveClass(/yes/);
  expect((await storedData(page, context)).local).toEqual([]);
});
