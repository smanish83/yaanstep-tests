import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';
import { blockedIn } from '../support/kid-safe';

// Opposites, the word games (opposites.html, 23 Nov 2026). Manish played Opposites and found the words very limited:
// he expected many more. The page now has a big checked word list (assets/opposites-words.js, window.YS_OPPOSITES):
// at least 350 true opposite pairs in groups, each with the youngest age it suits, at least 60 words that turn into
// their opposite with a beginning (un, dis, in, im, ir, il), and more words with no opposite (what a thing is made of,
// names of things). Two new games use it: Word opposites (a word read aloud, pick its opposite from word tiles: 3 tiles
// up to age 6, 4 from age 7, about 1 round in 5 has no opposite) and Make the opposite (pick the beginning; for ages 7
// and up, with a gentle note for younger children). No word comes back in a visit until the list is used up.
// Every round must have exactly one right answer: checked here with the test's own table built from the list's pairs,
// and the test's own groups of words that mean nearly the same, which must never be offered as a wrong choice.

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); };`;
const ORIGIN = 'http://127.0.0.1:4173';
const NOPE = 'no-opposite';

async function open(page: Page, age = 0, comfort: string[] = []) {
  await page.addInitScript(VOICE);
  if (age || comfort.length) {
    await page.addInitScript((p) => localStorage.setItem('ys-profile', JSON.stringify(p)), { ...(age ? { age, color: 0, nick: '' } : {}), ...(comfort.length ? { comfort } : {}) });
  }
  await page.goto('/opposites.html');
}
const current = (page: Page) => page.evaluate(() => (window as any).YS_SHELL.current());
const said = (page: Page) => page.evaluate(() => (window as any).__said as string[]);
const data = (page: Page) => page.evaluate(() => {
  const O = (window as any).YS_OPPOSITES;
  return { groups: O.groups, wordPairs: O.wordPairs, prefixes: O.prefixes, noneWords: O.noneWords } as {
    groups: Record<string, string>; wordPairs: { a: string; b: string; age: number; group: string; sense: string[] }[];
    prefixes: { root: string; pre: string; age: number; word: string; ex: string; avoid: string[]; pos: string }[];
    noneWords: { w: string; kind: string; thing?: string; can?: string[] }[];
  };
});
/** The hardest pair for an age in Word opposites (the brief: common words for 5 and 6; harder words from 7, by age). */
const wordMax = (age: number) => (!age ? 6 : age <= 4 ? 4 : age <= 6 ? 6 : age + 1);
const wordTiles = (age: number) => (age >= 7 ? 4 : 3);

/* ---------- the test's own logic ---------- */
/** Words that mean nearly the same thing. When one is the answer (or the word asked), another must never be a wrong choice. */
const NEAR: string[][] = [
  ['big', 'large', 'huge', 'giant', 'enormous', 'gigantic', 'colossal'], ['small', 'little', 'tiny', 'miniature', 'minuscule'], ['fast', 'quick'], ['loud', 'noisy'],
  ['quiet', 'silent'], ['happy', 'glad', 'cheerful'], ['sad', 'gloomy'], ['scared', 'afraid', 'nervous', 'worried', 'anxious', 'timid'], ['start', 'begin'], ['finish', 'end'],
  ['shut', 'close', 'closed'], ['wet', 'damp', 'moist', 'soaked'], ['hot', 'warm', 'boiling'], ['cold', 'cool', 'freezing', 'icy'], ['clean', 'tidy', 'neat'], ['dirty', 'messy'],
  ['easy', 'simple'], ['difficult', 'complicated', 'complex'], ['old', 'ancient'], ['new', 'modern', 'recent'], ['above', 'over', 'up', 'high'], ['below', 'under', 'down', 'low', 'beneath'],
  ['inside', 'in', 'indoors', 'indoor'], ['outside', 'out', 'outdoors', 'outdoor'], ['give', 'send', 'lend'], ['take', 'receive', 'borrow'], ['grow', 'increase', 'expand', 'enlarge'],
  ['shrink', 'decrease', 'contract', 'reduce'], ['real', 'genuine'], ['fake', 'pretend', 'artificial'], ['always', 'often', 'frequently'], ['never', 'rarely'],
  ['leave', 'exit', 'depart'], ['arrive', 'enter'], ['near', 'here'], ['far', 'away', 'there'], ['before', 'earlier', 'first'], ['after', 'later', 'last'],
];
/** Topics the list must never use, even as a "harmless" pair (the brief's kid-safe rules): death, violence, looks, money troubles, insults, love and hate, war, crime, alcohol. */
const NEVER = ['alive', 'dead', 'die', 'live', 'born', 'kill', 'fat', 'skinny', 'ugly', 'pretty', 'beautiful', 'handsome', 'rich', 'poor', 'stupid', 'clever', 'smart', 'dumb', 'foolish',
  'love', 'hate', 'war', 'peace', 'attack', 'fight', 'enemy', 'weapon', 'guilty', 'innocent', 'criminal', 'legal', 'illegal', 'sober', 'drunk', 'strong', 'weak', 'sick', 'come', 'screw', 'rude'];
/** Words made with a beginning that are real words but not the opposite we want: never offered as a wrong choice. */
const REAL_NOT_WANTED = ['inkind', 'discover', 'insure', 'inpatient', 'unbalance', 'unpractical', 'unloyal', 'unactive', 'uncapable', 'unedible', 'unreplaceable', 'unresistible',
  'unreversible', 'unlogical', 'unpleased', 'intrust', 'irreal', 'infold', 'inwrap', 'incertain', 'inroll', 'unaudible', 'unconsiderate', 'unpolite', 'disable'];

type Pairs = { a: string; b: string; age: number; group: string; sense: string[] }[];
function table(pairs: Pairs) {
  const opp: Record<string, string[]> = {}, sense: Record<string, string[]> = {}, youngest: Record<string, number> = {};
  for (const p of pairs) for (const [x, y] of [[p.a, p.b], [p.b, p.a]]) {
    (opp[x] ??= []).includes(y) || opp[x].push(y);
    sense[x] = [...new Set([...(sense[x] ?? []), ...p.sense])];
    youngest[x] = Math.min(youngest[x] ?? 99, p.age);
  }
  return { opp, sense, youngest };
}
/** Problems with one Word opposites round. n: word tiles wanted; max: the hardest pair for the child. */
function wordProblems(q: any, T: ReturnType<typeof table>, nones: string[], n: number, max: number): string[] {
  const out: string[] = [];
  const words: string[] = q.choices.filter((c: string) => c !== NOPE);
  if (words.length !== n) out.push(`${q.word}: ${words.length} word tiles, want ${n}`);
  if (new Set(q.choices).size !== q.choices.length) out.push(`${q.word}: a choice twice`);
  if (words.includes(q.word)) out.push(`${q.word}: the word itself is a choice`);
  for (const w of words) if (!T.opp[w]) out.push(`${q.word}: unknown choice ${w}`);
  if (q.kind === 'none') {
    if (!nones.includes(q.word)) out.push(`${q.word}: not a no-opposite word`);
    if (T.opp[q.word]) out.push(`${q.word}: has an opposite but is asked as none`);
    if (q.ans !== NOPE || !q.choices.includes(NOPE)) out.push(`${q.word}: no "No opposite!" answer`);
    return out;
  }
  const right = q.choices.filter((c: string) => c !== NOPE && (T.opp[q.word] ?? []).includes(c));
  if (right.length !== 1) out.push(`${q.word}: ${right.length} right answers (${right.join(', ')})`);
  else if (right[0] !== q.ans) out.push(`${q.word}: page says ${q.ans}, the test says ${right[0]}`);
  for (const w of words) {
    if (w === q.ans) continue;
    if (T.sense[w].some((s) => T.sense[q.ans].includes(s))) out.push(`${q.word}: ${w} is about the same thing as the answer ${q.ans}`);
    if (NEAR.some((g) => g.includes(w) && (g.includes(q.ans) || g.includes(q.word)))) out.push(`${q.word}: ${w} means nearly the same as ${q.ans} or ${q.word}`);
    if (T.youngest[w] > Math.max(max, T.youngest[q.word])) out.push(`${q.word}: ${w} is too hard for this age`);
  }
  return out;
}

/* ---------- the list ---------- */

test('the word list: at least 350 pairs in groups, unique and well formed, at least 60 beginnings, and more words with no opposite', async ({ page }) => {
  await open(page);
  const D = await data(page);
  expect(D.wordPairs.length).toBeGreaterThanOrEqual(350);
  expect(D.prefixes.length).toBeGreaterThanOrEqual(60);
  expect(D.noneWords.length).toBeGreaterThanOrEqual(40);
  // Every group the brief asks for, with plenty in each.
  for (const g of ['describe', 'action', 'place', 'time', 'feel']) expect(D.wordPairs.filter((p) => p.group === g).length, g).toBeGreaterThanOrEqual(25);
  expect(Object.keys(D.groups).sort()).toEqual([...new Set(D.wordPairs.map((p) => p.group))].sort());
  // Unique in either order, never a word with itself, single lower-case words, ages 3 to 12, and something it is about.
  const keys = D.wordPairs.map((p) => [p.a, p.b].sort().join('/'));
  expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  for (const p of D.wordPairs) {
    expect(p.a, JSON.stringify(p)).not.toBe(p.b);
    expect(`${p.a} ${p.b}`).toMatch(/^[a-z]+ [a-z]+$/);
    expect(p.age).toBeGreaterThanOrEqual(3);
    expect(p.age).toBeLessThanOrEqual(12);
    expect(p.sense.length).toBeGreaterThan(0);
  }
  // Symmetric: the table the games use says each word is the opposite of the other, both ways.
  const T = table(D.wordPairs);
  for (const p of D.wordPairs) { expect(T.opp[p.a]).toContain(p.b); expect(T.opp[p.b]).toContain(p.a); }
  // Common words for the youngest word players, harder ones later (the brief's examples).
  const age = (a: string, b: string) => D.wordPairs.find((p) => [p.a, p.b].sort().join('/') === [a, b].sort().join('/'))?.age;
  for (const [a, b] of [['big', 'small'], ['hot', 'cold'], ['up', 'down'], ['day', 'night'], ['happy', 'sad'], ['open', 'close'], ['push', 'pull']]) expect(age(a, b), `${a}/${b}`).toBeLessThanOrEqual(4);
  for (const [a, b] of [['ancient', 'modern'], ['expand', 'shrink'], ['generous', 'selfish']]) expect(age(a, b), `${a}/${b}`).toBeGreaterThanOrEqual(8);
  expect(D.wordPairs.filter((p) => p.age <= 6).length, 'common words for ages 5 and 6').toBeGreaterThanOrEqual(120);
  // Words with no opposite are never in a pair, and none repeats.
  const nones = D.noneWords.map((n) => n.w);
  expect(nones.filter((w, i) => nones.indexOf(w) !== i)).toEqual([]);
  expect(nones.filter((w) => T.opp[w])).toEqual([]);
  expect(D.noneWords.filter((n) => n.kind === 'made').length).toBeGreaterThanOrEqual(15);
  expect(D.noneWords.filter((n) => n.kind === 'thing').length).toBeGreaterThanOrEqual(15);
  for (const n of D.noneWords.slice(0, 60)) {
    const why = await page.evaluate((x) => (window as any).YS_OPPOSITES.whyNoneWord(x), n);
    expect(why).toMatch(n.kind === 'made' ? /made of\. It is not a way .* so it has no opposite\.$/ : /is the name of a thing\. .* has no opposite\.$/);
  }
  // Beginnings: one of un, dis, in, im, ir, il; the word is the beginning and the root; each root once; a sentence that uses the word.
  const roots = D.prefixes.map((p) => p.root);
  expect(roots.filter((r, i) => roots.indexOf(r) !== i)).toEqual([]);
  for (const p of D.prefixes) {
    expect(['un', 'dis', 'in', 'im', 'ir', 'il']).toContain(p.pre);
    expect(p.word).toBe(p.pre + p.root);
    expect(p.ex.toLowerCase(), p.root).toContain(p.word);
    expect(p.age).toBeGreaterThanOrEqual(7);
  }
  for (const pre of ['un', 'dis', 'in', 'im', 'ir', 'il']) expect(D.prefixes.some((p) => p.pre === pre), pre).toBe(true);
  expect(D.prefixes.filter((p) => p.age === 7).length, 'enough for a 7-year-old').toBeGreaterThanOrEqual(15);
});

test('the word list is kid-safe: no blocked word anywhere, and none of the topics the brief rules out', async ({ page, request }) => {
  await open(page);
  const D = await data(page);
  const words = [...D.wordPairs.flatMap((p) => [p.a, p.b]), ...D.prefixes.flatMap((p) => [p.root, p.word]), ...D.noneWords.map((n) => n.w)];
  for (const f of ['/assets/opposites-words.js', '/assets/opposites.js', '/opposites.html']) {
    const text = await (await request.get(f)).text();
    expect(blockedIn(text), f).toEqual([]);
  }
  expect(blockedIn(JSON.stringify(D).replace(/[{}[\]",:]/g, ' '))).toEqual([]);
  expect(words.filter((w) => NEVER.includes(w))).toEqual([]);
});

/* ---------- Word opposites ---------- */

test('Word opposites: every round has exactly one right answer and no near-twin of it, over many generated rounds at every age', async ({ page }) => {
  await open(page);
  const D = await data(page);
  const T = table(D.wordPairs), nones = D.noneWords.map((n) => n.w);
  const made = await page.evaluate(() => {
    const O = (window as any).YS_OPPOSITES, out: { max: number; n: number; q: any }[] = [];
    for (const age of [3, 5, 6, 7, 9, 12]) {
      const max = O.wordMax(age), n = O.wordChoices(age);
      O.wordPairs.forEach((p: any, i: number) => {
        if (p.age > max) return;
        out.push({ max, n, q: O.make.words(max, n, 'pair', i, 0, i % 2 === 0) });
        out.push({ max, n, q: O.make.words(max, n, 'pair', i, 1, i % 2 === 1) });
      });
      O.noneWords.forEach((x: any) => out.push({ max, n, q: O.make.words(max, n, 'none', x.w) }));
    }
    return out;
  });
  expect(made.length).toBeGreaterThan(1500);
  const bad = made.flatMap((m) => wordProblems(m.q, T, nones, m.n, m.max));
  expect(bad.slice(0, 25)).toEqual([]);
  // Words with more than one opposite are asked, and only one of their opposites is ever offered.
  for (const w of ['short', 'light', 'old', 'quiet', 'hard']) {
    const asked = made.filter((m) => m.q.kind === 'pair' && m.q.word === w);
    expect(asked.length, w).toBeGreaterThan(0);
    for (const m of asked) expect(m.q.choices.filter((c: string) => T.opp[w].includes(c)), w).toHaveLength(1);
  }
  // "No opposite!" is also offered in some rounds where it is not right.
  expect(made.some((m) => m.q.kind === 'pair' && m.q.choices.includes(NOPE))).toBe(true);
});

for (const age of [0, 5, 7, 12]) {
  test(`Word opposites, ${age ? `age ${age}` : 'no profile'}: 10 rounds read aloud, ${wordTiles(age)} word tiles, 2 with no opposite, one right answer each, kind on a miss`, async ({ page }) => {
    const errors = watchErrors(page);
    await open(page, age);
    const D = await data(page);
    const T = table(D.wordPairs), nones = D.noneWords.map((n) => n.w);
    await page.locator('#play-words').click();
    const noneRounds: number[] = [];
    for (let k = 0; k < 10; k++) {
      await expect(page.locator('#count')).toHaveText(`Round ${k + 1} of 10`);
      await expect(page.locator('#prompt')).toBeFocused();
      const r = await current(page);
      expect(wordProblems(r.q, T, nones, wordTiles(age), wordMax(age)), JSON.stringify(r.q)).toEqual([]);
      if (r.kind === 'none') noneRounds.push(k);
      // The word is shown and read aloud.
      await expect(page.locator('#prompt')).toHaveText(`What is the opposite of ${r.word}?`);
      await expect(page.locator('#word')).toHaveText(r.word);
      expect(await said(page)).toContain(`What is the opposite of ${r.word}?`);
      const tiles = await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => ({ v: b.getAttribute('data-v')!, name: b.querySelector('.sr')?.textContent ?? '', seen: b.querySelector('.wordtile')?.textContent ?? '' })));
      expect(tiles.map((t) => t.v).sort()).toEqual((r.choices as string[]).slice().sort());
      for (const t of tiles) { expect(t.name).toBe(t.v === NOPE ? 'No opposite!' : t.v); expect(t.seen).toBe(t.name); }
      if (k === 0) {
        const wrong = (r.choices as string[]).find((c) => c !== r.ans)!;
        await page.locator(`#choices button[data-v="${wrong}"]`).click();
        await expect(page.locator('#sub')).toHaveClass(/try/);
        await expect(page.locator('#sub')).toContainText(`You tapped ${wrong === NOPE ? 'No opposite!' : wrong}.`);
        expect((await said(page)).at(-1)).toMatch(/^You tapped/);
        await expect(page.locator(`#choices button[data-v="${wrong}"]`)).toBeDisabled();
        await expect(page.locator('#choices button:focus')).not.toBeDisabled();
        await page.locator('#howbtn').click();
        await expect(page.locator('#lesson h3')).toBeFocused();
        await expect(page.locator('#lesson svg[role=img]').first()).toBeVisible();
        expect((await page.locator('#lesson-say').innerText()).length).toBeGreaterThan(30);
        expect(await axeViolations(page, '#game')).toEqual([]);
        const missLine = await page.locator('#sub').innerText();
        expect(missLine).not.toMatch(/\b(wrong|incorrect|lose|lost|score|points|timer|hurry|seconds)\b/i);
      }
      await page.locator(`#choices button[data-v="${r.ans}"]`).click();
      await expect(page.locator('#sub')).toContainText('Yes!');
      const yes = r.kind === 'none' ? /has no opposite\.$/ : new RegExp(`^Yes! ${r.word[0].toUpperCase()}${r.word.slice(1)} and ${r.ans} are opposites\\.$`);
      expect((await said(page)).at(-1)).toMatch(yes);
      await expect(page.locator('#more')).toBeFocused();
      await page.locator('#more').click();
    }
    // About 1 round in 5 has no opposite: 2 of 10, never the first, never two in a row.
    expect(noneRounds).toHaveLength(2);
    expect(noneRounds[0]).toBeGreaterThan(0);
    expect(noneRounds[1] - noneRounds[0]).toBeGreaterThan(1);
    await expect(page.locator('#alldone')).toBeVisible();
    await page.locator('#stop').click();
    await expect(page.locator('#play-words')).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test('Word opposites: keyboard only, a tile says its word when it gets focus, and Enter picks it', async ({ page }) => {
  await open(page, 7);
  await page.locator('#play-words').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#prompt')).toBeFocused();
  const r = await current(page);
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => document.activeElement?.getAttribute('data-v'));
  expect(r.choices).toContain(first);
  expect((await said(page)).at(-1)).toBe(first === NOPE ? 'No opposite!' : first);
  // Tab on to the right answer, then press Enter.
  for (let i = 0; i < 6 && (await page.evaluate(() => document.activeElement?.getAttribute('data-v'))) !== r.ans; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-v'))).toBe(r.ans);
  await page.keyboard.press('Enter');
  await expect(page.locator('#sub')).toContainText('Yes!');
  await expect(page.locator('#more')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#count')).toHaveText('Round 2 of 10');
});

test('Word opposites: with "Fewer choices", every round shows two tiles and exactly one is right', async ({ page }) => {
  await open(page, 9, ['fewer']);
  await page.locator('#play-words').click();
  for (let k = 0; k < 10; k++) {
    const r = await current(page);
    const vals = await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-v')!));
    expect(vals, `round ${k + 1}`).toHaveLength(2);
    expect(vals.filter((v) => v === r.ans)).toHaveLength(1);
    await page.locator(`#choices button[data-v="${r.ans}"]`).click();
    await page.locator('#more').click();
  }
});

/* ---------- Make the opposite ---------- */

for (const age of [0, 6, 8, 12]) {
  test(`Make the opposite, ${age ? `age ${age}` : 'no profile'}: one right beginning each round, the built word and its example are shown and said`, async ({ page }) => {
    const errors = watchErrors(page);
    await open(page, age);
    const D = await data(page);
    await page.locator('#play-prefix').click();
    for (let k = 0; k < 8; k++) {
      await expect(page.locator('#count')).toHaveText(`Round ${k + 1} of 8`);
      await expect(page.locator('#prompt')).toBeFocused();
      if (age && age >= 7) await expect(page.locator('#older-note')).toHaveCount(0);
      else await expect(page.locator('#older-note')).toContainText('for ages 7 and up, but anyone can have a go');
      const r = await current(page);
      const it = D.prefixes.find((p) => p.root === r.q.root)!;
      expect(it, r.q.root).toBeTruthy();
      expect(it.age, 'not too hard for the age').toBeLessThanOrEqual(!age || age < 7 ? 7 : age + 1);
      // The test's own check: exactly one offered beginning is the list's, none is a beginning the list says to avoid,
      // and none makes a real word that is not the wanted opposite.
      const choices = r.choices as string[];
      expect(choices).toHaveLength(age >= 7 ? 4 : 3);
      expect(new Set(choices).size).toBe(choices.length);
      expect(choices.filter((c) => c === it.pre)).toHaveLength(1);
      expect(r.ans).toBe(it.pre);
      expect(choices.filter((c) => it.avoid.includes(c) || REAL_NOT_WANTED.includes(c + it.root))).toEqual([]);
      await expect(page.locator('#prompt')).toHaveText(`Which beginning makes the opposite of ${it.root}?`);
      await expect(page.locator('#word')).toContainText(it.root);
      if (k === 0) {
        const wrong = choices.find((c) => c !== r.ans)!;
        await page.locator(`#choices button[data-v="${wrong}"]`).click();
        await expect(page.locator('#sub')).toContainText(`You tapped ${wrong}.`);
        await page.locator('#howbtn').click();
        await expect(page.locator('#lesson svg[role=img]').first()).toBeVisible();
        expect((await page.locator('#lesson-say').innerText()).length).toBeGreaterThan(30);
        expect(await axeViolations(page, '#game')).toEqual([]);
      }
      await page.locator(`#choices button[data-v="${r.ans}"]`).click();
      await expect(page.locator('#word')).toHaveText(it.word);
      await expect(page.locator('#sub')).toContainText(`Yes! ${it.pre[0].toUpperCase()}${it.pre.slice(1)} and ${it.root} make ${it.word}.`);
      await expect(page.locator('#sub')).toContainText(it.ex);
      const last = (await said(page)).at(-1)!;
      expect(last).toContain(`${it.word[0].toUpperCase()}${it.word.slice(1)}.`);
      expect(last).toContain(it.ex);
      await page.locator('#more').click();
    }
    await expect(page.locator('#alldone')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('Make the opposite: over many generated rounds, exactly one offered beginning makes the opposite', async ({ page }) => {
  await open(page);
  const D = await data(page);
  const made = await page.evaluate(() => {
    const O = (window as any).YS_OPPOSITES, out: { n: number; q: any }[] = [];
    for (const it of O.prefixes) for (const n of [3, 4]) for (let rep = 0; rep < 10; rep++) out.push({ n, q: O.make.prefix(n, it.root) });
    return out;
  });
  const bad: string[] = [];
  for (const m of made) {
    const it = D.prefixes.find((p) => p.root === m.q.root)!;
    if (m.q.choices.length !== m.n) bad.push(`${it.root}: ${m.q.choices.length} choices`);
    if (m.q.choices.filter((c: string) => c === it.pre).length !== 1 || m.q.ans !== it.pre) bad.push(`${it.root}: right beginning not there once`);
    for (const c of m.q.choices) if (c !== it.pre && (it.avoid.includes(c) || REAL_NOT_WANTED.includes(c + it.root))) bad.push(`${it.root}: offers ${c}${it.root}`);
  }
  expect(bad.slice(0, 20)).toEqual([]);
});

/* ---------- across the page ---------- */

test('no repeats in a visit: Word opposites, Make the opposite and Find the opposite never ask the same word twice until the list is used up', async ({ page }) => {
  await open(page, 12);
  for (const [g, rounds, sets] of [['words', 10, 3], ['prefix', 8, 3], ['find', 8, 2]] as [string, number, number][]) {
    await page.locator(`#play-${g}`).click();
    const asked: string[] = [];
    for (let s = 0; s < sets; s++) {
      for (let k = 0; k < rounds; k++) {
        const r = await current(page);
        // Find the opposite: a pair counts once whichever side is shown ("short" belongs to two pairs, so it is the pair that counts).
        asked.push(g === 'find' && r.kind === 'pair' ? [r.word, r.ans].sort().join('/') : `${r.kind ?? ''}:${r.word}`);
        await page.locator(`#choices button[data-v="${r.ans}"]`).click();
        await page.locator('#more').click();
      }
      await expect(page.locator('#alldone')).toBeVisible();
      if (s < sets - 1) await page.locator('#keep').click();
    }
    expect(asked.filter((w, i) => asked.indexOf(w) !== i), g).toEqual([]);
    await page.locator('#stop').click();
  }
});

test('the word games load nothing from other sites, store nothing without a profile, pass the accessibility scan and fit 320 px', async ({ page, context }) => {
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await open(page);
  await expect(page.locator('#play-words')).toContainText('Word opposites');
  await expect(page.locator('#play-prefix')).toContainText('Make the opposite');
  await expect(page.locator('#level-note')).toContainText('Word opposites shows 3 words');
  await expect(page.locator('#level-note')).toContainText('Make the opposite is for ages 7 and up');
  expect(await page.locator('meta[name="description"]').getAttribute('content')).toMatch(/ages 3 to 12/);
  await page.setViewportSize({ width: 320, height: 700 });
  for (const g of ['words', 'prefix']) {
    await page.locator(`#play-${g}`).click();
    for (let k = 0; k < 3; k++) {
      expect(await axeViolations(page, '#game')).toEqual([]);
      expect(await horizontalOverflow(page), `${g} at 320 px`).toBeLessThanOrEqual(1);
      for (const b of await page.locator('#choices button').all()) {
        const box = (await b.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(47.5);
        expect(box.height).toBeGreaterThanOrEqual(47.5);
      }
      const r = await current(page);
      await page.locator(`#choices button[data-v="${r.ans}"]`).click();
      expect(await axeViolations(page, '#game')).toEqual([]);
      expect(await horizontalOverflow(page), `${g} at 320 px after a win`).toBeLessThanOrEqual(1);
      await page.locator('#more').click();
    }
    await page.locator('#exit').click();
  }
  await page.waitForLoadState('networkidle');
  expect(reqs.external(ORIGIN)).toEqual([]);
  expect(reqs.sending()).toEqual([]);
  const s = await storedData(page, context);
  expect(s.local).toEqual([]);
  expect(s.session.filter((k) => !/^ys-rest/.test(k))).toEqual([]);
  expect(s.cookies).toEqual([]);
  expect(errors).toEqual([]);
});

test('with an age 6 profile, each right answer in the word games is one English point, once per round', async ({ page }) => {
  await open(page, 6);
  for (const g of ['words', 'prefix']) {
    await page.locator(`#play-${g}`).click();
    const r = await current(page);
    const wrong = (r.choices as string[]).find((c) => c !== r.ans)!;
    await page.locator(`#choices button[data-v="${wrong}"]`).click();
    await page.locator(`#choices button[data-v="${r.ans}"]`).click();
    await expect(page.locator('#sub')).toHaveClass(/\byes\b/);
    await page.locator('#exit').click();
  }
  expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(['sprouts:points', 'ys-profile']);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('sprouts:points')))!)).toEqual({ maths: 0, english: 2, world: 0 });
});
