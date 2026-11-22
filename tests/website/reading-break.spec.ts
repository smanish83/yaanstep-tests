import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';
import { knownBug } from '../support/known-bugs';

// The "All done for now" screen on the reading pages (SCRUM-474 items 1 and 2, added 22 Nov 2026):
// a movement break, and a choice of something different to play next. No timers, no streaks,
// no rewards for time spent, nothing stored. The words below are written out here, not read from the page's code.

test.beforeEach(() => { knownBug(); });

const MOVES = [
  'Stand up and reach up high, like a tall tree.',
  'Hop like a frog: three small hops.',
  'Wiggle your fingers, then wiggle your toes.',
  'March on the spot and count to ten.',
  'Shrug your shoulders up and down three times.',
  'Clap your hands above your head, then by your knees.',
];
/** Word beats: the number of beats for every word the game may show. */
const BEATS: Record<string, number> = {
  cat: 1, dog: 1, sun: 1, bus: 1, cup: 1, pig: 1, hat: 1, fish: 1, ball: 1, moon: 1, book: 1, bed: 1, egg: 1, duck: 1, milk: 1,
  apple: 2, igloo: 2, carrot: 2, rocket: 2, pencil: 2, teapot: 2, banana: 3, umbrella: 3, octopus: 3,
};

async function finishWordBeats(page: Page) {
  await page.goto('/sounds.html');
  await page.locator('#play-beats').click();
  for (let r = 0; r < 8; r++) {
    const word = (await page.locator('#beatpic').getAttribute('data-word'))!;
    await page.locator(`#area button.choice[data-beats="${BEATS[word]}"]`).click();
    await page.locator('#more').click();
  }
  await expect(page.locator('#alldone')).toBeVisible();
}

test('after a set, All done offers a movement break and other games, with no timer or streak words', async ({ page, context }) => {
  await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204 }));
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await finishWordBeats(page);
  const move = (await page.locator('#moveit').innerText()).replace(/^Move break:\s*/, '').replace(/\s*Grown-up: you can do it together\.$/, '');
  expect(MOVES).toContain(move);
  const done = await page.locator('#alldone').innerText();
  expect(done).not.toMatch(/second|minute|timer|streak|points|hurry|lose|miss/i);
  await expect(page.locator('#nextgames button')).toHaveText(['First sounds']);
  expect(await page.locator('#nextgames a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual(['rhymes.html', 'sentences.html', 'stories.html']);
  await page.locator('#nextgames button').click();
  await expect(page.locator('#title')).toHaveText('First sounds');
  await expect(page.locator('#count')).toHaveText('Round 1 of 8');
  await expect(page.locator('#alldone')).toBeHidden();
  expect(errors).toEqual([]);
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect(reqs.sending()).toEqual([]);
  const s = await storedData(page, context);
  expect(s.local).toEqual([]);
  expect(s.cookies).toEqual([]);
});

test('Keep playing after the break gives one fresh break block, not two', async ({ page }) => {
  await finishWordBeats(page);
  await page.locator('#keep').click();
  for (let r = 0; r < 8; r++) {
    const word = (await page.locator('#beatpic').getAttribute('data-word'))!;
    await page.locator(`#area button.choice[data-beats="${BEATS[word]}"]`).click();
    await page.locator('#more').click();
  }
  await expect(page.locator('#alldone')).toBeVisible();
  await expect(page.locator('#afterdone')).toHaveCount(1);
});

test('the other reading pages load the same break screen', async ({ request }) => {
  for (const p of ['rhymes', 'sentences']) expect(await (await request.get(`/${p}.html`)).text()).toContain('src="assets/rd-break.js"');
});

test('the break screen: buttons and links are at least 48 px high, it fits 320 px and passes the accessibility scan', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await finishWordBeats(page);
  for (const b of await page.locator('#alldone button, #alldone a').all()) {
    expect((await b.boundingBox())!.height, await b.innerText()).toBeGreaterThanOrEqual(47.5);
  }
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  expect(await axeViolations(page)).toEqual([]);
});
