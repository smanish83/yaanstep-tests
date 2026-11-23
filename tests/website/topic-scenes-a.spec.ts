import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';

// "See them all together" pictures for three more topics (Manish, 23 Nov 2026: "Build those pictures"):
//   My body  - one child standing; tap a part (hair down to feet) to hear what it is and what it helps us do.
//   Plants   - one plant above and below the ground, with the sun, rain, air and soil; tap a part to hear what it does.
//   Seasons  - one tree four times (spring, summer, fall, winter) with what we wear below each; tap to hear about it.
// Same picture engine as the space scene (topics.js, see space-scene.spec.ts). The parts, their names and their order,
// and the key fact each tap must give, are written out by hand here, not read from the page.

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); };`;

const BANNED = [/therap/i, /treatment/i, /diagnos/i, /special needs/i, /\bproven\b/i, /clinical/i, /\bIQ\b/, /brain training/i, /improves?\b/i, /\bboosts?\b/i,
  /samples only/i, /dyslexi/i, /autis/i, /\bADHD\b/, /\bADD\b/, /down syndrome/i, /hearing loss/i, /low vision/i, /\bblind/i, /\bdeaf/i, /dyspraxi/i,
  /dyscalculi/i, /cerebral palsy/i, /epilep/i, /asperger/i, /\bSEND?\b/, /disorder/i, /impair/i, /\bcures?\b/i, /suitable for/i, /fully accessible/i];

type Case = {
  topic: string;
  /** Every tappable part, in page (and Tab) order: [id, visible name, what the spoken line must say]. */
  parts: [string, string, RegExp][];
  /** What the picture's description must name. */
  label: RegExp;
};

const CASES: Case[] = [
  {
    topic: 'body',
    label: /child.*head, hair, ears, eyes, nose, mouth, shoulders, arms, tummy, hands, legs, knees and feet/,
    parts: [
      ['head', 'Head', /brain/], ['hair', 'Hair', /grows/], ['ears', 'Ears', /hear/], ['eyes', 'Eyes', /\bsee\b/], ['nose', 'Nose', /smell/],
      ['mouth', 'Mouth', /taste.*talk|talk.*taste/], ['shoulders', 'Shoulders', /arms/], ['arms', 'Arms', /reach|hug|carry/], ['tummy', 'Tummy', /food/i],
      ['hands', 'Hands', /hold|clap|wave/], ['legs', 'Legs', /walk.*run|run.*walk/], ['knees', 'Knees', /bend/], ['feet', 'Feet', /stand|walk/],
    ],
  },
  {
    topic: 'plants',
    label: /flower.*tomato.*leaves.*stem.*roots.*sun.*rain.*seed/,
    parts: [
      ['sunlight', 'Sunlight', /sunlight/i], ['water', 'Rain', /water.*roots|roots.*water/], ['air', 'Air', /air/], ['flower', 'Flower', /seeds/],
      ['fruit', 'Fruit', /seeds/], ['leaf', 'Leaves', /sunlight.*food|food.*sunlight/], ['stem', 'Stem', /holds the plant up/], ['roots', 'Roots', /take in water/],
      ['soil', 'Soil', /roots/], ['seed', 'Seed', /new plant/],
    ],
  },
  {
    topic: 'seasons',
    label: /spring.*summer.*fall.*winter/i,
    parts: [
      ['spring', 'Spring', /flowers bloom.*after winter/i], ['spring-wear', 'Umbrella', /rain/], ['summer', 'Summer', /warmest.*after spring/],
      ['summer-wear', 'Sun hat', /sunny/], ['fall', 'Fall', /leaves.*after summer/], ['fall-wear', 'Sweater', /cooler.*warm/],
      ['winter', 'Winter', /coldest.*after fall.*spring comes again/], ['winter-wear', 'Hat and mittens', /cold/],
    ],
  },
];

type Obj = { id: string; name: string; say: string; compare: string; x: number; y: number; w: number; h: number };
type Scene = { button: string; small: string; title: string; prompt: string; note: string; W: number; H: number; objects: Obj[] };

async function open(page: Page, topic: string, age: number | null = null) {
  await page.addInitScript(VOICE);
  if (age) await page.addInitScript((a) => localStorage.setItem('ys-profile', JSON.stringify({ age: a, color: 0, nick: '' })), age);
  await page.goto(`/topics.html#${topic}`);
  await expect(page.locator('#menu')).toBeVisible();
}
async function openScene(page: Page, topic: string, age: number | null = null) {
  await open(page, topic, age);
  await expect(page.locator('#play-scene')).toBeVisible();
  await page.locator('#play-scene').click();
  await expect(page.locator('#scene-view')).toBeVisible();
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#scene-title')).toBeFocused();
}
/** The scene as the page has it, with each part's name and sentence worked out the way topics.js does. */
const scene = (page: Page, topic: string) => page.evaluate((t) => {
  const p = (window as any).YS_TOPIC_PAGE.topics[t], sc = p.scene;
  const [, , W, H] = sc.vb.split(/\s+/).map(Number);
  const item = (id: string) => p.items.find((i: any) => i.id === id);
  return {
    button: sc.button, small: sc.small, title: sc.title, prompt: sc.prompt, note: sc.note, W, H,
    objects: sc.objects.map((o: any) => {
      const it = item(o.item || o.id);
      return { id: o.id, name: o.name || (it ? it.name.charAt(0).toUpperCase() + it.name.slice(1) : o.id), say: o.say || (it ? it.say : ''), compare: o.compare || '',
        x: o.x, y: o.y || 0, w: o.w, h: o.h || H };
    }),
  };
}, topic) as Promise<Scene>;
const said = (page: Page) => page.evaluate(() => (window as any).__said as string[]);
const btn = (page: Page, id: string) => page.locator(`#sky .sky-btn[data-obj="${id}"]`);
const spoken = (o: Obj) => `${o.name}. ${[o.say, o.compare].join(' ').trim()}`;

