import { test, expect, type Page } from '@playwright/test';
import { url } from '../support/site';
import { axeViolations, expectNothingStored, watchRequests } from '../support/checks';
import { knownBug } from '../support/known-bugs';

// The Time calculator. SCRUM-386 (first written for SCRUM-368).
// Expected numbers below were worked out by hand: a year is 365 days and a waking day is 16 hours.

const out = (page: Page) => page.locator('#out');
const hours = (page: Page) => page.locator('#hours');
const back = (page: Page) => page.locator('#back');

test.beforeEach(async ({ page }) => {
  knownBug();
  await page.goto(url('time-calculator'));
});

test('starts with 3 hours and 30 minutes and shows the worked-out result', async ({ page }) => {
  await expect(page.locator('#calc')).toBeVisible();
  await expect(hours(page)).toHaveValue('3');
  await expect(back(page)).toHaveValue('30');
  await expect(out(page)).toContainText('At 3 hours a day, a year adds up to about 1,095 hours, or about 68 whole waking days');
  await expect(out(page)).toContainText('Winning back 30 minutes a day is about 183 hours a year, or around 11 waking days');
  await expect(page.locator('#ex-h')).toHaveText('Another example');
});

const CASES = [
  // hours a day, minutes back, hours a year, waking days a year, hours back a year, waking days back, warning?
  { h: '5', back: '30', yearHours: '1,825', yearDays: '114', backHours: '183', backDays: '11', warn: false },
  { h: '0.25', back: '15', yearHours: '91', yearDays: '6', backHours: '91', backDays: '6', warn: false },
  { h: '1', back: '60', yearHours: '365', yearDays: '23', backHours: '365', backDays: '23', warn: false },
  { h: '24', back: '60', yearHours: '8,760', yearDays: '548', backHours: '365', backDays: '23', warn: false },
  { h: '0.5', back: '60', yearHours: '183', yearDays: '11', backHours: '365', backDays: '23', warn: true },
  { h: '2.5', back: '15', yearHours: '913', yearDays: '57', backHours: '91', backDays: '6', warn: false },
];

for (const c of CASES) {
  test(`${c.h} hours a day and ${c.back} minutes back gives the right numbers`, async ({ page }) => {
    await hours(page).fill(c.h);
    await back(page).selectOption(c.back);
    await expect(out(page)).toContainText(`At ${c.h} hours a day, a year adds up to about ${c.yearHours} hours, or about ${c.yearDays} whole waking days (counting 16 waking hours a day).`);
    await expect(out(page)).toContainText(`Winning back ${c.back} minutes a day is about ${c.backHours} hours a year, or around ${c.backDays} waking days.`);
    const warning = 'That is more than you entered, so try a smaller amount.';
    if (c.warn) await expect(out(page)).toContainText(warning); else await expect(out(page)).not.toContainText(warning);
  });
}

for (const bad of ['', '-1', '24.5', '25', '1000']) {
  test(`asks for a number between 0 and 24 when the hours field holds "${bad}"`, async ({ page }) => {
    await hours(page).fill(bad);
    await expect(out(page)).toHaveText('Enter a number of hours between 0 and 24.');
  });
}

test('the fixed example on the page agrees with what the calculator works out', async ({ page }) => {
  const example = await page.locator('#static-example p').innerText();
  for (const n of ['3 hours a day', '1,095 hours', '68 whole waking days', '30 minutes a day', '183 hours a year', '11 waking days']) expect(example).toContain(n);
});

test('works with the keyboard: tab order, arrow keys, and Enter does not reload the page', async ({ page }) => {
  await hours(page).focus();
  await page.keyboard.press('Tab');
  await expect(back(page)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(back(page)).toHaveValue('60');
  await expect(out(page)).toContainText('Winning back 60 minutes a day');
  await hours(page).focus();
  const before = page.url();
  await page.keyboard.press('Enter');
  expect(page.url()).toBe(before);
  await expect(page.locator('#calc')).toBeVisible();
});

test('fields have labels and the result is announced to screen readers', async ({ page }) => {
  await expect(page.getByLabel('Hours on my phone per day')).toHaveAttribute('id', 'hours');
  await expect(page.getByLabel('Minutes per day I would like back')).toHaveAttribute('id', 'back');
  await expect(out(page)).toHaveAttribute('role', 'status');
  await expect(out(page)).toHaveAttribute('aria-live', 'polite');
});

test('says plainly that it is arithmetic and does not measure the phone', async ({ page }) => {
  await expect(page.locator('main')).toContainText('It does not measure your phone, and nothing you type leaves this page.');
});

test('accessibility scan passes with a result and with the error message showing', async ({ page }) => {
  expect(await axeViolations(page, 'main'), 'with a result').toEqual([]);
  await hours(page).fill('99');
  expect(await axeViolations(page, 'main'), 'with the error message').toEqual([]);
});

test('typing numbers stores nothing and sends nothing', async ({ page, context, baseURL }) => {
  const requests = watchRequests(page);
  await hours(page).fill('7.5');
  await back(page).selectOption('15');
  expect(requests.carryingData(), 'requests that could carry what the visitor typed').toEqual([]);
  expect(requests.external(new URL(baseURL!).origin), 'requests to other sites').toEqual([]);
  await expectNothingStored(page, context);
});
