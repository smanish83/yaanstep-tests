import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';
import { knownBug } from '../support/known-bugs';

// The child's age, the avatar and the points on the learning pages (SCRUM-487, added 22 Nov 2026).
// Manish asked: ask the child's age, show only what fits, an avatar made from the age that is always
// visible with the points below it, tap it to switch age, and a profile to set. Kept only in this browser.

test.beforeEach(() => { knownBug(); });

const KEY = 'ys-profile';
// The cards on the Yaanstep Sprouts page and the ages each fits (data-ages), in page order (23 Nov 2026).
const CARDS: [string, number, number][] = [
  // Maths games
  ['Maths', 3, 12], ['Quick maths games', 6, 12], ['Bar models', 5, 12], ['Number bonds', 5, 7], ['Tens and ones', 6, 8],
  ['Fractions', 7, 9], ['Money and coins', 5, 9], ['Clocks and time', 5, 9], ['Big and small', 3, 8],
  // English learning games
  ['Reading', 3, 7], ['Story library', 3, 12], ['Sounds and beats', 4, 6], ['Parts of a sentence', 5, 7], ['Rhymes and letter teams', 3, 7],
  ['Phonogram games', 5, 7], ['Opposites', 3, 8],
  // Brain games and puzzles
  ['Brain games', 3, 8], ['Find the difference', 3, 8], ['Same and different', 3, 5], ['Shapes, colors, numbers and animals', 3, 5],
  // World around us
  ['Learn about the world', 3, 8], ['The Sun and the planets', 3, 8], ['Weather and temperature', 3, 8], ['Slow things to watch', 3, 12], ['Calm corner', 3, 12],
];
const GAMES = CARDS.map((c) => c[0]);
/** The games each age should see on the Yaanstep Sprouts page. */
const FITS: Record<number, string[]> = Object.fromEntries([3, 4, 5, 6, 7, 8, 9, 12].map((age) => [age, CARDS.filter((c) => age >= c[1] && age <= c[2]).map((c) => c[0])]));
const STAGE: Record<number, string> = {
  3: 'seed', 4: 'seed', 5: 'sprout', 6: 'sprout', 7: 'small plant', 8: 'small plant',
  9: 'plant with a bud', 10: 'plant with a bud', 11: 'plant in flower', 12: 'plant in flower',
};
const LEARNING_PAGES = ['sprouts', 'maths', 'bar-models', 'number-bonds', 'tens-and-ones', 'fractions', 'reading', 'sounds', 'rhymes', 'sentences', 'stories', 'library', 'phonograms', 'first-steps', 'money', 'clocks', 'weather', 'topics', 'calm', 'brain', 'watch', 'compare', 'opposites', 'find-difference'];

const visibleGames = (page: Page) => page.locator('.games-cards li:visible h4').allTextContents();
const stored = (page: Page) => page.evaluate((k) => localStorage.getItem(k), KEY);
async function withProfile(page: Page, p: { age: number; color?: number; nick?: string; comfort?: string[] }, path = '/sprouts.html', points?: number) {
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
  await page.goto('/sprouts.html');
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
  await page.goto('/sprouts.html');
  await page.locator('#ys-skip').click();
  await expect(page.locator('#ys-ask')).toHaveCount(0);
  expect(await visibleGames(page)).toEqual(GAMES);
  expect(await stored(page)).toBeNull();
});

for (const age of Object.keys(FITS).map(Number)) {
  test(`picking age ${age} keeps only the age on this device and shows only the games that fit`, async ({ page, context }) => {
    const reqs = watchRequests(page);
    await page.goto('/sprouts.html');
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
      throw new Error(`no age should see every game now (age ${age})`);
    }
  });
}

test('the two games on the page itself follow the age too: Same and different for ages 3 to 5, quick maths from 6', async ({ page }) => {
  await withProfile(page, { age: 3 });
  await expect(page.locator('#start-sorting')).toBeVisible();
  await expect(page.locator('#start-maths-auto')).toBeHidden();
  await withProfile(page, { age: 9 });
  await expect(page.locator('#start-sorting')).toBeHidden();
  await expect(page.locator('#start-maths-auto')).toBeVisible();
});