async function expectShown(page: Page, o: Obj) {
  await expect(page.locator('#scene-name')).toHaveText(o.name);
  await expect(page.locator('#scene-say')).toHaveText(o.say);
  if (o.compare) await expect(page.locator('#scene-compare')).toHaveText(o.compare);
  else await expect(page.locator('#scene-compare')).toHaveCount(0);
  await expect(page.locator('#sky .sky-btn.on')).toHaveCount(1);
  await expect(btn(page, o.id)).toHaveClass(/\bon\b/);
  expect((await said(page)).at(-1)!.startsWith(spoken(o))).toBe(true);
}
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

for (const c of CASES) {
  test.describe(`${c.topic}: the "See them all together" picture`, () => {
    test('the menu button shows; the picture is accessible, loads nothing from other sites and stores nothing', async ({ page, context }) => {
      const errors = watchErrors(page);
      const reqs = watchRequests(page);
      await open(page, c.topic);
      const sc = await scene(page, c.topic);
      await expect(page.locator('#play-scene')).toBeVisible();
      await expect(page.locator('#play-scene')).toContainText('See them all together');
      await expect(page.locator('#play-scene small')).toHaveText(sc.small);
      expect(sc.small).toMatch(/Tap/);
      await page.locator('#play-scene').click();
      await expect(page.locator('#scene-view')).toBeVisible();
      await expect(page.locator('#scene-title')).toHaveText(sc.title);
      await expect(page.locator('#scene-panel')).toHaveAttribute('aria-live', 'polite');
      expect((await said(page)).at(-1)).toBe(`${sc.title}. ${sc.prompt}`);
      const svg = page.locator('#sky svg');
      await expect(svg).toHaveAttribute('role', 'img');
      expect(await svg.getAttribute('aria-label')).toMatch(c.label);
      // Every part is a real button whose accessible name is its visible name, in the expected order.
      const shown = await page.locator('#sky .sky-btn').evaluateAll((bs) => bs.map((b) => [b.getAttribute('data-obj'), b.tagName, (b as HTMLElement).innerText.trim()]));
      expect(shown).toEqual(c.parts.map(([id, name]) => [id, 'BUTTON', name]));
      for (const [id, name] of c.parts) await expect(btn(page, id)).toHaveAccessibleName(name);
      expect(await axeViolations(page, '#scene-view')).toEqual([]);
      await btn(page, c.parts[1][0]).click();
      expect(await axeViolations(page)).toEqual([]);
      const text = (await page.locator('#scene-view').innerText()) + ' ' + sc.objects.map((o) => `${o.name} ${o.say} ${o.compare}`).join(' ') + ' ' + sc.note;
      for (const w of BANNED) expect(text, String(w)).not.toMatch(w);
      // Nothing moves in the picture, so there is nothing to turn off for reduced motion or the calm setting.
      expect(await page.locator('#scene-view').evaluate((e) => e.getAnimations({ subtree: true }).length)).toBe(0);
      // The drawings are plain shapes: no text, scripts, links or pictures from elsewhere.
      expect(await page.locator('#sky svg').evaluate((s) => s.querySelectorAll('text, script, image, foreignObject, a, [href], use').length)).toBe(0);
      expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
      expect(reqs.sending()).toEqual([]);
      const stored = await storedData(page, context);
      expect(stored.local).toEqual([]);
      expect(stored.session).toEqual([]);
      expect(stored.cookies).toEqual([]);
      expect(errors).toEqual([]);
    });

    test('tapping each part shows its name and what it does, and says it', async ({ page }) => {
      await openScene(page, c.topic);
      const sc = await scene(page, c.topic);
      for (const [id, , fact] of c.parts) {
        const o = sc.objects.find((x) => x.id === id)!;
        await btn(page, id).click();
        await expectShown(page, o);
        expect(`${o.say} ${o.compare}`, id).toMatch(fact);
        for (const s of [o.say, o.compare].filter(Boolean)) expect(s, id).toMatch(/[.!?]$/);
      }
      const before = (await said(page)).length;
      await page.locator('#scene-again').click();
      const after = await said(page);
      expect(after.length).toBe(before + 1);
      expect(after.at(-1)).toBe(after.at(-2));
      await page.locator('#scene-exit').click();
      await expect(page.locator('#scene-view')).toBeHidden();
      await expect(page.locator('#play-scene')).toBeFocused();
    });

    test('every part works from the keyboard, in order, with a visible focus ring', async ({ page }) => {
      await openScene(page, c.topic);
      const sc = await scene(page, c.topic);
      await page.locator('#scene-exit').focus();
      for (let i = 0; i < c.parts.length; i++) {
        const id = c.parts[i][0];
        await page.keyboard.press('Tab');
        await expect(btn(page, id)).toBeFocused();
        const ring = await btn(page, id).evaluate((b) => { const s = getComputedStyle(b); return [s.outlineStyle, parseFloat(s.outlineWidth)] as [string, number]; });
        expect(ring[0], id).not.toBe('none');
        expect(ring[1], id).toBeGreaterThanOrEqual(3);
        await page.keyboard.press(i % 2 ? 'Space' : 'Enter');
        await expectShown(page, sc.objects.find((x) => x.id === id)!);
        await expect(btn(page, id)).toBeFocused();
      }
    });

    test('at 320px the page does not scroll sideways, and every part can be reached and is at least 44px', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 700 });
      await openScene(page, c.topic);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
      const sc = await scene(page, c.topic);
      const box = page.locator('#sky-box');
      for (const [id] of [...c.parts].reverse()) {
        await btn(page, id).scrollIntoViewIfNeeded();
        const b = (await btn(page, id).boundingBox())!;
        expect(b.width, id).toBeGreaterThanOrEqual(44);
        expect(b.height, id).toBeGreaterThanOrEqual(44);
        await btn(page, id).click();
        await expectShown(page, sc.objects.find((x) => x.id === id)!);
      }
      // The last part, reached by keyboard, is brought into view inside the picture's own box.
      const last = c.parts.at(-1)![0];
      await page.locator('#scene-exit').focus();
      for (let i = 0; i < c.parts.length; i++) await page.keyboard.press('Tab');
      await expect(btn(page, last)).toBeFocused();
      const b = (await btn(page, last).boundingBox())!, v = (await box.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(v.x - 1);
      expect(b.x + Math.min(b.width, 44)).toBeLessThanOrEqual(v.x + v.width + 1);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
      expect(await axeViolations(page, '#scene-view')).toEqual([]);
    });

    test('the parts do not overlap, and each part covers its own drawing', async ({ page }) => {
      await openScene(page, c.topic);
      const sc = await scene(page, c.topic);
      // From the pack: inside the picture, at least 44 px each way, no two overlapping.
      for (const o of sc.objects) {
        expect(o.w, o.id).toBeGreaterThanOrEqual(44);
        expect(o.h, o.id).toBeGreaterThanOrEqual(44);
        expect(o.x >= 0 && o.y >= 0 && o.x + o.w <= sc.W && o.y + o.h <= sc.H, `${o.id} inside the picture`).toBe(true);
      }
      const rect = (o: Obj) => ({ x: o.x, y: o.y, width: o.w, height: o.h });
      for (let i = 0; i < sc.objects.length; i++) for (let j = i + 1; j < sc.objects.length; j++) {
        expect(overlaps(rect(sc.objects[i]), rect(sc.objects[j])), `${sc.objects[i].id} and ${sc.objects[j].id}`).toBe(false);
      }
      // On the page: the buttons themselves do not overlap.
      const boxes = await page.locator('#sky .sky-btn').evaluateAll((bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { id: b.getAttribute('data-obj')!, x: r.x, y: r.y, width: r.width, height: r.height }; }));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        expect(overlaps(boxes[i], boxes[j]), `${boxes[i].id} and ${boxes[j].id} on the page`).toBe(false);
      }
      // Each part's own drawing reaches into its tap area (the picture is drawn 1:1, so drawing units are pixels).
      const drawn = await page.locator('#sky svg').evaluate((svg) => Array.from(svg.querySelectorAll('g[data-obj]')).map((g) => {
        const b = (g as SVGGraphicsElement).getBBox(); return { id: g.getAttribute('data-obj')!, x: b.x, y: b.y, width: b.width, height: b.height };
      }));
      expect(drawn.map((d) => d.id)).toEqual(sc.objects.map((o) => o.id));
      for (const d of drawn) {
        const o = sc.objects.find((x) => x.id === d.id)!;
        expect(d.width * d.height, `${d.id} has a drawing`).toBeGreaterThan(0);
        expect(overlaps(d, rect(o)), `${d.id} drawing is under its button`).toBe(true);
      }
    });

    for (const age of [6, null]) {
      test(age ? 'with a child profile, looking at every part adds exactly 1 world point, and tapping more adds no more'
        : 'with no profile, looking at every part stores nothing', async ({ page, context }) => {
        const errors = watchErrors(page);
        await openScene(page, c.topic, age);
        const sc = await scene(page, c.topic);
        const ids = c.parts.map(([id]) => id);
        for (let i = 0; i < ids.length; i++) {
          await btn(page, ids[i]).click();
          await expect(page.locator('#scene-name')).toHaveText(c.parts[i][1]);
          if (i < ids.length - 1) await expect(page.locator('#scene-done')).toHaveCount(0);
        }
        await expect(page.locator('#scene-done')).toHaveText('You looked at every part of the picture. Well done!');
        expect((await said(page)).at(-1)).toBe(`${spoken(sc.objects.at(-1)!)} You looked at every part of the picture. Well done!`);
        // Tapping more parts adds nothing more.
        for (const id of ids.slice(0, 3)) {
          await btn(page, id).click();
          await expect(page.locator('#scene-done')).toHaveCount(0);
        }
        const pts = await page.evaluate(() => JSON.parse(localStorage.getItem('sprouts:points') ?? 'null'));
        if (age) {
          expect(pts).toEqual({ maths: 0, english: 0, world: 1 });
          expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(['sprouts:points', 'ys-profile']);
          await expect(page.locator('#ys-pts')).toHaveText('1 point');
        } else {
          expect(pts).toBeNull();
          const stored = await storedData(page, context);
          expect(stored.local).toEqual([]);
          expect(stored.session).toEqual([]);
          expect(stored.cookies).toEqual([]);
        }
        expect(errors).toEqual([]);
      });
    }
  });
}

