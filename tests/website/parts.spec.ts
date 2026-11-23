import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';

// Fractions, decimals and percent (parts.html). Manish, 23 Nov 2026: "Also add another section under maths where it can
// help to understand decimals, %, what is 2/3 of 100, tip calculation like things, portions along with graphics also
// explain realistic examples like pizza, pie etc." A "learn, then play" page for ages 7 to 12 with six games.
// Every round must have exactly one right answer: that is checked with the test's own maths (from the numbers in the
// round), not by asking the page. A miss must draw the child's answer on the same picture as the answer we want, and a
// right answer must fill in the "?". The age in the profile ("ys-profile", read only) sets the difficulty.

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); };`;

const GAMES: Record<string, string> = {
  pizza: 'Pizza and pie portions',
  of: 'A fraction of a number',
  dec: 'Decimals',
  pct: 'Percent',
  match: 'Same amount, three ways',
  life: 'Real life: tips, sales and sharing',
};
const GAME_IDS = Object.keys(GAMES);
const PARTS = 7;
/** Words the page must never use (wording rules for Yaanstep Sprouts, and the site-wide list). */
const BANNED = [/therap/i, /treatment/i, /diagnos/i, /special needs/i, /\bproven\b/i, /clinical/i, /\bIQ\b/, /brain training/i, /improves?\b/i, /\bboosts?\b/i,
  /suitable for/i, /fully accessible/i, /dyslexi/i, /autis/i, /\bADHD\b/, /\bADD\b/, /down syndrome/i, /hearing loss/i, /low vision/i, /\bblind/i, /\bdeaf/i,
  /dyspraxi/i, /dyscalculi/i, /cerebral palsy/i, /epilep/i, /asperger/i, /\bSEND?\b/, /disorder/i, /impair/i, /\bcures?\b/i, /samples only/i,
  /\b(endless|unlimited|thousands of|hundreds of)\b/i];
/** No shopping pressure in the real-life money questions. */
const PRESSURE = /\b(hurry|buy now|limited time|deal|bargain|don't miss|last chance|act fast|grab)\b/i;

async function open(page: Page, age = 0, comfort: string[] = []) {
  await page.addInitScript(VOICE);
  if (age || comfort.length) {
    await page.addInitScript((p) => localStorage.setItem('ys-profile', JSON.stringify(p)), { ...(age ? { age, color: 0, nick: '' } : {}), ...(comfort.length ? { comfort } : {}) });
  }
  await page.goto('/parts.html');
}
const current = (page: Page) => page.evaluate(() => (window as any).YS_SHELL.current());

/* ---------- the test's own answers ---------- */
const fv = (s: string) => { const m = /^(\d+)\/(\d+)$/.exec(s); return m ? +m[1] / +m[2] : NaN; };
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
/** The right answer for a round, from its numbers: a value, or a choice id for the compare rounds. */
function rightValue(game: string, kind: string, d: any): number | string {
  switch (`${game}:${kind}`) {
    case 'pizza:left': return (d.d - d.e) / d.d;
    case 'pizza:eaten': return d.e / d.d;
    case 'pizza:share': return d.ask === 'frac' ? 1 / d.n : d.d / d.n;
    case 'pizza:more': return close(fv(d.a), fv(d.b)) ? 'same' : fv(d.a) > fv(d.b) ? d.a : d.b;
    case 'of:of': return (d.k * d.N) / d.d;
    case 'dec:money': return d.cents;
    case 'dec:ruler': case 'dec:line': return d.t / 1000;
    case 'dec:bigger': return close(+d.a, +d.b) ? 'same' : +d.a > +d.b ? d.a : d.b;
    case 'pct:grid': case 'pct:pick': return d.s;
    case 'pct:battery': { const v = fv(d.f) * 100; return close(d.p, v) ? 'same' : d.p > v ? 'more' : 'less'; }
    case 'pct:of': return (d.p * d.N) / 100;
    case 'match:pct': return (d.n * 100) / d.d;
    case 'match:dec': case 'match:frac': return d.n / d.d;
    case 'life:tip': return (d.bill * d.p) / 100;
    case 'life:tip-total': return d.bill + (d.bill * d.p) / 100;
    case 'life:sale': return d.ask === 'off' ? (d.price * d.p) / 100 : d.price - (d.price * d.p) / 100;
    case 'life:sale-two': { const a = d.price - (d.price * d.p) / 100; return a - (a * d.p2) / 100; }
    case 'life:split': case 'life:split-tip': return (d.bill + (d.bill * d.tip) / 100) / d.n;
  }
  throw new Error(`the test has no answer for ${game}:${kind}`);
}
/** Choice ids: fractions "3/8", numbers, cents, decimals, or the words more, less and same. */
const valueOf = (id: string) => (['same', 'more', 'less'].includes(id) ? NaN : /\//.test(id) ? fv(id) : +id);
function problems(game: string, q: { kind: string; data: any; ans: string; choices: string[]; key: string }): string[] {
  const out: string[] = [];
  const want = rightValue(game, q.kind, q.data);
  const right = q.choices.filter((c) => (typeof want === 'string' ? c === want : close(valueOf(c), want)));
  if (right.length !== 1) out.push(`${q.key}: ${right.length} right answers among ${q.choices.join(', ')} (want ${want})`);
  else if (right[0] !== q.ans) out.push(`${q.key}: the page says ${q.ans}, the test says ${right[0]}`);
  if (new Set(q.choices).size !== q.choices.length) out.push(`${q.key}: the same choice twice`);
  if (q.choices.length < 3 || q.choices.length > 4) out.push(`${q.key}: ${q.choices.length} choices`);
  return out;
}

/** Answers the round on screen correctly. */
async function answer(page: Page) {
  const r = await current(page);
  await page.locator(`#choices button[data-v="${r.ans}"]`).click();
}
/** Makes one wrong tap on the round on screen and returns what was tapped. */
async function missOnce(page: Page) {
  const r = await current(page);
  const wrong = (r.choices as string[]).find((c) => c !== r.ans)!;
  await page.locator(`#choices button[data-v="${wrong}"]`).click();
  return wrong;
}

