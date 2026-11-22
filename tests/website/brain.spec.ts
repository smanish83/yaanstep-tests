import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';

// Brain games (brain.html, Manish 22 Nov 2026: "Also can you add the games for brain activities."): puzzles and games
// for thinking, ages 3 to 8. A moving lesson, then Find the pairs, What comes next?, Odd one out, Shape puzzles and
// Look closely. Each game fits the age in the profile ("ys-profile", read only), and sits in the middle with none.
// Every question must have exactly one right answer. That is checked here with the test's own logic (periods of a
// pattern, shapes turned and flipped, the features of each picture), not by asking the page.

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); };`;

const GAMES = ['memory', 'next', 'odd', 'shapes', 'look'] as const;
type Game = (typeof GAMES)[number];
const NAMES: Record<Game, string> = { memory: 'Find the pairs', next: 'What comes next?', odd: 'Odd one out', shapes: 'Shape puzzles', look: 'Look closely' };
/** Pairs on the memory board for each age (0: no profile), as Manish's brief sets them: 4 at 3 to 4, up to 8 at 7 to 8. */
const PAIRS: Record<number, number> = { 0: 6, 3: 4, 4: 4, 5: 5, 6: 6, 7: 8, 8: 8 };
/** Words the page must never use (wording rules for this page). */
const BANNED = [/therap/i, /treatment/i, /diagnos/i, /special needs/i, /\bproven\b/i, /clinical/i, /\bIQ\b/, /brain training/i, /improves?\b/i, /\bboosts?\b/i];

async function open(page: Page, age = 0) {
  await page.addInitScript(VOICE);
  if (age) await page.addInitScript((a) => localStorage.setItem('ys-profile', JSON.stringify({ age: a, color: 0, nick: '' })), age);
  await page.goto('/brain.html');
}
const current = (page: Page) => page.evaluate(() => (window as any).YS_SHELL.current());
async function roundsInGame(page: Page) {
  return Number((await page.locator('#count').innerText()).match(/of (\d+)/)![1]);
}

/* ---------- the test's own answer logic ---------- */
type Cell = [number, number];
function norm(cells: Cell[]): string {
  const mx = Math.min(...cells.map((c) => c[0])), my = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[1] - b[1] || a[0] - b[0]).map((c) => c.join(',')).join(' ');
}
const rot = (cells: Cell[]): Cell[] => cells.map(([x, y]) => [-y, x] as Cell);
const mirror = (cells: Cell[]): Cell[] => cells.map(([x, y]) => [-x, y] as Cell);
function rotations(cells: Cell[]): string[] { const out: string[] = []; let c = cells; for (let i = 0; i < 4; i++) { out.push(norm(c)); c = rot(c); } return out; }
const allWays = (cells: Cell[]) => [...rotations(cells), ...rotations(mirror(cells))];

/** Returns a list of problems with one question; empty when it has exactly one right answer and it is the one marked. */
function problems(game: Game, q: any): string[] {
  const out: string[] = [];
  const one = (right: string[], label: string) => {
    if (right.length !== 1) out.push(`${label}: ${right.length} right answers (${right.join(', ')})`);
    else if (right[0] !== String(q.ans)) out.push(`${label}: page says ${q.ans}, the test says ${right[0]}`);
  };
  if (game === 'next') {
    if (new Set(q.choices).size !== 3) out.push('next: choices repeat');
    if (q.kind === 'grow') {
      const h: number[] = q.heights, d = h[1] - h[0];
      if (h.some((v, i) => i && v - h[i - 1] !== d)) out.push('grow: not even steps');
      one(q.choices.filter((c: string) => c === `tower-${h[h.length - 1] + d}`), 'grow');
    } else {
      const s: string[] = q.seq;
      // The shortest repeat that the whole row follows, seen at least twice.
      let p = 1;
      while (p <= s.length / 2 && !s.every((v, i) => i < p || v === s[i - p])) p++;
      if (p > s.length / 2) out.push(`next: no repeat seen twice in ${s.join(' ')}`);
      one(q.choices.filter((c: string) => c === s[s.length - p]), 'next');
      // Never color alone: different items always have different shapes.
      const items = [...new Set([...s, ...q.choices])];
      if (new Set(items.map((i) => i.split('-')[1])).size !== items.length) out.push(`next: two items share a shape: ${items.join(' ')}`);
      if (items.some((i) => !/^(red|blue|yellow|green|purple|orange)-(circle|square|triangle|star|heart|diamond)$/.test(i))) out.push('next: unknown item');
    }
  }
  if (game === 'odd') {
    const items: { id: string; f: Record<string, unknown> }[] = q.items;
    if (items.length !== 4 || new Set(items.map((i) => i.id)).size !== 4) out.push('odd: not 4 different choices');
    const feats = [...new Set(items.flatMap((i) => Object.keys(i.f)))];
    // An item is odd when, on some feature, the other three all agree and it does not.
    const odd = items.filter((it) => feats.some((f) => {
      const others = items.filter((o) => o !== it).map((o) => o.f[f]);
      return others.every((v) => v === others[0]) && it.f[f] !== others[0];
    }));
    one(odd.map((i) => i.id), `odd ${q.mode}`);
    if (q.mode === 'colorshape') {
      const it = items.find((i) => i.id === q.ans)!, other = items.find((i) => i.id !== q.ans)!;
      if (it.f.shape === other.f.shape) out.push('odd: color alone');
    }
  }
  if (game === 'shapes') {
    if (q.mode === 'hole') one(q.choices.filter((c: string) => c === q.hole), 'hole');
    else if (q.mode === 'turn') {
      const ways = rotations(q.shape);
      one(q.choices.filter((c: any) => ways.includes(norm(c.cells))).map((c: any) => c.id), 'turn');
      if (new Set(q.choices.map((c: any) => norm(c.cells))).size !== 3) out.push('turn: two choices look the same');
    } else {
      const gap = norm(q.gap), [W, H] = q.grid;
      if (q.gap.some(([x, y]: Cell) => x < 0 || y < 0 || x >= W || y >= H)) out.push('gap: outside the wall');
      const fits = q.choices.filter((c: any) => (q.mode === 'gap' ? [norm(c.cells)] : rotations(c.cells)).includes(gap));
      one(fits.map((c: any) => c.id), q.mode);
      // A wrong piece must not fit even turned or flipped.
      for (const c of q.choices) if (c.id !== q.ans && allWays(c.cells).includes(gap)) out.push(`${q.mode}: ${c.id} also fits when turned or flipped`);
    }
  }
  if (game === 'look') {
    if (q.mode === 'stars') {
      const n = q.shapes.filter((s: any) => s.kind === 'star').length;
      one(q.choices.filter((c: string) => Number(c) === n), 'stars');
      const spots = q.shapes.map((s: any) => `${s.col},${s.row}`);
      if (new Set(spots).size !== spots.length) out.push('stars: two shapes in one place');
    } else {
      const vals = q.items.map((i: any) => i.v);
      const odd = q.items.filter((it: any, k: number) => vals.filter((v: unknown, j: number) => j !== k).every((v: unknown, _: number, a: unknown[]) => v === a[0]) && vals.filter((v: unknown) => v === it.v).length === 1);
      one(odd.map((i: any) => i.id), `diff ${q.type}`);
    }
  }
  return out;
}

/** Answers the round on screen correctly. */
async function answer(page: Page, game: Game) {
  const r = await current(page);
  if (game === 'memory') {
    const cards: string[] = r.cards, done = new Set<number>();
    for (let i = 0; i < cards.length; i++) {
      if (done.has(i)) continue;
      const j = cards.indexOf(cards[i], i + 1);
      done.add(i); done.add(j);
      await page.locator(`#board button[data-i="${i}"]`).click();
      await page.locator(`#board button[data-i="${j}"]`).click();
    }
    return;
  }
  await page.locator(`#choices button[data-v="${r.ans}"]`).click();
}
/** Makes one wrong move on the round on screen. */
async function missOnce(page: Page, game: Game) {
  const r = await current(page);
  if (game === 'memory') {
    const j = (r.cards as string[]).findIndex((c) => c !== r.cards[0]);
    await page.locator('#board button[data-i="0"]').click();
    await page.locator(`#board button[data-i="${j}"]`).click();
    return { tapped: r.cards[0] as string };
  }
  const wrong = (r.choices as string[]).map(String).find((c) => !r.right.map(String).includes(c))!;
  await page.locator(`#choices button[data-v="${wrong}"]`).click();
  return { tapped: wrong };
}

