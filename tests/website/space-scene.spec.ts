import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';

// "See them all together" on topics.html#space (Manish, 23 Nov 2026: "show everything in same picture so kids can
// understand the differences, and when they will clock the object the description will be presented"). One picture of
// the Sun and the planets in order, sizes about to scale. Tapping one shows its sentence and a size line, and says them.
// The real widths below are written out by hand (compared with Earth), not read from the page.

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); };`;

/** In order from the Sun, with each one's width compared with Earth's. */
const ORDER = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] as const;
const NAMES: Record<string, string> = { sun: 'Sun', mercury: 'Mercury', venus: 'Venus', earth: 'Earth', moon: 'Moon', mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune' };
const WIDTH: Record<string, number> = { sun: 109, mercury: 0.383, venus: 0.949, earth: 1, moon: 0.273, mars: 0.532, jupiter: 11.21, saturn: 9.45, uranus: 4.01, neptune: 3.88 };
/** A number the size line must give, worked out here from WIDTH ("about 11 Earths would fit across Jupiter"). */
const COUNT: Record<string, RegExp> = {
  sun: new RegExp(`\\b${Math.round(WIDTH.sun)} Earths`), jupiter: new RegExp(`\\b${Math.round(WIDTH.jupiter)} Earths`),
  saturn: new RegExp(`\\b${Math.floor(WIDTH.saturn)} Earths`), uranus: new RegExp(`\\b${Math.round(WIDTH.uranus)} times`),
  neptune: new RegExp(`\\b${Math.round(WIDTH.neptune)} times`), moon: new RegExp(`\\b${Math.round(1 / WIDTH.moon)} Moons`), mars: /half as wide/,
};
const BANNED = [/therap/i, /treatment/i, /diagnos/i, /special needs/i, /\bproven\b/i, /clinical/i, /\bIQ\b/, /brain training/i, /improves?\b/i, /\bboosts?\b/i, /samples only/i];

async function openScene(page: Page) {
  await page.addInitScript(VOICE);
  await page.goto('/topics.html#space');
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#play-scene')).toBeVisible();
  await expect(page.locator('#play-scene')).toContainText('See them all together');
  await page.locator('#play-scene').click();
  await expect(page.locator('#scene-view')).toBeVisible();
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#scene-title')).toBeFocused();
}
const said = (page: Page) => page.evaluate(() => (window as any).__said as string[]);
const pack = (page: Page) => page.evaluate(() => {
  const t = (window as any).YS_TOPIC_PAGE.topics.space;
  return { say: Object.fromEntries(t.items.map((i: any) => [i.id, i.say])) as Record<string, string>, compare: Object.fromEntries(t.scene.objects.map((o: any) => [o.id, o.compare])) as Record<string, string> };
});
const btn = (page: Page, id: string) => page.locator(`#sky .sky-btn[data-obj="${id}"]`);

async function expectShown(page: Page, id: string, p: Awaited<ReturnType<typeof pack>>) {
  await expect(page.locator('#scene-name')).toHaveText(NAMES[id]);
  await expect(page.locator('#scene-say')).toHaveText(p.say[id]);
  await expect(page.locator('#scene-compare')).toHaveText(p.compare[id]);
  await expect(page.locator('#sky .sky-btn.on')).toHaveCount(1);
  await expect(btn(page, id)).toHaveClass(/\bon\b/);
  const last = (await said(page)).at(-1)!;
  const base = `${NAMES[id]}. ${p.say[id]} ${p.compare[id]}`;
  // The last part looked at also says the picture is done (and gives the World point).
  expect([base, `${base} You looked at every part of the picture. Well done!`]).toContain(last);
}

test('the space topic opens one picture of the Sun and the planets: accessible, loads nothing from other sites, stores nothing', async ({ page, context }) => {
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await openScene(page);
  const svg = page.locator('#sky svg');
  await expect(svg).toHaveAttribute('role', 'img');
  expect(await svg.getAttribute('aria-label')).toMatch(/Mercury, Venus, Earth.*Mars, Jupiter, Saturn, Uranus and Neptune/);
  await expect(page.locator('#scene-note')).toContainText('sizes are about right');
  await expect(page.locator('#scene-note')).toContainText('distances are squeezed');
  await expect(page.locator('#scene-panel')).toHaveAttribute('aria-live', 'polite');
  expect((await said(page)).at(-1)).toContain('The Sun and the planets');
  // Every object is a real button named by its name, in order from the Sun, and big enough to tap.
  const names = await page.locator('#sky .sky-btn').evaluateAll((bs) => bs.map((b) => [b.getAttribute('data-obj'), b.tagName, (b as HTMLElement).innerText.trim()]));
  expect(names).toEqual(ORDER.map((id) => [id, 'BUTTON', NAMES[id]]));
  for (const id of ORDER) {
    await btn(page, id).scrollIntoViewIfNeeded();
    const box = (await btn(page, id).boundingBox())!;
    expect(box.width, id).toBeGreaterThanOrEqual(44);
    expect(box.height, id).toBeGreaterThanOrEqual(44);
  }
  expect(await axeViolations(page, '#scene-view')).toEqual([]);
  await btn(page, 'saturn').click();
  expect(await axeViolations(page)).toEqual([]);
  const text = await page.locator('#scene-view').innerText();
  for (const w of BANNED) expect(text, String(w)).not.toMatch(w);
  // Nothing moves in the picture, so there is nothing to turn off for reduced motion or the calm setting.
  expect(await page.locator('#scene-view').evaluate((e) => e.getAnimations({ subtree: true }).length)).toBe(0);
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect(reqs.sending()).toEqual([]);
  const stored = await storedData(page, context);
  expect(stored.local).toEqual([]);
  expect(stored.session).toEqual([]);
  expect(stored.cookies).toEqual([]);
  expect(errors).toEqual([]);
});