test('Fractions, decimals and percent: loads with no errors, nothing from other sites, nothing stored, passes the accessibility scan, fits 320 px', async ({ page, context }) => {
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await open(page);
  await expect(page.locator('h1')).toHaveText('Fractions, decimals and percent');
  await expect(page).toHaveTitle('Fractions, decimals and percent | Yaanstep');
  await expect(page.locator('#menu .step')).toHaveCount(GAME_IDS.length + 1);
  for (const g of GAME_IDS) await expect(page.locator(`#play-${g}`)).toContainText(GAMES[g]);
  const note = await page.locator('.note').first().innerText();
  expect(note).toMatch(/ages 7 to 12/i);
  expect(note).toMatch(/free/i);
  expect(note).toMatch(/Not a replacement for school/);
  expect(note).toMatch(/only points are kept on this device/i);
  await expect(page.locator('body')).not.toContainText(/samples only/i);
  await expect(page.locator('#level-note')).toContainText('set in the middle');
  expect(await axeViolations(page)).toEqual([]);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  for (const g of GAME_IDS) {
    await page.locator(`#play-${g}`).click();
    await missOnce(page);
    await answer(page);
    await page.locator('#exit').click();
  }
  await page.waitForLoadState('networkidle');
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect(reqs.sending()).toEqual([]);
  // No profile: nothing is stored, not even points.
  const s = await storedData(page, context);
  expect(s.local).toEqual([]);
  expect(s.session.filter((k) => !/^ys-rest/.test(k))).toEqual([]); // the shared break timer (profile.js) may count play time for this visit
  expect(s.cookies).toEqual([]);
  expect(errors).toEqual([]);
});

test('Fractions, decimals and percent is linked from the Yaanstep Sprouts page', async ({ page }) => {
  await page.goto('/sprouts.html');
  await page.locator('a[href="parts.html"]').first().click();
  await expect(page.locator('h1')).toHaveText('Fractions, decimals and percent');
});