test('Brain games: loads with no errors, nothing from other sites, nothing stored, passes the accessibility scan, fits 320 px', async ({ page, context }) => {
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await open(page);
  await expect(page.locator('h1')).toHaveText('Brain games');
  await expect(page).toHaveTitle('Brain games | Yaanstep');
  await expect(page.locator('#menu .step')).toHaveCount(GAMES.length + 1);
  for (const g of GAMES) await expect(page.locator(`#play-${g}`)).toContainText(NAMES[g]);
  const intro = await page.locator('.note').first().innerText();
  expect(intro).toMatch(/ages 3 to 8/i);
  expect(intro).toMatch(/free/i);
  expect(intro).toMatch(/nothing is saved on this device/i);
  await expect(page.locator('#level-note')).toContainText('set in the middle');
  expect(await axeViolations(page)).toEqual([]);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  // Play a little, then check again: still nothing stored and nothing sent.
  await page.locator('#play-memory').click();
  await answer(page, 'memory');
  await page.waitForLoadState('networkidle');
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect(reqs.sending()).toEqual([]);
  const s = await storedData(page, context);
  expect(s.local).toEqual([]);
  expect(s.session.filter((k) => !/^ys-rest/.test(k))).toEqual([]); // the shared break timer (profile.js) may count play time for this visit
  expect(s.cookies).toEqual([]);
  expect(errors).toEqual([]);
});