for (const age of Object.keys(STAGE).map(Number)) {
  test(`age ${age}: the avatar is a ${STAGE[age]}, drawn by the page`, async ({ page }) => {
    await withProfile(page, { age });
    await expect(page.locator('#ys-badge svg')).toHaveAttribute('data-stage', STAGE[age]);
    await expect(page.locator('#ys-badge img')).toHaveCount(0);
    await expect(page.locator('#ys-badge')).toHaveAttribute('data-age', String(age));
  });
}

test('the avatar shows the points below it, split by subject, and the count follows the maths points', async ({ page }) => {
  await withProfile(page, { age: 6 }, '/sprouts.html', 30);
  await expect(page.locator('#ys-pts')).toHaveText('30 points');
  await expect(page.locator('#ys-split')).toHaveText('Maths 30 · English 0');
  const badge = (await page.locator('#ys-badge svg').boundingBox())!;
  const pts = (await page.locator('#ys-pts').boundingBox())!;
  const split = (await page.locator('#ys-split').boundingBox())!;
  expect(pts.y, 'points sit below the avatar').toBeGreaterThan(badge.y + badge.height - 1);
  expect(split.y, 'the split sits below the total').toBeGreaterThan(pts.y + pts.height - 1);
  // Points for every game, split by subject (Manish, 22 Nov 2026): a screen reader hears the split in words.
  await expect(page.locator('#ys-badge')).toHaveAccessibleName('Profile, age 6. 30 points: 30 maths, 0 English, 0 world.');
  await page.evaluate(() => localStorage.setItem('sprouts:demo', JSON.stringify({ points: 1 })));
  await expect(page.locator('#ys-pts')).toHaveText('1 point');
  await expect(page.locator('#ys-split')).toHaveText('Maths 1 · English 0');
});

for (const p of LEARNING_PAGES) {
  test(`${p}: with a profile, the avatar is always visible in the corner, even after scrolling`, async ({ page }) => {
    // Set the profile on another page first, so the reload in withProfile cannot cut off this page's pictures.
    await withProfile(page, { age: 5 }, '/sprouts.html');
    const errors = watchErrors(page);
    await page.goto(`/${p}.html`);
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
  await page.goto('/sprouts.html');
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
      if (view === 'age question') await page.goto('/sprouts.html');
      else await withProfile(page, { age: 7, nick: 'Mo' });
      if (view === 'profile open') await page.locator('#ys-badge').click();
      expect(await horizontalOverflow(page), 'overflow').toBeLessThanOrEqual(1);
      expect(await axeViolations(page), view).toEqual([]);
    });
  }
}

test.describe('Reset progress lives in the child\'s profile (SCRUM-492)', () => {
  const DEMO = JSON.stringify({ points: 40, lastDay: null, streak: 0, restDaysUsed: { week: -1, used: 0 }, milestones: {} });

  test('asks first; "No" keeps progress; "Yes" deletes points, garden and chapters but keeps the profile and settings', async ({ page }) => {
    const errors = watchErrors(page);
    await withProfile(page, { age: 7, nick: 'Sam' }, '/sprouts.html', 40);
    await page.evaluate(() => { localStorage.setItem('sprouts:demo-ch', '["x"]'); localStorage.setItem('demo-garden', '[1]'); localStorage.setItem('set-len', '10'); });
    await page.locator('#ys-badge').click();
    await expect(page.locator('#ys-ptext')).toHaveText('Progress on this device: 40 points (40 maths, 0 English, 0 world).');
    await expect(page.locator('#ys-confirm')).toBeHidden();
    await page.locator('#ys-reset').click();
    await expect(page.locator('#ys-confirm')).toBeVisible();
    await expect(page.locator('#ys-confirm')).toHaveAttribute('role', 'alertdialog');
    await expect(page.locator('#ys-confirm')).toContainText('cannot be undone');
    await expect(page.locator('#ys-keep')).toBeFocused();
    await page.locator('#ys-keep').click();
    await expect(page.locator('#ys-confirm')).toBeHidden();
    await expect(page.locator('#ys-reset')).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem('sprouts:demo'))).toBe(DEMO);
    await page.locator('#ys-reset').click();
    await page.locator('#ys-wipe').click();
    await expect(page.locator('#ys-ptext')).toHaveText('Progress deleted. The games start fresh.');
    await expect(page.locator('#ys-pts')).toHaveText('0 points');
    const left = await page.evaluate(() => Object.keys(localStorage).sort());
    expect(left).toEqual(['set-len', 'ys-profile']);
    expect(errors).toEqual([]);
  });

  test('the maths page points to the profile for reset once a profile exists, and keeps its own Reset without one', async ({ page }) => {
    await page.goto('/maths.html');
    await expect(page.locator('#reset')).toBeVisible();
    await expect(page.locator('#ys-reset-note')).toHaveCount(0);
    await withProfile(page, { age: 8 }, '/maths.html', 40);
    await expect(page.locator('#reset')).toBeHidden();
    await expect(page.locator('#ys-reset-note')).toHaveText("To reset progress, open your child's profile: tap the picture in the corner.");
    await page.locator('#ys-badge').click();
    await page.locator('#ys-reset').click();
    await page.locator('#ys-wipe').click();
    await page.locator('#ys-cancel').click();
    await expect(page.locator('#pts')).toHaveText('0');
  });
});

