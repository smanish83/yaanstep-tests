import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';

// Find the difference (find-difference.html, Manish 23 Nov 2026: "Also add games like find a different. Make sure present
// the difficulties based on the kids age and how they are solving the puzzles."). Ages 3 to 8. A moving lesson, then
// Odd one out (one drawing in a group differs) and Spot the differences (two made-up scenes; the second has 1 to 5 changes).
// The level starts from the age in the profile ("ys-profile", read only): 1 for ages 3 to 4, 2 for 5 to 6 and with no
// profile, 3 for 7 to 8, at most 6. After each round: no missed taps (and no clue) is one level up; 3 or more missed taps,
// or a clue, is one level down. The level lives in memory only. A clue shows after a quiet pause (window.YS_FIND.hintNow()
// gives it at once for tests). Every round must have exactly the answers the page says, checked here with the test's own
// logic, and every listed change in the second picture must really be drawn, with nothing else drawn differently.

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); };`;

const GAMES = ['odd', 'spot'] as const;
type Game = (typeof GAMES)[number];
const NAMES: Record<Game, string> = { odd: 'Odd one out', spot: 'Spot the differences' };
const ROUNDS: Record<Game, number> = { odd: 8, spot: 6 };
/** The first level for each age (0: no profile). */
const START: Record<number, number> = { 0: 2, 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 3 };
/** Pictures in an Odd one out group, and changes in Spot the differences, for levels 1 to 6. */
const GROUP = [3, 4, 5, 6, 8, 9];
const CHANGES = [1, 2, 3, 3, 4, 5];
/** Words the page must never use (this page's wording rules and the site-wide list). */
const BANNED = [/therap/i, /treatment/i, /diagnos/i, /special needs/i, /\bproven\b/i, /clinical/i, /\bIQ\b/, /brain training/i, /improves?\b/i, /\bboosts?\b/i,
  /dyslexi/i, /autis/i, /\bADHD\b/, /\bADD\b/, /down syndrome/i, /hearing loss/i, /low vision/i, /\bblind/i, /\bdeaf/i, /dyspraxi/i, /dyscalculi/i,
  /cerebral palsy/i, /epilep/i, /asperger/i, /\bSEND?\b/, /disorder/i, /impair/i, /\bcures?\b/i, /suitable for/i, /fully accessible/i, /samples only/i,
  /\b\d{2,}\+?\s+(puzzles|games|pictures)\b/i, /\b(endless|unlimited|thousands of)\b/i];

async function open(page: Page, age = 0, comfort: string[] = []) {
  await page.addInitScript(VOICE);
  if (age || comfort.length) {
    await page.addInitScript(([a, c]) => {
      const p: Record<string, unknown> = a ? { age: a, color: 0, nick: '' } : {};
      if (c.length) p.comfort = c;
      localStorage.setItem('ys-profile', JSON.stringify(p));
    }, [age, comfort] as [number, string[]]);
  }
  await page.goto('/find-difference.html');
}
const current = (page: Page) => page.evaluate(() => (window as any).YS_SHELL.current());
const levelOf = (page: Page, g: Game) => page.evaluate((x) => (window as any).YS_FIND.level(x), g);
const hintNow = (page: Page) => page.evaluate(() => (window as any).YS_FIND.hintNow());

/* ---------- the test's own answer logic ---------- */
type Part = { kind: string; color: string; size: string; slot: number };
type Diff = { id: string; type: string; kind: string; slots: number[] };

/** Problems with one Odd one out group; empty when exactly one picture differs, it is the one marked, and only by one feature. */
function oddProblems(q: any, n?: number): string[] {
  const out: string[] = [];
  const items: { id: string; f: Record<string, unknown> }[] = q.items;
  if (n !== undefined && items.length !== n) out.push(`odd: ${items.length} pictures, expected ${n}`);
  if (new Set(items.map((i) => i.id)).size !== items.length) out.push('odd: ids repeat');
  const keys = items.map((i) => JSON.stringify(i.f, Object.keys(i.f).sort()));
  const single = items.filter((_, k) => keys.filter((x) => x === keys[k]).length === 1);
  if (new Set(keys).size !== 2 || single.length !== 1) out.push(`odd: not exactly one different picture (${new Set(keys).size} kinds of picture)`);
  else if (single[0].id !== String(q.ans)) out.push(`odd: page says ${q.ans}, the test says ${single[0].id}`);
  if (single.length === 1 && q.mode !== 'shape') {
    const a = single[0].f, b = items.find((i) => i !== single[0])!.f;
    const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);
    if (changed.length !== 1) out.push(`odd ${q.mode}: ${changed.length} features differ (${changed.join(', ')})`);
  }
  return out;
}

/** The changes between the two scenes, worked out by the test from what each picture holds. */
function ownDiffs(left: Part[], right: Part[]): { kind: string; type: string; slots: number[] }[] {
  const out: { kind: string; type: string; slots: number[] }[] = [];
  const kinds = [...new Set([...left, ...right].map((p) => p.kind))];
  for (const k of kinds) {
    const a = left.find((p) => p.kind === k), b = right.find((p) => p.kind === k);
    if (a && !b) out.push({ kind: k, type: 'missing', slots: [a.slot] });
    else if (!a && b) out.push({ kind: k, type: 'extra', slots: [b.slot] });
    else if (a && b) {
      if (a.color !== b.color) out.push({ kind: k, type: 'color', slots: [b.slot] });
      if (a.size !== b.size) out.push({ kind: k, type: 'size', slots: [b.slot] });
      if (a.slot !== b.slot) out.push({ kind: k, type: 'position', slots: [b.slot, a.slot] });
    }
  }
  return out;
}
/** Problems with one Spot the differences round; empty when the page's list of changes is exactly what differs. */
function spotProblems(q: any, level?: number): string[] {
  const out: string[] = [];
  const left: Part[] = q.left, right: Part[] = q.right, diffs: Diff[] = q.diffs;
  if (level !== undefined && diffs.length !== CHANGES[level - 1]) out.push(`spot: ${diffs.length} changes at level ${level}, expected ${CHANGES[level - 1]}`);
  for (const [name, pic] of [['first', left], ['second', right]] as const) {
    if (new Set(pic.map((p) => p.slot)).size !== pic.length) out.push(`spot: two parts share a place in the ${name} picture`);
    if (new Set(pic.map((p) => p.kind)).size !== pic.length) out.push(`spot: a kind repeats in the ${name} picture`);
    if (pic.some((p) => p.slot < 0 || p.slot > 14)) out.push('spot: a part outside the picture');
  }
  const mine = ownDiffs(left, right).map((d) => `${d.kind}:${d.type}:${[...d.slots].sort().join('/')}`).sort();
  const page = diffs.map((d) => `${d.kind}:${d.type}:${[...d.slots].sort().join('/')}`).sort();
  if (JSON.stringify(mine) !== JSON.stringify(page)) out.push(`spot: the page lists ${page.join(' ')}, the pictures differ by ${mine.join(' ')}`);
  // No two changes in one place, so each tap finds exactly one change.
  const all = diffs.flatMap((d) => d.slots);
  if (new Set(all).size !== all.length) out.push('spot: two changes share a place');
  const ans: number[] = q.ans;
  if (ans.length !== diffs.length || ans.some((s, i) => !diffs[i].slots.includes(s))) out.push('spot: ans does not match the changes');
  return out;
}

/** Answers the round on screen correctly, with no missed taps. */
async function answer(page: Page, game: Game) {
  const r = await current(page);
  if (game === 'odd') { await page.locator(`#choices button[data-v="${r.ans}"]`).click(); return; }
  for (const s of r.ans as number[]) await page.locator(`#spot-right button[data-slot="${s}"]`).click();
}
/** Taps one thing that is not the answer (a picture that matches the others, or a part that did not change). */
async function missOnce(page: Page, game: Game, k = 0): Promise<string> {
  const r = await current(page);
  if (game === 'odd') {
    const wrong = (r.choices as string[]).filter((c) => c !== r.ans)[k % ((r.choices as string[]).length - 1)];
    await page.locator(`#choices button[data-v="${wrong}"]`).click();
    return wrong;
  }
  const changed = new Set((r.diffs as Diff[]).flatMap((d) => d.slots));
  const same = (r.right as Part[]).filter((p) => !changed.has(p.slot));
  const p = same[k % same.length];
  await page.locator(`#spot-right button[data-slot="${p.slot}"]`).click();
  return p.kind;
}

