import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';

// Big and small (compare.html) and Opposites (opposites.html). Manish, 23 Nov 2026: "Add the compare like small / big
// numbers, small balloon vs big balloon like questions or which one is smaller. a cup or a bucket like graphical
// questions. Also add opposites along with the graphical representation. In between give the example of the words
// which are not properties, like Plastic. There is no opposite of word Plastic. Explain why like that."
// Both are "learn, then play" pages for ages 3 to 8. Each game fits the age in the profile ("ys-profile", read only),
// and sits in the middle with none. Every round must have exactly one right answer: that is checked here with the
// test's own logic (its own real-life sizes and its own table of opposites), not by asking the page.

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); };`;

type PageId = 'compare' | 'opposites';
const PAGES: Record<PageId, { title: string; h1: string; parts: number; area: 'maths' | 'english'; games: Record<string, string> }> = {
  compare: { title: 'Big and small | Yaanstep', h1: 'Big and small', parts: 5, area: 'maths', games: { size: 'Big or small?', real: 'Which is smaller?', count: 'More or fewer?', number: 'Bigger number' } },
  opposites: { title: 'Opposites | Yaanstep', h1: 'Opposites', parts: 5, area: 'english', games: { find: 'Find the opposite', pairs: 'Opposites or not?' } },
};
const PAGE_IDS = Object.keys(PAGES) as PageId[];
/** Words the pages must never use (wording rules for Yaanstep Sprouts, and the site-wide list). */
const BANNED = [/therap/i, /treatment/i, /diagnos/i, /special needs/i, /\bproven\b/i, /clinical/i, /\bIQ\b/, /brain training/i, /improves?\b/i, /\bboosts?\b/i,
  /suitable for/i, /fully accessible/i, /dyslexi/i, /autis/i, /\bADHD\b/, /\bADD\b/, /down syndrome/i, /hearing loss/i, /low vision/i, /\bblind/i, /\bdeaf/i,
  /dyspraxi/i, /dyscalculi/i, /cerebral palsy/i, /epilep/i, /asperger/i, /\bSEND?\b/, /disorder/i, /impair/i, /\bcures?\b/i, /samples only/i,
  /\b(endless|unlimited|thousands of|hundreds of)\b/i];

async function open(page: Page, id: PageId, age = 0, comfort: string[] = []) {
  await page.addInitScript(VOICE);
  if (age || comfort.length) {
    await page.addInitScript((p) => localStorage.setItem('ys-profile', JSON.stringify(p)), { ...(age ? { age, color: 0, nick: '' } : {}), ...(comfort.length ? { comfort } : {}) });
  }
  await page.goto(`/${id}.html`);
}
const current = (page: Page) => page.evaluate(() => (window as any).YS_SHELL.current());
/** 0 for ages 3 and 4, 1 for 5 and 6 and with no profile, 2 for 7 and up (the brief's age bands). */
const lvOf = (age: number) => (!age ? 1 : age <= 4 ? 0 : age <= 6 ? 1 : 2);
const GROUP_MAX = [5, 10, 20];
const NUMBER_MAX = [10, 20, 100];

/* ---------- the test's own answer logic ---------- */
/** About how big each thing is in real life (cm). The test's own table, so the page cannot mark itself right. */
const REAL_CM: Record<string, number> = { ant: 0.5, bee: 1.5, egg: 6, apple: 8, mouse: 9, cup: 10, spoon: 16, pencil: 18, ball: 22, bucket: 30, watermelon: 35, cat: 45,
  dog: 60, chair: 90, bathtub: 160, cow: 220, bed: 200, car: 400, elephant: 600, house: 1000, bus: 1100 };
/** Opposites by the word shown. "short" has two: tall and long. */
const OPP_PAIRS = [['big', 'small'], ['hot', 'cold'], ['full', 'empty'], ['tall', 'short'], ['fast', 'slow'], ['happy', 'sad'], ['up', 'down'], ['open', 'closed'], ['wet', 'dry'],
  ['day', 'night'], ['long', 'short'], ['heavy', 'light'], ['loud', 'quiet'], ['in', 'out'], ['old', 'new'], ['clean', 'dirty'], ['on', 'off']];
const OPP: Record<string, string[]> = {};
for (const [a, b] of OPP_PAIRS) { (OPP[a] ??= []).push(b); (OPP[b] ??= []).push(a); }
/** Words with no opposite: what a thing is made of, and names of things. */
const NO_OPP = ['plastic', 'wood', 'glass', 'paper', 'metal', 'wool', 'apple', 'chair', 'dog', 'tree'];

function compareProblems(game: string, q: any, lv: number): string[] {
  const out: string[] = [];
  const one = (right: string[], label: string) => {
    if (right.length !== 1) out.push(`${label}: ${right.length} right answers (${right.join(', ')})`);
    else if (right[0] !== String(q.ans)) out.push(`${label}: page says ${q.ans}, the test says ${right[0]}`);
  };
  const want = (big: boolean, xs: { id: string; v: number }[]) => {
    const best = big ? Math.max(...xs.map((x) => x.v)) : Math.min(...xs.map((x) => x.v));
    return xs.filter((x) => x.v === best).map((x) => x.id);
  };
  if (game === 'size') {
    const n = lv === 2 ? 3 : 2, it = q.items as { id: string; scale: number }[];
    if (it.length !== n) out.push(`size: ${it.length} sizes at level ${lv}`);
    const s = it.map((x) => x.scale).sort((a, b) => a - b);
    if (s.some((v, i) => i && v - s[i - 1] < 0.1)) out.push(`size: two sizes too close (${s.join(', ')})`);
    if (!(n === 2 ? ['bigger', 'smaller'] : ['biggest', 'smallest']).includes(q.ask)) out.push(`size: asks ${q.ask} with ${n}`);
    one(want(/^big/.test(q.ask), it.map((x) => ({ id: x.id, v: x.scale }))), 'size');
  }
  if (game === 'real') {
    const it = q.items as { id: string; scale: number }[], n = lv === 2 ? 3 : 2;
    if (it.length !== n) out.push(`real: ${it.length} things at level ${lv}`);
    if (it.some((x) => !(x.id in REAL_CM))) return [`real: a thing the test does not know: ${it.map((x) => x.id).join(', ')}`];
    const cm = it.map((x) => REAL_CM[x.id]).sort((a, b) => a - b);
    if (cm.some((v, i) => i && v < 2 * cm[i - 1])) out.push(`real: two things too close in real life (${it.map((x) => x.id).join(', ')})`);
    one(want(/^big/.test(q.ask), it.map((x) => ({ id: x.id, v: REAL_CM[x.id] }))), 'real');
    // "same": drawn the same size on purpose. "flip": the smaller real thing drawn bigger. "true": drawn the real way round.
    const byReal = it.slice().sort((a, b) => REAL_CM[a.id] - REAL_CM[b.id]).map((x) => x.scale);
    if (q.mode === 'same' && new Set(byReal).size !== 1) out.push('real: "same" round not drawn the same size');
    if (q.mode === 'true' && byReal.some((v, i) => i && v <= byReal[i - 1])) out.push('real: "true" round not drawn small to big');
    if (q.mode === 'flip' && byReal.some((v, i) => i && v >= byReal[i - 1])) out.push('real: "flip" round not drawn big to small');
  }
  if (game === 'count') {
    const g = q.groups as { id: string; n: number }[];
    if (g.length !== 2 || g[0].n === g[1].n) out.push(`count: groups ${g.map((x) => x.n).join(' and ')}`);
    if (g.some((x) => x.n < 1 || x.n > GROUP_MAX[lv])) out.push(`count: a group above ${GROUP_MAX[lv]} at level ${lv}`);
    one(want(q.ask === 'more', g.map((x) => ({ id: x.id, v: x.n }))), 'count');
  }
  if (game === 'number') {
    const v = q.values as number[], n = lv === 2 ? 3 : 2;
    if (v.length !== n || new Set(v).size !== n) out.push(`number: values ${v.join(', ')}`);
    if (v.some((x) => x < 1 || x > NUMBER_MAX[lv])) out.push(`number: a value above ${NUMBER_MAX[lv]} at level ${lv}`);
    if (q.counters !== Math.max(...v) <= 10) out.push('number: counters shown when they should not be, or not shown');
    one(want(/^big/.test(q.ask), v.map((x) => ({ id: String(x), v: x }))), 'number');
  }
  return out;
}

/** labels: what each choice says on its tile. */
function oppositeProblems(game: string, q: any, labels: Record<string, string>, pics?: number): string[] {
  const out: string[] = [];
  if (game === 'find') {
    const word: string = q.label, choices: string[] = q.choices;
    const right = choices.filter((id) => id === 'none' ? !OPP[word] : (OPP[word] ?? []).includes(labels[id]));
    if (!OPP[word] && !NO_OPP.includes(word)) out.push(`find: the test does not know the word ${word}`);
    if (right.length !== 1) out.push(`find ${word}: ${right.length} right answers (${right.map((id) => labels[id]).join(', ')})`);
    else if (right[0] !== q.ans) out.push(`find ${word}: page says ${q.ans}, the test says ${right[0]}`);
    const said = choices.map((id) => labels[id]);
    if (new Set(said).size !== said.length) out.push(`find ${word}: two tiles say the same word (${said.join(', ')})`);
    if (said.includes(word)) out.push(`find ${word}: the word itself is a choice`);
    if (q.kind === 'none' && !choices.includes('none')) out.push(`find ${word}: no "No opposite!" tile`);
    if (pics && choices.filter((id) => id !== 'none').length !== pics) out.push(`find ${word}: ${choices.filter((id) => id !== 'none').length} pictures, want ${pics}`);
  }
  if (game === 'pairs') {
    const yes = (OPP[q.la] ?? []).includes(q.lb);
    if (q.ans !== (yes ? 'yes' : 'no')) out.push(`pairs ${q.la} and ${q.lb}: page says ${q.ans}`);
    if (q.la === q.lb) out.push('pairs: the same word twice');
  }
  return out;
}

/** Answers the round on screen correctly. */
async function answer(page: Page) {
  const r = await current(page);
  await page.locator(`#choices button[data-v="${r.ans}"]`).click();
}
/** Makes one wrong tap on the round on screen. */
async function missOnce(page: Page, prefer?: string) {
  const r = await current(page);
  const choices = (r.choices as string[]).map(String);
  const wrong = prefer && prefer !== r.ans && choices.includes(prefer) ? prefer : choices.find((c) => !r.right.map(String).includes(c))!;
  await page.locator(`#choices button[data-v="${wrong}"]`).click();
  return wrong;
}

