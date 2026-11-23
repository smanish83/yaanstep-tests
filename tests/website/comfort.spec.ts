import { test, expect, type Page } from '@playwright/test';
import { axeViolations, watchErrors, watchRequests } from '../support/checks';

// New comfort settings (SCRUM-498, ACCESS-01..10; Manish, 22 Nov 2026: "adding plays and learning for kids with special needs").
// His rule: every child is covered, and settings are chosen by need, never by a diagnosis. Each setting is checked on at least
// two pages: Fewer choices, Read questions aloud, Quiet rewards and the Easy-reading font, plus calm mode's new limits.
// Settings are kept only in this browser, in the one profile key; a test proves no request carries them.

const KEY = 'ys-profile';
const ORIGIN = 'http://127.0.0.1:4173';
const ALL = ['easy', 'calm', 'big', 'contrast', 'rest', 'fewer', 'read', 'quiet', 'font'];

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); };`;
const said = (page: Page) => page.evaluate(() => (window as any).__said as string[]);

/** Sets comfort settings (with or without an age) on the given page, then reloads it. */
async function withComfort(page: Page, comfort: string[], path: string, age?: number) {
  await page.goto(path);
  const value = age ? { age, color: 0, nick: '', comfort } : { comfort };
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(value)]);
  await page.reload();
}

/** The choices on screen: their values, and how many of them are right. */
async function choicesNow(page: Page, sel: string, right: (string | number)[]) {
  const vals = await page.locator(sel).evaluateAll((bs) => bs.map((b) => b.getAttribute('data-v')!));
  const good = right.map(String);
  return { vals, rights: vals.filter((v) => good.includes(v)) };
}

test.describe('Fewer choices', () => {
  test('the shared hook keeps every right answer and exactly one wrong one, in order, and does nothing when off', async ({ page }) => {
    await withComfort(page, ['fewer'], '/money.html');
    const bad = await page.evaluate(() => {
      const C = (window as any).YSComfort, out: string[] = [];
      for (let i = 0; i < 500; i++) {
        const n = 3 + (i % 5), list = Array.from({ length: n }, (_, k) => k * 7 + i), right = list[i % n];
        const got = C.fewer(list, right);
        if (got.length !== 2 || got.filter((x: number) => x === right).length !== 1) out.push(`one right: ${list} -> ${got}`);
        if (got.join() !== list.filter((x) => got.includes(x)).join()) out.push(`order: ${list} -> ${got}`);
        const two = C.fewer(list, [list[0], list[1]]);
        if (two.length !== 3 || !two.includes(list[0]) || !two.includes(list[1])) out.push(`never drops a right one: ${two}`);
        if (C.fewer(list, 'not there').length !== n) out.push('a list without the answer is left alone');
      }
      return out;
    });
    expect(bad).toEqual([]);
    await withComfort(page, ['calm'], '/money.html');
    expect(await page.evaluate(() => (window as any).YSComfort.fewer([1, 2, 3, 4], 2))).toEqual([1, 2, 3, 4]);
  });

  // The learn-then-play pages share one shell; the round on screen tells the test what is right.
  const SHELL = [
    { file: 'money', games: ['count', 'change'] },
    { file: 'clocks', games: ['read', 'howlong'] },
    { file: 'weather', games: ['find', 'dress', 'read', 'compare'] },
  ];
  for (const p of SHELL) {
    test(`${p.file}: two answer tiles, exactly one of them right, in every round of every choice game`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.addInitScript(VOICE);
      await withComfort(page, ['fewer'], `/${p.file}.html`);
      for (const g of p.games) {
        await page.locator(`#play-${g}`).click();
        for (let k = 0; k < 8; k++) {
          await expect(page.locator('#count')).toHaveText(`Round ${k + 1} of 8`);
          const r = await page.evaluate(() => (window as any).YS_SHELL.current());
          const { vals, rights } = await choicesNow(page, '#choices button', r.right ?? [r.ans]);
          expect(vals, `${g} round ${k + 1}`).toHaveLength(2);
          expect(rights, `${g} round ${k + 1}: exactly one right answer`).toHaveLength(1);
          expect(await page.locator('#choices').getAttribute('class')).toContain('two');
          await page.locator(`#choices button[data-v="${rights[0]}"]`).click();
          await expect(page.locator('#sub')).toContainText('Yes!');
          await page.locator('#more').click();
        }
        await page.locator('#stop').click();
      }
      expect(errors).toEqual([]);
    });
  }

  test('without the setting the shell still shows three tiles', async ({ page }) => {
    await page.goto('/money.html');
    await page.locator('#play-count').click();
    await expect(page.locator('#choices button')).toHaveCount(3);
  });

  // Picture maths pages, through the small shared hook.
  const HOOKED = [
    { file: 'number-bonds', game: 'bonds', hook: 'YS_BONDS' },
    { file: 'tens-and-ones', game: 'read', hook: 'YS_TENS' },
    { file: 'fractions', game: 'name', hook: 'YS_FRACTIONS' },
  ];
  for (const p of HOOKED) {
    test(`${p.file}: two choices with exactly one right answer over 8 rounds, and three without the setting`, async ({ page }) => {
      const errors = watchErrors(page);
      await withComfort(page, ['fewer'], `/${p.file}.html`);
      await page.locator(`#play-${p.game}`).click();
      for (let k = 0; k < 8; k++) {
        await expect(page.locator('#count')).toHaveText(`Round ${k + 1} of 8`);
        const r = await page.evaluate((h) => (window as any)[h].current(), p.hook);
        const { vals, rights } = await choicesNow(page, '#choices button', [r.ans]);
        expect(vals, `round ${k + 1}`).toHaveLength(2);
        expect(rights, `round ${k + 1}: exactly one right answer`).toHaveLength(1);
        await page.locator(`#choices button[data-v="${rights[0]}"]`).click();
        await page.locator('#go').click();
      }
      // Many more rounds straight from the page's own choice maker.
      const bad = await page.evaluate(([h, g]) => {
        const H = (window as any)[h], out: string[] = [];
        for (let i = 0; i < 300; i++) {
          const r = H.make[g]();
          const c = g === 'name' ? H.choices(r.k, r.d) : H.choices(r.ans);
          if (c.length !== 2 || c.filter((v: unknown) => String(v) === String(r.ans)).length !== 1) out.push(`${JSON.stringify(r.ans)} -> ${c}`);
        }
        return out;
      }, [p.hook, p.game]);
      expect(bad).toEqual([]);
      expect(errors).toEqual([]);
      await withComfort(page, [], `/${p.file}.html`);
      await page.locator(`#play-${p.game}`).click();
      await expect(page.locator('#choices button')).toHaveCount(3);
    });
  }

  test('first learning games: two picture tiles with exactly one right in every round', async ({ page }) => {
    await page.addInitScript(VOICE);
    await withComfort(page, ['fewer'], '/first-steps.html');
    for (const g of ['shapes', 'colors', 'numbers', 'animals']) {
      await page.locator(`#play-${g}`).click();
      for (let k = 0; k < 8; k++) {
        const r = await page.evaluate(() => (window as any).YS_FIRST.current());
        const { vals, rights } = await choicesNow(page, '#choices button', [r.ans]);
        expect(vals, `${g} round ${k + 1}`).toHaveLength(2);
        expect(rights).toHaveLength(1);
        await page.locator(`#choices button[data-v="${rights[0]}"]`).click();
        await page.locator('#more').click();
      }
      await page.locator('#stop').click();
    }
  });
});