test('Find the difference: loads with no errors, nothing from other sites, nothing stored, passes the accessibility scan, fits 320 px', async ({ page, context }) => {
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await open(page);
  await expect(page.locator('h1')).toHaveText('Find the difference');
  await expect(page).toHaveTitle('Find the difference | Yaanstep');
  await expect(page.locator('#menu .step')).toHaveCount(GAMES.length + 1);
  for (const g of GAMES) await expect(page.locator(`#play-${g}`)).toContainText(NAMES[g]);
  const intro = await page.locator('.note').first().innerText();
  expect(intro).toMatch(/ages 3 to 8/i);
  expect(intro).toMatch(/free/i);
  expect(intro).toContain('Not a replacement for school.');
  expect(intro).toMatch(/only points are kept on this device/i);
  await expect(page.locator('#level-note')).toContainText('start in the middle');
  expect(await axeViolations(page)).toEqual([]);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  for (const g of GAMES) {
    await page.locator(`#play-${g}`).click();
    expect(await horizontalOverflow(page), `${g} at 320 px`).toBeLessThanOrEqual(1);
    expect(await axeViolations(page, '#game')).toEqual([]);
    await answer(page, g);
    await page.locator('#exit').click();
  }
  await page.waitForLoadState('networkidle');
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect(reqs.sending()).toEqual([]);
  const s = await storedData(page, context);
  expect(s.local).toEqual([]);
  expect(s.session.filter((k) => !/^ys-rest/.test(k))).toEqual([]); // the shared break timer (profile.js) may count play time for this visit
  expect(s.cookies).toEqual([]);
  expect(errors).toEqual([]);
});

