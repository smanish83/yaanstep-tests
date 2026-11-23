import { test, expect } from '@playwright/test';
import { SHAME_WORDS } from '../support/approved-steps';
import { axeViolations, expectNothingStored, horizontalOverflow, watchErrors, watchRequests } from '../support/checks';
import { knownBug } from '../support/known-bugs';
import {
  answerFromPicture, answerFromStory, exit, feedback, next, numberButton, openLearning, playMathsPerfectly,
  playSortingPerfectly, playShadow, PAIR_KINDS, progress, rightAnswer, stage, startMaths, startSorting, story, title, type Kind, type Style,
} from '../support/learning';

// The Learning page (sample lessons for a parent and child). SCRUM-387.
// These tests check that the games work and that the sums are right. They do not check that a lesson
// suits a child of that age: that is the review by Dev, Amara, Leela and Hiroshi (all AI).

const STYLES: Style[] = ['questions', 'dice', 'hunt', 'race', 'line'];
const KINDS: Kind[] = ['add', 'take', 'more'];

test.beforeEach(async ({ page }) => {
  knownBug();
  await openLearning(page);
});

test.describe('what the page tells a parent', () => {
  test('one short note at the top says the games are samples made by AI, not tested with children, and nothing is recorded or sent (Manish, 23 Nov 2026)', async ({ page }) => {
    const notice = page.locator('main .notice[role=note]');
    await expect(notice).toHaveCount(1);
    await expect(notice).toContainText("free samples made by Yaanstep's AI team, not yet tested with children");
    await expect(notice).toContainText('No sign-in and no ads; nothing is recorded or sent, and only points are kept on this device, with a child profile.');
    await expect(page.locator('main .lead')).toContainText('Short lessons and games to try with your child.');
  });

  test('the cards no longer repeat the age or the voice and privacy lines (Manish, 23 Nov 2026)', async ({ page }) => {
    const cards = page.locator('.games-cards > li');
    expect(await cards.count()).toBeGreaterThan(15);
    await expect(page.locator('.games-cards .tag')).toHaveCount(0);
    const text = await page.locator('.games-cards').innerText();
    expect(text).not.toMatch(/Ages? \d+ (to|and up)/);
    expect(text).not.toMatch(/own voice|Nothing is recorded|Only points are kept/);
    // Every card has its own picture, hidden from screen readers because the heading names the card.
    for (const li of await cards.all()) {
      await expect(li.locator('svg.card-icon[aria-hidden=true]')).toHaveCount(1);
    }
    const pictures = await page.locator('.games-cards svg.card-icon').evaluateAll((s) => s.map((x) => x.innerHTML));
    expect(new Set(pictures).size, 'each card has a different picture').toBe(pictures.length);
  });

  test('offers both games among the other cards and hides the no-JavaScript table', async ({ page }) => {
    await expect(page.locator('.games-cards #start-sorting')).toBeVisible();
    await expect(page.locator('.games-cards #start-maths-auto')).toBeVisible();
    await expect(page.locator('#start-maths-auto')).toBeVisible(); // SCRUM-494: one Start; the game menus wait behind a "Grown-up" toggle
    await expect(page.locator('#static-lessons')).toBeHidden();
    await expect(page.locator('#player')).toBeHidden();
  });
});