for (const id of PAGE_IDS) {
  const P = PAGES[id], GAMES = Object.keys(P.games);

  test(`${P.h1}: loads with no errors, nothing from other sites, nothing stored, passes the accessibility scan, fits 320 px`, async ({ page, context }) => {
    const errors = watchErrors(page);
    const reqs = watchRequests(page);
    await open(page, id);
    await expect(page.locator('h1')).toHaveText(P.h1);
    await expect(page).toHaveTitle(P.title);
    await expect(page.locator('#menu .step')).toHaveCount(GAMES.length + 1);
    for (const g of GAMES) await expect(page.locator(`#play-${g}`)).toContainText(P.games[g]);
    const note = await page.locator('.note').first().innerText();
    expect(note).toMatch(/ages 3 to 8/i);
    expect(note).toMatch(/free/i);
    expect(note).toMatch(/Not a replacement for school/);
    expect(note).toMatch(/only points are kept on this device/i);
    await expect(page.locator('body')).not.toContainText(/samples only/i);
    await expect(page.locator('#level-note')).toContainText('set in the middle');
    expect(await axeViolations(page)).toEqual([]);
    await page.setViewportSize({ width: 320, height: 700 });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await page.locator(`#play-${GAMES[0]}`).click();
    await answer(page);
    await page.waitForLoadState('networkidle');
    expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
    expect(reqs.sending()).toEqual([]);
    const s = await storedData(page, context);
    expect(s.local).toEqual([]);
    expect(s.session.filter((k) => !/^ys-rest/.test(k))).toEqual([]); // the shared break timer (profile.js) may count play time for this visit
    expect(s.cookies).toEqual([]);
    expect(errors).toEqual([]);
  });

  test(`${P.h1} is linked from the Yaanstep Sprouts page`, async ({ page }) => {
    await page.goto('/sprouts.html');
    await page.locator(`a[href="${id}.html"]`).first().click();
    await expect(page.locator('h1')).toHaveText(P.h1);
  });

  test(`${P.h1}: the wording is plain and kind, with no claims and none of the banned words`, async ({ page }) => {
    await open(page, id);
    const texts = [await page.locator('main').innerText(), await page.title(), (await page.locator('meta[name="description"]').getAttribute('content')) ?? ''];
    const inGames: string[] = [];
    await page.locator('#play-learn').click();
    for (let i = 0; i < P.parts; i++) { texts.push(await page.locator('#area').innerText()); if (i < P.parts - 1) await page.locator('#nextpart').click(); }
    for (const g of GAMES) {
      await page.locator(`[data-go="${g}"]`).click();
      await missOnce(page);
      await page.locator('#howbtn').click();
      inGames.push(await page.locator('#game').innerText());
      await answer(page);
      inGames.push(await page.locator('#sub').innerText());
      await page.locator('#exit').click();
      await page.locator('#play-learn').click();
      for (let i = 0; i < P.parts - 1; i++) await page.locator('#nextpart').click();
    }
    texts.push(...(await page.evaluate(() => (window as any).__said as string[])));
    const all = [...texts, ...inGames].join('\n');
    for (const bad of BANNED) expect.soft(all, `banned: ${bad}`).not.toMatch(bad);
    // Inside the games: no losing, no scores, no rush. ("fast" and "slow" are words in the opposites game itself.)
    expect(inGames.join('\n')).not.toMatch(/\b(wrong|incorrect|lose|lost|score|points|timer|hurry|seconds)\b/i);
    expect(all).not.toMatch(/undefined|NaN|\[object/);
  });

  test(`${P.h1}: the lesson has ${P.parts} parts, each with a moving picture that shows in full with reduced motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, id);
    await page.locator('#play-learn').click();
    const said: string[] = [];
    for (let i = 1; i <= P.parts; i++) {
      await expect(page.locator('#count')).toHaveText(`Part ${i} of ${P.parts}`);
      await expect(page.locator('#area svg[role=img]').first()).toBeVisible();
      said.push(await page.locator('#lesson-text').innerText());
      expect(said[i - 1].length).toBeGreaterThan(30);
      const hidden = await page.locator('#area svg .mv-in').evaluateAll((es) => es.filter((e) => getComputedStyle(e).opacity !== '1').length);
      expect(hidden, 'reduced motion shows the finished picture').toBe(0);
      if (i < P.parts) await page.locator('#nextpart').click();
    }
    await expect(page.locator('[data-go]')).toHaveCount(GAMES.length);
    expect(await axeViolations(page, '#game')).toEqual([]);
    const lesson = said.join('\n');
    if (id === 'compare') {
      // The cup and the bucket: a picture can be drawn any size, so think about the real things.
      expect(lesson).toMatch(/any size/);
      expect(lesson).toMatch(/cup and the bucket are drawn the same size/);
      expect(lesson).toMatch(/bucket is much bigger/);
      expect(lesson).toMatch(/more/);
      expect(lesson).toMatch(/fewer/);
    } else {
      expect(lesson).toMatch(/hot and cold are opposites/i);
      // Manish's example, word for word in the lesson: plastic has no opposite, and why.
      expect(lesson).toContain('Plastic tells us what the cup is made of. It is not a way the cup can be, like hot or cold, so it has no opposite.');
      expect(lesson).toMatch(/names of things/i);
    }
  });

  for (const g of GAMES) {
    for (const age of [0, 3, 8]) {
      test(`${P.games[g]}, ${age ? `age ${age}` : 'no profile'}: plays through every round, one right answer each time, teaches on a miss`, async ({ page }) => {
        const errors = watchErrors(page);
        await open(page, id, age);
        await page.locator(`#play-${g}`).click();
        const lv = lvOf(age);
        const noneRounds: number[] = [];
        for (let k = 0; k < 8; k++) {
          await expect(page.locator('#count')).toHaveText(`Round ${k + 1} of 8`);
          await expect(page.locator('#prompt')).toBeFocused();
          const r = await current(page);
          const tiles = await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => ({ v: b.getAttribute('data-v')!, name: b.querySelector('.sr')?.textContent ?? '', items: b.querySelectorAll('.it').length, seen: (b.querySelector('.w, .wordtile')?.textContent ?? (b.textContent ?? '').replace(b.querySelector('.sr')?.textContent ?? '', '')).trim() })));
          expect(tiles.map((t) => t.v).sort()).toEqual((r.choices as string[]).map(String).sort());
          for (const t of tiles) expect(t.name.length, `${g}: tile ${t.v} has a name`).toBeGreaterThan(0);
          if (id === 'compare') {
            expect(compareProblems(g, r.q, lv), JSON.stringify(r.q)).toEqual([]);
            if (g === 'count') for (const grp of r.q.groups) expect(tiles.find((t) => t.v === grp.id)!.items, 'things drawn in the group').toBe(grp.n);
            if (g === 'number' && r.q.counters) for (const v of r.q.values) expect(tiles.find((t) => t.v === String(v))!.items, 'counters under the number').toBe(v);
            if (g === 'real') {
              if (r.q.mode === 'true') await expect(page.locator('#real-hint')).toHaveCount(0);
              else await expect(page.locator('#real-hint')).toContainText('Think about the real things');
              await expect(page.locator('#prompt')).toContainText('in real life');
            }
          } else {
            const labels: Record<string, string> = {};
            for (const t of tiles) labels[t.v] = t.seen;
            const pics = g === 'find' ? (age >= 6 ? 4 : 3) : undefined;
            expect(oppositeProblems(g, r.q, labels, pics), JSON.stringify(r.q)).toEqual([]);
            if (g === 'find') {
              if (r.kind === 'none') noneRounds.push(k);
              await expect(page.locator('#word')).toContainText(r.label);
              await expect(page.locator('#prompt')).toHaveText(`What is the opposite of ${r.label}?`);
            }
          }
          if (k === 0) {
            const tapped = await missOnce(page);
            await expect(page.locator('#sub')).toHaveClass(/try/);
            await expect(page.locator('#sub')).toContainText('You tapped');
            await expect(page.locator(`#choices button[data-v="${tapped}"]`)).toBeDisabled();
            await expect(page.locator('#choices button:focus')).not.toBeDisabled();
            await page.locator('#howbtn').click();
            await expect(page.locator('#lesson h3')).toBeFocused();
            await expect(page.locator('#lesson svg[role=img]').first()).toBeVisible();
            expect((await page.locator('#lesson-say').innerText()).length).toBeGreaterThan(30);
            expect(await axeViolations(page, '#game')).toEqual([]);
          }
          await answer(page);
          await expect(page.locator('#sub')).toContainText('Yes!');
          await expect(page.locator('#howbox')).toBeEmpty();
          await expect(page.locator('#more')).toBeFocused();
          await page.locator('#more').click();
        }
        if (g === 'find') {
          // About 1 round in 4 has no opposite: 2 of 8, never the first, never two in a row.
          expect(noneRounds).toHaveLength(2);
          expect(noneRounds[0]).toBeGreaterThan(0);
          expect(noneRounds[1] - noneRounds[0]).toBeGreaterThan(1);
        }
        await expect(page.locator('#alldone')).toBeVisible();
        await page.locator('#stop').click();
        await expect(page.locator(`#play-${g}`)).toBeFocused();
        expect(errors).toEqual([]);
      });
    }
  }

  test(`${P.h1}: with a profile, each right answer is one ${P.area} point, once per round; nothing else is stored`, async ({ page }) => {
    await open(page, id, 5);
    for (const g of GAMES) {
      await page.locator(`#play-${g}`).click();
      await missOnce(page);
      await answer(page);
      await expect(page.locator('#sub')).toHaveClass(/\byes\b/);
      await page.locator('#exit').click();
    }
    expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(['sprouts:points', 'ys-profile']);
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('sprouts:points')))!)).toEqual({ maths: 0, english: 0, world: 0, [P.area]: GAMES.length });
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('ys-profile')))!)).toEqual({ age: 5, color: 0, nick: '' });
  });

  test(`${P.h1}: every button is at least 48 by 48 px and nothing scrolls sideways at 320 px`, async ({ page }) => {
    await open(page, id, 8);
    await page.setViewportSize({ width: 320, height: 700 });
    for (const g of ['learn', ...GAMES]) {
      await page.locator(`#play-${g}`).click();
      for (const b of await page.locator('button:visible').all()) {
        const box = (await b.boundingBox())!;
        expect(box.width, `${g}: ${await b.innerText()}`).toBeGreaterThanOrEqual(47.5);
        expect(box.height, `${g}: ${await b.innerText()}`).toBeGreaterThanOrEqual(47.5);
      }
      expect(await horizontalOverflow(page), `${g} at 320 px`).toBeLessThanOrEqual(1);
      await page.locator('#exit').click();
    }
  });

  test(`${P.h1}: choices are named for screen readers by their own words, with the drawing hidden`, async ({ page }) => {
    await open(page, id);
    for (const g of GAMES) {
      await page.locator(`#play-${g}`).click();
      const info = await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => ({
        sr: b.querySelector('.sr')?.textContent ?? '', label: b.getAttribute('aria-label'),
        drawn: [...b.querySelectorAll('svg')].every((s) => s.closest('[aria-hidden="true"]') !== null),
      })));
      for (const i of info) {
        expect(i.label, g).toBeNull();
        expect(i.sr.length, g).toBeGreaterThan(0);
        expect(i.drawn, g).toBe(true);
      }
      expect(await axeViolations(page, '#game')).toEqual([]);
      await page.locator('#exit').click();
    }
  });

  test(`${P.h1}: with "Fewer choices", every round shows two tiles and exactly one is right`, async ({ page }) => {
    await open(page, id, 8, ['fewer']);
    for (const g of GAMES) {
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
}

/* ---------- Big and small ---------- */

test('Big and small: every round has exactly one right answer, over many generated rounds for every level', async ({ page }) => {
  await open(page, 'compare');
  const made = await page.evaluate(() => {
    const C = (window as any).YS_COMPARE, out: { game: string; lv: number; q: any }[] = [];
    for (const lv of [0, 1, 2]) for (const st of [0, 1, 2]) for (let rep = 0; rep < 60; rep++) {
      out.push({ game: 'size', lv, q: C.make.size(lv, st) });
      out.push({ game: 'real', lv, q: C.make.real(lv, st) });
      out.push({ game: 'count', lv, q: C.make.count(lv, st) });
      out.push({ game: 'number', lv, q: C.make.number(lv, st) });
    }
    return out;
  });
  expect(made.length).toBe(3 * 3 * 60 * 4);
  const bad = made.flatMap((m) => compareProblems(m.game, m.q, m.lv).map((p) => `level ${m.lv}: ${p}`));
  expect(bad.slice(0, 20)).toEqual([]);
  // The pictures in "Which is smaller?" are sometimes drawn the same size on purpose, at every level, and the wrong way round from age 5.
  const modes = new Set(made.filter((m) => m.game === 'real').map((m) => `${m.lv}:${m.q.mode}`));
  for (const k of ['0:same', '0:true', '1:same', '1:flip', '2:same', '2:flip']) expect(modes, k).toContain(k);
  // Cup and bucket is one of the pairs.
  expect(made.some((m) => m.game === 'real' && m.q.items.map((i: any) => i.id).sort().join() === 'bucket,cup')).toBe(true);
  // Both questions are asked: bigger and smaller, more and fewer.
  const asks = new Set(made.map((m) => `${m.game}:${m.q.ask}`));
  for (const k of ['size:bigger', 'size:smaller', 'size:biggest', 'size:smallest', 'real:smaller', 'real:bigger', 'count:more', 'count:fewer', 'number:bigger', 'number:smallest']) expect(asks, k).toContain(k);
});

test('Big and small: the age sets the level: groups up to 5, 10 or 20 and numbers up to 10, 20 or 100', async ({ page }) => {
  await open(page, 'compare');
  const got = await page.evaluate(() => { const C = (window as any).YS_COMPARE; return [0, 3, 4, 5, 6, 7, 8].map((a) => C.level(a)); });
  expect(got).toEqual([1, 0, 0, 1, 1, 2, 2]);
  expect(await page.evaluate(() => [(window as any).YS_COMPARE.groupMax, (window as any).YS_COMPARE.numberMax])).toEqual([GROUP_MAX, NUMBER_MAX]);
  await open(page, 'compare', 7);
  await expect(page.locator('#level-note')).toContainText('age 7');
  await expect(page.locator('#level-note')).toContainText('up to 20');
  await expect(page.locator('#level-note')).toContainText('up to 100');
});

test('Big and small: no round repeats the one before it', async ({ page }) => {
  await open(page, 'compare', 5);
  for (const g of ['size', 'real', 'count', 'number']) {
    await page.locator(`#play-${g}`).click();
    let last = '';
    for (let k = 0; k < 8; k++) {
      const q = (await current(page)).q;
      const key = g === 'size' || g === 'count' ? q.thing : g === 'real' ? q.items.map((i: any) => i.id).sort().join() : q.values.slice().sort().join();
      expect(key, `${g} round ${k + 1}`).not.toBe(last);
      last = key;
      await answer(page);
      await page.locator('#more').click();
    }
    await page.locator('#stop').click();
  }
});

test('Which is smaller?: a miss says which is smaller in real life, and the lesson says a picture can be drawn any size', async ({ page }) => {
  await open(page, 'compare', 4);
  await page.locator('#play-real').click();
  const r = await current(page);
  const wrong = await missOnce(page);
  const small = r.q.order[0], big = r.q.order[r.q.order.length - 1];
  await expect(page.locator('#sub')).toContainText(`You tapped the ${wrong}. In real life`);
  await expect(page.locator('#sub')).toContainText(r.q.ask === 'smaller' ? `${small} is smaller than` : `${big} is bigger than`);
  await page.locator('#howbtn').click();
  await expect(page.locator('#lesson-say')).toContainText('A picture can be drawn any size');
});

/* ---------- Opposites ---------- */

test('Opposites: every round has exactly one right answer, over many generated rounds for every level', async ({ page }) => {
  await open(page, 'opposites');
  const made = await page.evaluate(() => {
    const O = (window as any).YS_OPPOSITES, out: { game: string; lv: number; n: number; q: any }[] = [];
    for (const lv of [0, 1, 2]) for (const n of [3, 4]) for (let rep = 0; rep < 80; rep++) {
      out.push({ game: 'find', lv, n, q: O.make.find(lv, n, 'pair', null, rep % 2 === 0) });
      out.push({ game: 'find', lv, n, q: O.make.find(lv, n, 'none') });
      out.push({ game: 'pairs', lv, n, q: O.make.pairs(lv, rep % 2 === 0) });
    }
    return { out, labels: O.labels as Record<string, string> };
  });
  const labels: Record<string, string> = { ...made.labels, none: 'No opposite!' };
  const bad = made.out.flatMap((m) => {
    const l: Record<string, string> = { ...labels };
    for (const id of m.q.choices ?? []) l[id] ??= id;
    return oppositeProblems(m.game, m.q, l, m.game === 'find' ? m.n : undefined).map((p) => `level ${m.lv}: ${p}`);
  });
  expect(bad.slice(0, 20)).toEqual([]);
  // Every word with no opposite turns up, plastic first among them, and "No opposite!" is also offered in rounds where it is not right.
  const noneWords = new Set(made.out.filter((m) => m.q.kind === 'none').map((m) => m.q.word));
  for (const w of NO_OPP) expect(noneWords, w).toContain(w);
  expect(made.out.some((m) => m.q.kind === 'pair' && m.q.choices.includes('none'))).toBe(true);
  // "short" is asked both ways, and "long" is never a wrong choice for it (both are opposites of short).
  expect(made.out.filter((m) => m.game === 'find' && m.q.label === 'short').length).toBeGreaterThan(0);
});

test('Opposites: the age sets the choices: 3 pictures up to age 5, 4 from age 6', async ({ page }) => {
  await open(page, 'opposites');
  const got = await page.evaluate(() => { const O = (window as any).YS_OPPOSITES; return [0, 3, 4, 5, 6, 7, 8].map((a) => O.choiceCount(a)); });
  expect(got).toEqual([3, 3, 3, 3, 4, 4, 4]);
  for (const [age, pics] of [[4, 3], [6, 4]]) {
    await open(page, 'opposites', age);
    await expect(page.locator('#level-note')).toContainText(`shows ${pics} pictures`);
    await page.locator('#play-find').click();
    const r = await current(page);
    expect((r.choices as string[]).filter((c) => c !== 'none')).toHaveLength(pics);
  }
});

test('Opposites: a word with no opposite shows its picture, the big "No opposite!" tile, and says why', async ({ page }) => {
  await open(page, 'opposites', 6);
  await page.locator('#play-find').click();
  let seen = 0;
  for (let k = 0; k < 8; k++) {
    const r = await current(page);
    if (r.kind === 'none') {
      seen++;
      expect(NO_OPP).toContain(r.label);
      await expect(page.locator('#word svg[role=img]')).toBeVisible();
      const none = page.locator('#choices button[data-v="none"]');
      await expect(none).toHaveClass(/none-tile/);
      await expect(none).toContainText('No opposite!');
      // A picture tap first: it says what that word is the opposite of, and what this word is.
      const wrong = await missOnce(page);
      await expect(page.locator('#sub')).toContainText(`You tapped ${r.labels[wrong]}.`);
      await expect(page.locator('#sub')).toContainText(new RegExp(`${r.label[0].toUpperCase()}${r.label.slice(1)} (tells us what the \\w+ is made of|is the name of a thing)`));
      await none.click();
      const said = await page.evaluate(() => (window as any).__said as string[]);
      expect(said[said.length - 1]).toMatch(/has no opposite\.$/);
      await expect(page.locator('#sub')).toContainText(/made of|name of a thing/);
    } else await answer(page);
    await page.locator('#more').click();
  }
  expect(seen).toBe(2);
});

test('Opposites: tapping "No opposite!" for a word that has one explains that it does have one', async ({ page }) => {
  await open(page, 'opposites', 5);
  await page.locator('#play-find').click();
  // "No opposite!" is offered in about half of the other rounds; play on until one turns up.
  for (let k = 0; k < 40; k++) {
    const r = await current(page);
    if (r.kind === 'pair' && (r.choices as string[]).includes('none')) {
      await page.locator('#choices button[data-v="none"]').click();
      await expect(page.locator('#sub')).toHaveClass(/try/);
      await expect(page.locator('#sub')).toContainText(`But ${r.label} does have an opposite: ${r.labels[r.ans]}.`);
      return;
    }
    await answer(page);
    await page.locator('#more').click();
    if (await page.locator('#alldone').isVisible()) await page.locator('#keep').click();
  }
  throw new Error('"No opposite!" was never offered in a round where the word has an opposite');
});

test('Opposites: the plan of rounds with no opposite is about 1 in 4, never the first and never two in a row', async ({ page }) => {
  await open(page, 'opposites');
  const plans = await page.evaluate(() => Array.from({ length: 300 }, () => (window as any).YS_OPPOSITES.planNone(8) as number[]));
  for (const p of plans) {
    expect(p).toHaveLength(2);
    expect(p[0]).toBeGreaterThan(0);
    expect(p[1]).toBeLessThan(8);
    expect(p[1] - p[0]).toBeGreaterThan(1);
  }
});