test('Find the difference is linked from the Yaanstep Sprouts page', async ({ page }) => {
  await page.goto('/sprouts.html');
  await page.locator('a[href="find-difference.html"]').first().click();
  await expect(page.locator('h1')).toHaveText('Find the difference');
});

test('Find the difference: the wording is plain and kind, with no claims and none of the banned words', async ({ page }) => {
  await open(page);
  const texts = [await page.locator('body').innerText(), await page.title(), (await page.locator('meta[name="description"]').getAttribute('content')) ?? ''];
  const inGames: string[] = [];
  await page.locator('#play-learn').click();
  for (let i = 0; i < 5; i++) { texts.push(await page.locator('#area').innerText()); if (i < 4) await page.locator('#nextpart').click(); }
  for (const g of GAMES) {
    await page.locator(`[data-go="${g}"]`).click();
    await missOnce(page, g);
    await page.locator('#howbtn').click();
    inGames.push(await page.locator('#game').innerText());
    await hintNow(page);
    inGames.push(await page.locator('#sub').innerText());
    await answer(page, g);
    inGames.push(await page.locator('#sub').innerText());
    await page.locator('#exit').click();
    await page.locator('#play-learn').click();
    for (let i = 0; i < 4; i++) await page.locator('#nextpart').click();
  }
  texts.push(...(await page.evaluate(() => (window as any).__said as string[])));
  const all = [...texts, ...inGames].join('\n');
  for (const bad of BANNED) expect.soft(all, `banned: ${bad}`).not.toMatch(bad);
  // Inside the games: no losing, no scores, no rush.
  expect(inGames.join('\n')).not.toMatch(/\b(wrong|incorrect|lose|lost|score|points|timer|hurry|quick|fast|seconds)\b/i);
});

