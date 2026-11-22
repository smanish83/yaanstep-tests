import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';
import { knownBug } from '../support/known-bugs';

// Bar models (bar-models.html, SCRUM-488, added 22 Nov 2026). Our own word problems, made fresh each time,
// using the bar model method. Every answer here is worked out by the test from the words on the screen,
// never read from the page's code: the test reads the problem, works it out, and checks the bars, the
// question mark, the steps and the answer sentence.

test.beforeEach(() => { knownBug(); });

type Want = {
  kind: string;
  q: string;              // which option places the question mark correctly
  lens: number[];         // how long each bar is once every sentence is read
  calcs: { ask: string; ans: number }[];
  say: string;            // the answer sentence
};

/** Reads a problem and works it out. Returns null if the words fit none of the planned kinds. */
function solve(text: string): Want | null {
  let m: RegExpMatchArray | null;
  if ((m = text.match(/^(\w+) has (\d+) (\w+)\. (\w+) has (\d+) \3\. How many \3 do they have altogether\?$/))) {
    const [, A, a, T, B, b] = m; const t = +a + +b;
    return { kind: 'join', q: 'total', lens: [+a, +b], calcs: [{ ask: `What is ${a} + ${b}?`, ans: t }], say: `${A} and ${B} have ${t} ${T} altogether.` };
  }
  if ((m = text.match(/^There are (\d+) (\w+) in a bag\. (\d+) of them are red\. The rest are blue\. How many \2 are blue\?$/))) {
    const [, t, T, a] = m; const r = +t - +a;
    return { kind: 'rest', q: 'blue', lens: [+t], calcs: [{ ask: `What is ${t} − ${a}?`, ans: r }], say: `${r} ${T} are blue.` };
  }
  if ((m = text.match(/^(\w+) has (\d+) (\w+)\. (\w+) has (\d+) more \3 than \1\. How many \3 does \4 have\?$/))) {
    const [, , a, T, B, d] = m; const b = +a + +d;
    return { kind: 'more', q: 'b', lens: [+a, b], calcs: [{ ask: `What is ${a} + ${d}?`, ans: b }], say: `${B} has ${b} ${T}.` };
  }
  if ((m = text.match(/^(\w+) has (\d+) (\w+)\. (\w+) has (\d+) \3\. How many more \3 does \1 have than \4\?$/))) {
    const [, A, a, T, B, b] = m; const d = +a - +b;
    return { kind: 'diff', q: 'extra', lens: [+a, +b], calcs: [{ ask: `What is ${a} − ${b}?`, ans: d }], say: `${A} has ${d} more ${T} than ${B}.` };
  }
  if ((m = text.match(/^(\w+) has (\d+) (\w+)\. (\w+) has (\d+) times as many \3 as \1\. How many \3 does \4 have\?$/))) {
    const [, , a, T, B, k] = m; const p = +a * +k;
    return { kind: 'times', q: 'b', lens: [+a, p], calcs: [{ ask: `What is ${a} × ${k}?`, ans: p }], say: `${B} has ${p} ${T}.` };
  }
  if ((m = text.match(/^(\w+) has (\d+) (\w+)\. (\w+) has (\d+) fewer \3 than \1\. How many \3 do they have altogether\?$/))) {
    const [, A, a, T, B, d] = m; const b = +a - +d, t = +a + b;
    return { kind: 'fewerTotal', q: 'total', lens: [+a, b], calcs: [{ ask: `What is ${a} − ${d}?`, ans: b }, { ask: `What is ${a} + ${b}?`, ans: t }], say: `${A} and ${B} have ${t} ${T} altogether.` };
  }
  if ((m = text.match(/^(\w+) and (\w+) have (\d+) (\w+) altogether\. \1 has (\d+) times as many \4 as \2\. How many \4 does \2 have\?$/))) {
    const [, , B, t, T, k] = m; const u = +t / (+k + 1);
    return { kind: 'share', q: 'b', lens: [u * +k, u], calcs: [{ ask: `What is ${t} ÷ ${+k + 1}?`, ans: u }], say: `${B} has ${u} ${T}.` };
  }
  if ((m = text.match(/^(\w+) has (\d+) times as many (\w+) as (\w+)\. (\w+) has (\d+) more \3 than \4\. \1 has (\d+) \3\. How many \3 do the three of them have altogether\?$/))) {
    const [, , k, T, , , d, x] = m; const b = +x / +k, c = b + +d, t = +x + b + c;
    return {
      kind: 'three', q: 'total', lens: [+x, b, c],
      calcs: [{ ask: `What is ${x} ÷ ${k}?`, ans: b }, { ask: `What is ${b} + ${d}?`, ans: c }, { ask: `What is ${x} + ${b} + ${c}?`, ans: t }],
      say: `The three of them have ${t} ${T} altogether.`,
    };
  }
  return null;
}