test(`Fractions, decimals and percent: the lesson has ${PARTS} parts, each with a moving picture that shows in full with reduced motion`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await page.locator('#play-learn').click();
  const said: string[] = [];
  for (let i = 1; i <= PARTS; i++) {
    await expect(page.locator('#count')).toHaveText(`Part ${i} of ${PARTS}`);
    await expect(page.locator('#area svg[role=img]').first()).toBeVisible();
    expect(((await page.locator('#area svg[role=img]').first().getAttribute('aria-label')) ?? '').length).toBeGreaterThan(20);
    said.push(await page.locator('#lesson-text').innerText());
    expect(said[i - 1].length).toBeGreaterThan(30);
    const hidden = await page.locator('#area svg .mv-in').evaluateAll((es) => es.filter((e) => getComputedStyle(e).opacity !== '1').length);
    expect(hidden, 'reduced motion shows the finished picture').toBe(0);
    expect(await axeViolations(page, '#game')).toEqual([]);
    if (i < PARTS) await page.locator('#nextpart').click();
  }
  await expect(page.locator('[data-go]')).toHaveCount(GAME_IDS.length);
  const lesson = said.join('\n');
  // Manish's own examples: pizza, two thirds of a number, decimals with money, percent, tips.
  expect(lesson).toMatch(/pizza/);
  expect(lesson).toMatch(/two thirds of 99/i);
  expect(lesson).toContain('$1.25 is 1 dollar and 25 cents');
  expect(lesson).toMatch(/0\.5 is bigger/);
  expect(lesson).toMatch(/35%/);
  expect(lesson).toMatch(/0\.25/);
  expect(lesson).toMatch(/15% tip|For a 15% tip/);
});

for (const g of GAME_IDS) {
  for (const age of [0, 7, 12]) {
    test(`${GAMES[g]}, ${age ? `age ${age}` : 'no profile'}: plays every round, one right answer each time, a picture of the child's answer on a miss, the "?" filled on a win`, async ({ page }) => {
      const errors = watchErrors(page);
      await open(page, age);
      await page.locator(`#play-${g}`).click();
      const keys: string[] = [];
      for (let k = 0; k < 8; k++) {
        await expect(page.locator('#count')).toHaveText(`Round ${k + 1} of 8`);
        await expect(page.locator('#prompt')).toBeFocused();
        const r = await current(page);
        keys.push(r.key);
        expect(problems(g, r), JSON.stringify(r.data)).toEqual([]);
        const tiles = await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => ({ v: b.getAttribute('data-v')!, name: b.querySelector('.sr')?.textContent ?? '' })));
        expect(tiles.map((t) => t.v).sort()).toEqual((r.choices as string[]).slice().sort());
        for (const t of tiles) expect(t.name.length, `${g}: tile ${t.v} has a name`).toBeGreaterThan(0);
        // The question has a picture and a line with a "?".
        await expect(page.locator('#qpic svg[role=img]')).toBeVisible();
        expect(((await page.locator('#qpic svg').getAttribute('aria-label')) ?? '').length).toBeGreaterThan(15);
        await expect(page.locator('#gap')).toHaveText('?');
        await expect(page.locator('#try-pic')).toBeHidden();
        if (k < 2) {
          // A miss: kind words that say what was tapped, and the child's answer drawn on the same picture.
          const tapped = await missOnce(page);
          await expect(page.locator('#sub')).toHaveClass(/try/);
          await expect(page.locator('#try-pic')).toBeVisible();
          const said = (await page.locator('#try-text').innerText()).toLowerCase();
          expect(said).toMatch(/^you (said|picked)/);
          expect(said.includes(tapped.toLowerCase()) || said.includes(String(r.labels[tapped]).toLowerCase()), `${said} names ${tapped}`).toBe(true);
          await expect(page.locator('#try-pic svg[role=img]')).toBeVisible();
          expect(await page.locator('#try-pic svg').getAttribute('aria-label')).toMatch(/your (answer|pick)/i);
          await expect(page.locator('#gap')).toHaveText('?');
          await expect(page.locator(`#choices button[data-v="${tapped}"]`)).toBeDisabled();
          await expect(page.locator('#choices button:focus')).not.toBeDisabled();
          await page.locator('#howbtn').click();
          await expect(page.locator('#lesson h3')).toBeFocused();
          await expect(page.locator('#lesson svg[role=img]').first()).toBeVisible();
          expect((await page.locator('#lesson-say').innerText()).length).toBeGreaterThan(30);
          if (k === 0) expect(await axeViolations(page, '#game')).toEqual([]);
        }
        await answer(page);
        await expect(page.locator('#sub')).toContainText('Yes!');
        expect((await page.locator('#sub').innerText()).length, 'a short why with the right answer').toBeGreaterThan(30);
        // The "?" is filled in with the answer.
        await expect(page.locator('#gap')).toHaveText(r.fill);
        await expect(page.locator('#gap')).not.toHaveText('?');
        await expect(page.locator('#qline')).toHaveText(`${r.line[0]}${r.fill}${r.line[1]}`);
        await expect(page.locator('#try-pic')).toBeHidden();
        await expect(page.locator('#howbox')).toBeEmpty();
        await expect(page.locator('#more')).toBeFocused();
        await page.locator('#more').click();
      }
      // No question comes back in a visit.
      expect(new Set(keys).size, keys.join(' ')).toBe(keys.length);
      await expect(page.locator('#alldone')).toBeVisible();
      await page.locator('#stop').click();
      await expect(page.locator(`#play-${g}`)).toBeFocused();
      expect(errors).toEqual([]);
    });
  }
}