test('Find the difference: the lesson has 5 parts, each with a moving picture that shows in full with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await page.locator('#play-learn').click();
  for (let i = 1; i <= 5; i++) {
    await expect(page.locator('#count')).toHaveText(`Part ${i} of 5`);
    await expect(page.locator('#area svg[role=img]').first()).toBeVisible();
    expect((await page.locator('#lesson-text').innerText()).length).toBeGreaterThan(30);
    const hidden = await page.locator('#area svg .mv-in').evaluateAll((es) => es.filter((e) => getComputedStyle(e).opacity !== '1').length);
    expect(hidden, 'reduced motion shows the finished picture').toBe(0);
    if (i < 5) await page.locator('#nextpart').click();
  }
  await expect(page.locator('[data-go]')).toHaveCount(GAMES.length);
  expect(await axeViolations(page, '#game')).toEqual([]);
});

for (const g of GAMES) {
  for (const age of [0, 3, 8]) {
    test(`${NAMES[g]}, ${age ? `age ${age}` : 'no profile'}: plays through every round, teaches on a miss, and moves focus sensibly`, async ({ page }) => {
      const errors = watchErrors(page);
      await open(page, age);
      await page.locator(`#play-${g}`).click();
      const total = ROUNDS[g];
      for (let k = 0; k < total; k++) {
        await expect(page.locator('#count')).toHaveText(`Round ${k + 1} of ${total}`);
        await expect(page.locator('#prompt')).toBeFocused();
        const r = await current(page);
        expect(r.game).toBe(g);
        if (g === 'odd') {
          expect(oddProblems(r, GROUP[r.level - 1]), JSON.stringify(r)).toEqual([]);
          const shown = await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-v')!));
          expect(shown).toEqual(r.choices);
        } else {
          expect(spotProblems(r, r.level), JSON.stringify(r)).toEqual([]);
          await expect(page.locator('#found-count')).toHaveText(`Found 0 of ${r.diffs.length}`);
          // A button for every place that holds something in either picture.
          const places = [...new Set([...r.left, ...r.right].map((p: Part) => p.slot))].sort((a, b) => a - b).map(String);
          const shown = await page.locator('#spot-right button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-slot')!));
          expect(shown).toEqual(places);
        }
        if (k === 0) {
          const tapped = await missOnce(page, g);
          await expect(page.locator('#sub')).toHaveClass(/try/);
          await expect(page.locator('#sub')).toContainText('You tapped');
          if (g === 'odd') {
            await expect(page.locator(`#choices button[data-v="${tapped}"]`)).toBeDisabled();
            await expect(page.locator('#choices button:focus')).not.toBeDisabled();
          } else {
            await expect(page.locator('#sub')).toContainText(`the ${tapped === 'frame' ? 'picture frame' : tapped}`);
            await expect(page.locator('#sub')).toContainText('the same in both pictures');
            await expect(page.locator('#found-count')).toHaveText(`Found 0 of ${r.diffs.length}`);
          }
          await page.locator('#howbtn').click();
          await expect(page.locator('#lesson h3')).toBeFocused();
          await expect(page.locator('#lesson svg[role=img]').first()).toBeVisible();
          expect((await page.locator('#lesson-say').innerText()).length).toBeGreaterThan(30);
          expect(await axeViolations(page, '#game')).toEqual([]);
        }
        if (g === 'spot') {
          const ans: number[] = r.ans;
          for (let i = 0; i < ans.length; i++) {
            await page.locator(`#spot-right button[data-slot="${ans[i]}"]`).click();
            if (i < ans.length - 1) await expect(page.locator('#found-count')).toHaveText(`Found ${i + 1} of ${ans.length}`);
          }
          await expect(page.locator('#found-count')).toHaveText(`Found ${ans.length} of ${ans.length}`);
          // Each found change has a ring in both pictures (a move has a ring at both places).
          const rings = (r.diffs as Diff[]).reduce((n, d) => n + d.slots.length, 0);
          await expect(page.locator('#spot-right svg .rings circle')).toHaveCount(rings);
          await expect(page.locator('#spot-left svg .rings circle')).toHaveCount(rings);
        } else {
          await answer(page, g);
        }
        await expect(page.locator('#sub')).toContainText('Yes!');
        await expect(page.locator('#howbox')).toBeEmpty();
        await expect(page.locator('#more')).toBeFocused();
        await page.locator('#more').click();
      }
      await expect(page.locator('#alldone')).toBeVisible();
      await page.locator('#stop').click();
      await expect(page.locator(`#play-${g}`)).toBeFocused();
      expect(errors).toEqual([]);
    });
  }
}

