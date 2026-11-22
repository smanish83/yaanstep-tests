import { bareSprouts } from '../support/checks';
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

    test('uses the product name only in full, as "Yaanstep Sprouts"', async ({ page }) => {
      knownBug();
      await page.goto(url(p));
      expect(bareSprouts(await page.locator('body').innerText())).toEqual([]);
      expect(bareSprouts(await page.title())).toEqual([]);
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
  // Manish, 22 Nov 2026: the AI label is said once, in a small "Please note" box at the top, not on every card.
  test('one small "Please note" box near the top says who is AI; the cards repeat no label; the founder is named', async ({ page }) => {
    await page.goto(url('team'));
    const note = page.locator('main .notice');
    await expect(note).toHaveCount(1);
    await expect(note).toContainText('AI agent, not a person');
    await expect(note).toContainText('each portrait is AI-generated');
    await expect(note).toContainText('Each AI agent has a defined job and area of expertise.');
    await expect(note).toContainText('several of them review anything meant for children before it is published');
    expect(await note.evaluate((n) => n.compareDocumentPosition(document.querySelector('main ul.team')!) & Node.DOCUMENT_POSITION_FOLLOWING), 'note comes before the cards').toBeTruthy();
    const size = await note.evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
    const body = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    expect(size, 'smaller than the body text').toBeLessThan(body);
    expect(size, 'still readable').toBeGreaterThanOrEqual(13);
    const main = await page.locator('main').innerText();
    expect(main.match(/Each AI agent has a defined job/g) ?? [], 'said once').toHaveLength(1);
    expect(main.match(/AI-generated/g) ?? [], 'said once').toHaveLength(1);
    expect(main).not.toContain('AI agent ·');
    const cards = page.locator('main ul.team > li');
    expect(await cards.count()).toBeGreaterThanOrEqual(10);
    // Screen readers still hear it on each picture.
    const alts = await page.locator('main ul.team > li:not(.founder) img').evaluateAll((im) => im.map((i) => i.getAttribute('alt') ?? ''));
    expect(alts.filter((a) => !a.startsWith('AI-generated portrait of '))).toEqual([]);
    await expect(page.locator('main ul.team > li.founder')).toContainText('Manish Sandbhor');
    await expect(page.locator('main ul.team > li.founder')).not.toContainText(/\bAI\b/);
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

// SCRUM-410 rule: no puzzle count (or "endless", "unlimited", "thousands of" puzzles) is stated in public
// unless an automated test proves that many distinct puzzles exist. No count is proven yet, so none may appear.
const LEARNING_PAGES = ['sprouts', 'maths', 'reading', 'bar-models', 'number-bonds', 'tens-and-ones', 'fractions', 'sounds', 'rhymes', 'sentences', 'stories'];
const COUNT_CLAIMS = [
  /\b\d{2,}[\d,]*\+?\s+(different |distinct |unique |new )?(puzzles|questions|problems|games|exercises)\b/i,
  /\b(endless|unlimited|infinite|countless|thousands of|hundreds of|millions of)\s+(puzzles|questions|problems|games|exercises)\b/i,
  /\bnever run out\b/i,
];
for (const p of LEARNING_PAGES) {
  test(`${p}: states no puzzle count that a test has not proven (SCRUM-410)`, async ({ page }) => {
    knownBug();
    await page.goto(url(p));
    // The set-length choice on the maths page ("5 questions, 10 questions, 15 questions") is a setting, not a claim.
    const text = (await bodyText(page)).replace(/Questions in each set.*?\b15 questions\b/, '');
    for (const claim of COUNT_CLAIMS) expect.soft(text, `count claim: ${claim}`).not.toMatch(claim);
  });
}