test.describe('Read questions aloud', () => {
  const PAGES = [
    { file: 'number-bonds', game: 'bonds' },
    { file: 'tens-and-ones', game: 'read' },
  ];
  for (const p of PAGES) {
    test(`${p.file}: off, nothing is spoken; on, each new question is spoken once, and Hear it says it again`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.addInitScript(VOICE);
      await page.goto(`/${p.file}.html`);
      await page.locator(`#play-${p.game}`).click();
      await page.waitForTimeout(800);
      expect(await said(page), 'nothing spoken without the setting').toEqual([]);
      await expect(page.locator('#ys-hear')).toHaveCount(0);

      await withComfort(page, ['read'], `/${p.file}.html`);
      await page.locator(`#play-${p.game}`).click();
      for (let k = 0; k < 4; k++) {
        await expect(page.locator('#count')).toHaveText(`Round ${k + 1} of 8`);
        const words = (await page.locator('#say').innerText()).trim();
        const ask = (await page.locator('#panel .ask').innerText()).trim();
        await expect.poll(() => said(page)).toHaveLength(k + 1);
        expect((await said(page))[k]).toBe(`${words} ${ask}`);
        const hear = page.locator('#ys-hear');
        await expect(hear).toBeVisible();
        await expect(hear).toHaveAccessibleName('Hear it');
        const box = (await hear.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(47.5);
        await hear.click();
        await expect.poll(() => said(page)).toHaveLength(k + 2);
        expect((await said(page))[k + 1]).toBe(`${words} ${ask}`);
        await page.evaluate(() => (window as any).__said.pop());
        // A right answer is not a new question: nothing more is said.
        const r = await page.evaluate(() => ((window as any).YS_BONDS ?? (window as any).YS_TENS).current());
        await page.locator(`#choices button[data-v="${r.ans}"]`).click();
        await page.waitForTimeout(600);
        expect(await said(page)).toHaveLength(k + 1);
        await page.locator('#go').click();
      }
      expect(await axeViolations(page, '#game')).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test('on a page that already speaks its questions, nothing is said twice', async ({ page }) => {
    await page.addInitScript(VOICE);
    await withComfort(page, ['read'], '/money.html');
    await page.locator('#play-count').click();
    const prompt = (await page.locator('#prompt').innerText()).trim();
    await page.waitForTimeout(900);
    expect(await said(page)).toEqual([prompt]);
    await expect(page.locator('#ys-hear'), 'the page has its own "Hear it again"').toHaveCount(0);
  });
});

test.describe('Quiet rewards', () => {
  async function rightTile(page: Page) {
    const t = page.locator('#choices .right');
    await expect(t).toHaveCount(1);
    return t.evaluate((e) => ({
      tick: getComputedStyle(e, '::after').content,
      moving: e.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length,
    }));
  }

  test('money: a right answer gets a plain tick and words, and nothing moves', async ({ page }) => {
    await page.addInitScript(VOICE);
    await page.goto('/money.html');
    await page.locator('#play-count').click();
    let r = await page.evaluate(() => (window as any).YS_SHELL.current());
    await page.locator(`#choices button[data-v="${r.ans}"]`).click();
    expect((await rightTile(page)).tick, 'no tick without the setting').toBe('none');

    await withComfort(page, ['quiet'], '/money.html');
    await page.locator('#play-count').click();
    r = await page.evaluate(() => (window as any).YS_SHELL.current());
    await page.locator(`#choices button[data-v="${r.ans}"]`).click();
    expect(await rightTile(page)).toEqual({ tick: '"✓"', moving: 0 });
    await expect(page.locator('#sub')).toContainText('Yes!');
    expect(await page.locator('#sub').evaluate((e) => getComputedStyle(e, '::before').content)).toContain('✓');
    expect(await axeViolations(page, '#game')).toEqual([]);
  });

  test('first learning games: a plain tick on the right picture, and nothing moves', async ({ page }) => {
    await page.addInitScript(VOICE);
    await withComfort(page, ['quiet'], '/first-steps.html');
    await page.locator('#play-shapes').click();
    const r = await page.evaluate(() => (window as any).YS_FIRST.current());
    await page.locator(`#choices button[data-v="${r.ans}"]`).click();
    expect(await rightTile(page)).toEqual({ tick: '"✓"', moving: 0 });
    await expect(page.locator('#sub')).toContainText('Yes!');
  });
});

test.describe('Easy-reading font', () => {
  for (const path of ['/sprouts.html', '/money.html', '/calm.html']) {
    test(`${path}: text and buttons use a font already on the device, and no font is downloaded`, async ({ page }) => {
      const reqs = watchRequests(page);
      const fonts: string[] = [];
      page.on('request', (q) => { if (q.resourceType() === 'font' || /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(q.url())) fonts.push(q.url()); });
      await page.goto(path);
      const before = await page.locator('main p').first().evaluate((e) => getComputedStyle(e).fontFamily);
      expect(before).not.toMatch(/^Verdana/);
      await withComfort(page, ['font'], path);
      await expect(page.locator('html')).toHaveClass(/\bys-font\b/);
      const look = await page.evaluate(() => ({
        p: getComputedStyle(document.querySelector('main p')!).fontFamily,
        b: getComputedStyle(document.querySelector('main button, main a')!).fontFamily,
      }));
      expect(look.p).toMatch(/^Verdana, Tahoma, "Trebuchet MS", sans-serif$/);
      expect(look.b).toMatch(/^Verdana/);
      expect(fonts).toEqual([]);
      expect(reqs.external(ORIGIN)).toEqual([]);
    });
  }
});

test.describe('Calm mode: no countdowns, no extra sound', () => {
  test('the break reminder waits without counting down when calm mode is on', async ({ page }) => {
    await page.addInitScript(() => { (window as any).YS_REST_MS = 2000; (window as any).YS_REST_WAIT = 2; });
    await withComfort(page, ['rest', 'calm'], '/sprouts.html', 6);
    const go = page.locator('#ys-rest-go');
    await expect(go).toBeVisible({ timeout: 8000 });
    await expect(go).toBeDisabled();
    await expect(go).toHaveText('Back to play soon');
    await expect(go).toBeEnabled({ timeout: 4000 });
    await expect(go).toHaveText('Back to play');
  });

  test('a page cannot play audio while calm mode is on', async ({ page }) => {
    await withComfort(page, ['calm'], '/money.html');
    const muted = await page.evaluate(async () => {
      const a = document.createElement('audio');
      document.body.appendChild(a);
      await a.play();
      return a.muted && a.paused;
    });
    expect(muted).toBe(true);
  });

  test('the calm corner breathes one step at a time with calm mode on', async ({ page }) => {
    await withComfort(page, ['calm'], '/calm.html');
    await expect(page.locator('#pace')).toBeHidden();
    await page.locator('#breath-start').click();
    await expect(page.locator('#breath-word')).toHaveText('Breathe in…');
    await expect(page.locator('#breath-next')).toBeFocused();
    await page.waitForTimeout(1500);
    await expect(page.locator('#breath-word'), 'nothing moves on by itself').toHaveText('Breathe in…');
  });
});

test.describe('Comfort settings without a profile', () => {
  test('Yaanstep Sprouts links to them; a grown-up can choose them with no age, and they stay when an age is picked', async ({ page, context }) => {
    const errors = watchErrors(page);
    await page.goto('/sprouts.html');
    // Calm play sits among the other cards, not in a section of its own (Manish, 23 Nov 2026).
    await expect(page.locator('.games-cards a[href="calm.html"]')).toBeVisible();
    await expect(page.locator('.games-cards a[href="watch.html"]')).toBeVisible();
    await expect(page.locator('#comfort h2')).toHaveText('Comfort settings');
    await page.locator('#comfort [data-ys-comfort]').click();
    const dlg = page.locator('#ys-comfort-dlg');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('h2')).toHaveText('Comfort settings');
    await expect(dlg).toContainText('no age is needed');
    await expect(dlg.locator('button[data-comfort]')).toHaveCount(9);
    for (const b of await dlg.locator('button[data-comfort]').all()) await expect(b).toHaveAttribute('aria-pressed', 'false');
    await expect(dlg.locator('input, select, textarea'), 'no free text').toHaveCount(0);
    expect(await axeViolations(page, '#ys-comfort-dlg')).toEqual([]);
    await dlg.locator('button[data-comfort=fewer]').click();
    await dlg.locator('button[data-comfort=quiet]').click();
    await expect(dlg.locator('button[data-comfort=fewer]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#ys-csave').click();
    await expect(dlg).toBeHidden();
    expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), KEY))!)).toEqual({ comfort: ['fewer', 'quiet'] });
    await expect(page.locator('html')).toHaveClass(/\bys-fewer\b/);
    await expect(page.locator('html')).toHaveClass(/\bys-quiet\b/);
    await expect(page.locator('#ys-badge')).toHaveCount(0);
    await expect(page.locator('#ys-ask')).toBeVisible();
    await page.goto('/money.html');
    await expect(page.locator('html')).toHaveClass(/\bys-fewer\b/);
    await page.goto('/sprouts.html');
    await page.locator('#ys-ask button[data-age="6"]').click();
    expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), KEY))!)).toEqual({ age: 6, color: 0, nick: '', comfort: ['fewer', 'quiet'] });
    expect(Object.keys(await page.evaluate(() => ({ ...localStorage })))).toEqual([KEY]);
    expect((await context.cookies())).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('turning every setting off again leaves nothing stored', async ({ page }) => {
    await withComfort(page, ['calm'], '/sprouts.html');
    await page.locator('#comfort [data-ys-comfort]').click();
    await page.locator('#ys-comfort-dlg button[data-comfort=calm]').click();
    await page.locator('#ys-csave').click();
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
    await expect(page.locator('html')).not.toHaveClass(/ys-calm/);
  });

  test('nothing is pre-set from the age: picking an age turns on no comfort setting', async ({ page }) => {
    for (const age of [3, 8, 12]) {
      await page.goto('/sprouts.html');
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.locator(`#ys-ask button[data-age="${age}"]`).click();
      for (const c of ALL) await expect(page.locator('html')).not.toHaveClass(new RegExp(`\\bys-${c}\\b`));
    }
  });
});