test.describe('the sums are right (generated questions)', () => {
  test('3,000 story questions of each kind and size: one right answer, sensible choices, numbers in range', async ({ page }) => {
    const problems = await page.evaluate(() => {
      const make = (window as any).yaanstepMakeQuestion as (kind: string, max: number) => any;
      const out: string[] = [];
      const num = (s: string) => Number(s.match(/\d+/)![0]);
      for (const kind of ['add', 'take', 'more']) for (const max of [10, 20]) for (let i = 0; i < 3000; i++) {
        const q = make(kind, max);
        const where = `${kind}/${max}: ${q.say.join(' ')}`;
        // Work the answer out again from the words alone.
        const expected = kind === 'add' ? num(q.say[0]) + num(q.say[1]) : num(q.say[0]) - num(q.say[1]);
        if (q.answer !== expected) out.push(`${where} -> answer ${q.answer}, should be ${expected}`);
        if (q.options.filter((o: number) => o === q.answer).length !== 1) out.push(`${where} -> right answer not offered exactly once: ${q.options}`);
        if (q.options.length !== 3 || new Set(q.options).size !== 3) out.push(`${where} -> needs 3 different choices: ${q.options}`);
        if (q.options.some((o: number) => o < 0 || !Number.isInteger(o))) out.push(`${where} -> a choice is negative or not whole: ${q.options}`);
        const nums = (q.say.join(' ').match(/\d+/g) ?? []).map(Number).concat([q.answer]);
        if (nums.some((n: number) => n < 0 || n > max)) out.push(`${where} -> a number is outside 0 to ${max}`);
        if (q.answer < 1) out.push(`${where} -> answer below 1`);
        // The picture must show the same sum as the words.
        const s = q.spec;
        if (s.type === 'parts' && s.parts[0].v + s.parts[1].v !== s.whole) out.push(`${where} -> picture parts do not add up to the whole`);
        if (s.type === 'compare' && s.a.v - s.b.v !== q.answer) out.push(`${where} -> picture gap is not the answer`);
        if (!new RegExp(`\\b${q.answer}\\b`).test(q.explain)) out.push(`${where} -> the explanation does not name the answer: ${q.explain}`);
        if (out.length > 20) return out;
      }
      return out;
    });
    expect(problems).toEqual([]);
  });

  test('3,000 number cards of each kind and size: the card, the answer and the hint agree', async ({ page }) => {
    const problems = await page.evaluate(() => {
      const make = (window as any).yaanstepMakeFact as (kind: string, max: number) => any;
      const out: string[] = [];
      for (const kind of ['add', 'take', 'more']) for (const max of [10, 20]) for (let i = 0; i < 3000; i++) {
        const f = make(kind, max);
        const m = f.text.match(/^(\d+) ([+−]) (\d+)$/);
        if (!m) { out.push(`${kind}/${max}: card not readable: ${f.text}`); continue; }
        const expected = m[2] === '+' ? Number(m[1]) + Number(m[3]) : Number(m[1]) - Number(m[3]);
        if (f.answer !== expected) out.push(`${kind}/${max}: ${f.text} -> answer ${f.answer}, should be ${expected}`);
        if ([Number(m[1]), Number(m[3]), f.answer].some((n) => n < 0 || n > max)) out.push(`${kind}/${max}: ${f.text} -> a number is outside 0 to ${max}`);
        if (f.start + f.hop !== (kind === 'take' ? f.answer : Number(m[1]) + (kind === 'add' ? Number(m[3]) : 0))) out.push(`${kind}/${max}: ${f.text} -> the hops on the number line do not land in the right place (start ${f.start}, hop ${f.hop})`);
        if (out.length > 20) return out;
      }
      return out;
    });
    expect(problems).toEqual([]);
  });

  test('the story read aloud and the bar picture always give the same answer', async ({ page }) => {
    for (const kind of KINDS) {
      await startMaths(page, { kind, style: 'questions' });
      for (let round = 0; round < 5; round++) {
        const { lines } = await story(page);
        const label = (await stage(page).locator('.drop-pic svg[role=img]').getAttribute('aria-label')) ?? '';
        expect(answerFromPicture(label), `${kind}: ${lines.join(' ')} / ${label}`).toBe(answerFromStory(lines));
        await numberButton(stage(page).locator('.num-row button'), answerFromStory(lines)).click();
        await next(page).click();
      }
      await exit(page).click();
    }
  });
});

