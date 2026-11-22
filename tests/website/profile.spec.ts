import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';
import { knownBug } from '../support/known-bugs';

// The child's age, the avatar and the points on the learning pages (SCRUM-487, added 22 Nov 2026).
// Manish asked: ask the child's age, show only what fits, an avatar made from the age that is always
// visible with the points below it, tap it to switch age, and a profile to set. Kept only in this browser.

test.beforeEach(() => { knownBug(); });

const KEY = 'ys-profile';
const GAMES = ['Maths', 'Reading', 'Story time', 'Sounds and beats', 'Parts of a sentence', 'Rhymes and letter teams'];
/** The games each age should see on the Learning page, written out from the age tags on the cards. */
const FITS: Record<number, string[]> = {
  3: ['Maths', 'Reading', 'Story time', 'Rhymes and letter teams'],
  4: ['Maths', 'Reading', 'Story time', 'Sounds and beats', 'Rhymes and letter teams'],
  5: GAMES,
  6: GAMES,
  7: ['Maths', 'Reading', 'Story time', 'Parts of a sentence', 'Rhymes and letter teams'],
  8: ['Maths'],
  12: ['Maths'],
};
const STAGE: Record<number, string> = {
  3: 'seed', 4: 'seed', 5: 'sprout', 6: 'sprout', 7: 'small plant', 8: 'small plant',
  9: 'plant with a bud', 10: 'plant with a bud', 11: 'plant in flower', 12: 'plant in flower',
};
const LEARNING_PAGES = ['learning', 'maths', 'reading', 'sounds', 'rhymes', 'sentences', 'stories'];

const visibleGames = (page: Page) => page.locator('.games-cards li:visible h3').allTextContents();
const stored = (page: Page) => page.evaluate((k) => localStorage.getItem(k), KEY);
async function withProfile(page: Page, p: { age: number; color?: number; nick?: string }, path = '/learning.html', points?: number) {
  await page.goto(path);
  await page.evaluate(([k, v, pts]) => {
    localStorage.setItem(k as string, v as string);
    if (pts != null) localStorage.setItem('sprouts:demo', JSON.stringify({ points: pts, lastDay: null, streak: 0, restDaysUsed: { week: -1, used: 0 }, milestones: {} }));
  }, [KEY, JSON.stringify({ color: 0, nick: '', ...p }), points ?? null]);
  await page.reload();
}

test('first visit to Learning asks the age, shows every game, stores nothing and shows no avatar yet', async ({ page, context }) => {
  await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204 }));
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await page.goto('/learning.html');
  await expect(page.locator('#ys-ask h2')).toHaveText('How old is your child?');
  await expect(page.locator('#ys-ask')).toContainText('kept only on this device');
  await expect(page.locator('#ys-ask .ys-ages button')).toHaveText(['3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
  expect(await visibleGames(page)).toEqual(GAMES);
  await expect(page.locator('#ys-badge')).toHaveCount(0);
  const s = await storedData(page, context);
  expect(s.local).toEqual([]);
  expect(s.cookies).toEqual([]);
  expect(errors).toEqual([]);
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
});

test('"Show everything" on the age question closes it and stores nothing', async ({ page }) => {
  await page.goto('/learning.html');
  await page.locator('#ys-skip').click();
  await expect(page.locator('#ys-ask')).toHaveCount(0);
  expect(await visibleGames(page)).toEqual(GAMES);
  expect(await stored(page)).toBeNull();
});

for (const age of Object.keys(FITS).map(Number)) {
  test(`picking age ${age} keeps only the age on this device and shows only the games that fit`, async ({ page, context }) => {
    const reqs = watchRequests(page);
    await page.goto('/learning.html');
    await page.locator(`#ys-ask button[data-age="${age}"]`).click();
    await expect(page.locator('#ys-ask')).toHaveCount(0);
    expect(JSON.parse((await stored(page))!)).toEqual({ age, color: 0, nick: '' });
    expect((await storedData(page, context)).local).toEqual([KEY]);
    expect(reqs.sending()).toEqual([]);
    expect(await visibleGames(page)).toEqual(FITS[age]);
    await expect(page.locator('#ys-badge')).toBeVisible();
    await expect(page.locator('#ys-badge')).toBeFocused();
    if (FITS[age].length < GAMES.length) {
      await expect(page.locator('#ys-filter-text')).toHaveText(`Showing what fits age ${age}.`);
      await page.locator('#ys-showall').click();
      expect(await visibleGames(page)).toEqual(GAMES);
      await expect(page.locator('#ys-showall')).toHaveText(`Only age ${age}`);
      await page.locator('#ys-showall').click();
      expect(await visibleGames(page)).toEqual(FITS[age]);
    } else {
      await expect(page.locator('#ys-filter')).toHaveCount(0);
    }
  });
}