test('seasons: the four trees are in order left to right, and the scene uses the topic\'s own word "fall"', async ({ page }) => {
  await openScene(page, 'seasons');
  const sc = await scene(page, 'seasons');
  const xs = ['spring', 'summer', 'fall', 'winter'].map((id) => sc.objects.find((o) => o.id === id)!.x);
  expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  await btn(page, 'fall').click();
  await expect(page.locator('#scene-name')).toHaveText('Fall');
  // The pack says "fall" and explains "autumn" once, in the item's own sentence; the scene adds no other name for it.
  const words = sc.objects.map((o) => `${o.name} ${o.compare}`).join(' ') + ' ' + sc.title + ' ' + sc.note;
  expect(words).not.toMatch(/autumn/i);
  expect(sc.objects.find((o) => o.id === 'fall')!.say).toMatch(/also called autumn/);
});

test('body: one standing child, drawn from the hair down to the feet', async ({ page }) => {
  await openScene(page, 'body');
  const sc = await scene(page, 'body');
  const down = ['hair', 'head', 'eyes', 'nose', 'mouth', 'shoulders', 'tummy', 'legs', 'knees', 'feet'].map((id) => sc.objects.find((o) => o.id === id)!.y);
  expect([...down].sort((a, b) => a - b)).toEqual(down);
});

test('plants: the flower, fruit and leaves are above the ground; the roots, the seed and the soil are below it', async ({ page }) => {
  await openScene(page, 'plants');
  const sc = await scene(page, 'plants');
  const GROUND = 280; // the ground line in the plants picture (its y in picture pixels)
  const o = (id: string) => sc.objects.find((x) => x.id === id)!;
  for (const id of ['sunlight', 'water', 'air', 'flower', 'fruit', 'leaf', 'stem']) expect(o(id).y + o(id).h, id).toBeLessThanOrEqual(GROUND);
  for (const id of ['roots', 'soil', 'seed']) expect(o(id).y, id).toBeGreaterThanOrEqual(GROUND);
  expect(o('flower').y).toBeLessThan(o('stem').y);
  expect(o('stem').y).toBeLessThan(o('roots').y);
});