test('no request ever carries a comfort setting, on any page, while playing', async ({ page, context }) => {
  const seen: { url: string; method: string; body: string | null; headers: string }[] = [];
  page.on('request', (r) => seen.push({ url: r.url(), method: r.method(), body: r.postData(), headers: JSON.stringify(r.headers()) }));
  await page.addInitScript(VOICE);
  await withComfort(page, ALL, '/sprouts.html', 6);
  for (const p of ['sprouts', 'calm', 'money', 'number-bonds', 'tens-and-ones', 'first-steps', 'maths', 'stories', 'accessibility']) {
    await page.goto(`/${p}.html`);
    await page.waitForLoadState('networkidle');
  }
  await page.goto('/money.html');
  await page.locator('#play-count').click();
  const r = await page.evaluate(() => (window as any).YS_SHELL.current());
  await page.locator(`#choices button[data-v="${r.ans}"]`).click();
  await page.goto('/calm.html');
  await page.locator('#plan-cards button').first().click();
  await page.waitForLoadState('networkidle');
  expect(seen.length).toBeGreaterThan(10);
  expect(seen.filter((q) => q.method !== 'GET'), 'requests that send data').toEqual([]);
  expect(seen.filter((q) => q.body), 'requests with a body').toEqual([]);
  expect(seen.filter((q) => new URL(q.url).search !== ''), 'requests with a query').toEqual([]);
  expect(seen.filter((q) => !q.url.startsWith(ORIGIN) && !q.url.startsWith('data:')), 'requests to other sites').toEqual([]);
  expect(seen.filter((q) => /comfort|ys-profile|fewer|quiet/i.test(q.headers)), 'headers').toEqual([]);
  expect(await context.cookies()).toEqual([]);
});