test('the lesson cards follow the age too: Same and different for ages 3 to 4, the maths games from 6', async ({ page }) => {
  await withProfile(page, { age: 3 });
  expect(await page.locator('#learn .lesson-cards > li[data-ages]').evaluateAll((ls) => ls.map((l) => (l as HTMLElement).hidden))).toEqual([false, true]);
  await withProfile(page, { age: 9 });
  expect(await page.locator('#learn .lesson-cards > li[data-ages]').evaluateAll((ls) => ls.map((l) => (l as HTMLElement).hidden))).toEqual([true, false]);
});

for (const age of Object.keys(STAGE).map(Number)) {
  test(`age ${age}: the avatar is a ${STAGE[age]}, drawn by the page`, async ({ page }) => {
    await withProfile(page, { age });
    await expect(page.locator('#ys-badge svg')).toHaveAttribute('data-stage', STAGE[age]);
    await expect(page.locator('#ys-badge img')).toHaveCount(0);
    await expect(page.locator('#ys-badge')).toHaveAttribute('data-age', String(age));
  });
}

test('the avatar shows the points below it, and the count follows the maths points', async ({ page }) => {
  await withProfile(page, { age: 6 }, '/learning.html', 30);
  await expect(page.locator('#ys-pts')).toHaveText('30 points');
  const badge = (await page.locator('#ys-badge svg').boundingBox())!;
  const pts = (await page.locator('#ys-pts').boundingBox())!;
  expect(pts.y, 'points sit below the avatar').toBeGreaterThan(badge.y + badge.height - 1);
  await expect(page.locator('#ys-badge')).toHaveAccessibleName('Profile, age 6. 30 points');
  await page.evaluate(() => localStorage.setItem('sprouts:demo', JSON.stringify({ points: 1 })));
  await expect(page.locator('#ys-pts')).toHaveText('1 point');
});

for (const p of LEARNING_PAGES) {
  test(`${p}: with a profile, the avatar is always visible in the corner, even after scrolling`, async ({ page }) => {
    const errors = watchErrors(page);
    await withProfile(page, { age: 5 }, `/${p}.html`);
    const badge = page.locator('#ys-badge');
    await expect(badge).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(badge).toBeInViewport();
    expect(await badge.evaluate((b) => getComputedStyle(b).position)).toBe('fixed');
    expect(errors).toEqual([]);
  });
}

test('pages outside learning show no avatar', async ({ page }) => {
  await withProfile(page, { age: 5 }, '/index.html');
  await expect(page.locator('#ys-badge')).toHaveCount(0);
});

test('tapping the avatar opens the profile: switch age, pick a color, add a nickname, save', async ({ page }) => {
  await withProfile(page, { age: 5 });
  await page.locator('#ys-badge').click();
  const dlg = page.locator('#ys-profile');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('h2')).toHaveText("Your child's profile");
  await expect(dlg).toContainText('Please use a nickname, not a full name.');
  await expect(dlg).toContainText('kept only on this device. Nothing is sent.');
  await expect(dlg.locator('input[type=file]')).toHaveCount(0);
  await expect(dlg.locator('.ys-dages button[aria-pressed="true"]')).toHaveText('5');
  await dlg.locator('.ys-dages button[data-age="8"]').click();
  await expect(page.locator('#ys-pvtext')).toHaveText('Age 8: a small plant.');
  await dlg.locator('.ys-colors button[aria-label="Blue"]').click();
  await expect(dlg.locator('.ys-colors button[aria-pressed="true"]')).toHaveAttribute('aria-label', 'Blue');
  await dlg.locator('#ys-nickin').fill('Bo1@x');
  await dlg.locator('#ys-save').click();
  await expect(dlg).toBeHidden();
  expect(JSON.parse((await stored(page))!)).toEqual({ age: 8, color: 1, nick: 'Box' });
  await expect(page.locator('#ys-badge svg')).toHaveAttribute('data-stage', 'small plant');
  await expect(page.locator('#ys-nick')).toHaveText('Box');
  expect(await visibleGames(page)).toEqual(FITS[8]);
  await expect(page.locator('#ys-badge')).toBeFocused();
});

