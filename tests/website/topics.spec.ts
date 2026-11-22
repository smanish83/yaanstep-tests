import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';

// Learn about the world (topics.html, Manish 22 Nov 2026): picture topics for ages 3 to 8, each with a lesson
// (one picture at a time) and a game. Flags are checked against their official proportions and capitals here,
// written out by hand from each country's flag law, not read from the page.

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); };`;

const WANT_TOPICS = ['food', 'body', 'feelings', 'family', 'vehicles', 'healthy', 'seasons', 'opposites', 'jobs', 'plants', 'habitats', 'flags', 'space'];

// height : width, and the capital, for every flag the page may show.
const FLAGS: Record<string, [number, number, string]> = {
  japan: [2, 3, 'Tokyo'], france: [2, 3, 'Paris'], italy: [2, 3, 'Rome'], germany: [3, 5, 'Berlin'], ireland: [1, 2, 'Dublin'],
  belgium: [13, 15, 'Brussels'], netherlands: [2, 3, 'Amsterdam'], poland: [5, 8, 'Warsaw'], ukraine: [2, 3, 'Kyiv'], russia: [2, 3, 'Moscow'],
  nigeria: [1, 2, 'Abuja'], ghana: [2, 3, 'Accra'], sweden: [5, 8, 'Stockholm'], norway: [8, 11, 'Oslo'], finland: [11, 18, 'Helsinki'],
  denmark: [28, 37, 'Copenhagen'], switzerland: [1, 1, 'Bern'], greece: [2, 3, 'Athens'], thailand: [2, 3, 'Bangkok'], colombia: [2, 3, 'Bogot'],
  india: [2, 3, 'New Delhi'], china: [2, 3, 'Beijing'], vietnam: [2, 3, 'Hanoi'], bangladesh: [3, 5, 'Dhaka'], pakistan: [2, 3, 'Islamabad'],
  turkey: [2, 3, 'Ankara'], 'united-states': [10, 19, 'Washington'], 'united-kingdom': [1, 2, 'London'], jamaica: [1, 2, 'Kingston'],
  'south-korea': [2, 3, 'Seoul'], philippines: [1, 2, 'Manila'], austria: [2, 3, 'Vienna'], estonia: [7, 11, 'Tallinn'], lithuania: [3, 5, 'Vilnius'],
  hungary: [1, 2, 'Budapest'], romania: [2, 3, 'Bucharest'], 'ivory-coast': [2, 3, 'Yamoussoukro'], mali: [2, 3, 'Bamako'], peru: [2, 3, 'Lima'],
  mauritius: [2, 3, 'Port Louis'], chile: [2, 3, 'Santiago'], iceland: [18, 25, 'Reykjav'], israel: [8, 11, 'Jerusalem'], 'new-zealand': [1, 2, 'Wellington'], australia: [1, 2, 'Canberra'],
};

async function open(page: Page, hash = '') {
  await page.addInitScript(VOICE);
  await page.goto(`/topics.html${hash}`);
}
const current = (page: Page) => page.evaluate(() => (window as any).YS_SHELL.current());

test('the topics page is linked from Yaanstep Sprouts, lists every topic, loads nothing from other sites and stores nothing', async ({ page, context }) => {
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await page.goto('/sprouts.html');
  await page.locator('a[href="topics.html"]').click();
  await expect(page.locator('h1')).toHaveText('Learn about the world');
  const ids = await page.evaluate(() => (window as any).YS_TOPIC_PAGE.ids as string[]);
  expect(ids).toEqual(WANT_TOPICS);
  await expect(page.locator('#topic-list button')).toHaveCount(WANT_TOPICS.length);
  expect(await axeViolations(page)).toEqual([]);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect((await storedData(page, context)).local).toEqual([]);
  expect(errors).toEqual([]);
});

test('every topic pack is well formed: unique ids, a sentence per picture, and questions whose answers exist', async ({ page }) => {
  await open(page);
  const problems = await page.evaluate(() => {
    const T = (window as any).YS_TOPIC_PAGE.topics, out: string[] = [];
    for (const id of Object.keys(T)) {
      const t = T[id], ids = new Set<string>();
      if (!/^\d+-\d+$/.test(t.ages)) out.push(`${id}: ages`);
      if (t.items.length < 6) out.push(`${id}: only ${t.items.length} items`);
      for (const it of t.items) {
        if (ids.has(it.id)) out.push(`${id}: duplicate ${it.id}`);
        ids.add(it.id);
        if (!it.say || !/[.!?]["”]?$/.test(it.say)) out.push(`${id}/${it.id}: say`);
        if (/<(svg|script|style|text|image|foreignObject)\b|href=|\son\w+=/i.test(it.art)) out.push(`${id}/${it.id}: art`);
        const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${it.vb || '0 0 64 64'}">${it.art}</svg>`, 'image/svg+xml');
        if (doc.querySelector('parsererror')) out.push(`${id}/${it.id}: broken drawing`);
      }
      for (const q of t.questions || []) {
        for (const a of [...q.ans, ...(q.pool || [])]) if (!ids.has(a)) out.push(`${id}: "${q.q}" names ${a}`);
        const pool = (q.pool || [...ids]).filter((x: string) => !q.ans.includes(x));
        if (pool.length < 2) out.push(`${id}: "${q.q}" has too few wrong choices`);
        if ((q.pool || []).some((x: string) => q.ans.includes(x))) out.push(`${id}: "${q.q}" pool overlaps answers`);
      }
    }
    return out;
  });
  expect(problems).toEqual([]);
});

