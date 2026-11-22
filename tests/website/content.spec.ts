import { test, expect } from '@playwright/test';
import { site, url } from '../support/site';
import { knownBug } from '../support/known-bugs';
import { APPROVED_STEPS } from '../support/approved-steps';

// Company rules that the public text must keep (Project instructions, Ground rules). SCRUM-386.
// These tests do not judge whether advice is good or age-fit; that is the advisors' review.

/** Claims the site must never make. */
const BANNED_CLAIMS = [
  /nothing leaves (the|your) phone/i, /\bno account\b/i, // no longer true since the cloud decision
  /clinically proven/i, /\bproven to\b/i, /\bguaranteed\b/i, /\bcures?\b/i, /scientifically proven/i, /doctor recommended/i,
  /atomic habits/i, /james clear/i, /tiny habits/i, /bj fogg/i, /power of habit/i, /duhigg/i, // no book titles or author names
];

async function bodyText(page: import('@playwright/test').Page) {
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ');
}

for (const p of site.pages) {
  test.describe(`content rules on ${p}`, () => {
    test('makes no banned claim', async ({ page }) => {
      knownBug();
      await page.goto(url(p));
      const text = await bodyText(page);
      for (const bad of BANNED_CLAIMS) expect.soft(text, `banned: ${bad}`).not.toMatch(bad);
    });

    test('shows no price amount (prices are not approved)', async ({ page }) => {
      knownBug();
      await page.goto(url(p));
      expect((await bodyText(page)).match(/[$€£₹]\s?\d[\d.,]*/g) ?? []).toEqual([]);
    });

    test('does not use the unapproved name "Sprouts" in public', async ({ page }) => {
      knownBug();
      await page.goto(url(p));
      expect(await page.content()).not.toMatch(/sprouts/i);
    });

    test('never calls an advisor a psychologist or therapist', async ({ page }) => {
      knownBug();
      await page.goto(url(p));
      const text = await bodyText(page);
      // Allowed only as a denial ("not psychologists") or as advice to see a real one.
      const hits = text.match(/[^.]*\b(psychologists?|therapists?|counsell?ors?)\b[^.]*\./gi) ?? [];
      const wrong = hits.filter((s) => !/\bnot\b|\btalk to\b|\bsubstitute\b/i.test(s));
      expect(wrong).toEqual([]);
    });

    test('footer says it is not therapy and that the site has no cookies or trackers', async ({ page }) => {
      knownBug();
      await page.goto(url(p));
      const footer = page.locator('footer');
      await expect(footer).toContainText(/not therapy/i);
      await expect(footer).toContainText(/no cookies/i);
      await expect(footer).toContainText(/no trackers/i);
      await expect(footer).toContainText(/ages 13 and up/i);
      await expect(footer).toContainText(/AI agents/);
    });

    test('collects nothing: no form that submits and no field for a name, email or password', async ({ page }) => {
      knownBug();
      await page.goto(url(p));
      expect(await page.locator('form[action], form[method]').count(), 'forms that submit').toBe(0);
      expect(await page.locator('input[type=email], input[type=password], input[type=tel], input[name*=name i], textarea').count(), 'personal fields').toBe(0);
    });
  });
}

test.describe('legal pages', () => {
  for (const p of ['privacy', 'terms']) {
    test(`${p} says it is a draft, written by the AI team, with no lawyer review, and not legal advice`, async ({ page }) => {
      await page.goto(url(p));
      const main = page.locator('main');
      await expect(main).toContainText('DRAFT');
      await expect(main).toContainText(/written by the Yaanstep AI team/i);
      await expect(main).toContainText(/no lawyer has reviewed/i);
      await expect(main).toContainText(/not legal advice/i);
    });
  }
});

test.describe('team page', () => {
  test('every team card is labeled as AI and the page says who the human founder is', async ({ page }) => {
    await page.goto(url('team'));
    const cards = page.locator('main ul.team > li');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(10);
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const text = await card.innerText();
      if (/Manish Sandbhor/.test(text)) { expect(text, 'the founder card carries no AI label').not.toMatch(/\bAI\b/); continue; }
      expect(text, `card ${i + 1}`).toMatch(/AI agent|AI-generated portrait/);
    }
    await expect(page.locator('main')).toContainText(/AI agent, not a person/);
    await expect(page.locator('main')).toContainText('Manish Sandbhor');
  });
});

test.describe('accessibility page', () => {
  test('names the standard it aims for and gives a way to report a problem', async ({ page }) => {
    await page.goto(url('accessibility'));
    await expect(page.locator('main')).toContainText(/WCAG 2\.2/);
    await expect(page.locator('main')).toContainText('hello@yaanstep.com');
  });
});

test('site wording matches the decisions in SCRUM-420: web first, no 60-second promise, no Android-only lines', async ({ page }) => {
  await page.goto(url('index'));
  await expect(page.locator('main')).not.toContainText('Android only');
  await expect(page.locator('main')).not.toContainText('Google Play');
  await page.goto(url('how-it-works'));
  await expect(page.locator('main')).not.toContainText('60 seconds');
  await expect(page.locator('main')).toContainText('10-second countdown');
  await page.goto(url('accessibility'));
  await expect(page.locator('main')).toContainText('automated accessibility scan runs on every page');
  await page.goto(url('testers'));
  await expect(page.locator('main')).toContainText('web app first');
});

test('How it works: example steps are approved steps', async ({ page }) => {
  knownBug();
  await page.goto(url('how-it-works'));
  const approved = Object.values(APPROVED_STEPS).flat().map((s) => s.replace(/\.$/, ''));
  const shown = (await page.locator('main table').first().locator('tbody tr td:last-child').allInnerTexts()).map((s) => s.trim().replace(/\.$/, ''));
  expect(shown.length).toBeGreaterThanOrEqual(4);
  expect(shown.filter((s) => !approved.includes(s)), 'steps that are not in doc 05 or doc 11').toEqual([]);
});