test('Fractions, decimals and percent: every round has exactly one right answer, over many generated rounds at every step', async ({ page }) => {
  await open(page);
  const made = await page.evaluate(() => {
    const P = (window as any).YS_PARTS, out: { game: string; st: number; q: any }[] = [];
    for (const game of Object.keys(P.kinds)) for (const kind of P.kinds[game](0)) for (let st = 0; st <= 4; st++) for (const n of [3, 4]) {
      for (let rep = 0; rep < 40; rep++) out.push({ game, st, q: P.make(game, kind, st, n) });
    }
    return out;
  });
  expect(made.length).toBeGreaterThan(5000);
  const bad = made.flatMap((m) => problems(m.game, m.q).map((p) => `step ${m.st}: ${p}`));
  expect(bad.slice(0, 20)).toEqual([]);
  const text = made.map((m) => `${m.q.text} ${m.q.why} ${m.q.line.join('')}`).join('\n');
  expect(text).not.toMatch(/undefined|NaN|\[object|Infinity/);
  expect(text).not.toMatch(PRESSURE);
  // Every kind of question turns up.
  const kinds = new Set(made.map((m) => `${m.game}:${m.q.kind}`));
  for (const k of ['pizza:left', 'pizza:eaten', 'pizza:share', 'pizza:more', 'of:of', 'dec:money', 'dec:ruler', 'dec:line', 'dec:bigger', 'pct:grid', 'pct:pick', 'pct:battery', 'pct:of',
    'match:pct', 'match:dec', 'match:frac', 'life:tip', 'life:tip-total', 'life:sale', 'life:sale-two', 'life:split', 'life:split-tip']) expect(kinds, k).toContain(k);
  // Manish's examples: 0.5 against 0.45 style rounds, 80% against 3/4 style rounds, and pizza, pie and chocolate.
  expect(made.some((m) => m.q.kind === 'bigger' && /^0\.\d$/.test(m.q.data.a + '') && /^0\.\d\d$/.test(m.q.data.b + '') || m.q.kind === 'bigger' && /^0\.\d\d$/.test(m.q.data.a + '') && /^0\.\d$/.test(m.q.data.b + ''))).toBe(true);
  for (const f of ['pizza', 'pie', 'bar']) expect(made.some((m) => m.q.data.food === f), f).toBe(true);
});

test('Fractions, decimals and percent: age 7 gets friendly numbers, age 12 gets harder ones', async ({ page }) => {
  await open(page);
  const s: Record<string, any[]> = await page.evaluate(() => {
    const P = (window as any).YS_PARTS, r: Record<string, any[]> = {};
    for (const st of [0, 3]) {
      r[`of${st}`] = Array.from({ length: 200 }, () => P.make('of', 'plain', st, 4).data);
      r[`tip${st}`] = Array.from({ length: 200 }, () => P.make('life', 'tip', st, 4).data);
      r[`pct${st}`] = Array.from({ length: 200 }, () => P.make('pct', 'of', st, 4).data);
      r[`match${st}`] = Array.from({ length: 200 }, () => P.make('match', 'pct', st, 4).data);
    }
    return { ...r, base: [0, 5, 7, 8, 9, 10, 11, 12].map((a) => P.base(a)) };
  });
  expect(s.base).toEqual([1, 0, 0, 0, 2, 2, 3, 3]);
  // Ages 7 and 8: halves, quarters and tenths of numbers up to 100; a 10% tip; 10, 25 and 50 percent.
  for (const d of s.of0) { expect([2, 4, 10]).toContain(d.d); expect(d.N).toBeLessThanOrEqual(100); }
  for (const d of s.tip0) expect(d.p).toBe(10);
  for (const d of s.pct0) expect([10, 25, 50]).toContain(d.p);
  for (const d of s.match0) expect([2, 4, 10]).toContain(d.d);
  // Ages 11 and 12: other fractions and bigger numbers, 15% and 18% tips, harder percents.
  expect(s.of3.some((d: any) => ![2, 4, 10].includes(d.d) && d.N > 100)).toBe(true);
  expect(s.tip3.some((d: any) => d.p === 18) && s.tip3.some((d: any) => d.p === 15)).toBe(true);
  expect(s.pct3.some((d: any) => [15, 18, 35].includes(d.p))).toBe(true);
  expect(s.match3.some((d: any) => [8, 20, 25].includes(d.d))).toBe(true);
  // The same game on screen: age 7 starts at the easiest step, age 12 at a hard one.
  for (const [age, step] of [[7, 0], [12, 3]]) {
    await open(page, age);
    await page.locator('#play-of').click();
    const r = await current(page);
    expect(r.step, `age ${age}`).toBe(step);
    if (age === 7) expect([2, 4, 10]).toContain(r.data.d);
    await expect(page.locator('#level-note')).toContainText(`Set for age ${age}`);
    await expect(page.locator('#older-note')).toHaveCount(0);
  }
});

test('Fractions, decimals and percent: two right answers in a row step up, a miss steps back (age 9)', async ({ page }) => {
  await open(page, 9);
  await page.locator('#play-of').click();
  const steps: number[] = [];
  const right = async () => { await answer(page); await page.locator('#more').click(); };
  steps.push((await current(page)).step); await right();
  steps.push((await current(page)).step); await right();
  steps.push((await current(page)).step); await missOnce(page); await right();
  steps.push((await current(page)).step);
  expect(steps).toEqual([2, 2, 3, 2]);
  // Nothing about it is stored.
  expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(['sprouts:points', 'ys-profile']);
});

test('Fractions, decimals and percent: under age 7, a gentle note and only the easiest rounds', async ({ page }) => {
  await open(page, 5);
  await expect(page.locator('#level-note')).toContainText('made for ages 7 and up');
  for (const g of GAME_IDS) {
    await page.locator(`#play-${g}`).click();
    for (let k = 0; k < 3; k++) {
      await expect(page.locator('#older-note')).toContainText('made for ages 7 and up');
      expect((await current(page)).step).toBe(0);
      await answer(page);
      await page.locator('#more').click();
    }
    await page.locator('#exit').click();
  }
});

test('Fractions, decimals and percent: no question comes back in a visit, across games and "Keep playing"', async ({ page }) => {
  await open(page, 10);
  const keys: string[] = [];
  for (const g of ['pizza', 'pct']) {
    await page.locator(`#play-${g}`).click();
    for (let k = 0; k < 16; k++) {
      keys.push((await current(page)).key);
      await answer(page);
      await page.locator('#more').click();
      if (k === 7) await page.locator('#keep').click();
    }
    await page.locator('#stop').click();
  }
  expect(new Set(keys).size, keys.join(' ')).toBe(keys.length);
});

test('Fractions, decimals and percent: with an age 9 profile, each right answer is one maths point, once per round; nothing else is stored', async ({ page }) => {
  await open(page, 9);
  for (const g of GAME_IDS) {
    await page.locator(`#play-${g}`).click();
    await missOnce(page);
    await answer(page);
    await expect(page.locator('#sub')).toHaveClass(/\byes\b/);
    await page.locator('#exit').click();
  }
  expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(['sprouts:points', 'ys-profile']);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('sprouts:points')))!)).toEqual({ maths: GAME_IDS.length, english: 0, world: 0 });
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('ys-profile')))!)).toEqual({ age: 9, color: 0, nick: '' });
});

