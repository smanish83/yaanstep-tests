import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';

// "See them all together" for two more topics on topics.html (Manish, 23 Nov 2026: "Build those pictures").
//   #habitats  Animal homes: one wide trip from the ocean to the icy Arctic. The nest sits above the forest and the
//              hive above the rabbit's burrow, so those four are boxes stacked in one strip.
//   #vehicles  Things that go: sky, rails, road, a farm field and the sea in one picture.
// Tapping a part shows its name, its sentence and one more line (why the home suits the animal, or a fun and true
// comparison), and says them. Looking at every part once in a visit gives 1 World point, only with a child profile.
// The names, the order and the animal in each home are written out here by hand, not read from the page.

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); };`;

type Topic = {
  id: 'habitats' | 'vehicles';
  title: string;
  small: RegExp;
  note: RegExp;
  /** In Tab order: [object id, visible name, what the sentence and the extra line must mention]. */
  parts: [string, string, RegExp][];
};

const TOPICS: Topic[] = [
  {
    id: 'habitats', title: 'Animal homes around the world', small: /Tap one to hear who lives there/, note: /squeezed together/,
    parts: [
      ['ocean', 'Ocean', /whale/i], ['pond', 'Pond', /frog/i], ['nest', 'Nest', /bird.*egg|egg.*bird/i], ['forest', 'Forest', /owl.*deer|deer.*owl/i],
      ['hive', 'Hive', /bees?\b.*honey/i], ['burrow', 'Burrow', /rabbit/i], ['farm', 'Farm', /\bcows?\b/i], ['grassland', 'Grassland', /zebra/i],
      ['jungle', 'Jungle', /monkey/i], ['cave', 'Cave', /\bbats?\b/i], ['desert', 'Desert', /camel/i], ['arctic', 'Arctic', /polar bear/i],
    ],
  },
  {
    id: 'vehicles', title: 'Things that go, all together', small: /sky, the rails, the road and the sea/, note: /sizes are not real/,
    parts: [
      ['helicopter', 'Helicopter', /fly|land/i], ['airplane', 'Airplane', /flies|people/i], ['hot-air-balloon', 'Hot air balloon', /wind|floats/i],
      ['train', 'Train', /rails.*(car|bus)\b/i], ['scooter', 'Scooter', /wheels/i], ['bicycle', 'Bicycle', /pedals/i], ['car', 'Car', /people/i],
      ['bus', 'Bus', /people/i], ['police-car', 'Police car', /police/i], ['ambulance', 'Ambulance', /hospital/i], ['fire-truck', 'Fire truck', /fire/i],
      ['tractor', 'Tractor', /farm/i], ['boat', 'Boat', /water|sea/i], ['ship', 'Ship', /sea/i], ['rocket', 'Rocket', /space/i],
    ],
  },
];

const DONE = 'You looked at every part of the picture. Well done!';
const BANNED = [/therap/i, /treatment/i, /diagnos/i, /special needs/i, /\bproven\b/i, /clinical/i, /\bIQ\b/, /brain training/i, /improves?\b/i, /\bboosts?\b/i,
  /samples only/i, /autis/i, /dyslexi/i, /\bADHD\b/, /\bADD\b/, /down syndrome/i, /hearing loss/i, /low vision/i, /\bblind\b/i, /\bdeaf\b/i, /dyspraxi/i,
  /dyscalculi/i, /cerebral palsy/i, /epilep/i, /asperger/i, /\bSEND?\b/, /disorder/i, /impair/i, /\bcures?\b/i, /suitable for/i, /fully accessible/i,
  /endless/i, /thousands of (puzzles|games)/i];
const PTS_KEY = 'sprouts:points';

async function openScene(page: Page, t: Topic, age?: number) {
  await page.addInitScript(VOICE);
  if (age) await page.addInitScript((a) => localStorage.setItem('ys-profile', JSON.stringify({ age: a, color: 0, nick: '' })), age);
  await page.goto(`/topics.html#${t.id}`);
  await expect(page.locator('#menu')).toBeVisible();
  const go = page.locator('#play-scene');
  await expect(go).toBeVisible();
  await expect(go).toContainText('See them all together');
  await expect(go.locator('small')).toHaveText(t.small);
  await go.click();
  await expect(page.locator('#scene-view')).toBeVisible();
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#scene-title')).toHaveText(t.title);
  await expect(page.locator('#scene-title')).toBeFocused();
}
const said = (page: Page) => page.evaluate(() => (window as any).__said as string[]);
const btn = (page: Page, id: string) => page.locator(`#sky .sky-btn[data-obj="${id}"]`);
const stored = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), PTS_KEY) as Promise<Record<string, number> | null>;

