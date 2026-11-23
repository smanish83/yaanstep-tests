import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';

// Clocks and time, two more games (Manish, 23 Nov 2026: "Add world time in Clocks and time, also add a games like
// I am backing a bread, i have to set timer for 45 minutes or seconds, set the timer for it").
// - Time around the world (#play-world): city cards with a flag, a clock and a sun or moon, from the device clock and
//   the browser's own time zone data. Tapping a card says its time. Questions: day or night, where is it night,
//   what time is it, how many hours ahead. The answers are checked here with the test's own Intl maths at a fixed time.
// - Set the kitchen timer (#play-timer): an everyday job needs a timer; the child sets it with + and − buttons.
//   Right: the timer runs down in a few seconds (at once with reduced motion or "calm"), rings with a picture, the job
//   is done. Not right: a kind line saying what was set and what was asked, and "Show me how".
// Both fit the age in the profile ("ys-profile", read only): up to 5, 6 and 7 (and no profile), 8 and up.
// Points go to maths, only with a profile.

const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); };`;

const HERE = 'America/Chicago';
test.use({ timezoneId: HERE });

/** The cities and their time zones, as the brief asks: a spread around the world, each with its country's flag. */
const CITIES: Record<string, { name: string; zone: string }> = {
  'los-angeles': { name: 'Los Angeles', zone: 'America/Los_Angeles' },
  'new-york': { name: 'New York', zone: 'America/New_York' },
  london: { name: 'London', zone: 'Europe/London' },
  lagos: { name: 'Lagos', zone: 'Africa/Lagos' },
  delhi: { name: 'Delhi', zone: 'Asia/Kolkata' },
  bangkok: { name: 'Bangkok', zone: 'Asia/Bangkok' },
  tokyo: { name: 'Tokyo', zone: 'Asia/Tokyo' },
  sydney: { name: 'Sydney', zone: 'Australia/Sydney' },
};
/** Fixed moments: a November evening here, a June midday in London, the night London's clocks go forward, a new year. */
const MOMENTS = [new Date('2026-11-23T23:47:00Z'), new Date('2026-06-21T12:05:00Z'), new Date('2026-03-29T01:30:00Z'), new Date('2027-01-01T05:00:00Z')];
const KINDS: Record<number, string[]> = { 0: ['daynight', 'where'], 1: ['daynight', 'where', 'time'], 2: ['where', 'time', 'ahead'] };
const levelOf = (age: number) => (!age ? 1 : age <= 5 ? 0 : age <= 7 ? 1 : 2);

/** Words the page must never use: the shared wording rules and the extra list for this page. */
const BANNED = [/therap/i, /treatment/i, /diagnos/i, /special needs/i, /autis/i, /disorder/i, /\bSEND?\b/, /\bproven\b/i, /clinical/i, /\bIQ\b/, /brain training/i,
  /improves?\b/i, /\bboosts?\b/i, /dyslexi/i, /\bADHD\b/i, /\bADD\b/, /down syndrome/i, /hearing loss/i, /low vision/i, /\bblind/i, /\bdeaf/i, /dyspraxi/i,
  /dyscalculi/i, /cerebral palsy/i, /epilep/i, /asperger/i, /impair/i, /\bcures?\b/i, /suitable for/i, /fully accessible/i,
  /\b\d{2,}\+?\s+(puzzles|questions|games)\b/i, /\b(endless|thousands of|unlimited)\b/i, /samples only/i];

/* ---------- the test's own time maths ---------- */
function zoneTime(zone: string, at: Date) {
  const s = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  const [h, m] = s.split(':').map(Number);
  return { h: h % 24, m };
}
function utcOffset(zone: string, at: Date) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')!.value;
  const m = name.match(/GMT([+-])(\d\d):(\d\d)/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}
const isDay = (h: number) => h >= 6 && h < 18;
const label = (t: { h: number; m: number }) => `${t.h % 12 || 12}:${String(t.m).padStart(2, '0')} ${t.h < 12 ? 'a.m.' : 'p.m.'}`;
const noun = (h: number) => (h < 5 || h >= 21 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening');
function spoken(t: { h: number; m: number }) {
  const base = t.m === 0 ? `${t.h % 12 || 12} o'clock` : `${t.h % 12 || 12}:${String(t.m).padStart(2, '0')}`;
  if (t.m === 0 && t.h === 12) return `${base}, midday`;
  if (t.m === 0 && t.h === 0) return `${base}, midnight`;
  return `${base} ${noun(t.h) === 'night' ? 'at night' : `in the ${noun(t.h)}`}`;
}
const hours = (n: number) => `${n} ${n === 1 ? 'hour' : 'hours'}`;