/** The kinds each age group should get, and the largest number a problem may use. */
const BANDS: Record<string, { kinds: string[]; max: number }> = {
  '5-6': { kinds: ['join', 'rest'], max: 20 },
  '7-8': { kinds: ['join', 'rest', 'more', 'diff'], max: 100 },
  '9-10': { kinds: ['diff', 'times', 'fewerTotal'], max: 400 },
  '11-12': { kinds: ['times', 'fewerTotal', 'share', 'three'], max: 1400 },
};

async function bars(page: Page) {
  return page.evaluate(() => {
    const segs = [...document.querySelectorAll('#model rect.seg, #model rect.missing')].map((r) => ({ v: +r.getAttribute('data-v')!, w: +r.getAttribute('width')! }));
    const lens = [...document.querySelectorAll('#model .rowlen')].map((g) => +g.getAttribute('data-len')!);
    const q = [...document.querySelectorAll('#model .qmark')].map((t) => t.textContent);
    return { segs, lens, q };
  });
}

/** Plays one problem all the way through, checking every step against the worked answer. */
async function playOne(page: Page, problems: string[], band: string) {
  const text = (await page.locator('#problem').innerText()).trim();
  const want = solve(text);
  if (!want) problems.push(`"${text}": does not match any planned kind`);
  if (!want) return;
  if (!BANDS[band].kinds.includes(want.kind)) problems.push(`"${text}": kind ${want.kind} is not planned for ages ${band}`);
  const nums = (text.match(/\d+/g) ?? []).map(Number).concat(want.lens, want.calcs.map((c) => c.ans));
  if (Math.max(...nums) > BANDS[band].max) problems.push(`"${text}": uses a number above ${BANDS[band].max} for ages ${band}`);
  if (want.calcs.some((c) => !Number.isInteger(c.ans) || c.ans <= 0)) problems.push(`"${text}": an answer is not a whole number above 0`);

  await expect(page.locator('#stepline')).toHaveText('Step 1 of 7: Read the problem.');
  await page.locator('#go').click();
  await expect(page.locator('#stepline')).toHaveText('Step 2 of 7: Who and what?');
  await expect(page.locator('#who')).not.toBeEmpty();
  await page.locator('#go').click();
  await expect(page.locator('#stepline')).toHaveText('Step 3 of 7: Draw a bar for each one.');
  await expect(page.locator('#model rect.unitbar')).toHaveCount(want.lens.length);
  const facts = (await page.locator('#problem .sent').count()) - 1;
  for (let i = 0; i < facts; i++) {
    await page.locator('#go').click();
    await expect(page.locator('#stepline')).toHaveText('Step 4 of 7: Read one sentence at a time and change the bars.');
    await expect(page.locator(`#problem .sent[data-i="${i}"]`)).toHaveClass(/now/);
  }
  // Every sentence read: the bars now match the problem, and equal values are drawn the same length.
  const b = await bars(page);
  if (JSON.stringify(b.lens) !== JSON.stringify(want.lens)) problems.push(`"${text}": bars are ${JSON.stringify(b.lens)}, expected ${JSON.stringify(want.lens)}`);
  // Widths are rounded to 0.1 px, so each part may be off by up to 0.05 px from its exact size.
  const px = b.segs.reduce((t, s) => t + s.w, 0) / b.segs.reduce((t, s) => t + s.v, 0);
  if (b.segs.some((s) => Math.abs(s.w - s.v * px) > 0.1)) problems.push(`"${text}": bars are not drawn to the same scale`);
  expect(b.q).toEqual([]);

  await page.locator('#go').click();
  await expect(page.locator('#stepline')).toHaveText('Step 5 of 7: Where does the question mark go?');
  await expect(page.locator('#qopts button')).toHaveCount(3);
  await expect(page.locator('#go')).toBeHidden();
  await page.locator(`#qopts button[data-q="${want.q}"]`).click();
  expect((await bars(page)).q).toEqual(['?']);

  for (let i = 0; i < want.calcs.length; i++) {
    await page.locator('#go').click();
    await expect(page.locator('#stepline')).toHaveText('Step 6 of 7: Work it out.');
    await expect(page.locator('#calcq')).toHaveText(want.calcs[i].ask);
    const opts = (await page.locator('#calcopts button').allTextContents()).map(Number);
    if (!opts.includes(want.calcs[i].ans) || new Set(opts).size !== opts.length || opts.length !== 3 || opts.some((o) => o <= 0)) problems.push(`"${text}": step ${i + 1} choices ${JSON.stringify(opts)} are wrong for ${want.calcs[i].ans}`);
    await page.locator(`#calcopts button[data-v="${want.calcs[i].ans}"]`).click();
    await expect(page.locator('#work .eq').nth(i)).toHaveText(`${want.calcs[i].ask.replace(/^What is |\?$/g, '')} = ${want.calcs[i].ans}`);
  }
  expect((await bars(page)).q, 'the question mark becomes the answer').toEqual([String(want.calcs[want.calcs.length - 1].ans)]);
  await page.locator('#go').click();
  await expect(page.locator('#stepline')).toHaveText('Step 7 of 7: Say the answer in a full sentence.');
  await expect(page.locator('#sayopts button')).toHaveCount(2);
  const sentences = await page.locator('#sayopts button').allTextContents();
  if (!sentences.includes(want.say)) problems.push(`"${text}": the right sentence "${want.say}" is not offered: ${JSON.stringify(sentences)}`);
  await page.locator('#sayopts button[data-right="true"]').click();
  await expect(page.locator('#answer')).toHaveText(want.say);
}