/** Each part's sentence (its own, or its pack item's) and extra line, read from the pack. */
const lines = (page: Page, id: string) => page.evaluate((tid) => {
  const t = (window as any).YS_TOPIC_PAGE.topics[tid], out: Record<string, { say: string; compare: string }> = {};
  for (const o of t.scene.objects) {
    const it = t.items.find((i: any) => i.id === (o.item || o.id));
    out[o.id] = { say: o.say || (it ? it.say : ''), compare: o.compare || '' };
  }
  return out;
}, id);

async function expectShown(page: Page, id: string, name: string, l: { say: string; compare: string }, done = false) {
  await expect(page.locator('#scene-name')).toHaveText(name);
  await expect(page.locator('#scene-say')).toHaveText(l.say);
  await expect(page.locator('#scene-compare')).toHaveText(l.compare);
  await expect(page.locator('#sky .sky-btn.on')).toHaveCount(1);
  await expect(btn(page, id)).toHaveClass(/\bon\b/);
  const last = (await said(page)).at(-1)!;
  expect(last).toBe(`${name}. ${l.say} ${l.compare}${done ? ' ' + DONE : ''}`);
  if (done) await expect(page.locator('#scene-done')).toHaveText(DONE);
  else await expect(page.locator('#scene-done')).toHaveCount(0);
}