/** The right choices for a world round, by the test's own maths: must be exactly [r.ans]. */
function worldRight(r: any, at: Date): string[] {
  const t = (id: string) => zoneTime(CITIES[id].zone, at);
  if (r.kind === 'daynight') return r.choices.filter((v: string) => (v === 'day') === isDay(t(r.city).h));
  if (r.kind === 'where') return r.choices.filter((v: string) => (r.want === 'night') !== isDay(t(v).h));
  if (r.kind === 'time') return r.choices.filter((v: string) => v === label(t(r.city)));
  const d = (utcOffset(CITIES[r.city].zone, at) - utcOffset(CITIES[r.from].zone, at)) / 60;
  return r.choices.filter((v: string) => v === hours(d));
}

/* ---------- the timer: seconds from the words of the prompt ---------- */
function asked(prompt: string): number {
  const said = prompt.match(/Set the timer for (.+)\.$/)![1];
  const phrases: Record<string, number> = { 'a quarter of an hour': 900, 'half an hour': 1800, 'three quarters of an hour': 2700, 'an hour': 3600 };
  if (said in phrases) return phrases[said];
  const m = said.match(/^(?:(\d+) minutes?)?(?: and )?(?:(\d+) seconds)?$/)!;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}
const amount = (s: number) => [Math.floor(s / 60) ? `${Math.floor(s / 60)} minute${Math.floor(s / 60) === 1 ? '' : 's'}` : '', s % 60 ? `${s % 60} seconds` : ''].filter(Boolean).join(' and ') || '0 minutes';

async function open(page: Page, o: { age?: number; comfort?: string[]; at?: Date } = {}) {
  await page.addInitScript(VOICE);
  if (o.age || o.comfort) await page.addInitScript((p) => localStorage.setItem('ys-profile', JSON.stringify(p)), { age: o.age ?? 0, color: 0, nick: '', ...(o.comfort ? { comfort: o.comfort } : {}) });
  if (o.at) await page.clock.setFixedTime(o.at);
  await page.goto('/clocks.html');
}
const current = (page: Page) => page.evaluate(() => (window as any).YS_SHELL.current());

/** Sets the kitchen timer to the round's time with the buttons, the way a child would. */
async function setTimer(page: Page, seconds: number, level: number) {
  const m = Math.floor(seconds / 60), s = seconds % 60;
  if (level === 0) { for (let i = 0; i < m; i++) await page.locator('#min-up').click(); return; }
  for (let i = 0; i < Math.floor(m / 10); i++) await page.locator('#min-up10').click();
  for (let i = 0; i < m % 10; i++) await page.locator('#min-up').click();
  for (let i = 0; i < s / 10; i++) await page.locator('#sec-up').click();
}
async function expectKindMiss(page: Page) {
  await expect(page.locator('#sub')).toHaveClass(/try/);
  await expect(page.locator('#sub')).not.toContainText(/wrong|incorrect|lose|lost|score|hurry|quick/i);
  await page.locator('#howbtn').click();
  await expect(page.locator('#lesson h3')).toBeFocused();
  await expect(page.locator('#lesson svg[role=img]').first()).toBeVisible();
  expect((await page.locator('#lesson-say').innerText()).length).toBeGreaterThan(30);
}