test('every round has exactly the answers the page says, and every listed change is really drawn, at every level', async ({ page }) => {
  await open(page);
  const made = await page.evaluate(() => {
    const F = (window as any).YS_FIND, out: any[] = [];
    for (let lv = 1; lv <= 6; lv++) for (let rep = 0; rep < 60; rep++) {
      const o = F.make.odd(lv), s = F.make.spot(lv);
      // What each picture draws: the odd one's drawing, and each place in both scenes.
      const arts = o.items.map((i: any) => F.art.odd(i.f));
      const drawnDiff: number[] = [];
      for (let p = 0; p < 15; p++) if (F.art.slot(s.left, p) !== F.art.slot(s.right, p)) drawnDiff.push(p);
      out.push({ lv, odd: o, arts, spot: { ...s, ans: s.diffs.map((d: any) => d.slots[0]) }, drawnDiff });
    }
    return out;
  });
  expect(made.length).toBe(6 * 60);
  const bad: string[] = [];
  const kinds = new Set<string>();
  for (const m of made) {
    bad.push(...oddProblems(m.odd, GROUP[m.lv - 1]).map((p) => `level ${m.lv}: ${p}`));
    bad.push(...spotProblems(m.spot, m.lv).map((p) => `level ${m.lv}: ${p}`));
    // Drawn: the odd picture looks different, and all the others look the same.
    const arts: string[] = m.arts, oddArt = arts[Number(m.odd.ans) - 1];
    if (arts.filter((a) => a === oddArt).length !== 1 || new Set(arts).size !== 2) bad.push(`level ${m.lv}: odd ${m.odd.mode}: the drawings do not show exactly one different picture`);
    // Drawn: the places that look different are exactly the places of the listed changes.
    const listed = [...new Set((m.spot.diffs as Diff[]).flatMap((d) => d.slots))].sort((a, b) => a - b);
    if (JSON.stringify(listed) !== JSON.stringify(m.drawnDiff)) bad.push(`level ${m.lv}: spot draws changes at ${m.drawnDiff.join(',')} but lists ${listed.join(',')}`);
    kinds.add(`odd:${m.lv}:${m.odd.mode}`);
    for (const d of m.spot.diffs as Diff[]) kinds.add(`spot:${d.type}`);
  }
  expect(bad.slice(0, 20)).toEqual([]);
  // Easy changes at the start, small details at the top; every kind of change in the scenes turns up.
  for (const k of ['odd:1:color', 'odd:1:shape', 'odd:3:facing', 'odd:3:pattern', 'odd:6:part', 'odd:6:count', 'spot:color', 'spot:missing', 'spot:extra', 'spot:size', 'spot:position']) expect(kinds, k).toContain(k);
  for (const k of ['odd:6:color', 'odd:6:shape', 'odd:5:color']) expect(kinds, k).not.toContain(k);
});

for (const age of [0, 3, 4, 5, 6, 7, 8]) {
  test(`the level starts from the age: level ${START[age]} ${age ? `at age ${age}` : 'with no profile'}, and the profile is only read`, async ({ page }) => {
    await open(page, age);
    if (age) await expect(page.locator('#level-note')).toContainText(`age ${age}`);
    await expect(page.locator('#level-note')).toContainText(`level ${START[age]} of 6`);
    for (const g of GAMES) expect(await levelOf(page, g)).toBe(START[age]);
    await page.locator('#play-odd').click();
    const r = await current(page);
    expect(r.level).toBe(START[age]);
    expect(r.items).toHaveLength(GROUP[START[age] - 1]);
    await expect(page.locator('#choices button')).toHaveCount(GROUP[START[age] - 1]);
    await page.locator('#exit').click();
    await page.locator('#play-spot').click();
    const s = await current(page);
    expect(s.level).toBe(START[age]);
    expect(s.diffs).toHaveLength(CHANGES[START[age] - 1]);
    await answer(page, 'spot');
    // With a profile, the only new key is the points (one world point for the round).
    const kept = await page.evaluate(() => Object.keys(localStorage).sort());
    expect(kept).toEqual(age ? ['sprouts:points', 'ys-profile'] : []);
    if (age) {
      expect(JSON.parse((await page.evaluate(() => localStorage.getItem('ys-profile')))!)).toEqual({ age, color: 0, nick: '' });
      expect(JSON.parse((await page.evaluate(() => localStorage.getItem('sprouts:points')))!)).toEqual({ maths: 0, english: 0, world: 1 });
    }
  });
}