test.describe('Same and different (ages 3 to 5, with a grown-up)', () => {
  test('can be played to the end by tapping', async ({ page }) => {
    const errors = watchErrors(page);
    await startSorting(page);
    await expect(page.locator('#player-kicker')).toHaveText('Same and different · with a grown-up');
    await expect(title(page)).toHaveText('Find the same');
    await expect(progress(page)).toHaveText('Step 1 of 5');
    await expect(next(page)).toBeDisabled();
    await playSortingPerfectly(page);
    await expect(title(page)).toHaveText('Now do it for real');
    await expect(progress(page)).toHaveText('Step 5 of 5');
    await expect(page.locator('#player-say p:not(.who)').first()).toHaveText(/^(Pair up|Find|Line up|Fold|Sort|Look)\b.+\.$/);
    await expect(next(page)).toBeHidden();
    await expect(stage(page).getByRole('button', { name: 'Play again' })).toBeVisible();
    await expect(stage(page)).toContainText('Only points were kept');
    expect(errors).toEqual([]);
  });

  test('a mistake gets "Not yet" and a hint, takes nothing away, and the child can still finish', async ({ page }) => {
    await startSorting(page);
    const socks = stage(page).locator('.tray button.item-btn');
    const labels = await socks.evaluateAll((b) => b.map((x) => x.getAttribute('aria-label') ?? ''));
    const twin = labels.find((l, i) => labels.indexOf(l) !== i)!;
    const odd = labels.findIndex((l) => l !== twin);
    await socks.nth(labels.indexOf(twin)).click();
    await expect(feedback(page)).toHaveText('Now find one more that is the same.');
    await socks.nth(odd).click();
    await expect(feedback(page)).toHaveText('Not yet. Those two are different. Try two others.');
    await expect(feedback(page)).toHaveClass(/\btry\b/);
    await socks.nth(labels.indexOf(twin)).click();
    await socks.nth(odd).click();
    await expect(feedback(page)).toHaveText('Not yet. Look at the color first. Then look for stripes or dots.');
    expect(await feedback(page).innerText()).not.toMatch(SHAME_WORDS);
    await expect(socks).toHaveCount(4);
    await expect(next(page)).toBeDisabled();
    await playSortingPerfectly(page);
    await expect(title(page)).toHaveText('Now do it for real');
  });

  test('putting a block in the wrong basket says which basket to try', async ({ page }) => {
    await startSorting(page);
    const socks = stage(page).locator('.tray button.item-btn');
    const labels = await socks.evaluateAll((b) => b.map((x) => x.getAttribute('aria-label') ?? ''));
    const twin = labels.find((l, i) => labels.indexOf(l) !== i)!;
    await socks.nth(labels.indexOf(twin)).click();
    await socks.nth(labels.lastIndexOf(twin)).click();
    await next(page).click();
    const names = await stage(page).locator('.tray button.item-btn').evaluateAll((b) => b.map((x) => x.getAttribute('aria-label') ?? ''));
    await stage(page).locator('.tray button.item-btn').nth(names.findIndex((l) => names.indexOf(l) === names.lastIndexOf(l))).click();
    await next(page).click();
    await playShadow(page);
    await next(page).click();
    await stage(page).locator('button.basket').first().click();
    await expect(feedback(page)).toHaveText('Pick one to move first.');
    const item = stage(page).locator('.tray button[data-group]').first();
    const group = (await item.getAttribute('data-group'))!;
    await item.click();
    await expect(item).toHaveAttribute('aria-pressed', 'true');
    await stage(page).locator(`button.basket:not([data-group="${group}"])`).click();
    await expect(feedback(page)).toHaveText(new RegExp(`^Not yet\\. That .*\\b${group}\\b.*\\. Try the ${group} basket\\.$`));
    await expect(stage(page).locator('.tray button[data-group]')).toHaveCount(6);
  });

  test('can be played with the keyboard only', async ({ page }) => {
    await page.locator('#start-sorting').focus();
    await page.keyboard.press('Enter');
    await expect(title(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(stage(page).locator('.tray button.item-btn').first()).toBeFocused();
    const socks = stage(page).locator('.tray button.item-btn');
    const labels = await socks.evaluateAll((b) => b.map((x) => x.getAttribute('aria-label') ?? ''));
    const twin = labels.find((l, i) => labels.indexOf(l) !== i)!;
    await socks.nth(labels.indexOf(twin)).focus();
    await page.keyboard.press('Space');
    await socks.nth(labels.lastIndexOf(twin)).focus();
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toContainText('Yes!');
    await next(page).focus();
    await page.keyboard.press('Enter');
    await expect(title(page)).toHaveText('Find the different one');
    await expect(title(page)).toBeFocused();
  });

  test('a thing can be dragged onto its match and into its basket with the mouse', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Mouse dragging is a desktop check. A real finger on a touch screen is a manual test for Manish.');
    await startSorting(page);
    const socks = stage(page).locator('.tray button.item-btn');
    const labels = await socks.evaluateAll((b) => b.map((x) => x.getAttribute('aria-label') ?? ''));
    const twin = labels.find((l, i) => labels.indexOf(l) !== i)!;
    await socks.nth(labels.indexOf(twin)).dragTo(socks.nth(labels.lastIndexOf(twin)), { steps: 8 });
    await expect(feedback(page)).toContainText(PAIR_KINDS);
    await next(page).click();
    const names = await stage(page).locator('.tray button.item-btn').evaluateAll((b) => b.map((x) => x.getAttribute('aria-label') ?? ''));
    await stage(page).locator('.tray button.item-btn').nth(names.findIndex((l) => names.indexOf(l) === names.lastIndexOf(l))).click();
    await next(page).click();
    await playShadow(page);
    await next(page).click();
    const item = stage(page).locator('.tray button[data-group]').first();
    const group = await item.getAttribute('data-group');
    await item.dragTo(stage(page).locator(`button.basket[data-group="${group}"]`), { steps: 8 });
    await expect(feedback(page)).toHaveText('Yes! 5 to go.');
    await expect(stage(page).locator('.tray button[data-group]')).toHaveCount(5);
    await expect(page.locator('.item-ghost')).toHaveCount(0);
  });

  test('has many different examples: things to pair, ways to be different, and ways to sort (SCRUM-493)', async ({ page }) => {
    const pairs = new Set<string>();
    const kinds = new Set<string>();
    for (let round = 0; round < 12; round++) {
      await page.goto('sprouts.html');
      await startSorting(page);
      const labels = await stage(page).locator('.tray button.item-btn').evaluateAll((b) => b.map((x) => x.getAttribute('aria-label') ?? ''));
      expect(labels).toHaveLength(4);
      expect(new Set(labels).size, `one pair and two others: ${labels}`).toBe(3);
      pairs.add([...labels].sort().join('|'));
      kinds.add(((await page.locator('#player-say').innerText()).match(/Two (\w+) are the same/) ?? [])[1] ?? '');
      await playSortingPerfectly(page);
      const t = await page.locator('#player-title').innerText();
      expect(t).toBe('Now do it for real');
    }
    expect(pairs.size, 'the pairs change from game to game').toBeGreaterThanOrEqual(10);
    expect(kinds.size, `more than one kind of thing to pair: ${[...kinds]}`).toBeGreaterThanOrEqual(2);
  });

  test('"Play again" starts a fresh game from step 1', async ({ page }) => {
    await startSorting(page);
    await playSortingPerfectly(page);
    await stage(page).getByRole('button', { name: 'Play again' }).click();
    await expect(title(page)).toHaveText('Find the same');
    await expect(progress(page)).toHaveText('Step 1 of 5');
    await expect(next(page)).toBeDisabled();
  });
});

test.describe('Maths games (age 6 and up)', () => {
  for (const style of STYLES) {
    test(`${style}: five rounds, all right first time, ends with five stars`, async ({ page }) => {
      const errors = watchErrors(page);
      await startMaths(page, { style });
      await expect(progress(page)).toHaveText('Step 1 of 6');
      const titles = await playMathsPerfectly(page);
      expect(titles).toHaveLength(6);
      const word = style === 'questions' || style === 'race' ? 'Question' : 'Round';
      expect(titles.slice(0, 5)).toEqual([1, 2, 3, 4, 5].map((i) => `${word} ${i} of 5`));
      expect(titles[5]).toBe(style === 'race' ? 'You reached the flag!' : 'Well done!');
      await expect(stage(page)).toContainText('You worked out all 5 questions. Right on the first try: 5.');
      await expect(stage(page).locator('.stars')).toHaveText('★★★★★');
      await expect(stage(page)).toContainText('Only points are kept');
      expect(errors).toEqual([]);
    });
  }

  for (const kind of KINDS) {
    test(`story questions ask the kind that was chosen: ${kind}`, async ({ page }) => {
      await startMaths(page, { kind, style: 'questions' });
      const ask = { add: /How many .* now\?/, take: /How many are left\?/, more: /How many more does \w+ have\?/ }[kind as 'add' | 'take' | 'more'];
      for (let round = 0; round < 5; round++) {
        const { lines } = await story(page);
        expect(lines[2]).toMatch(ask);
        await numberButton(stage(page).locator('.num-row button'), answerFromStory(lines)).click();
        await next(page).click();
      }
    });
  }

  for (const style of ['questions', 'hunt', 'line', 'race'] as Style[]) {
    test(`${style}: "Up to 10" keeps every number at 10 or below`, async ({ page }) => {
      await startMaths(page, { size: '10', style });
      for (let round = 0; round < 5; round++) {
        const shown = (await page.locator('#player-say, #player-stage .fact-card, #player-stage .num-row, #player-stage .hunt-grid, #player-stage .num-line').allInnerTexts()).join(' ');
        const numbers = (shown.match(/\d+/g) ?? []).map(Number);
        // Wrong choices may sit one or two above the right answer, so allow 12 for the choices and 10 for the sum itself.
        const { value } = await rightAnswer(page);
        expect(value, `round ${round + 1}: the answer`).toBeLessThanOrEqual(10);
        expect(Math.max(...numbers), `round ${round + 1}: numbers on screen ${numbers}`).toBeLessThanOrEqual(12);
        const { buttons } = await rightAnswer(page);
        await numberButton(buttons, value).click();
        await next(page).click();
      }
    });
  }

  test('dice: "Up to 10" keeps every answer at 10 or below', async ({ page }) => {
    // Make every roll the highest roll, so the test does not depend on luck.
    await page.addInitScript(() => { Math.random = () => 0.999; });
    await openLearning(page);
    await startMaths(page, { kind: 'add', size: '10', style: 'dice' });
    const { value } = await rightAnswer(page);
    expect(value, 'two sixes add up to 12, above the "Up to 10" the parent chose').toBeLessThanOrEqual(10);
  });

  test('dice: "Taking away" asks a taking-away question', async ({ page }) => {
    await startMaths(page, { kind: 'take', style: 'dice' });
    await stage(page).getByRole('button', { name: 'Roll', exact: true }).click();
    await expect(stage(page).locator('.ask')).not.toHaveText('How many more dots on the first die?');
  });

  test('a wrong answer gets a word hint, then dots to count, never a red cross, and costs one star', async ({ page }) => {
    await startMaths(page, { kind: 'add', style: 'questions' });
    const { value, buttons } = await rightAnswer(page);
    const choices = (await buttons.allInnerTexts()).map(Number);
    const wrong = choices.filter((c) => c !== value);
    await numberButton(buttons, wrong[0]).click();
    await expect(feedback(page)).toContainText(/^Not yet\. Start at \d+\. Count on \d+ more\.$/);
    await expect(feedback(page)).toHaveClass(/\btry\b/);
    await expect(numberButton(buttons, wrong[0])).toBeDisabled();
    await expect(stage(page).locator('.drop-pic')).toHaveClass(/\blook\b/);
    await expect(next(page)).toBeDisabled();
    await numberButton(buttons, wrong[1]).click();
    await expect(feedback(page)).toHaveText('Not yet. Here are dots to help. Count all the dots.');
    const dots = stage(page).locator('.hint-pic svg[role=img]');
    await expect(dots).toHaveAttribute('aria-label', 'Dots to count. Count all the dots.');
    expect(await dots.locator('circle').count(), 'one dot for each thing in the story').toBe(value);
    expect(await feedback(page).innerText()).not.toMatch(SHAME_WORDS);
    expect(await stage(page).innerText()).not.toMatch(/[✗✘❌]/);
    await numberButton(buttons, value).click();
    await expect(feedback(page)).toContainText(/^You worked it out! \d+ and \d+ make \d+\.$/);
    await next(page).click();
    await playMathsPerfectly(page);
    await expect(stage(page)).toContainText('You worked out all 5 questions. Right on the first try: 4.');
    await expect(stage(page).locator('.stars')).toHaveText('★★★★☆');
  });

  for (const style of ['dice', 'hunt', 'line'] as Style[]) {
    test(`${style}: a wrong answer gets a kind hint and the round can still be finished`, async ({ page }) => {
      await startMaths(page, { kind: 'add', style });
      const { value, buttons } = await rightAnswer(page);
      const choices = (await buttons.allInnerTexts()).map(Number).filter((c) => c !== value);
      await numberButton(buttons, choices[0]).click();
      await expect(feedback(page)).toContainText(/^Not yet\. /);
      await numberButton(buttons, choices[1]).click();
      await expect(feedback(page)).toContainText(/^Not yet\. /);
      expect(await feedback(page).innerText()).not.toMatch(SHAME_WORDS);
      await expect(next(page)).toBeDisabled();
      await numberButton(buttons, value).click();
      await expect(feedback(page)).toContainText(/^You worked it out! /);
      await expect(next(page)).toBeEnabled();
    });
  }

  test('with "Start with a short lesson" ticked there are three lesson steps before the five rounds', async ({ page }) => {
    await startMaths(page, { kind: 'take', lesson: true });
    await expect(progress(page)).toHaveText('Step 1 of 9');
    await expect(title(page)).toHaveText('Lesson: see it with dots');
    await expect(page.locator('#player-say')).toContainText('Taking away means some go away.');
    await expect(next(page)).toBeEnabled();
    await stage(page).getByRole('button', { name: 'Show me' }).click();
    await expect(feedback(page)).toContainText(/\d+ and \d+ make \d+\. So \d+ are left\./);
    await next(page).click();
    await expect(title(page)).toHaveText('Lesson: the bar picture');
    await stage(page).getByRole('button', { name: 'Show the answer' }).click();
    await expect(stage(page).locator('svg[role=img]')).toHaveAttribute('aria-label', /^Bar picture\. Whole bar: \d+\. Parts: \d+ gone, \d+ left\.$/);
    await next(page).click();
    await expect(title(page)).toHaveText('Lesson: your turn');
    const titles = await playMathsPerfectly(page);
    expect(titles).toEqual(['Lesson: your turn', 'Question 1 of 5', 'Question 2 of 5', 'Question 3 of 5', 'Question 4 of 5', 'Question 5 of 5', 'Well done!']);
    // The practice question in the lesson is not one of the five scored rounds.
    await expect(stage(page)).toContainText('You worked out all 5 questions. Right on the first try: 5.');
  });

  test('"Keep going" gives five new rounds and starts the stars again', async ({ page }) => {
    await startMaths(page, { style: 'hunt' });
    await playMathsPerfectly(page);
    await stage(page).getByRole('button', { name: 'Keep going' }).click();
    await expect(progress(page)).toHaveText('Step 1 of 6');
    await expect(title(page)).toHaveText('Round 1 of 5');
    await playMathsPerfectly(page);
    await expect(stage(page).locator('.stars')).toHaveText('★★★★★');
  });

  test('a number can be dragged onto the picture with the mouse', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Mouse dragging is a desktop check. A real finger on a touch screen is a manual test for Manish.');
    await startMaths(page, { style: 'questions' });
    const { value, buttons } = await rightAnswer(page);
    await numberButton(buttons, value).dragTo(stage(page).locator('.drop-pic'), { steps: 8 });
    await expect(feedback(page)).toContainText('Yes!');
  });

  test('can be played with the keyboard only', async ({ page }) => {
    await page.locator('#maths-own summary').focus();
    await page.keyboard.press('Enter');
    await page.locator('input[name=style][value=questions]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('input[name=style]:checked')).toHaveValue('dice');
    await page.locator('#with-lesson').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#with-lesson')).not.toBeChecked();
    await page.keyboard.press('Tab');
    await expect(page.locator('#start-maths')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(title(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(stage(page).getByRole('button', { name: 'Roll', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    // After the roll, focus moves to the first answer so the child can carry on without the mouse.
    await expect(stage(page).locator('.num-row button').first()).toBeFocused();
    const { value, buttons } = await rightAnswer(page);
    await numberButton(buttons, value).focus();
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toContainText('Yes!');
  });
});

test.describe('game mode', () => {
  test('while a game is open the page shows only the game, and Exit brings the page back', async ({ page }) => {
    await startMaths(page);
    await expect(page.locator('body')).toHaveClass(/\bplaying\b/);
    for (const hidden of ['header.site', 'footer.site', 'main h1', 'main .notice', '.games-cards']) await expect(page.locator(hidden), hidden).toBeHidden();
    await expect(page.locator('#player')).toBeVisible();
    await expect(exit(page)).toBeVisible();
    await exit(page).click();
    await expect(page.locator('#player')).toBeHidden();
    for (const shown of ['header.site', 'footer.site', 'main h1', 'main .notice', '.games-cards']) await expect(page.locator(shown), shown).toBeVisible();
    await expect(page.locator('#start-maths')).toBeFocused();
    await expect(stage(page)).toBeEmpty();
  });

  test('each new step moves focus to its heading and feedback is announced to screen readers', async ({ page }) => {
    await startMaths(page);
    await expect(title(page)).toBeFocused();
    await expect(feedback(page)).toHaveAttribute('role', 'status');
    await expect(feedback(page)).toHaveAttribute('aria-live', 'polite');
    const { value, buttons } = await rightAnswer(page);
    await numberButton(buttons, value).click();
    await next(page).click();
    await expect(title(page)).toHaveText('Question 2 of 5');
    await expect(title(page)).toBeFocused();
  });

  test('nothing plays on by itself: a step waits until the child answers', async ({ page }) => {
    await page.clock.install();
    await openLearning(page);
    await startMaths(page);
    await page.clock.runFor(5 * 60_000);
    await expect(title(page)).toHaveText('Question 1 of 5');
    await expect(next(page)).toBeDisabled();
  });
});

test.describe('fits the screen and passes the accessibility scan in every game', () => {
  const views: { name: string; open: (page: import('@playwright/test').Page) => Promise<void> }[] = [
    { name: 'sorting: socks', open: (page) => startSorting(page) },
    { name: 'maths lesson: dots', open: (page) => startMaths(page, { lesson: true }) },
    ...STYLES.map((style) => ({ name: `maths: ${style}`, open: (page: import('@playwright/test').Page) => startMaths(page, { style }) })),
    { name: 'maths: number line up to 20 after two misses', open: async (page) => {
      await startMaths(page, { kind: 'add', style: 'line' });
      const { value, buttons } = await rightAnswer(page);
      await numberButton(buttons, value === 0 ? 1 : 0).click();
      await numberButton(buttons, value === 20 ? 19 : 20).click();
    } },
    { name: 'maths: end screen', open: async (page) => { await startMaths(page, { style: 'race' }); await playMathsPerfectly(page); } },
  ];
  for (const view of views) {
    test(`${view.name}`, async ({ page }) => {
      await view.open(page);
      if (await stage(page).getByRole('button', { name: 'Roll', exact: true }).count()) await stage(page).getByRole('button', { name: 'Roll', exact: true }).click();
      expect(await horizontalOverflow(page), 'sideways scroll at the device width').toBeLessThanOrEqual(1);
      expect(await axeViolations(page, 'main'), 'accessibility scan').toEqual([]);
      await page.setViewportSize({ width: 320, height: 640 });
      expect(await horizontalOverflow(page), 'sideways scroll at 320 px').toBeLessThanOrEqual(1);
    });
  }
});

test('playing both games stores nothing and sends nothing', async ({ page, context, baseURL }) => {
  const requests = watchRequests(page);
  await startSorting(page);
  await playSortingPerfectly(page);
  await exit(page).click();
  await startMaths(page, { style: 'dice', lesson: true });
  await next(page).click();
  await next(page).click();
  await playMathsPerfectly(page);
  await exit(page).click();
  expect(requests.carryingData(), 'requests that could carry what the child did').toEqual([]);
  expect(requests.external(new URL(baseURL!).origin), 'requests to other sites').toEqual([]);
  await expectNothingStored(page, context);
});
