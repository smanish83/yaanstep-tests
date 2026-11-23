import { test, expect, type Locator, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors } from '../support/checks';
import { knownBug } from '../support/known-bugs';
import { openLearning, playSortingPerfectly, rightAnswer, numberButton, feedback, startMaths } from '../support/learning';

// Points for every game, split by subject (Manish, 22 Nov 2026: "The points are not increasing. Make sure it is
// updating for all games, not just limited to maths. In case, we can split maths vs English learning").
// Each question answered right adds 1 point to its subject (maths, English or world) in "sprouts:points", once per
// question. A finished library book adds 2 English points. The maths page's own points ("sprouts:demo") count as maths.
// Only with a child profile: without one, nothing is stored. The calm corner has no points on purpose.

test.beforeEach(() => { knownBug(); });

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); };`;

type Area = 'maths' | 'english' | 'world';
type Points = Record<Area, number>;
const PTS_KEY = 'sprouts:points';

async function open(page: Page, path: string, age: number | null) {
  await page.addInitScript(VOICE);
  if (age) await page.addInitScript((a) => localStorage.setItem('ys-profile', JSON.stringify({ age: a, color: 0, nick: '' })), age);
  await page.goto(path);
}
const stored = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), PTS_KEY) as Promise<Points | null>;
const keys = (page: Page) => page.evaluate(() => Object.keys(localStorage).sort());
const want = (area: Area, n: number): Points => ({ maths: 0, english: 0, world: 0, [area]: n });

/** The shell pages (money, clocks, weather, topics, brain): tap the right tile of the round on screen. */
async function shellRight(page: Page) {
  const r = await page.evaluate(() => (window as any).YS_SHELL.current());
  await page.locator(`#choices button[data-v="${r.ans}"]`).click();
  await expect(page.locator('#sub')).toHaveClass(/\byes\b/);
}
/** Pages with no answer hook: tap each choice until the page says it is right (a miss first is fine). */
async function tapUntilRight(page: Page, choices: Locator) {
  const n = await choices.count();
  for (let i = 0; i < n; i++) {
    const b = choices.nth(i);
    if (await b.isDisabled()) continue;
    await b.click();
    if (/\byes\b/.test((await page.locator('#sub').getAttribute('class')) ?? '')) return;
  }
  throw new Error('no choice was right');
}
async function hookRight(page: Page, hook: string, sel = '#choices button') {
  const r = await page.evaluate((h) => (window as any)[h].current(), hook);
  await page.locator(`${sel}[data-v="${r.ans}"]`).click();
}
/** Bar models: plays one problem through all its steps. The point comes only with the answer sentence. */
async function barProblem(page: Page) {
  const p = await page.evaluate(() => (window as any).YS_BARS.current());
  let calc = 0;
  for (let guard = 0; guard < 30; guard++) {
    if (await page.locator('#qopts').isVisible()) await page.locator(`#qopts button[data-q="${p.right}"]`).click();
    else if (await page.locator('#calcopts').isVisible()) await page.locator(`#calcopts button[data-v="${p.calcs[calc++].ans}"]`).click();
    else if (await page.locator('#sayopts').isVisible()) {
      expect(await stored(page), 'no point for a step, only for the finished problem').toBeNull();
      await page.locator('#sayopts button[data-right="true"]').click();
      await expect(page.locator('#answer')).toBeVisible();
      return;
    }
    await page.locator('#go').click();
  }
  throw new Error('did not reach the answer sentence');
}
async function finishBook(page: Page) {
  await page.locator('#shelf .bookbtn').first().click();
  for (let guard = 0; guard < 60 && !(await page.locator('#ltheend').isVisible()); guard++) await page.locator('#rnext').click();
  await expect(page.locator('#ltheend')).toHaveText('The end.');
}