test('perfect play raises the level each round: more pictures in Odd one out, more changes in Spot the differences', async ({ page }) => {
  await open(page, 3);
  await page.locator('#play-odd').click();
  const sizes: number[] = [], levels: number[] = [];
  for (let k = 0; k < 7; k++) {
    const r = await current(page);
    levels.push(r.level); sizes.push(r.items.length);
    await answer(page, 'odd');
    if (r.level < 6) await expect(page.locator('#sub')).toContainText('Getting trickier.');
    else await expect(page.locator('#sub')).not.toContainText('Getting trickier.');
    await page.locator('#more').click();
  }
  expect(levels).toEqual([1, 2, 3, 4, 5, 6, 6]);
  expect(sizes).toEqual([3, 4, 5, 6, 8, 9, 9]);
  await page.locator('#exit').click();
  await page.locator('#play-spot').click();
  const changes: number[] = [], spotLevels: number[] = [];
  for (let k = 0; k < 6; k++) {
    const r = await current(page);
    spotLevels.push(r.level); changes.push(r.diffs.length);
    expect(r.left.length, 'more parts in the scene as the level rises').toBe([5, 6, 7, 8, 9, 10][r.level - 1]);
    await answer(page, 'spot');
    await page.locator('#more').click();
  }
  expect(spotLevels).toEqual([1, 2, 3, 4, 5, 6]);
  expect(changes).toEqual([1, 2, 3, 3, 4, 5]);
});

test('several missed taps lower the level, and one or two keep it where it is', async ({ page }) => {
  await open(page, 8);
  // Odd one out at level 3 (5 pictures): 3 missed taps, then the answer.
  await page.locator('#play-odd').click();
  let r = await current(page);
  expect(r.level).toBe(3);
  for (let k = 0; k < 3; k++) await missOnce(page, 'odd', k);
  await answer(page, 'odd');
  await expect(page.locator('#sub')).toContainText('A bit easier now.');
  expect(await levelOf(page, 'odd')).toBe(2);
  await page.locator('#more').click();
  r = await current(page);
  expect(r.level).toBe(2);
  expect(r.items).toHaveLength(4);
  // One missed tap: the level stays.
  await missOnce(page, 'odd');
  await answer(page, 'odd');
  await expect(page.locator('#sub')).not.toContainText(/trickier|easier/);
  expect(await levelOf(page, 'odd')).toBe(2);
  await page.locator('#exit').click();
  // Spot the differences at level 3: 3 taps on parts that did not change, then all the changes.
  await page.locator('#play-spot').click();
  r = await current(page);
  expect(r.level).toBe(3);
  for (let k = 0; k < 3; k++) await missOnce(page, 'spot', k);
  expect((await current(page)).wrong).toBe(3);
  await answer(page, 'spot');
  await expect(page.locator('#sub')).toContainText('A bit easier now.');
  await page.locator('#more').click();
  r = await current(page);
  expect(r.level).toBe(2);
  expect(r.diffs).toHaveLength(2);
});

test('the level never goes below 1', async ({ page }) => {
  await open(page, 3);
  await page.locator('#play-odd').click();
  for (let k = 0; k < 2; k++) {
    await missOnce(page, 'odd', 0);
    await missOnce(page, 'odd', 1);
    await hintNow(page);
    await answer(page, 'odd');
    await page.locator('#more').click();
    expect(await levelOf(page, 'odd')).toBe(1);
  }
});