test('Fractions, decimals and percent: the wording is plain and kind, with no claims, no pressure and none of the banned words', async ({ page }) => {
  await open(page, 10);
  const texts = [await page.locator('main').innerText(), await page.title(), (await page.locator('meta[name="description"]').getAttribute('content')) ?? ''];
  const inGames: string[] = [];
  await page.locator('#play-learn').click();
  for (let i = 0; i < PARTS; i++) { texts.push(await page.locator('#area').innerText()); if (i < PARTS - 1) await page.locator('#nextpart').click(); }
  await page.locator('#exit').click();
  for (const g of GAME_IDS) {
    await page.locator(`#play-${g}`).click();
    for (let k = 0; k < 4; k++) {
      inGames.push(await page.locator('#prompt').innerText());
      await missOnce(page);
      await page.locator('#howbtn').click();
      inGames.push(await page.locator('#game').innerText());
      inGames.push((await page.locator('#try-pic svg').getAttribute('aria-label')) ?? '');
      await answer(page);
      inGames.push(await page.locator('#sub').innerText());
      await page.locator('#more').click();
    }
    await page.locator('#exit').click();
  }
  texts.push(...(await page.evaluate(() => (window as any).__said as string[])));
  const all = [...texts, ...inGames].join('\n');
  for (const bad of BANNED) expect.soft(all, `banned: ${bad}`).not.toMatch(bad);
  expect(all).not.toMatch(PRESSURE);
  // Inside the games: no losing, no scores, no rush.
  expect(inGames.join('\n')).not.toMatch(/\b(wrong|incorrect|lose|lost|score|points|timer|hurry|seconds)\b/i);
  expect(all).not.toMatch(/undefined|NaN|\[object/);
  // He, she and the like are never guessed from a name in the word problems.
  expect(inGames.join('\n')).not.toMatch(/\b(he|she|his|her|him)\b/i);
});

test('Fractions, decimals and percent: every button is at least 44 by 44 px and nothing scrolls sideways at 320 px', async ({ page }) => {
  await open(page, 12);
  await page.setViewportSize({ width: 320, height: 700 });
  for (const g of ['learn', ...GAME_IDS]) {
    await page.locator(`#play-${g}`).click();
    for (let k = 0; k < (g === 'learn' ? 1 : 3); k++) {
      if (g !== 'learn') { await missOnce(page); await page.locator('#howbtn').click(); }
      for (const b of await page.locator('button:visible').all()) {
        const box = (await b.boundingBox())!;
        expect(box.width, `${g}: ${await b.innerText()}`).toBeGreaterThanOrEqual(44);
        expect(box.height, `${g}: ${await b.innerText()}`).toBeGreaterThanOrEqual(44);
      }
      expect(await horizontalOverflow(page), `${g} at 320 px`).toBeLessThanOrEqual(1);
      if (g !== 'learn') { await answer(page); await page.locator('#more').click(); }
    }
    await page.locator('#exit').click();
  }
});

test('Fractions, decimals and percent: playable with the keyboard alone', async ({ page }) => {
  await open(page, 9);
  await page.locator('#play-pct').focus();
  await page.keyboard.press('Enter');
  for (let k = 0; k < 3; k++) {
    await expect(page.locator('#prompt')).toBeFocused();
    const r = await current(page);
    // Tab from the question to the tiles, then on to the right one.
    await page.keyboard.press('Tab');
    for (let i = 0; i < 6; i++) {
      if ((await page.evaluate(() => document.activeElement?.getAttribute('data-v'))) === r.ans) break;
      await page.keyboard.press('Tab');
    }
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-v'))).toBe(r.ans);
    await page.keyboard.press('Enter');
    await expect(page.locator('#sub')).toContainText('Yes!');
    await expect(page.locator('#gap')).toHaveText(r.fill);
    await expect(page.locator('#more')).toBeFocused();
    await page.keyboard.press('Enter');
  }
  // A tile that gets focus from the keyboard reads its name aloud.
  await page.keyboard.press('Tab');
  const said = await page.evaluate(() => (window as any).__said as string[]);
  expect(said[said.length - 1].length).toBeGreaterThan(0);
});

test('Fractions, decimals and percent: with "Fewer choices", every round shows two tiles and exactly one is right', async ({ page }) => {
  await open(page, 8, ['fewer']);
  for (const g of GAME_IDS) {
    await page.locator(`#play-${g}`).click();
    for (let k = 0; k < 8; k++) {
      const r = await current(page);
      const vals = await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-v')!));
      expect(vals, `${g} round ${k + 1}`).toHaveLength(2);
      expect(vals.filter((v) => v === String(r.ans)), `${g} round ${k + 1}`).toHaveLength(1);
      await answer(page);
      await page.locator('#more').click();
    }
    await page.locator('#stop').click();
  }
});

test('Fractions, decimals and percent: choices are named for screen readers by their own words, with the drawing hidden', async ({ page }) => {
  await open(page, 10);
  for (const g of GAME_IDS) {
    await page.locator(`#play-${g}`).click();
    for (let k = 0; k < 4; k++) {
      const info = await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => ({
        sr: b.querySelector('.sr')?.textContent ?? '', label: b.getAttribute('aria-label'),
        drawn: [...b.querySelectorAll('svg, .frac, .wordtile')].every((s) => s.closest('[aria-hidden="true"]') !== null),
      })));
      for (const i of info) {
        expect(i.label, g).toBeNull();
        expect(i.sr.length, g).toBeGreaterThan(0);
        expect(i.drawn, g).toBe(true);
      }
      await answer(page);
      await page.locator('#more').click();
    }
    expect(await axeViolations(page, '#game')).toEqual([]);
    await page.locator('#exit').click();
  }
});

test('A fraction of a number: a miss on "What is k/d of N?" draws the bar, the shaded part we want, and the child\'s answer under it', async ({ page }) => {
  await open(page, 10);
  await page.locator('#play-of').click();
  const r = await current(page);
  const tapped = await missOnce(page);
  await expect(page.locator('#try-text')).toContainText(`You said ${tapped}. That is this much of the bar`);
  await expect(page.locator('#try-text')).toContainText(`We want ${r.data.k}/${r.data.d}, this much`);
  const label = (await page.locator('#try-pic svg').getAttribute('aria-label')) ?? '';
  expect(label).toContain(`the whole is ${r.data.N}`);
  expect(label).toContain(`your answer, ${tapped}`);
  // The picture shows the target as a size, not as the number.
  expect(await page.locator('#try-pic svg').innerHTML()).not.toContain(`>${r.ans}<`);
  await answer(page);
  await expect(page.locator('#qline')).toHaveText(`${r.data.k}/${r.data.d} of ${r.data.N} = ${r.ans}`);
});
