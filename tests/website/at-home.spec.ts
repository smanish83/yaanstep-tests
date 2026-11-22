import { test, expect } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';
import { knownBug } from '../support/known-bugs';

// Reading games at home (at-home.html, SCRUM-457, doc 23; added 22 Nov 2026).
// A static page for parents: screen-free games, safety rules first, no claims, nothing stored or sent.

test.beforeEach(() => { knownBug(); });

const GAMES = [
  'Sticky-note sound hunt', 'Mystery sound bag', 'Pizza flip', 'Letter tap', 'Body rhymes',
  'Robot talk', 'Drive and read', 'Sound jump', 'Sound hopscotch', 'Feed the monster', 'Word bowling',
  'Letter swap', 'Build a word', 'Picture match', 'Word treasure hunt', 'Memory pairs',
];
/** The 30 short words from doc 18 (reading step A3). The page may suggest only these for blending games. */
const A3_WORDS = 'sat pat tap pan pin tin sit sip tip nap mat map dad dig dog got cat cap pot kid red run hat hot bed bus bug fun fit hen'.split(' ');

test('lists the sixteen games, each with ages and what you need', async ({ page }) => {
  await page.goto('/at-home.html');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Reading games at home');
  expect(await page.locator('.card h3').allInnerTexts()).toEqual(GAMES);
  for (const meta of await page.locator('.card .meta').allInnerTexts()) expect(meta).toMatch(/^Ages \d to \d · \S/);
});

test('puts the safety rules before the games, including small parts and a grown-up present', async ({ page }) => {
  await page.goto('/at-home.html');
  const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  expect(text.indexOf('Keep it safe')).toBeLessThan(text.indexOf(GAMES[0]));
  expect(text).toContain('A grown-up stays with the child for every game.');
  expect(text).toMatch(/No buttons, beads or coins for children under 4/);
  expect(text).toMatch(/Not yet tried with children/);
});

test('suggests only the reading-step words for blending', async ({ page }) => {
  await page.goto('/at-home.html');
  const words = (await page.locator('.words').innerText()).split(/,\s*/).map((w) => w.trim());
  expect(words).toEqual(A3_WORDS);
});

test('makes no claim that a game improves reading', async ({ page }) => {
  await page.goto('/at-home.html');
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/\b(improves?|boosts?|proven|research|studies show|helps (your )?child(ren)? (learn|read))\b/i);
});

test('is linked from the Learning and Reading pages', async ({ page }) => {
  for (const from of ['/sprouts.html', '/reading.html']) {
    await page.goto(from);
    await expect(page.locator('a[href="at-home.html"]').first()).toBeVisible();
  }
});

test('loads with no errors, asks nothing of other sites, stores nothing, fits 320 px, and passes the axe scan', async ({ page, context }) => {
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/at-home.html');
  expect(errors).toEqual([]);
  expect(reqs.external(new URL(page.url()).origin)).toEqual([]);
  expect(reqs.sending()).toEqual([]);
  const s = await storedData(page, context);
  expect([...s.cookies, ...s.local, ...s.session]).toEqual([]);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  expect(await axeViolations(page)).toEqual([]);
});