test('Close leaves the profile as it was', async ({ page }) => {
  await withProfile(page, { age: 4 });
  await page.locator('#ys-badge').click();
  await page.locator('#ys-profile .ys-dages button[data-age="10"]').click();
  await page.locator('#ys-cancel').click();
  await expect(page.locator('#ys-profile')).toBeHidden();
  expect(JSON.parse((await stored(page))!).age).toBe(4);
  await expect(page.locator('#ys-badge svg')).toHaveAttribute('data-stage', 'seed');
});

test('Remove profile deletes it from this device and the age question comes back', async ({ page, context }) => {
  await withProfile(page, { age: 7, nick: 'Ana' });
  await page.locator('#ys-badge').click();
  await page.locator('#ys-remove').click();
  await expect(page.locator('#ys-badge')).toHaveCount(0);
  await expect(page.locator('#ys-ask')).toBeVisible();
  expect(await visibleGames(page)).toEqual(GAMES);
  expect((await storedData(page, context)).local).toEqual([]);
});

test('maths opens on the band for the age, and "Show everything" brings back the other bands', async ({ page }) => {
  await withProfile(page, { age: 5 }, '/maths.html');
  await expect(page.locator('#bands button:visible')).toHaveText(['Ages 5 to 6']);
  await page.locator('#ys-showall').click();
  await expect(page.locator('#bands button:visible')).toHaveCount(5);
  await withProfile(page, { age: 12 }, '/maths.html');
  await expect(page.locator('#bands button:visible')).toHaveText(['Ages 11 to 12']);
});

test('Story time lists the stories for the age; an older child sees them all', async ({ page }) => {
  await withProfile(page, { age: 4 }, '/stories.html');
  await expect(page.locator('#storylist button:visible')).toHaveCount(2);
  await expect(page.locator('#story-ball')).toBeVisible();
  await expect(page.locator('#story-rain')).toBeVisible();
  await withProfile(page, { age: 6 }, '/stories.html');
  await expect(page.locator('#storylist button:visible')).toHaveCount(2);
  await expect(page.locator('#story-boat')).toBeVisible();
  await withProfile(page, { age: 9 }, '/stories.html');
  await expect(page.locator('#storylist button:visible')).toHaveCount(4);
  await expect(page.locator('#ys-filter')).toHaveCount(0);
});

test('the privacy page says what the profile keeps', async ({ page }) => {
  await page.goto('/privacy.html');
  await expect(page.locator('main')).toContainText('keeps that age, a color and an optional nickname in your browser');
  await expect(page.locator('main')).toContainText('there is no photo upload');
});

test('buttons are at least 48 by 48 px: the age question, the avatar and the profile', async ({ page }) => {
  const check = async (sel: string) => {
    for (const b of await page.locator(sel).all()) {
      const box = (await b.boundingBox())!;
      expect(box.width, await b.innerText()).toBeGreaterThanOrEqual(47.5);
      expect(box.height, await b.innerText()).toBeGreaterThanOrEqual(47.5);
    }
  };
  await page.goto('/learning.html');
  await check('#ys-ask button');
  await page.locator('#ys-ask button[data-age="6"]').click();
  await check('#ys-badge, #ys-filter button');
  await page.locator('#ys-badge').click();
  await check('#ys-profile button:visible');
});

for (const view of ['age question', 'with a profile', 'profile open'] as const) {
  for (const width of [0, 320]) {
    test(`profile: ${view} fits the screen and passes the accessibility scan${width ? ' at 320 px' : ''}`, async ({ page }) => {
      if (width) await page.setViewportSize({ width, height: 700 });
      if (view === 'age question') await page.goto('/learning.html');
      else await withProfile(page, { age: 7, nick: 'Mo' });
      if (view === 'profile open') await page.locator('#ys-badge').click();
      expect(await horizontalOverflow(page), 'overflow').toBeLessThanOrEqual(1);
      expect(await axeViolations(page), view).toEqual([]);
    });
  }
}