test('a clue after a quiet pause: it waits for the pause, outlines a remaining answer, and makes the next round easier', async ({ page }) => {
  await page.clock.install();
  await open(page, 8);
  const delay = await page.evaluate(() => (window as any).YS_FIND.hintDelay);
  expect(delay).toBeGreaterThanOrEqual(8000);
  await page.locator('#play-spot').click();
  const r = await current(page);
  await page.clock.runFor(delay - 2000);
  await expect(page.locator('#area .hint')).toHaveCount(0);
  // A tap starts the wait again.
  const first = r.ans[0];
  await page.locator(`#spot-right button[data-slot="${first}"]`).click();
  await page.clock.runFor(delay - 2000);
  await expect(page.locator('#area .hint')).toHaveCount(0);
  await page.clock.runFor(2500);
  await expect(page.locator('#area .hint')).toHaveCount(1);
  const hinted = Number(await page.locator('#area .hint').getAttribute('data-slot'));
  const remaining = (r.diffs as Diff[]).filter((d) => !d.slots.includes(first)).map((d) => d.slots[0]);
  expect(remaining).toContain(hinted);
  await expect(page.locator('#sub')).toContainText('clue');
  expect((await current(page)).hinted).toBe(true);
  // Solving it after a clue makes the next round a step easier.
  for (const s of r.ans.slice(1)) await page.locator(`#spot-right button[data-slot="${s}"]`).click();
  await expect(page.locator('#sub')).toContainText('A bit easier now.');
  await expect(page.locator('#area .hint')).toHaveCount(0);
  expect(await levelOf(page, 'spot')).toBe(2);
  // In Odd one out the clue outlines the different picture.
  await page.locator('#exit').click();
  await page.locator('#play-odd').click();
  const o = await current(page);
  await page.clock.runFor(delay + 500);
  await expect(page.locator('#choices .hint')).toHaveCount(1);
  await expect(page.locator(`#choices button[data-v="${o.ans}"]`)).toHaveClass(/hint/);
  // Leaving the game: no clue turns up later on the lesson.
  await page.locator('#exit').click();
  await page.locator('#play-learn').click();
  await page.clock.runFor(delay * 2);
  await expect(page.locator('#sub')).not.toContainText('clue');
});