interface Case { name: string; path: string; age: number; area: Area; gain?: number; play: (page: Page) => Promise<void> }
const CASES: Case[] = [
  { name: 'Money and coins', path: '/money.html', age: 7, area: 'maths', play: async (p) => { await p.locator('#play-count').click(); await shellRight(p); } },
  { name: 'Clocks and time', path: '/clocks.html', age: 7, area: 'maths', play: async (p) => { await p.locator('#play-read').click(); await shellRight(p); } },
  { name: 'Weather', path: '/weather.html', age: 6, area: 'world', play: async (p) => { await p.locator('#play-find').click(); await shellRight(p); } },
  { name: 'Learn about the world', path: '/topics.html', age: 6, area: 'world', play: async (p) => { await p.locator('#topic-food').click(); await p.locator('#play-play').click(); await shellRight(p); } },
  { name: 'Brain games', path: '/brain.html', age: 6, area: 'world', play: async (p) => { await p.locator('#play-odd').click(); await shellRight(p); } },
  { name: 'Number bonds', path: '/number-bonds.html', age: 6, area: 'maths', play: async (p) => { await p.locator('#play-bonds').click(); await hookRight(p, 'YS_BONDS'); await expect(p.locator('#right')).toBeVisible(); } },
  { name: 'Tens and ones', path: '/tens-and-ones.html', age: 7, area: 'maths', play: async (p) => { await p.locator('#play-read').click(); await hookRight(p, 'YS_TENS'); await expect(p.locator('#right')).toBeVisible(); } },
  { name: 'Fractions', path: '/fractions.html', age: 8, area: 'maths', play: async (p) => { await p.locator('#play-name').click(); await hookRight(p, 'YS_FRACTIONS'); await expect(p.locator('#right')).toBeVisible(); } },
  { name: 'Bar models', path: '/bar-models.html', age: 8, area: 'maths', play: async (p) => { await p.locator('#band-7-8').click(); await barProblem(p); } },
  { name: 'First steps: numbers', path: '/first-steps.html', age: 4, area: 'maths', play: async (p) => { await p.locator('#play-numbers').click(); await hookRight(p, 'YS_FIRST'); await expect(p.locator('#sub')).toHaveClass(/\byes\b/); } },
  { name: 'First steps: shapes', path: '/first-steps.html', age: 4, area: 'maths', play: async (p) => { await p.locator('#play-shapes').click(); await hookRight(p, 'YS_FIRST'); await expect(p.locator('#sub')).toHaveClass(/\byes\b/); } },
  { name: 'First steps: colors', path: '/first-steps.html', age: 4, area: 'world', play: async (p) => { await p.locator('#play-colors').click(); await hookRight(p, 'YS_FIRST'); await expect(p.locator('#sub')).toHaveClass(/\byes\b/); } },
  { name: 'First steps: animal sounds', path: '/first-steps.html', age: 4, area: 'world', play: async (p) => { await p.locator('#play-animals').click(); await hookRight(p, 'YS_FIRST'); await expect(p.locator('#sub')).toHaveClass(/\byes\b/); } },
  {
    name: 'Phonogram games', path: '/phonograms.html', age: 6, area: 'english', play: async (p) => {
      await p.locator('#play-split').click();
      const r = await p.evaluate(() => (window as any).YS_PHONOGRAMS.current());
      await p.locator(`#choices button[data-split="${r.p.join('|')}"]`).click();
      await expect(p.locator('#sub')).toHaveClass(/\byes\b/);
    },
  },
  { name: 'Rhymes', path: '/rhymes.html', age: 5, area: 'english', play: async (p) => { await p.locator('#play-rhyme').click(); await tapUntilRight(p, p.locator('#area button.choice')); } },
  { name: 'Letter teams', path: '/rhymes.html', age: 6, area: 'english', play: async (p) => { await p.locator('#play-teams').click(); await tapUntilRight(p, p.locator('#area button.choice')); } },
  { name: 'First sounds', path: '/sounds.html', age: 5, area: 'english', play: async (p) => { await p.locator('#play-first').click(); await tapUntilRight(p, p.locator('#area button.choice')); } },
  { name: 'Word beats', path: '/sounds.html', age: 5, area: 'english', play: async (p) => { await p.locator('#play-beats').click(); await tapUntilRight(p, p.locator('#area button.choice')); } },
  { name: 'Parts of a sentence', path: '/sentences.html', age: 6, area: 'english', play: async (p) => { await p.locator('#play-game').click(); await tapUntilRight(p, p.locator('#area button.choice')); } },
  { name: 'Story library', path: '/library.html', age: 6, area: 'english', gain: 2, play: finishBook },
  {
    name: 'Yaanstep Sprouts maths lesson', path: '/sprouts.html', age: 6, area: 'maths', play: async (p) => {
      await openLearning(p);
      await startMaths(p, { style: 'questions', lesson: false });
      const { value, buttons } = await rightAnswer(p);
      await numberButton(buttons, value).click();
      await expect(feedback(p)).toHaveClass(/\byes\b/);
    },
  },
  {
    name: 'Yaanstep Sprouts Same and different', path: '/sprouts.html', age: 3, area: 'world', gain: 3, play: async (p) => {
      await openLearning(p);
      await p.locator('#start-sorting').click();
      await playSortingPerfectly(p);
    },
  },
];

