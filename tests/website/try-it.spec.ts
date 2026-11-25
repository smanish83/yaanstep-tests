import { test, expect, type Page } from '../support/test';
import { url } from '../support/site';
import { APPROVED_STEPS, SHAME_WORDS } from '../support/approved-steps';
import { axeViolations, expectNothingStored, watchRequests } from '../support/checks';
import { knownBug } from '../support/known-bugs';

// The "Try a tiny step" demo. SCRUM-386 (first written for SCRUM-367 and SCRUM-369).

const PROFILES: { value: string; label: string }[] = [
  { value: 'student', label: 'Student' },
  { value: 'seeker', label: 'Job seeker' },
  { value: 'manager', label: 'Manager' },
  { value: 'desk', label: 'Desk job' },
  { value: 'teen', label: 'Teen (13 to 17)' },
];

const tiny = (page: Page) => page.locator('#tiny');
const start = (page: Page) => page.locator('#start');
const another = (page: Page) => page.locator('#another');
const countdown = (page: Page) => page.locator('#countdown');
const result = (page: Page) => page.locator('#result');

test.beforeEach(async ({ page }) => {
  knownBug();
  await page.clock.install();
  await page.goto(url('try-it'));
});

test('shows the demo, says the steps are untested drafts and that nothing is saved', async ({ page }) => {
  await expect(page.locator('#demo')).toBeVisible();
  await expect(page.locator('main')).toContainText('have not been tested with real users');
  await expect(page.locator('main')).toContainText('Nothing you pick is saved or sent anywhere');
  await expect(page.locator('#examples-h')).toHaveText('More examples of tiny steps');
  await expect(page.locator('input[name=profile]:checked')).toHaveValue('student');
});

for (const profile of PROFILES) {
  test(`${profile.label}: every step shown is an approved step, word for word`, async ({ page }) => {
    await page.getByLabel(profile.label, { exact: true }).check();
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      const step = (await tiny(page).innerText()).trim();
      if (seen.includes(step)) break;
      seen.push(step);
      if (await another(page).isHidden()) break;
      await another(page).click();
    }
    expect(seen.length).toBeGreaterThanOrEqual(1);
    for (const step of seen) expect(APPROVED_STEPS[profile.value], `"${step}" is not in doc 05 or doc 11`).toContain(step);
    // A profile with one step has nothing to switch to, so the button is hidden.
    if (seen.length === 1) await expect(another(page)).toBeHidden(); else await expect(another(page)).toBeVisible();
  });
}

test('"Show me a different step" goes round the list and comes back to the first step', async ({ page }) => {
  const first = await tiny(page).innerText();
  await another(page).click();
  await expect(tiny(page)).not.toHaveText(first);
  await another(page).click();
  await another(page).click();
  await expect(tiny(page)).toHaveText(first);
});

test('changing profile starts again at that profile\'s first step', async ({ page }) => {
  await another(page).click();
  await page.getByLabel('Manager', { exact: true }).check();
  await expect(tiny(page)).toHaveText(APPROVED_STEPS.manager[0]);
});

test('the no-JavaScript table lists approved steps only', async ({ page }) => {
  const all = Object.values(APPROVED_STEPS).flat();
  for (const cell of await page.locator('#static-list tbody tr td:nth-child(2)').allInnerTexts()) expect(all, cell).toContain(cell.trim());
});

test('Start Now opens a 10 second countdown, locks the choices and moves focus to "Not now"', async ({ page }) => {
  await start(page).click();
  await expect(countdown(page)).toBeVisible();
  await expect(page.locator('#count-text')).toHaveText('10');
  await expect(start(page)).toBeDisabled();
  await expect(another(page)).toBeDisabled();
  for (const r of await page.locator('input[name=profile]').all()) await expect(r).toBeDisabled();
  await expect(page.locator('#cancel')).toBeFocused();
  await expect(result(page)).toBeHidden();
});

test('the countdown counts down one second at a time', async ({ page }) => {
  await start(page).click();
  await page.clock.runFor(3_100);
  await expect(page.locator('#count-text')).toHaveText('7');
  await page.clock.runFor(4_000);
  await expect(page.locator('#count-text')).toHaveText('3');
});

test('when the countdown ends it says Go with the same step, then gets out of the way', async ({ page }) => {
  const step = (await tiny(page).innerText()).replace(/\.$/, '');
  await start(page).click();
  await page.clock.runFor(10_500);
  await expect(countdown(page)).toBeHidden();
  await expect(result(page)).toBeVisible();
  await expect(result(page)).toContainText(`Go! ${step}.`);
  await expect(result(page)).toContainText('you still started');
  await expect(start(page)).toBeEnabled();
  await expect(page.locator('input[name=profile]').first()).toBeEnabled();
});

test('"Not now" stops the countdown kindly and gives focus back to Start Now', async ({ page }) => {
  await start(page).click();
  await page.clock.runFor(2_000);
  await page.locator('#cancel').click();
  await expect(countdown(page)).toBeHidden();
  await expect(result(page)).toHaveText('No problem. Come back when you are ready. Skipping once costs nothing.');
  await expect(start(page)).toBeFocused();
  await expect(start(page)).toBeEnabled();
  // The stopped countdown must not fire later.
  await page.clock.runFor(15_000);
  await expect(result(page)).not.toContainText('Go!');
});

test('no message uses shame wording', async ({ page }) => {
  await start(page).click();
  await page.locator('#cancel').click();
  expect(await result(page).innerText()).not.toMatch(SHAME_WORDS);
  await start(page).click();
  await page.clock.runFor(10_500);
  expect(await result(page).innerText()).not.toMatch(SHAME_WORDS);
});

test('works with the keyboard only', async ({ page }) => {
  await page.locator('input[name=profile]:checked').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('input[name=profile]:checked')).toHaveValue('seeker');
  await expect(tiny(page)).toHaveText(APPROVED_STEPS.seeker[0]);
  await page.keyboard.press('Tab');
  await expect(start(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(countdown(page)).toBeVisible();
  await expect(page.locator('#cancel')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(countdown(page)).toBeHidden();
  await expect(start(page)).toBeFocused();
});

test('screen reader hooks: the step and the result are announced', async ({ page }) => {
  await expect(page.locator('.step-card')).toHaveAttribute('aria-live', 'polite');
  await expect(result(page)).toHaveAttribute('role', 'status');
  await expect(page.locator('#count-text')).toHaveAttribute('role', 'timer');
});

test('accessibility scan passes while the countdown is open and after it ends', async ({ page }) => {
  await start(page).click();
  expect(await axeViolations(page, 'main'), 'countdown open').toEqual([]);
  await page.clock.runFor(10_500);
  expect(await axeViolations(page, 'main'), 'after Go').toEqual([]);
});

test('using the demo stores nothing and sends nothing', async ({ page, context, baseURL }) => {
  const requests = watchRequests(page);
  await page.getByLabel('Desk job', { exact: true }).check();
  await another(page).click();
  await start(page).click();
  await page.clock.runFor(10_500);
  expect(requests.carryingData(), 'requests that could carry what the visitor picked').toEqual([]);
  expect(requests.external(new URL(baseURL!).origin), 'requests to other sites').toEqual([]);
  await expectNothingStored(page, context);
});