test('flags: every flag has its official proportions, and the capital named is right', async ({ page }) => {
  await open(page);
  const flags = await page.evaluate(() => (window as any).YS_TOPIC_PAGE.topics.flags.items.map((i: any) => ({ id: i.id, vb: i.vb, say: i.say })));
  expect(flags.length).toBeGreaterThanOrEqual(15);
  for (const f of flags) {
    expect(Object.keys(FLAGS), `${f.id} is not in the checked list`).toContain(f.id);
    const [h, w, capital] = FLAGS[f.id];
    const [, , vw, vh] = f.vb.split(/\s+/).map(Number);
    expect(Math.abs(vh / vw - h / w), `${f.id} proportions ${vw}x${vh}`).toBeLessThan(0.005);
    expect(f.say.normalize('NFD').replace(/[̀-ͯ]/g, ''), f.id).toContain(capital);
  }
});

for (const id of WANT_TOPICS) {
  test(`${id}: the lesson shows every picture, and 8 rounds of the game teach on a miss`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, `#${id}`);
    await expect(page.locator('#menu')).toBeVisible();
    const n = await page.evaluate((t) => (window as any).YS_TOPIC_PAGE.topics[t].items.length, id);
    await page.locator('#play-learn').click();
    for (let i = 1; i <= n + 1; i++) {
      await expect(page.locator('#count')).toHaveText(`Part ${i} of ${n + 1}`);
      await expect(page.locator('#area svg[role=img]').first()).toBeVisible();
      if (i <= n) await page.locator('#nextpart').click();
    }
    await page.locator('[data-go="play"]').click();
    for (let k = 0; k < 8; k++) {
      await expect(page.locator('#count')).toHaveText(`Round ${k + 1} of 8`);
      const r = await current(page);
      const opts = await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-v')!));
      expect(opts).toHaveLength(3);
      expect(opts.filter((o) => r.right.includes(o)), r.q).toEqual([r.ans]);
      if (k === 0) {
        const wrong = opts.find((o) => !r.right.includes(o))!;
        await page.locator(`#choices button[data-v="${wrong}"]`).click();
        await expect(page.locator('#sub')).toHaveClass(/try/);
        await page.locator('#howbtn').click();
        await expect(page.locator('#lesson h3')).toBeFocused();
        expect(await axeViolations(page, '#game')).toEqual([]);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
      }
      await page.locator(`#choices button[data-v="${r.ans}"]`).click();
      await expect(page.locator('#sub')).toContainText('Yes!');
      await page.locator('#more').click();
    }
    await expect(page.locator('#alldone')).toBeVisible();
    await page.locator('#stop').click();
    await page.locator('#other-topic').click();
    await expect(page.locator(`#topic-${id}`)).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test('every button on the topics page is at least 48 by 48 px', async ({ page }) => {
  await open(page);
  const sizes = async (where: string) => {
    for (const b of await page.locator('button:visible').all()) {
      const box = (await b.boundingBox())!;
      expect(box.width, `${where}: ${await b.innerText()}`).toBeGreaterThanOrEqual(47.5);
      expect(box.height, `${where}: ${await b.innerText()}`).toBeGreaterThanOrEqual(47.5);
    }
  };
  await sizes('list');
  await page.locator('#topic-flags').click();
  await page.locator('#play-play').click();
  await sizes('flags game');
});