test('is a public page linked from Learning: labelled, no errors, no outside requests, nothing sent or stored', async ({ page, context, request }) => {
  await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204 }));
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await page.goto('/bar-models.html');
  await expect(page.locator('h1')).toHaveText('Bar models');
  for (const t of ['our own', 'AI team', 'bar model method', 'Not yet tested with children', 'nothing is saved']) await expect(page.locator('body')).toContainText(t);
  await expect(page.locator('.howto li')).toHaveCount(7);
  expect(await (await request.get('/learning.html')).text()).toContain('href="bar-models.html"');
  await expect(page.locator('#bandlist button')).toHaveText(['Ages 5 to 6' + '5 problems', 'Ages 7 to 8' + '5 problems', 'Ages 9 to 10' + '5 problems', 'Ages 11 to 12' + '5 problems']);
  await page.locator('#band-5-6').click();
  await playOne(page, [], '5-6');
  expect(errors).toEqual([]);
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect(reqs.sending()).toEqual([]);
  const s = await storedData(page, context);
  expect(s.local).toEqual([]);
  expect(s.cookies).toEqual([]);
  const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  expect(hrefs.filter((h) => /^(https?:)?\/\//.test(h))).toEqual([]);
});

for (const band of Object.keys(BANDS)) {
  test(`ages ${band}: 4 sets of 5 problems, every one worked out by the test and shown right, step by step`, async ({ page }) => {
    test.setTimeout(240_000);
    const problems: string[] = [];
    await page.goto('/bar-models.html');
    await page.locator(`#band-${band}`).click();
    for (let set = 0; set < 4; set++) {
      for (let i = 0; i < 5; i++) {
        await expect(page.locator('#count')).toHaveText(`Problem ${i + 1} of 5`);
        await playOne(page, problems, band);
        await expect(page.locator('#go')).toHaveText(i < 4 ? 'Next problem' : 'Finish');
        await page.locator('#go').click();
      }
      await expect(page.locator('#alldone')).toBeVisible();
      await page.locator('#again').click();
    }
    expect(problems).toEqual([]);
  });
}

test('every problem kind is worked out right in 2,000 fresh problems, straight from the page generator', async ({ page }) => {
  await page.goto('/bar-models.html');
  const texts = await page.evaluate(() => {
    const K = (window as any).YS_BARS.kinds;
    const out: string[] = [];
    for (const k of Object.keys(K)) for (let i = 0; i < 125; i++) for (const big of [false, true]) out.push(K[k](big).sentences.join(' '));
    return out;
  });
  const bad = texts.filter((t) => { const w = solve(t); return !w || w.calcs.some((c) => !Number.isInteger(c.ans) || c.ans <= 0); });
  expect(bad).toEqual([]);
});