test('Clocks: the two new games are on the menu; the page loads nothing from other sites, stores nothing, passes the accessibility scan and fits 320 px', async ({ page, context }) => {
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await open(page, { at: MOMENTS[0] });
  await expect(page.locator('#play-world')).toContainText('Time around the world');
  await expect(page.locator('#play-timer')).toContainText('Set the kitchen timer');
  const note = await page.locator('.note').first().innerText();
  expect(note).toMatch(/Free\./);
  expect(note).toContain('Not a replacement for school.');
  expect(note).toMatch(/only points are kept on this device/i);
  expect(await axeViolations(page)).toEqual([]);
  for (const g of ['world', 'timer']) {
    await page.locator(`#play-${g}`).click();
    expect(await axeViolations(page, '#game'), g).toEqual([]);
    await page.setViewportSize({ width: 320, height: 700 });
    expect(await horizontalOverflow(page), `${g} at 320 px`).toBeLessThanOrEqual(1);
    for (const b of await page.locator('button:visible').all()) {
      const box = (await b.boundingBox())!;
      expect(box.width, `${g}: ${await b.innerText()}`).toBeGreaterThanOrEqual(47.5);
      expect(box.height, `${g}: ${await b.innerText()}`).toBeGreaterThanOrEqual(47.5);
    }
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.locator('#exit').click();
  }
  await page.waitForLoadState('networkidle');
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect(reqs.sending()).toEqual([]);
  const s = await storedData(page, context);
  expect(s.local).toEqual([]);
  expect(s.session.filter((k) => !/^ys-rest/.test(k))).toEqual([]); // the shared break timer (profile.js) may count play time
  expect(s.cookies).toEqual([]);
  expect(errors).toEqual([]);
});

for (const at of MOMENTS) {
  test(`Time around the world at ${at.toISOString()}: every card shows the real time there, with day or night and a flag, and tapping says it`, async ({ page }) => {
    const errors = watchErrors(page);
    await open(page, { at });
    await page.locator('#play-world').click();
    const r = await current(page);
    expect(r.now).toBe(at.getTime());
    // The page's zones are the brief's cities, and their times match the test's own Intl maths.
    expect(r.zones.map((z: any) => [z.id, z.zone])).toEqual(Object.entries(CITIES).map(([id, c]) => [id, c.zone]));
    for (const z of r.zones) {
      const t = zoneTime(z.zone, at);
      expect([z.h, z.m, z.day, z.label], z.id).toEqual([t.h, t.m, isDay(t.h), label(t)]);
      expect(z.off, z.id).toBe(utcOffset(z.zone, at));
      const card = page.locator(`#cities button[data-city="${z.id}"]`);
      await expect(card).toContainText(CITIES[z.id].name);
      await expect(card).toContainText(label(t));
      await expect(card).toHaveClass(isDay(t.h) ? /\bday\b/ : /\bnight\b/);
      await expect(card.locator('svg[aria-hidden="true"]')).toHaveCount(3); // flag, sun or moon, clock (all drawings, hidden from screen readers)
    }
    const here = zoneTime(HERE, at);
    expect([r.here.zone, r.here.h, r.here.m]).toEqual([HERE, here.h, here.m]);
    await expect(page.locator('#cities button[data-city="here"]')).toContainText(label(here));
    // Tapping a card says the time there, in words, and shows the same line.
    for (const id of ['tokyo', 'london', 'here']) {
      await page.locator(`#cities button[data-city="${id}"]`).click();
      const want = id === 'here' ? `Here it is ${spoken(here)}.` : `In ${CITIES[id].name} it is ${spoken(zoneTime(CITIES[id].zone, at))}.`;
      await expect(page.locator('#cityline')).toHaveText(want);
      const said = await page.evaluate(() => (window as any).__said as string[]);
      expect(said[said.length - 1]).toBe(want);
    }
    await expect(page.locator('#cityline')).toHaveAttribute('aria-live', 'polite');
    expect(errors).toEqual([]);
  });
}