for (const c of CASES) {
  test(`${c.name}: with a profile, a right answer adds ${c.gain ?? 1} ${c.area} point${(c.gain ?? 1) > 1 ? 's' : ''} and the badge shows it`, async ({ page }) => {
    const errors = watchErrors(page);
    await open(page, c.path, c.age);
    await expect(page.locator('#ys-pts')).toHaveText('0 points');
    await c.play(page);
    const n = c.gain ?? 1;
    expect(await stored(page)).toEqual(want(c.area, n));
    await expect(page.locator('#ys-pts')).toHaveText(`${n} point${n === 1 ? '' : 's'}`);
    expect(await keys(page), 'the only new key is sprouts:points').toEqual([PTS_KEY, 'ys-profile']);
    expect(errors).toEqual([]);
  });

  test(`${c.name}: with no profile, playing stores nothing`, async ({ page, context }) => {
    await open(page, c.path, null);
    await c.play(page);
    expect((await storedData(page, context)).local).toEqual([]);
    await expect(page.locator('#ys-badge')).toHaveCount(0);
  });
}

test('the calm corner gives no points on purpose: it is calm play with no score', async ({ page }) => {
  await open(page, '/calm.html', 6);
  await expect(page.locator('#ys-pts')).toHaveText('0 points');
  const calm = await (await page.request.get('/assets/calm.js')).text();
  expect(calm).not.toContain('YSPoints');
  expect(await stored(page)).toBeNull();
});

test.describe('one question gives at most one point', () => {
  test('tapping the right tile again, or waiting, adds nothing more', async ({ page }) => {
    await open(page, '/money.html', 7);
    await page.locator('#play-count').click();
    const r = await page.evaluate(() => (window as any).YS_SHELL.current());
    const right = page.locator(`#choices button[data-v="${r.ans}"]`);
    await right.click();
    await right.click({ force: true });
    await right.click({ force: true });
    expect(await stored(page)).toEqual(want('maths', 1));
    // The next round is a new question: one more point.
    await page.locator('#more').click();
    await shellRight(page);
    expect(await stored(page)).toEqual(want('maths', 2));
  });

  test('a right answer after a miss still counts once', async ({ page }) => {
    await open(page, '/number-bonds.html', 6);
    await page.locator('#play-bonds').click();
    const r = await page.evaluate(() => (window as any).YS_BONDS.current());
    await page.locator(`#choices button:not([data-v="${r.ans}"])`).first().click();
    expect(await stored(page)).toBeNull();
    await page.locator(`#choices button[data-v="${r.ans}"]`).click();
    expect(await stored(page)).toEqual(want('maths', 1));
  });

  test('Find the pairs gives one point for the whole board, not one per pair', async ({ page }) => {
    await open(page, '/brain.html', 3);
    await page.locator('#play-memory').click();
    const cards: string[] = (await page.evaluate(() => (window as any).YS_SHELL.current())).cards;
    const done = new Set<number>();
    for (let i = 0; i < cards.length; i++) {
      if (done.has(i)) continue;
      const j = cards.indexOf(cards[i], i + 1);
      done.add(i); done.add(j);
      await page.locator(`#board button[data-i="${i}"]`).click();
      await page.locator(`#board button[data-i="${j}"]`).click();
    }
    await expect(page.locator('#sub')).toHaveClass(/\byes\b/);
    expect(await stored(page)).toEqual(want('world', 1));
  });

  test('a library book gives its 2 points once, even when "The end." is shown again', async ({ page }) => {
    await open(page, '/library.html', 6);
    await finishBook(page);
    await page.locator('#rprev').click();
    await page.locator('#rnext').click();
    await expect(page.locator('#ltheend')).toBeVisible();
    await page.locator('#lagain').click();
    for (let guard = 0; guard < 60 && !(await page.locator('#ltheend').isVisible()); guard++) await page.locator('#rnext').click();
    expect(await stored(page)).toEqual(want('english', 2));
  });
});