for (const t of TOPICS) {
  const ORDER = t.parts.map((p) => p[0]);
  const NAME = Object.fromEntries(t.parts.map((p) => [p[0], p[1]]));

  test.describe(`${t.id}: see them all together`, () => {
    test('one picture with every part as a named button: accessible, loads nothing from other sites, stores nothing', async ({ page, context }) => {
      const errors = watchErrors(page);
      const reqs = watchRequests(page);
      await openScene(page, t);
      const svg = page.locator('#sky > svg');
      await expect(svg).toHaveAttribute('role', 'img');
      const label = ((await svg.getAttribute('aria-label')) ?? '').toLowerCase();
      for (const [, name] of t.parts) expect(label, name).toContain(name.toLowerCase());
      await expect(page.locator('#scene-note')).toHaveText(t.note);
      await expect(page.locator('#scene-panel')).toHaveAttribute('aria-live', 'polite');
      expect((await said(page)).at(-1)).toContain(t.title);
      // Real buttons, named by their visible name, in reading order, and big enough to tap.
      const names = await page.locator('#sky .sky-btn').evaluateAll((bs) => bs.map((b) => [b.getAttribute('data-obj'), b.tagName, (b as HTMLElement).innerText.trim()]));
      expect(names).toEqual(t.parts.map(([id, name]) => [id, 'BUTTON', name]));
      for (const [id, name] of t.parts) {
        await expect(btn(page, id)).toHaveAccessibleName(name);
        await btn(page, id).scrollIntoViewIfNeeded();
        const box = (await btn(page, id).boundingBox())!;
        expect(box.width, id).toBeGreaterThanOrEqual(44);
        expect(box.height, id).toBeGreaterThanOrEqual(44);
      }
      expect(await axeViolations(page, '#scene-view')).toEqual([]);
      await btn(page, ORDER[2]).click();
      expect(await axeViolations(page)).toEqual([]);
      const text = await page.locator('#scene-view').innerText();
      for (const w of BANNED) expect(text, String(w)).not.toMatch(w);
      // Nothing moves in the picture, so there is nothing to turn off for reduced motion or the calm setting.
      expect(await page.locator('#scene-view').evaluate((e) => e.getAnimations({ subtree: true }).length)).toBe(0);
      // Without a profile, looking at every part still says well done, but nothing is kept.
      for (const id of ORDER) await btn(page, id).click();
      await expect(page.locator('#scene-done')).toHaveText(DONE);
      expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
      expect(reqs.sending()).toEqual([]);
      const st = await storedData(page, context);
      expect(st.local).toEqual([]);
      expect(st.session).toEqual([]);
      expect(st.cookies).toEqual([]);
      expect(errors).toEqual([]);
    });

    test('tapping each part shows its name, its sentence and one more line, and says them', async ({ page }) => {
      await openScene(page, t);
      const l = await lines(page, t.id);
      for (let i = 0; i < t.parts.length; i++) {
        const [id, name, about] = t.parts[i];
        await btn(page, id).click();
        await expectShown(page, id, name, l[id], i === t.parts.length - 1);
        expect(`${l[id].say} ${l[id].compare}`, id).toMatch(about);
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

    test('every part works from the keyboard, in order, with a visible focus ring', async ({ page }) => {
      await openScene(page, t);
      const l = await lines(page, t.id);
      await page.locator('#scene-exit').focus();
      for (let i = 0; i < ORDER.length; i++) {
        const id = ORDER[i];
        await page.keyboard.press('Tab');
        await expect(btn(page, id)).toBeFocused();
        const ring = await btn(page, id).evaluate((b) => { const s = getComputedStyle(b); return [s.outlineStyle, parseFloat(s.outlineWidth)] as [string, number]; });
        expect(ring[0], id).not.toBe('none');
        expect(ring[1], id).toBeGreaterThanOrEqual(3);
        await page.keyboard.press(i % 2 ? 'Space' : 'Enter');
        await expectShown(page, id, NAME[id], l[id], i === ORDER.length - 1);
        await expect(btn(page, id)).toBeFocused();
      }
    });

    test('at 320px the page does not scroll sideways; the picture scrolls in its own box and every part can be reached', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 700 });
      await openScene(page, t);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
      const box = page.locator('#sky-box');
      const [scroll, client] = await box.evaluate((b) => [b.scrollWidth, b.clientWidth]);
      expect(scroll).toBeGreaterThan(client);
      const l = await lines(page, t.id);
      const back = [...ORDER].reverse();
      for (let i = 0; i < back.length; i++) {
        const id = back[i];
        await btn(page, id).click();
        await expectShown(page, id, NAME[id], l[id], i === back.length - 1);
        const b = (await btn(page, id).boundingBox())!;
        expect(b.width, id).toBeGreaterThanOrEqual(44);
        expect(b.height, id).toBeGreaterThanOrEqual(44);
      }
      // Reaching the last part by keyboard brings it into view inside the box.
      const lastId = ORDER[ORDER.length - 1];
      await page.locator('#scene-exit').focus();
      for (let i = 0; i < ORDER.length; i++) await page.keyboard.press('Tab');
      await expect(btn(page, lastId)).toBeFocused();
      const b = (await btn(page, lastId).boundingBox())!, v = (await box.boundingBox())!;
      expect(b.x + b.width).toBeGreaterThanOrEqual(v.x + 22);
      expect(b.x).toBeLessThanOrEqual(v.x + v.width - 22);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
      expect(await axeViolations(page, '#scene-view')).toEqual([]);
    });

    test('the parts do not overlap, each drawing sits in its own part, and the picture is plain drawing only', async ({ page }) => {
      await openScene(page, t);
      // On screen: no two buttons share any area.
      const boxes = await page.locator('#sky .sky-btn').evaluateAll((bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { id: b.getAttribute('data-obj')!, x: r.left, y: r.top, w: r.width, h: r.height }; }));
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], c = boxes[j];
          const ox = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x), oy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
          expect(ox <= 0.5 || oy <= 0.5, `${a.id} overlaps ${c.id}`).toBe(true);
        }
      }
      // In the pack: every part is inside the picture, and the middle of its drawing is inside its own part.
      const problems = await page.locator('#sky > svg').evaluate((svg, tid) => {
        const sc = (window as any).YS_TOPIC_PAGE.topics[tid].scene, [, , W, H] = sc.vb.split(/\s+/).map(Number), out: string[] = [];
        const bad = /<(script|style|text|image|foreignObject|a)\b|href=|\son\w+=|url\(/i;
        if (bad.test(sc.back)) out.push('back: not plain drawing');
        const ids = new Set<string>();
        for (const o of sc.objects) {
          if (ids.has(o.id)) out.push(`${o.id}: twice`);
          ids.add(o.id);
          if (bad.test(o.art)) out.push(`${o.id}: not plain drawing`);
          const y = o.h ? (o.y || 0) : 0, h = o.h || H;
          if (o.x < 0 || o.x + o.w > W || y < 0 || y + h > H) out.push(`${o.id}: outside the picture`);
          const g = svg.querySelector(`[data-obj="${o.id}"]`) as SVGGraphicsElement | null;
          if (!g) { out.push(`${o.id}: no drawing`); continue; }
          const bb = g.getBBox(), cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
          if (cx < o.x || cx > o.x + o.w || cy < y || cy > y + h) out.push(`${o.id}: drawing centre ${cx.toFixed(0)},${cy.toFixed(0)} is outside its part`);
          for (const s of [o.say, o.compare].filter(Boolean)) {
            if (!/[.!?]$/.test(s)) out.push(`${o.id}: "${s}" is not a sentence`);
            for (const one of s.split(/(?<=[.!?])\s+/)) if (one.split(/\s+/).length > 20) out.push(`${o.id}: long sentence "${one}"`);
          }
          if ((o.compare || '').split(/(?<=[.!?])\s+/).length > 2) out.push(`${o.id}: more than two sentences`);
        }
        const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${sc.vb}">${sc.back}${sc.objects.map((o: any) => o.art).join('')}</svg>`, 'image/svg+xml');
        if (doc.querySelector('parsererror')) out.push('broken drawing');
        return out;
      }, t.id);
      expect(problems).toEqual([]);
    });

    test('with a child profile, looking at every part adds exactly 1 World point; more taps add no more', async ({ page }) => {
      await openScene(page, t, 6);
      for (const id of ORDER.slice(0, -1)) await btn(page, id).click();
      expect((await stored(page))?.world ?? 0).toBe(0);
      await expect(page.locator('#scene-done')).toHaveCount(0);
      await btn(page, ORDER[ORDER.length - 1]).click();
      await expect(page.locator('#scene-done')).toHaveText(DONE);
      await expect.poll(() => stored(page)).toEqual({ maths: 0, english: 0, world: 1 });
      for (const id of ORDER) await btn(page, id).click();
      await btn(page, ORDER[0]).click();
      await expect(page.locator('#scene-done')).toHaveCount(0);
      expect(await stored(page)).toEqual({ maths: 0, english: 0, world: 1 });
      expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual([PTS_KEY, 'ys-profile']);
    });
  });
}

test('the lesson and the game of both topics are still there next to the picture', async ({ page }) => {
  await page.addInitScript(VOICE);
  for (const t of TOPICS) {
    await page.goto(`/topics.html#${t.id}`);
    await expect(page.locator('#menu')).toBeVisible();
    await expect(page.locator('#play-learn')).toBeVisible();
    await expect(page.locator('#play-play')).toBeVisible();
    await expect(page.locator('#play-scene')).toBeVisible();
  }
});