test('the clue glows softly only when moving pictures are allowed: a still outline with reduced motion or Calm mode', async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await open(page);
  await page.locator('#play-odd').click();
  await hintNow(page);
  const moving = page.locator('#choices .hint');
  await expect(moving).toHaveClass(/glow/);
  expect(await moving.evaluate((e) => getComputedStyle(e).animationName)).toBe('ysGlow');

  const still = await browser.newPage();
  await still.emulateMedia({ reducedMotion: 'reduce' });
  await open(still);
  await still.locator('#play-spot').click();
  await hintNow(still);
  const h = still.locator('#area .hint');
  await expect(h).toHaveCount(1);
  expect(await h.evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
  expect(await h.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe('dashed');
  await still.close();

  const calm = await browser.newPage();
  await calm.emulateMedia({ reducedMotion: 'no-preference' });
  await open(calm, 6, ['calm']);
  await calm.locator('#play-odd').click();
  await hintNow(calm);
  const c = calm.locator('#choices .hint');
  await expect(c).toHaveCount(1);
  await expect(c).not.toHaveClass(/glow/);
  expect(await c.evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
  await calm.close();
});

test('Fewer choices keeps Odd one out groups to 3 pictures, even as the level rises', async ({ page }) => {
  await open(page, 8, ['fewer']);
  await page.locator('#play-odd').click();
  for (let k = 0; k < 5; k++) {
    const r = await current(page);
    expect(r.items).toHaveLength(3);
    await expect(page.locator('#choices button')).toHaveCount(3);
    expect(oddProblems(r), JSON.stringify(r)).toEqual([]);
    await answer(page, 'odd');
    await page.locator('#more').click();
  }
  expect(await levelOf(page, 'odd')).toBe(6);
});

test('Spot the differences works from the keyboard: Tab to a changed part, then Enter or Space', async ({ page }) => {
  await open(page); // level 2: two changes
  await page.locator('#play-spot').click();
  const r = await current(page);
  expect(r.ans).toHaveLength(2);
  const keys = ['Enter', 'Space'];
  for (let i = 0; i < 2; i++) {
    await page.locator('#prompt').focus();
    let found = false;
    for (let t = 0; t < 20 && !found; t++) {
      await page.keyboard.press('Tab');
      found = await page.evaluate((s) => document.activeElement?.getAttribute('data-slot') === String(s), r.ans[i]);
    }
    expect(found, `Tab reaches place ${r.ans[i]}`).toBe(true);
    await expect(page.locator(`#spot-right button[data-slot="${r.ans[i]}"]`)).toBeFocused();
    await page.keyboard.press(keys[i]);
    if (i === 0) await expect(page.locator('#found-count')).toHaveText('Found 1 of 2');
  }
  await expect(page.locator('#found-count')).toHaveText('Found 2 of 2');
  await expect(page.locator('#sub')).toContainText('Yes!');
  await expect(page.locator('#more')).toBeFocused();
});

test('Spot the differences can be played by name: the first picture lists its parts, and each tap place says what it holds', async ({ page }) => {
  await open(page, 5);
  await page.locator('#play-spot').click();
  const r = await current(page);
  const label = (await page.locator('#spot-left svg').getAttribute('aria-label'))!;
  expect(await page.locator('#spot-left svg').getAttribute('role')).toBe('img');
  for (const p of r.left as Part[]) expect(label).toContain(`a ${p.size} ${p.color} ${p.kind === 'frame' ? 'picture frame' : p.kind}`);
  expect(await page.locator('#spot-right svg').getAttribute('aria-hidden')).toBe('true');
  await expect(page.locator('#spot-right')).toHaveAttribute('role', 'group');
  const rows = ['Top', 'Middle', 'Bottom'];
  for (const b of await page.locator('#spot-right button').all()) {
    const s = Number(await b.getAttribute('data-slot'));
    const p = (r.right as Part[]).find((x) => x.slot === s);
    const where = `${rows[Math.floor(s / 5)]}, place ${(s % 5) + 1}: `;
    await expect(b).toHaveAccessibleName(where + (p ? `a ${p.size} ${p.color} ${p.kind === 'frame' ? 'picture frame' : p.kind}` : 'nothing here'));
  }
  // A found change says so.
  await page.locator(`#spot-right button[data-slot="${r.ans[0]}"]`).click();
  await expect(page.locator(`#spot-right button[data-slot="${r.ans[0]}"]`)).toHaveAccessibleName(/, found$/);
  expect(await axeViolations(page, '#game')).toEqual([]);
});

test('Odd one out: each picture is named by its own words, so a screen reader can compare them', async ({ page }) => {
  await open(page, 8);
  await page.locator('#play-odd').click();
  const r = await current(page);
  const names = await page.locator('#choices button .sr').allTextContents();
  expect(names).toHaveLength(r.items.length);
  const words = names.map((n) => n.replace(/^Picture \d+: /, ''));
  // The matching pictures share their words; the different one has its own.
  const oddWords = words[Number(r.ans) - 1];
  expect(words.filter((w) => w === oddWords)).toHaveLength(1);
  expect(new Set(words).size).toBe(2);
  const drawn = await page.locator('#choices button svg').evaluateAll((ss) => ss.every((s) => s.closest('[aria-hidden="true"]') !== null));
  expect(drawn).toBe(true);
});

test('Find the difference: every button is at least 44 by 44 px, also at 320 px where the two scenes stack', async ({ page }) => {
  await open(page, 8);
  for (const width of [0, 320]) {
    if (width) await page.setViewportSize({ width, height: 700 });
    for (const g of ['learn', ...GAMES]) {
      await page.locator(`#play-${g}`).click();
      for (const b of await page.locator('button:visible').all()) {
        const box = (await b.boundingBox())!;
        const name = (await b.getAttribute('data-slot')) ?? (await b.innerText());
        expect(box.width, `${g}: ${name}`).toBeGreaterThanOrEqual(43.5);
        expect(box.height, `${g}: ${name}`).toBeGreaterThanOrEqual(43.5);
      }
      if (width) expect(await horizontalOverflow(page), `${g} at 320 px`).toBeLessThanOrEqual(1);
      await page.locator('#exit').click();
    }
  }
});