test.describe('Comfort settings for children who learn in different ways (SCRUM-498)', () => {
  test('the profile offers nine comfort settings, chosen by need, and keeps them in the same key', async ({ page }) => {
    const errors = watchErrors(page);
    await withProfile(page, { age: 6 });
    await page.locator('#ys-badge').click();
    const box = page.locator('#ys-profile .ys-comfort');
    await expect(box.locator('legend')).toHaveText('Comfort settings');
    await expect(box).toContainText('You do not need to tell us why.');
    await expect(box.locator('button')).toHaveCount(9);
    await expect(box.locator('button span')).toHaveText(['Easy reading', 'Calm mode', 'Bigger buttons', 'Strong contrast', 'Break reminders', 'Fewer choices', 'Read questions aloud', 'Quiet rewards', 'Easy-reading font']);
    for (const b of await box.locator('button small').all()) expect((await b.innerText()).length, 'a plain one-line description').toBeGreaterThan(20);
    for (const b of await box.locator('button').all()) await expect(b).toHaveAttribute('aria-pressed', 'false');
    await box.locator('button[data-comfort=easy]').click();
    await box.locator('button[data-comfort=big]').click();
    await expect(box.locator('button[data-comfort=easy]')).toHaveAttribute('aria-pressed', 'true');
    expect(await axeViolations(page, '#ys-profile')).toEqual([]);
    await page.locator('#ys-save').click();
    expect(JSON.parse((await stored(page))!)).toEqual({ age: 6, color: 0, nick: '', comfort: ['easy', 'big'] });
    await expect(page.locator('html')).toHaveClass(/\bys-easy\b/);
    await expect(page.locator('html')).toHaveClass(/\bys-big\b/);
    await expect(page.locator('html')).not.toHaveClass(/\bys-calm\b/);
    expect(Object.keys(await page.evaluate(() => ({ ...localStorage }))).sort()).toEqual([KEY]);
    expect(errors).toEqual([]);
  });

  test('settings carry to every learning page; easy reading spaces the text and calm mode stops all movement', async ({ page }) => {
    await withProfile(page, { age: 6, comfort: ['easy', 'calm', 'big'] });
    for (const path of ['/stories.html', '/maths.html', '/sprouts.html']) {
      await page.goto(path);
      await expect(page.locator('html'), path).toHaveClass(/ys-easy/);
    }
    const css = await page.evaluate(() => {
      const m = getComputedStyle(document.querySelector('main')!);
      return { ls: parseFloat(m.letterSpacing), ws: parseFloat(m.wordSpacing), bg: getComputedStyle(document.body).backgroundColor };
    });
    expect(css.ls).toBeGreaterThan(0);
    expect(css.ws).toBeGreaterThan(0);
    expect(css.bg).toBe('rgb(251, 245, 230)');
    await page.locator('#start-maths-auto').click();
    const anim = await page.locator('#player svg.moving circle').first().evaluate((c) => getComputedStyle(c).animationName);
    expect(anim).toBe('none');
    const small = await page.locator('#player button:visible').evaluateAll((bs) => bs.filter((b) => { const r = b.getBoundingClientRect(); return r.height < 63.5 || r.width < 63.5; }).map((b) => b.textContent));
    expect(small, 'buttons under 64 px with bigger buttons on').toEqual([]);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    expect(await axeViolations(page, 'main')).toEqual([]);
  });

  test('strong contrast makes the text black on white, gives buttons dark edges and underlines links', async ({ page }) => {
    await withProfile(page, { age: 6, comfort: ['contrast'] });
    await expect(page.locator('html')).toHaveClass(/\bys-contrast\b/);
    const look = await page.evaluate(() => {
      const p = document.querySelector('main p')!, b = document.querySelector('main button, main a.btn')!, a = document.querySelector('main a')!;
      return { bg: getComputedStyle(document.body).backgroundColor, text: getComputedStyle(p).color, edge: getComputedStyle(b).borderTopColor, width: parseFloat(getComputedStyle(b).borderTopWidth), line: getComputedStyle(a).textDecorationLine };
    });
    expect(look).toEqual({ bg: 'rgb(255, 255, 255)', text: 'rgb(0, 0, 0)', edge: 'rgb(0, 0, 0)', width: 3, line: 'underline' });
    expect(await axeViolations(page, 'main')).toEqual([]);
  });

  test('break reminders show a calm break after the play time, wait before going back, and stay off unless chosen', async ({ page }) => {
    await page.addInitScript(() => { (window as any).YS_REST_MS = 3000; (window as any).YS_REST_WAIT = 2; });
    await withProfile(page, { age: 6 });
    await page.waitForTimeout(4500);
    await expect(page.locator('#ys-rest')).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
    await withProfile(page, { age: 6, comfort: ['rest'] });
    const rest = page.locator('#ys-rest');
    await expect(rest).toBeVisible({ timeout: 8000 });
    await expect(rest.locator('h2')).toHaveText('Time for a little break');
    await expect(rest).toContainText('stretch your arms');
    const go = page.locator('#ys-rest-go');
    await expect(go).toBeDisabled();
    await expect(go).toHaveText(/^Back to play in \d+$/);
    expect(await axeViolations(page, '#ys-rest')).toEqual([]);
    await expect(go).toBeEnabled({ timeout: 4000 });
    await expect(go).toHaveText('Back to play');
    await expect(go).toBeFocused();
    await go.click();
    await expect(rest).toHaveCount(0);
  });

  test('turning a setting off removes it, and the profile goes back to the plain shape', async ({ page }) => {
    await withProfile(page, { age: 6, comfort: ['calm'] });
    await expect(page.locator('html')).toHaveClass(/ys-calm/);
    await page.locator('#ys-badge').click();
    await page.locator('#ys-profile button[data-comfort=calm]').click();
    await page.locator('#ys-save').click();
    await expect(page.locator('html')).not.toHaveClass(/ys-calm/);
    expect(JSON.parse((await stored(page))!)).toEqual({ age: 6, color: 0, nick: '' });
  });

  test('the accessibility page has the statement for Yaanstep Sprouts, without promises it cannot keep', async ({ page }) => {
    await page.goto('/accessibility.html');
    const part = page.locator('main');
    await expect(page.locator('#sprouts')).toHaveText('Yaanstep Sprouts for every child');
    await expect(part).toContainText('never by a label, and we never ask why');
    await expect(part).toContainText('What does not exist yet');
    await expect(part).toContainText('Nothing here has been tried with children yet.');
    await expect(part).toContainText('makes no health claims');
    const text = await part.innerText();
    for (const bad of [/\bimproves?\b/i, /\btreats?\b/i, /clinically/i, /fully accessible/i, /\bcures?\b/i]) expect(text).not.toMatch(bad);
    await page.goto('/sprouts.html');
    await expect(page.locator('main .notice a[href="accessibility.html#sprouts"]')).toBeVisible();
  });
});

test('the games sit in four frames, and a frame with nothing for the child\'s age is hidden (Manish, 23 Nov 2026)', async ({ page }) => {
  await page.goto('/sprouts.html');
  await expect(page.locator('.games-cards .frame-h')).toHaveText(['Maths games', 'English learning games', 'Brain games and puzzles', 'World around us']);
  await expect(page.locator('.games-cards .frame-h svg.frame-icon[aria-hidden=true]')).toHaveCount(4);
  expect(await axeViolations(page)).toEqual([]);
  await withProfile(page, { age: 12 });
  await expect(page.locator('.frame-puzzles')).toBeHidden();
  await expect(page.locator('.frame-maths')).toBeVisible();
  await page.locator('#ys-showall').click();
  await expect(page.locator('.frame-puzzles')).toBeVisible();
});