test('Brain games is linked from the Yaanstep Sprouts page', async ({ page }) => {
  await page.goto('/sprouts.html');
  await page.locator('a[href="brain.html"]').click();
  await expect(page.locator('h1')).toHaveText('Brain games');
});

test('Brain games: the wording is plain and kind, with no claims and none of the words the rules ban', async ({ page }) => {
  await open(page);
  const texts = [await page.locator('body').innerText()], inGames: string[] = [];
  await page.locator('#play-learn').click();
  for (let i = 0; i < 6; i++) { texts.push(await page.locator('#area').innerText()); if (i < 5) await page.locator('#nextpart').click(); }
  for (const g of GAMES) {
    await page.locator(`[data-go="${g}"]`).click();
    await missOnce(page, g);
    await page.locator('#howbtn').click();
    inGames.push(await page.locator('#game').innerText());
    await answer(page, g);
    inGames.push(await page.locator('#sub').innerText());
    await page.locator('#exit').click();
    await page.locator('#play-learn').click();
    for (let i = 0; i < 5; i++) await page.locator('#nextpart').click();
  }
  texts.push(...(await page.evaluate(() => (window as any).__said as string[])));
  const all = [...texts, ...inGames].join('\n');
  for (const bad of BANNED) expect.soft(all, `banned: ${bad}`).not.toMatch(bad);
  // Inside the games: no losing, no scores, no rush (the intro may say there are none).
  expect(inGames.join('\n')).not.toMatch(/\b(wrong|incorrect|lose|lost|score|points|timer|hurry|quick|fast)\b/i);
});