for (const age of [0, 4, 7, 8]) {
  test(`Time around the world, ${age ? `age ${age}` : 'no profile'}: every round has exactly one right answer by the test's own maths; a miss teaches; 8 rounds end on a break`, async ({ page }) => {
    const errors = watchErrors(page);
    const at = MOMENTS[[0, 4, 7, 8].indexOf(age)];
    await open(page, { age, at });
    await page.locator('#play-world').click();
    const kinds = new Set<string>();
    for (let k = 0; k < 8; k++) {
      await expect(page.locator('#count')).toHaveText(`Round ${k + 1} of 8`);
      const r = await current(page);
      kinds.add(r.kind);
      expect(r.level).toBe(levelOf(age));
      await expect(page.locator('#prompt')).toHaveText(r.text);
      expect(worldRight(r, at), JSON.stringify(r)).toEqual([String(r.ans)]);
      const shown = await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-v')!));
      expect(shown.slice().sort()).toEqual(r.choices.map(String).sort());
      expect(new Set(shown).size).toBe(shown.length);
      if (k === 0 || k === 5) {
        const wrong = shown.find((v) => v !== String(r.ans))!;
        await page.locator(`#choices button[data-v="${wrong}"]`).click();
        await expect(page.locator(`#choices button[data-v="${wrong}"]`)).toBeDisabled();
        await expect(page.locator('#sub')).toContainText('Not ');
        await expectKindMiss(page);
        if (k === 0) expect(await axeViolations(page, '#game')).toEqual([]);
      }
      await page.locator(`#choices button[data-v="${r.ans}"]`).click();
      await expect(page.locator('#sub')).toContainText('Yes!');
      if (r.kind !== 'ahead') {
        // The win compares the city with here: "It is night in Tokyo while it is morning here."
        const c = zoneTime(CITIES[r.city].zone, at), h = zoneTime(HERE, at);
        const cmp = noun(c.h) === noun(h.h) ? `It is ${noun(c.h)} in ${CITIES[r.city].name}, and ${noun(h.h)} here too.` : `It is ${noun(c.h)} in ${CITIES[r.city].name} while it is ${noun(h.h)} here.`;
        await expect(page.locator('#sub')).toContainText(cmp);
      }
      await expect(page.locator('#howbox')).toBeEmpty();
      await expect(page.locator('#more')).toBeFocused();
      await page.locator('#more').click();
    }
    expect([...kinds].sort()).toEqual(KINDS[levelOf(age)].slice().sort());
    await expect(page.locator('#alldone')).toBeVisible();
    await page.locator('#stop').click();
    await expect(page.locator('#play-world')).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test('Time around the world: with "Fewer choices", two tiles and exactly one right answer in every round', async ({ page }) => {
  const at = MOMENTS[1];
  await open(page, { age: 8, comfort: ['fewer'], at });
  await page.locator('#play-world').click();
  for (let k = 0; k < 8; k++) {
    const r = await current(page);
    const shown = await page.locator('#choices button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-v')!));
    expect(shown).toHaveLength(2);
    expect(shown.filter((v) => worldRight({ ...r, choices: shown }, at).includes(v))).toEqual([String(r.ans)]);
    await page.locator(`#choices button[data-v="${r.ans}"]`).click();
    await page.locator('#more').click();
  }
});

for (const age of [0, 4, 7, 8]) {
  test(`Set the kitchen timer, ${age ? `age ${age}` : 'no profile'}: the buttons fit the age; set right, it runs down and rings; set wrong, a kind line and a lesson`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, { age });
    await page.locator('#play-timer').click();
    const lv = levelOf(age);
    await expect(page.locator('#sec-up')).toHaveCount(lv === 0 ? 0 : 1);
    await expect(page.locator('#min-up10')).toHaveCount(lv === 0 ? 0 : 1);
    for (let k = 0; k < 8; k++) {
      await expect(page.locator('#count')).toHaveText(`Round ${k + 1} of 8`);
      const r = await current(page);
      const prompt = await page.locator('#prompt').innerText();
      expect(r.level).toBe(lv);
      expect(prompt).toBe(r.text);
      expect(asked(prompt), prompt).toBe(r.seconds);
      expect(r.seconds).toBeGreaterThan(0);
      expect(r.seconds % 10).toBe(0);
      if (lv === 0) { expect(r.seconds % 60).toBe(0); expect(r.seconds).toBeLessThanOrEqual(600); }
      else expect(r.seconds).toBeLessThanOrEqual(3600);
      if (lv === 1) expect(prompt).not.toMatch(/hour/);
      await expect(page.locator('#timer-now')).toHaveText('The timer is set to 0 minutes.');
      const before = await page.locator('#job svg').getAttribute('aria-label');
      if (k === 0 || k === 4) {
        // Start with nothing set, then with one minute too many: both say what was set and what is needed.
        await page.locator('#start').click();
        await expect(page.locator('#sub')).toContainText(`set it to ${amount(r.seconds)}`);
        await expectKindMiss(page);
        if (k === 0) expect(await axeViolations(page, '#game')).toEqual([]);
        await setTimer(page, r.seconds, lv);
        await page.locator('#min-up').click();
        const set = Math.min(r.seconds + 60, lv === 0 ? 600 : 3600);
        await page.locator('#start').click();
        if (set !== r.seconds) {
          await expect(page.locator('#sub')).toContainText(`Your timer is set to ${amount(set)}. We need ${amount(r.seconds)}`);
          await expect(page.locator('#sub')).toHaveClass(/try/);
          await page.locator('#min-down').click();
        }
      } else await setTimer(page, r.seconds, lv);
      if (!(await page.locator('#sub').getAttribute('class'))!.includes('yes')) {
        await expect(page.locator('#timer-now')).toHaveText(`The timer is set to ${amount(r.seconds)}.`);
        await expect(page.locator('#timer svg')).toHaveAttribute('aria-label', new RegExp(r.ans));
        await page.locator('#start').click();
      }
      await expect(page.locator('#sub')).toContainText('Yes!');
      await expect(page.locator('#timer svg')).toHaveAttribute('aria-label', /ringing/);
      await expect(page.locator('#timer-now')).toContainText('Ding!');
      expect(await page.locator('#job svg').getAttribute('aria-label'), 'the job picture is finished').not.toBe(before);
      await expect(page.locator('#start')).toBeDisabled();
      await expect(page.locator('#howbox')).toBeEmpty();
      await expect(page.locator('#more')).toBeFocused();
      await page.locator('#more').click();
    }
    await expect(page.locator('#alldone')).toBeVisible();
    await page.locator('#stop').click();
    await expect(page.locator('#play-timer')).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test('Set the kitchen timer: with motion it runs down in a few seconds with the buttons off, and never makes the child wait the real time', async ({ page }) => {
  await open(page, { age: 7 });
  await page.locator('#play-timer').click();
  const r = await current(page);
  await setTimer(page, r.seconds, 1);
  const t0 = Date.now();
  await page.locator('#start').click();
  await expect(page.locator('#min-up')).toBeDisabled();
  await expect(page.locator('#sub')).toContainText('no waiting');
  await expect(page.locator('#sub')).toContainText('Yes!', { timeout: 8000 });
  expect(Date.now() - t0, `the job needs ${r.seconds} seconds, but the child waits only a moment`).toBeLessThan(8000);
});

test('Set the kitchen timer: with the calm setting it finishes at once, with no running down', async ({ page }) => {
  await open(page, { age: 7, comfort: ['calm'] });
  await page.locator('#play-timer').click();
  const r = await current(page);
  await setTimer(page, r.seconds, 1);
  await page.locator('#start').click();
  await expect(page.locator('#sub')).toContainText('Yes!', { timeout: 1000 });
  await expect(page.locator('#timer .mv-wiggle')).toHaveCount(0);
});

test('Both new games work from the keyboard, and the time set is announced politely', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, { age: 8, at: MOMENTS[0] });
  await page.locator('#play-timer').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#timer-now')).toHaveAttribute('aria-live', 'polite');
  await page.locator('#min-up').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#timer-now')).toHaveText('The timer is set to 1 minute.');
  await page.keyboard.press('Space');
  await expect(page.locator('#timer-now')).toHaveText('The timer is set to 2 minutes.');
  await page.locator('#sec-up').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#timer-now')).toHaveText('The timer is set to 2 minutes and 10 seconds.');
  for (const id of ['min-down10', 'min-up10', 'min-down', 'min-up', 'sec-down', 'sec-up', 'start']) {
    const name = await page.locator(`#${id}`).evaluate((b) => b.textContent!.trim());
    expect(name.length, id).toBeGreaterThan(3);
  }
  await page.locator('#exit').click();
  await page.locator('#play-world').focus();
  await page.keyboard.press('Enter');
  const r = await current(page);
  await page.locator(`#choices button[data-v="${r.ans}"]`).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#sub')).toContainText('Yes!');
  await expect(page.locator('#more')).toBeFocused();
  // City cards are buttons named by their words, with the drawings hidden from screen readers.
  const cards = await page.locator('#cities button').evaluateAll((bs) => bs.map((b) => ({ name: b.textContent!.trim(), hidden: [...b.querySelectorAll(':scope > svg, :scope > span > svg')].every((s) => s.getAttribute('aria-hidden') === 'true') })));
  expect(cards).toHaveLength(9);
  for (const c of cards) { expect(c.name).toMatch(/\d:\d\d [ap]\.m\..*(day|night)/); expect(c.hidden).toBe(true); }
});