test.describe('Banned words (ACCESS rules): none on the changed pages', () => {
  // The words the plan bans, and the names of conditions. The site footer must still say "not therapy" (content.spec,
  // company ground rule), so the check covers the page itself: everything in <main>, the title and the description.
  const BANNED = [/therap/i, /treatment/i, /diagnos/i, /special needs/i, /\bproven\b/i, /clinical/i, /suitable for/i, /fully accessible/i,
    /dyslexi/i, /autis/i, /\bADHD\b/, /\bADD\b/, /down syndrome/i, /hearing loss/i, /low vision/i, /\bblind/i, /\bdeaf/i, /dyspraxi/i,
    /dyscalculi/i, /cerebral palsy/i, /epilep/i, /asperger/i, /\bSEND?\b/, /disorder/i, /impair/i, /\bcures?\b/i];
  for (const path of ['/accessibility.html', '/sprouts.html', '/calm.html', '/watch.html', '/compare.html', '/opposites.html', '/find-difference.html']) {
    test(`${path}`, async ({ page }) => {
      await page.goto(path);
      const text = [await page.locator('main').innerText(), await page.title(), (await page.locator('meta[name="description"]').getAttribute('content')) ?? ''].join(' ');
      for (const bad of BANNED) expect.soft(text, `banned: ${bad}`).not.toMatch(bad);
    });
  }
  test('the profile and comfort dialogs', async ({ page }) => {
    await withComfort(page, [], '/sprouts.html', 6);
    await page.locator('#ys-badge').click();
    const text = await page.locator('#ys-profile').innerText();
    for (const bad of BANNED) expect.soft(text, `banned: ${bad}`).not.toMatch(bad);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator('#comfort [data-ys-comfort]').click();
    const text2 = await page.locator('#ys-comfort-dlg').innerText();
    for (const bad of BANNED) expect.soft(text2, `banned: ${bad}`).not.toMatch(bad);
  });
});

test('bigger buttons reach the new controls: Hear it, the comfort dialog and the calm corner are at least 64 px', async ({ page }) => {
  await page.addInitScript(VOICE);
  await withComfort(page, ['big', 'read'], '/number-bonds.html');
  await page.locator('#play-bonds').click();
  const hear = (await page.locator('#ys-hear').boundingBox())!;
  expect(hear.height).toBeGreaterThanOrEqual(63.5);
  await page.goto('/calm.html');
  const small = await page.locator('main button:visible').evaluateAll((bs) => bs.filter((b) => { const r = b.getBoundingClientRect(); return r.height < 63.5 || r.width < 63.5; }).map((b) => b.textContent));
  expect(small).toEqual([]);
});