test('before the first bar, the model box is short and says where the bars will go', async ({ page }) => {
  await page.goto('/bar-models.html');
  await page.locator('#band-7-8').click();
  await expect(page.locator('#model svg')).toHaveAttribute('aria-label', 'Bar model. No bars yet.');
  await expect(page.locator('#model')).toContainText('The bars will appear here.');
  expect((await page.locator('#model').boundingBox())!.height).toBeLessThan(120);
});

test('a wrong answer says "Not yet" and waits; nothing moves on by itself', async ({ page }) => {
  await page.clock.install();
  await page.goto('/bar-models.html');
  await page.locator('#band-7-8').click();
  const facts = (await page.locator('#problem .sent').count()) - 1;
  for (let i = 0; i < 3 + facts; i++) await page.locator('#go').click();
  const want = solve((await page.locator('#problem').innerText()).trim())!;
  const wrongQ = page.locator(`#qopts button:not([data-q="${want.q}"])`).first();
  await wrongQ.click();
  await expect(page.locator('#tip')).toHaveText('Not yet. Read the question again: what does it ask for?');
  await expect(wrongQ).toBeDisabled();
  await page.locator(`#qopts button[data-q="${want.q}"]`).click();
  await page.locator('#go').click();
  await page.locator(`#calcopts button:not([data-v="${want.calcs[0].ans}"])`).first().click();
  await expect(page.locator('#tip')).toHaveText('Not yet. Look at the bars again.');
  await page.clock.runFor(60_000);
  await expect(page.locator('#stepline')).toHaveText('Step 6 of 7: Work it out.');
  await expect(page.locator('#go')).toBeHidden();
});

test('with a profile, only the age group for the child shows, and Show everything brings the rest back', async ({ page }) => {
  await page.goto('/bar-models.html');
  await page.evaluate(() => localStorage.setItem('ys-profile', JSON.stringify({ age: 8, color: 0, nick: '' })));
  await page.reload();
  await expect(page.locator('#bandlist button:visible')).toHaveCount(1);
  await expect(page.locator('#band-7-8')).toBeVisible();
  await page.locator('#ys-showall').click();
  await expect(page.locator('#bandlist button:visible')).toHaveCount(4);
});

test('every button is at least 48 by 48 px', async ({ page }) => {
  await page.goto('/bar-models.html');
  const check = async () => {
    for (const b of await page.locator('button:visible').all()) {
      const box = (await b.boundingBox())!;
      expect(box.width, await b.innerText()).toBeGreaterThanOrEqual(47.5);
      expect(box.height, await b.innerText()).toBeGreaterThanOrEqual(47.5);
    }
  };
  await check();
  await page.locator('#band-11-12').click();
  const facts = (await page.locator('#problem .sent').count()) - 1;
  for (let i = 0; i < 3 + facts; i++) await page.locator('#go').click();
  await check();
});

for (const view of ['menu', 'bars', 'question mark', 'work it out'] as const) {
  for (const width of [0, 320]) {
    test(`bar models: ${view} view fits the screen and passes the accessibility scan${width ? ' at 320 px' : ''}`, async ({ page }) => {
      if (width) await page.setViewportSize({ width, height: 700 });
      await page.goto('/bar-models.html');
      if (view !== 'menu') {
        await page.locator('#band-11-12').click();
        const facts = (await page.locator('#problem .sent').count()) - 1;
        // From the first step: 2 clicks reach the bars, one more per sentence, one more reaches the question mark.
        const steps = view === 'bars' ? 2 + facts : 3 + facts;
        for (let i = 0; i < steps; i++) await page.locator('#go').click();
        if (view === 'work it out') {
          const want = solve((await page.locator('#problem').innerText()).trim())!;
          await page.locator(`#qopts button[data-q="${want.q}"]`).click();
          await page.locator('#go').click();
        }
      }
      expect(await horizontalOverflow(page), 'overflow').toBeLessThanOrEqual(1);
      expect(await axeViolations(page), `${view} view`).toEqual([]);
    });
  }
}