test('Points: a right answer in each new game adds one maths point with a profile, and nothing is stored without one', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, { age: 7, at: MOMENTS[2] });
  await page.locator('#play-world').click();
  let r = await current(page);
  await page.locator(`#choices button[data-v="${r.ans}"]`).click();
  await expect(page.locator('#sub')).toContainText('Yes!');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sprouts:points') ?? 'null'))).toEqual({ maths: 1, english: 0, world: 0 });
  await page.locator('#exit').click();
  await page.locator('#play-timer').click();
  r = await current(page);
  await setTimer(page, r.seconds, 1);
  await page.locator('#start').click();
  await expect(page.locator('#sub')).toContainText('Yes!');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sprouts:points') ?? 'null'))).toEqual({ maths: 2, english: 0, world: 0 });
  expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(['sprouts:points', 'ys-profile']);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('ys-profile')))!)).toEqual({ age: 7, color: 0, nick: '' });
});

test('Points: without a profile, playing both new games stores nothing', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, { at: MOMENTS[3] });
  await page.locator('#play-world').click();
  let r = await current(page);
  await page.locator(`#choices button[data-v="${r.ans}"]`).click();
  await page.locator('#exit').click();
  await page.locator('#play-timer').click();
  r = await current(page);
  await setTimer(page, r.seconds, 1);
  await page.locator('#start').click();
  await expect(page.locator('#sub')).toContainText('Yes!');
  const s = await storedData(page, context);
  expect(s.local).toEqual([]);
  expect(s.cookies).toEqual([]);
});