test('tapping each object shows its name, its sentence and a size line, and says them', async ({ page }) => {
  await openScene(page);
  const p = await pack(page);
  for (const id of ORDER) {
    await btn(page, id).click();
    await expectShown(page, id, p);
    if (COUNT[id]) expect(p.compare[id], id).toMatch(COUNT[id]);
  }
  const before = (await said(page)).length;
  await page.locator('#scene-again').click();
  const after = await said(page);
  expect(after.length).toBe(before + 1);
  expect(after.at(-1)).toBe(after.at(-2));
  await page.locator('#scene-exit').click();
  await expect(page.locator('#scene-view')).toBeHidden();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#play-scene')).toBeFocused();
});

test('every object works from the keyboard, in order, with a visible focus ring', async ({ page }) => {
  await openScene(page);
  const p = await pack(page);
  await page.locator('#scene-exit').focus();
  for (let i = 0; i < ORDER.length; i++) {
    const id = ORDER[i];
    await page.keyboard.press('Tab');
    await expect(btn(page, id)).toBeFocused();
    const ring = await btn(page, id).evaluate((b) => { const s = getComputedStyle(b); return [s.outlineStyle, parseFloat(s.outlineWidth)] as [string, number]; });
    expect(ring[0], id).not.toBe('none');
    expect(ring[1], id).toBeGreaterThanOrEqual(3);
    await page.keyboard.press(i % 2 ? 'Space' : 'Enter');
    await expectShown(page, id, p);
    await expect(btn(page, id)).toBeFocused();
  }
});

test('at 320px the page does not scroll sideways; the picture scrolls in its own box and every object can be reached', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openScene(page);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  const box = page.locator('#sky-box');
  const [scroll, client] = await box.evaluate((b) => [b.scrollWidth, b.clientWidth]);
  expect(scroll).toBeGreaterThan(client);
  const p = await pack(page);
  for (const id of [...ORDER].reverse()) {
    await btn(page, id).click();
    await expectShown(page, id, p);
  }
  // Reaching the last one by keyboard brings it into view inside the box.
  await page.locator('#scene-exit').focus();
  for (let i = 0; i < ORDER.length; i++) await page.keyboard.press('Tab');
  await expect(btn(page, 'neptune')).toBeFocused();
  const b = (await btn(page, 'neptune').boundingBox())!, v = (await box.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(v.x - 1);
  expect(b.x + Math.min(b.width, 44)).toBeLessThanOrEqual(v.x + v.width + 1);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  expect(await axeViolations(page, '#scene-view')).toEqual([]);
});

test('the drawn sizes match the real sizes, and the objects are in order from the Sun', async ({ page }) => {
  await openScene(page);
  const drawn = await page.locator('#sky svg').evaluate((svg, ids) => Object.fromEntries((ids as string[]).map((id) => {
    const c = svg.querySelector(`[data-obj="${id}"] .body`)!;
    return [id, { r: Number(c.getAttribute('r')), cx: Number(c.getAttribute('cx')) }];
  })), [...ORDER]) as Record<string, { r: number; cx: number }>;
  const earth = drawn.earth.r;
  for (const id of ORDER) {
    expect(drawn[id].r, `${id} has a drawn circle`).toBeGreaterThan(0);
    expect(Math.abs(drawn[id].r / earth / WIDTH[id] - 1), `${id}: drawn ${drawn[id].r} vs Earth ${earth}`).toBeLessThan(0.05);
  }
  // Smallest to biggest, by the drawing and by the real widths, come out the same.
  const bySize = (f: (id: string) => number) => [...ORDER].sort((a, b) => f(a) - f(b));
  expect(bySize((id) => drawn[id].r)).toEqual(bySize((id) => WIDTH[id]));
  expect(bySize((id) => drawn[id].r)).toEqual(['moon', 'mercury', 'mars', 'venus', 'earth', 'neptune', 'uranus', 'saturn', 'jupiter', 'sun']);
  // Left to right in order from the Sun (the Moon sits beside Earth), and each tap strip covers its own object.
  const planets = ORDER.filter((id) => id !== 'moon');
  for (let i = 1; i < planets.length; i++) expect(drawn[planets[i]].cx, planets[i]).toBeGreaterThan(drawn[planets[i - 1]].cx);
  const strips = await page.evaluate(() => (window as any).YS_TOPIC_PAGE.topics.space.scene.objects.map((o: any) => [o.id, o.x, o.w]) as [string, number, number][]);
  for (const [id, x, w] of strips) {
    if (id === 'sun') continue; // only the Sun's edge shows; its centre is far off to the left
    expect(drawn[id].cx, id).toBeGreaterThan(x);
    expect(drawn[id].cx, id).toBeLessThan(x + w);
  }
  for (let i = 1; i < strips.length; i++) expect(strips[i][1], strips[i][0]).toBe(strips[i - 1][1] + strips[i - 1][2]);
});

test('topics without a picture of everything do not show the button', async ({ page }) => {
  await page.addInitScript(VOICE);
  await page.goto('/topics.html#food');
  await expect(page.locator('#menu')).toBeVisible();
  const hasScene = await page.evaluate(() => !!(window as any).YS_TOPIC_PAGE.topics.food.scene);
  if (!hasScene) await expect(page.locator('#play-scene')).toBeHidden();
  await page.locator('#other-topic').click();
  await expect(page.locator('#scene-view')).toBeHidden();
  await page.locator('#topic-space').click();
  await expect(page.locator('#play-scene')).toBeVisible();
});