test('Brain games: the lesson has 6 parts, each with a moving picture that shows in full with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await page.locator('#play-learn').click();
  for (let i = 1; i <= 6; i++) {
    await expect(page.locator('#count')).toHaveText(`Part ${i} of 6`);
    await expect(page.locator('#area svg[role=img]').first()).toBeVisible();
    expect((await page.locator('#lesson-text').innerText()).length).toBeGreaterThan(30);
    const hidden = await page.locator('#area svg .mv-in').evaluateAll((es) => es.filter((e) => getComputedStyle(e).opacity !== '1').length);
    expect(hidden, 'reduced motion shows the finished picture').toBe(0);
    if (i < 6) await page.locator('#nextpart').click();
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
      const total = await roundsInGame(page);
      // Memory boards ask the shell for 3 rounds (YSShell.run rounds: { memory: 3 }); until the shell reads it, every game has 8.
      expect(total).toBe(g === 'memory' ? 3 : 8);
      for (let k = 0; k < total; k++) {
        await expect(page.locator('#count')).toHaveText(`Round ${k + 1} of ${total}`);
        await expect(page.locator('#prompt')).toBeFocused();
        const r = await current(page);
        if (g === 'memory') {
          expect(r.cards).toHaveLength(2 * PAIRS[age]);
          await expect(page.locator('#board button')).toHaveCount(2 * PAIRS[age]);
        } else {
          expect(problems(g, r.q ?? r), JSON.stringify(r)).toEqual([]);
          const shown = await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-v')!));
          expect(shown.slice().sort()).toEqual((r.choices as string[]).map(String).sort());
        }
        if (k === 0) {
          const { tapped } = await missOnce(page, g);
          await expect(page.locator('#sub')).toHaveClass(/try/);
          await expect(page.locator('#sub')).toContainText(g === 'memory' ? `You turned over a${/^[aeiou]/.test(tapped) ? 'n' : ''} ${tapped}` : 'You tapped');
          if (g !== 'memory') {
            // The tapped choice is switched off, and focus moves to a choice that is still open.
            await expect(page.locator(`#choices button[data-v="${tapped}"]`)).toBeDisabled();
            await expect(page.locator('#choices button:focus')).not.toBeDisabled();
          }
          await page.locator('#howbtn').click();
          await expect(page.locator('#lesson h3')).toBeFocused();
          await expect(page.locator('#lesson svg[role=img]').first()).toBeVisible();
          expect((await page.locator('#lesson-say').innerText()).length).toBeGreaterThan(30);
          expect(await axeViolations(page, '#game')).toEqual([]);
        }
        await answer(page, g);
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

test('every question has exactly one right answer, over many generated rounds for every age', async ({ page }) => {
  await open(page);
  const made = await page.evaluate(() => {
    const B = (window as any).YS_BRAIN, out: { game: string; lv: number; q: any }[] = [];
    for (const lv of [0, 1, 2]) for (let round = 0; round < 8; round++) for (let rep = 0; rep < 25; rep++) {
      out.push({ game: 'next', lv, q: B.make.next(lv, round) });
      out.push({ game: 'odd', lv, q: B.make.odd(lv, round) });
      out.push({ game: 'shapes', lv, q: B.make.shapes(lv, round) });
      out.push({ game: 'look', lv, q: B.make.look(lv, round) });
    }
    return out;
  });
  expect(made.length).toBe(3 * 8 * 25 * 4);
  const bad = made.flatMap((m) => problems(m.game as Game, m.q).map((p) => `level ${m.lv}: ${p}`));
  expect(bad.slice(0, 20)).toEqual([]);
  // Every kind of question turns up for the levels that use it.
  const kinds = new Set(made.map((m) => `${m.game}:${m.lv}:${m.q.unit ?? m.q.mode}`));
  for (const k of ['next:0:AB', 'next:0:AAB', 'next:1:ABC', 'next:2:grow', 'next:2:AABB', 'odd:0:colorshape', 'odd:1:number', 'odd:2:shape', 'odd:2:kind',
    'shapes:0:hole', 'shapes:1:gap', 'shapes:2:turn', 'shapes:2:gapturn', 'look:0:diff', 'look:2:stars']) expect(kinds, k).toContain(k);
});

test('the age from the profile sets the level: easy for 3 to 4, middle for 5 to 6 and with no profile, harder for 7 to 8', async ({ page }) => {
  await open(page);
  const got = await page.evaluate(() => { const B = (window as any).YS_BRAIN; return [0, 3, 4, 5, 6, 7, 8, 9].map((a) => [B.level(a), B.pairs(a)]); });
  expect(got).toEqual([[1, 6], [0, 4], [0, 4], [1, 5], [1, 6], [2, 8], [2, 8], [2, 8]]);
});

for (const age of [0, 3, 4, 5, 6, 7, 8]) {
  test(`Find the pairs: ${PAIRS[age]} pairs ${age ? `at age ${age}` : 'with no profile'}, each picture exactly twice, and the profile is only read`, async ({ page }) => {
    await open(page, age);
    if (age) await expect(page.locator('#level-note')).toContainText(`age ${age}`);
    await page.locator('#play-memory').click();
    await expect(page.locator('#board button')).toHaveCount(2 * PAIRS[age]);
    const r = await current(page);
    const counts = new Map<string, number>();
    for (const c of r.cards as string[]) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(PAIRS[age]);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
    await answer(page, 'memory');
    const kept = await page.evaluate(() => Object.keys(localStorage));
    expect(kept).toEqual(age ? ['ys-profile'] : []);
    if (age) expect(JSON.parse((await page.evaluate(() => localStorage.getItem('ys-profile')))!)).toEqual({ age, color: 0, nick: '' });
  });
}

test('Find the pairs: a mismatch shows both cards, then turns them back; a pair stays face up and focus moves on; no timer is shown', async ({ page }) => {
  await open(page, 3);
  await page.locator('#play-memory').click();
  const r = await current(page);
  const j = (r.cards as string[]).findIndex((c) => c !== r.cards[0]);
  await page.locator('#board button[data-i="0"]').click();
  await expect(page.locator('#board button[data-i="0"]')).toContainText(`Card 1: ${r.cards[0]}`);
  await page.locator(`#board button[data-i="${j}"]`).click();
  await expect(page.locator(`#board button[data-i="${j}"]`)).toContainText(`: ${r.cards[j]}`);
  await expect(page.locator('#board button[data-i="0"]')).toContainText('Card 1: face down', { timeout: 4000 });
  await expect(page.locator(`#board button[data-i="${j}"]`)).toContainText('face down');
  const k = (r.cards as string[]).indexOf(r.cards[0], 1);
  await page.locator('#board button[data-i="0"]').click();
  await page.locator(`#board button[data-i="${k}"]`).click();
  await expect(page.locator('#board button[data-i="0"]')).toContainText('found');
  await expect(page.locator('#board button[data-i="0"]')).toBeDisabled();
  await expect(page.locator('#board button:focus')).toContainText('face down');
  await expect(page.locator('#game')).not.toContainText(/seconds|timer|moves left|score/i);
});

test('Find the pairs: with reduced motion the cards turn over without a flip animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await page.locator('#play-memory').click();
  await page.locator('#board button[data-i="0"]').click();
  const anim = await page.locator('#board button[data-i="0"] svg').first().evaluate((s) => getComputedStyle(s).animationName);
  expect(anim).toBe('none');
});

test('What comes next: no two items differ by color alone, in the choices or the pattern', async ({ page }) => {
  await open(page, 8);
  await page.locator('#play-next').click();
  for (let k = 0; k < 8; k++) {
    const r = await current(page);
    expect(problems('next', r.q)).toEqual([]);
    await answer(page, 'next');
    await page.locator('#more').click();
  }
});

test('Odd one out: the reason is spoken after the answer', async ({ page }) => {
  await open(page);
  await page.locator('#play-odd').click();
  for (let k = 0; k < 4; k++) {
    await answer(page, 'odd');
    const said = await page.evaluate(() => (window as any).__said as string[]);
    expect(said[said.length - 1]).toMatch(/^Yes! .*(not|The others|others have).*\./);
    await page.locator('#more').click();
  }
});

test('Brain games: every button is at least 48 by 48 px in every game, also at 320 px with the biggest memory board', async ({ page }) => {
  await open(page, 8);
  for (const width of [0, 320]) {
    if (width) await page.setViewportSize({ width, height: 700 });
    for (const g of ['learn', ...GAMES]) {
      await page.locator(`#play-${g}`).click();
      for (const b of await page.locator('button:visible').all()) {
        const box = (await b.boundingBox())!;
        expect(box.width, `${g}: ${await b.innerText()}`).toBeGreaterThanOrEqual(47.5);
        expect(box.height, `${g}: ${await b.innerText()}`).toBeGreaterThanOrEqual(47.5);
      }
      if (width) expect(await horizontalOverflow(page), `${g} at 320 px`).toBeLessThanOrEqual(1);
      await page.locator('#exit').click();
    }
  }
});

test('Brain games: choices are named for screen readers by their own words, with the drawing hidden', async ({ page }) => {
  await open(page);
  for (const g of GAMES) {
    await page.locator(`#play-${g}`).click();
    const sel = g === 'memory' ? '#board button' : '#choices button';
    const info = await page.locator(sel).evaluateAll((bs) => bs.map((b) => ({
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