test('The lessons in the new games show their finished pictures with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, { age: 8, at: MOMENTS[0] });
  for (const g of ['world', 'timer']) {
    await page.locator(`#play-${g}`).click();
    if (g === 'world') {
      const r = await current(page);
      const wrong = (r.choices as string[]).map(String).find((v) => v !== String(r.ans))!;
      await page.locator(`#choices button[data-v="${wrong}"]`).click();
    } else await page.locator('#start').click();
    await page.locator('#howbtn').click();
    const hidden = await page.locator('#lesson svg .mv-in').evaluateAll((es) => es.filter((e) => getComputedStyle(e).opacity !== '1').length);
    expect(hidden, g).toBe(0);
    await page.locator('#exit').click();
  }
});

test('Clocks: the wording of the new games is plain and kind, with none of the banned words, also in the title, the description and what is spoken', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const age of [4, 7, 8]) {
    const p = await page.context().newPage();
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await open(p, { age, at: MOMENTS[age % MOMENTS.length] });
    const texts = [await p.locator('body').innerText(), await p.title(), (await p.locator('meta[name=description]').getAttribute('content'))!];
    const inGames: string[] = [];
    for (const g of ['world', 'timer']) {
      await p.locator(`#play-${g}`).click();
      for (let k = 0; k < 3; k++) {
        const r = await current(p);
        if (g === 'world') {
          await p.locator('#cities button').first().click();
          const wrong = (r.choices as string[]).map(String).find((v) => v !== String(r.ans))!;
          await p.locator(`#choices button[data-v="${wrong}"]`).click();
          await p.locator('#howbtn').click();
          inGames.push(await p.locator('#game').innerText());
          await p.locator(`#choices button[data-v="${r.ans}"]`).click();
        } else {
          await p.locator('#start').click();
          await p.locator('#howbtn').click();
          inGames.push(await p.locator('#game').innerText());
          await setTimer(p, r.seconds, levelOf(age));
          await p.locator('#start').click();
        }
        await expect(p.locator('#sub')).toContainText('Yes!');
        inGames.push(await p.locator('#game').innerText());
        await p.locator('#more').click();
      }
      await p.locator('#exit').click();
    }
    const svgLabels = await p.locator('[aria-label]').evaluateAll((es) => es.map((e) => e.getAttribute('aria-label')!));
    texts.push(...svgLabels, ...(await p.evaluate(() => (window as any).__said as string[])));
    const all = [...texts, ...inGames].join('\n');
    for (const bad of BANNED) expect.soft(all, `age ${age}, banned: ${bad}`).not.toMatch(bad);
    expect(inGames.join('\n')).not.toMatch(/\b(wrong|incorrect|lose|lost|score|hurry|quick|fast)\b/i);
    await p.close();
  }
});