test.describe('the badge shows the total and the split', () => {
  test('total, then "Maths M · English E", and World only once there are world points; it updates at once', async ({ page }) => {
    await open(page, '/sprouts.html', 6);
    await expect(page.locator('#ys-pts')).toHaveText('0 points');
    await expect(page.locator('#ys-split')).toHaveText('Maths 0 · English 0');
    await expect(page.locator('#ys-badge')).toHaveAccessibleName('Profile, age 6. 0 points: 0 maths, 0 English, 0 world.');
    // No waiting for the once-a-second refresh: read the badge in the same task as the add.
    const now = await page.evaluate(() => {
      (window as any).YSPoints.add('english', 1);
      return [document.getElementById('ys-pts')!.textContent, document.getElementById('ys-split')!.textContent];
    });
    expect(now).toEqual(['1 point', 'Maths 0 · English 1']);
    await page.evaluate(() => { (window as any).YSPoints.add('maths', 2); (window as any).YSPoints.add('world', 1); });
    await expect(page.locator('#ys-pts')).toHaveText('4 points');
    await expect(page.locator('#ys-split')).toHaveText('Maths 2 · English 1 · World 1');
    await expect(page.locator('#ys-badge')).toHaveAccessibleName('Profile, age 6. 4 points: 2 maths, 1 English, 1 world.');
    expect(await stored(page)).toEqual({ maths: 2, english: 1, world: 1 });
  });

  test('the maths page\'s own points count as maths', async ({ page }) => {
    await open(page, '/sprouts.html', 6);
    await page.evaluate(() => {
      localStorage.setItem('sprouts:demo', JSON.stringify({ points: 30 }));
      localStorage.setItem('sprouts:points', JSON.stringify({ maths: 1, english: 4, world: 0 }));
    });
    await expect(page.locator('#ys-pts')).toHaveText('35 points');
    await expect(page.locator('#ys-split')).toHaveText('Maths 31 · English 4');
    expect(await page.evaluate(() => (window as any).YSPoints.totals())).toEqual({ maths: 31, english: 4, world: 0, total: 35 });
  });

  test('the profile shows the same split, and Delete progress clears sprouts:points', async ({ page }) => {
    await open(page, '/sprouts.html', 6);
    await page.evaluate(() => localStorage.setItem('sprouts:points', JSON.stringify({ maths: 3, english: 2, world: 1 })));
    await page.reload();
    await page.locator('#ys-badge').click();
    await expect(page.locator('#ys-ptext')).toHaveText('Progress on this device: 6 points (3 maths, 2 English, 1 world).');
    await page.locator('#ys-reset').click();
    await page.locator('#ys-wipe').click();
    expect(await stored(page)).toBeNull();
    await expect(page.locator('#ys-pts')).toHaveText('0 points');
    await expect(page.locator('#ys-split')).toHaveText('Maths 0 · English 0');
    expect(await keys(page)).toEqual(['ys-profile']);
  });

  test('YSPoints.add stores nothing without a child profile, also with comfort settings only', async ({ page }) => {
    await open(page, '/sprouts.html', null);
    expect(await page.evaluate(() => (window as any).YSPoints.add('maths', 1))).toBe(false);
    await page.evaluate(() => localStorage.setItem('ys-profile', JSON.stringify({ comfort: ['calm'] })));
    expect(await page.evaluate(() => (window as any).YSPoints.add('english', 1))).toBe(false);
    expect(await keys(page)).toEqual(['ys-profile']);
  });

  for (const width of [0, 320]) {
    test(`with big numbers in every subject the badge fits and passes the accessibility scan${width ? ' at 320 px' : ''}`, async ({ page }) => {
      if (width) await page.setViewportSize({ width, height: 700 });
      await open(page, '/money.html', 7);
      await page.evaluate(() => localStorage.setItem('sprouts:points', JSON.stringify({ maths: 1234, english: 567, world: 89 })));
      await page.reload();
      await expect(page.locator('#ys-split')).toHaveText('Maths 1234 · English 567 · World 89');
      await expect(page.locator('#ys-badge')).toBeInViewport({ ratio: 1 });
      expect(await horizontalOverflow(page), 'overflow').toBeLessThanOrEqual(1);
      expect(await axeViolations(page, '#ys-badge')).toEqual([]);
    });
  }
});
