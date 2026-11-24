import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { axeViolations, horizontalOverflow, watchErrors, watchRequests } from '../support/checks';

// Story library (SCRUM-497, Manish 22 Nov 2026): complete free picture books with pictures, from open libraries,
// kept on this site with the credits each licence asks for. Only CC BY or public domain books.

interface Entry { id: string; title: string; ages: string; minutes: number; pages: number; words: number; cover: string; platform: string; licence: string }
interface Book {
  id: string; title: string; pages: { img: string | null; text: string }[]; words: number; minutes: number; ages: string;
  credits: { authors: string[]; illustrators: string[]; translators: string[]; publisher: string; platform: string; source: string; licence: string; licenceUrl: string; changes: string };
}

// These tests read with the device voice; recorded stories are tested below, so recordings are switched off here.
const FAKE_VOICE = `window.__said=[];
  HTMLMediaElement.prototype.canPlayType=()=>'';
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); window.__u=u; };
  window.__boundary=(i)=>{ const u=window.__u; const at=[...u.text.matchAll(/\\S+/g)][i].index; u.onboundary&&u.onboundary({name:'word',charIndex:at}); };`;

async function catalog(page: Page): Promise<Entry[]> {
  return (await page.request.get('/stories/catalog.json')).json();
}

// Manish, 24 Nov 2026: "Remove following story ... Ammu's Puppy".
test('books Manish asked to remove stay out of the library', async ({ page }) => {
  const cat = await catalog(page);
  expect(cat.map((c) => c.title)).not.toContain("Ammu's Puppy");
  expect((await page.request.get('/stories/books/pb-ammus-puppy.json')).status()).toBe(404);
});

// Manish, 24 Nov 2026: "Similar with all other stories, if religion, or anything inappropriate, the remove that story."
// Every story was read in full; the ones taken out are listed in removed-stories.json and must not come back.
test('stories taken out for religion or unsuitable content stay out, with their pictures and recordings', async ({ page }) => {
  const removed: string[] = JSON.parse(readFileSync(join(__dirname, 'removed-stories.json'), 'utf8'));
  expect(removed.length).toBeGreaterThan(100);
  const ids = new Set((await catalog(page)).map((c) => c.id));
  expect(removed.filter((id) => ids.has(id))).toEqual([]);
  for (const id of removed.slice(0, 20)) {
    expect((await page.request.get(`/stories/books/${id}.json`)).status(), id).toBe(404);
    expect((await page.request.get(`/stories/audio/${id}/index.json`)).status(), id).toBe(404);
  }
});

test('every book is complete, credited and openly licensed', async ({ page }) => {
  const cat = await catalog(page);
  expect(cat.length, 'books in the library').toBeGreaterThanOrEqual(400);
  expect(new Set(cat.map((c) => c.id)).size).toBe(cat.length);
  const problems: string[] = [];
  for (const c of cat) {
    const r = await page.request.get(`/stories/books/${c.id}.json`);
    if (r.status() !== 200) { problems.push(`${c.id}: no book file`); continue; }
    const b: Book = await r.json();
    const k = b.credits;
    if (b.title !== c.title) problems.push(`${c.id}: title differs from the catalogue`);
    if (b.pages.length < 2 || b.pages.some((p) => !p.text.trim())) problems.push(`${c.id}: a page has no text`);
    if (!k.authors.length) problems.push(`${c.id}: no author`);
    if (!k.illustrators.length) problems.push(`${c.id}: no illustrator`);
    if (!/^https:\/\/(storyweaver\.org\.in|www\.africanstorybook\.org|africanstorybook\.org|bookdash\.org|www\.gutenberg\.org)\//.test(k.source)) problems.push(`${c.id}: source link ${k.source}`);
    if (!/^(CC BY [34]\.0|Public Domain)$/.test(k.licence)) problems.push(`${c.id}: licence ${k.licence}`);
    if (!/^https:\/\/creativecommons\.org\/(licenses\/by\/[34]\.0|publicdomain\/mark\/1\.0)\/$/.test(k.licenceUrl)) problems.push(`${c.id}: licence link ${k.licenceUrl}`);
    if (!/WebP/.test(k.changes)) problems.push(`${c.id}: changes not stated`);
    if (/\*\*|^#{1,6}\s/m.test(b.pages.map((p) => p.text).join('\n'))) problems.push(`${c.id}: formatting marks left in the text`);
    if (!['3-5', '5-7', '7-9', '9-12'].includes(b.ages)) problems.push(`${c.id}: ages ${b.ages}`);
  }
  expect(problems).toEqual([]);
});

test('every picture of every tenth book is on this site', async ({ page }) => {
  const cat = await catalog(page);
  const missing: string[] = [];
  for (const c of cat.filter((_, i) => i % 10 === 0)) {
    const b: Book = await (await page.request.get(`/stories/books/${c.id}.json`)).json();
    for (const p of b.pages) if (p.img && (await page.request.head(`/stories/${p.img}`)).status() !== 200) missing.push(p.img);
  }
  expect(missing).toEqual([]);
});

test('the shelf filters by age and length, searches titles, and loads nothing from other sites', async ({ page }) => {
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await page.goto('/library.html');
  await expect(page.locator('h1')).toHaveText('Story library');
  const cat = await catalog(page);
  await expect(page.locator('#total')).toHaveText(String(cat.length));
  await expect(page.locator('#found')).toHaveText(`${cat.length} books`);
  await expect(page.locator('#shelf .bookbtn')).toHaveCount(24);
  await page.locator('#ages').selectOption('3-5');
  await expect(page.locator('#found')).toHaveText(`${cat.filter((c) => c.ages === '3-5').length} books`);
  await page.locator('#length').selectOption('long');
  await expect(page.locator('#found')).toHaveText(new RegExp(`^${cat.filter((c) => c.ages === '3-5' && c.minutes >= 10).length} books?$`));
  await page.locator('#ages').selectOption('all');
  await page.locator('#length').selectOption('all');
  const one = cat[0];
  await page.locator('#q').fill(one.title.slice(0, 12));
  await expect(page.locator('#shelf .bookbtn').first()).toContainText(one.title.slice(0, 12));
  await page.locator('#q').fill('');
  await page.locator('#more').click();
  await expect(page.locator('#shelf .bookbtn')).toHaveCount(Math.min(48, cat.length));
  expect(errors).toEqual([]);
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  expect(await axeViolations(page)).toEqual([]);
});

test('the shelf starts on the age band from the child\'s profile', async ({ page }) => {
  await page.goto('/library.html');
  await page.evaluate(() => localStorage.setItem('ys-profile', JSON.stringify({ age: 8, color: 0, nick: '' })));
  await page.reload();
  await expect(page.locator('#ages')).toHaveValue('7-9');
});

// Manish, 24 Nov 2026: "when I clicked on story, by default drop down age is 5-7. Make sure to set default for all ages
// if no age group is selected."
test('without a child profile the shelf starts on All ages, even after another age was picked and the page reloaded', async ({ page }) => {
  await page.goto('/library.html');
  await expect(page.locator('#ages')).toHaveValue('all');
  await page.locator('#ages').selectOption('5-7');
  await page.reload();
  await expect(page.locator('#ages')).toHaveValue('all');
  await page.goto('/sprouts.html');
  await page.goBack();
  await expect(page.locator('#ages')).toHaveValue('all');
});

// Manish, 24 Nov 2026: "while reading the stories, hide the profile icon where you show profile name, maths score etc.
// As it is not relevant in stories."
test('the profile badge steps aside while a story is open and comes back on the shelf', async ({ page }) => {
  await page.addInitScript(FAKE_VOICE);
  await page.addInitScript(() => localStorage.setItem('ys-profile', JSON.stringify({ age: 6, color: 0, nick: 'Ria' })));
  await page.goto('/library.html');
  await expect(page.locator('#ys-badge')).toBeVisible();
  await page.locator('#shelf .bookbtn').first().click();
  await expect(page.locator('#btitle')).not.toBeEmpty();
  await expect(page.locator('#ys-badge')).toBeHidden();
  await page.locator('#rexit').click();
  await expect(page.locator('#ys-badge')).toBeVisible();
});

test('a book opens on its cover with credits, reads page by page with the read-along marker, and ends with the credits again', async ({ page }) => {
  await page.addInitScript(FAKE_VOICE);
  await page.goto('/library.html');
  const first = page.locator('#shelf .bookbtn').first();
  const id = await first.getAttribute('data-id');
  const b: Book = await (await page.request.get(`/stories/books/${id}.json`)).json();
  await first.click();
  await expect(page.locator('#btitle')).toHaveText(b.title);
  await expect(page.locator('#rcount')).toHaveText('Cover');
  const credits = page.locator('#credits');
  await expect(credits).toContainText(b.credits.authors[0]);
  await expect(credits).toContainText(b.credits.illustrators[0]);
  await expect(credits.locator(`a[href="${b.credits.licenceUrl}"]`)).toHaveText(b.credits.licence);
  await expect(credits.locator(`a[href="${b.credits.source}"]`)).toHaveText(b.credits.platform);
  await expect(page.locator('#readit')).toBeHidden();
  await page.locator('#rnext').click();
  await expect(page.locator('#rcount')).toHaveText(`Page 1 of ${b.pages.length}`);
  await expect(page.locator('#ltext')).toHaveText(b.pages[0].text.replace(/\s+/g, ' ').trim());
  if (b.pages[0].img) await expect(page.locator('#rpage img.pg')).toHaveAttribute('src', `stories/${b.pages[0].img}`);
  await page.locator('#readit').click();
  expect(await page.evaluate(() => (window as any).__said.at(-1))).toBe(b.pages[0].text);
  await page.evaluate(() => (window as any).__boundary(0));
  await expect(page.locator('#ltext .w.now')).toHaveCount(1);
  expect(await axeViolations(page)).toEqual([]);
  for (let i = 1; i < b.pages.length; i++) await page.locator('#rnext').click();
  await expect(page.locator('#rnext')).toHaveText('Finish the book');
  await page.locator('#rnext').click();
  await expect(page.locator('#ltheend')).toHaveText('The end.');
  await expect(page.locator('#credits')).toContainText(b.credits.licence);
  await expect(page.locator('#lagain')).toBeFocused();
  await page.locator('#lother').click();
  await expect(page.locator('#library')).toBeVisible();
  await expect(first).toBeFocused();
});

// Reading the whole story aloud (Manish 22 Nov 2026): pages turn by themselves, reading can be paused, and the
// speed is slower for younger children. The fake voice "finishes" each page a moment after it starts, unless held.
const AUTO_VOICE = FAKE_VOICE + `
  window.YS_TURN_MS = 0; window.__rates = [];
  const say = window.speechSynthesis.speak;
  window.speechSynthesis.speak = (u) => { say(u); window.__rates.push(u.rate); if (!window.__hold) setTimeout(() => u.onend && u.onend(), 20); };`;

async function openFirstBook(page: Page, age?: number): Promise<Book> {
  await page.addInitScript(AUTO_VOICE);
  await page.goto('/library.html');
  if (age) {
    await page.evaluate((a) => localStorage.setItem('ys-profile', JSON.stringify({ age: a, color: 0, nick: '' })), age);
    await page.reload();
  }
  const first = page.locator('#shelf .bookbtn').first();
  const id = await first.getAttribute('data-id');
  await first.click();
  return (await page.request.get(`/stories/books/${id}.json`)).json();
}

test('"Read the whole story to me" reads every page and turns the pages by itself, then ends on the credits', async ({ page }) => {
  const errors = watchErrors(page);
  const b = await openFirstBook(page);
  await expect(page.locator('#readall')).toBeVisible();
  await expect(page.locator('#rspeed')).toHaveValue('0.8');
  await page.locator('#readall').click();
  await expect(page.locator('#ltheend')).toHaveText('The end.', { timeout: 15000 });
  await expect(page.locator('#lagain')).toBeFocused();
  const said = await page.evaluate(() => (window as any).__said as string[]);
  expect(said).toEqual(b.pages.map((p) => p.text));
  expect(errors).toEqual([]);
});

test('reading aloud can be paused and started again, and the next button still works while it reads', async ({ page }) => {
  const b = await openFirstBook(page);
  test.skip(b.pages.length < 3, 'needs a book of 3 pages or more');
  await page.evaluate(() => { (window as any).__hold = true; });
  await page.locator('#readall').click();
  await expect(page.locator('#rcount')).toHaveText(`Page 1 of ${b.pages.length}`);
  await expect(page.locator('#pauseread')).toBeFocused();
  await expect(page.locator('#readall')).toBeHidden();
  await expect(page.locator('#readit')).toBeHidden();
  await page.locator('#rnext').click();
  await expect(page.locator('#rcount')).toHaveText(`Page 2 of ${b.pages.length}`);
  expect(await page.evaluate(() => (window as any).__said.at(-1))).toBe(b.pages[1].text);
  await page.locator('#pauseread').click();
  await expect(page.locator('#readall')).toBeFocused();
  await expect(page.locator('#pauseread')).toBeHidden();
  await expect(page.locator('#readit')).toBeVisible();
  await page.evaluate(() => { (window as any).__hold = false; const u = (window as any).__u; u.onend && u.onend(); });
  await expect(page.locator('#rcount')).toHaveText(`Page 2 of ${b.pages.length}`);
  expect(await axeViolations(page)).toEqual([]);
});

// Manish 22 Nov 2026: "Reading is getting finished before word highlights". The marker must keep up with the voice,
// also on voices that never report each word, and learn how fast this device's voice really reads.
test('the read-along marker keeps up with a voice that reports no words, and learns the voice\'s pace', async ({ page }) => {
  await page.clock.install();
  const b = await openFirstBook(page);
  await page.evaluate(() => { (window as any).__hold = true; });
  await page.locator('#rnext').click();
  const words = b.pages[0].text.match(/\S+/g)!;
  const total = words.reduce((t, w) => t + w.length + 1 + (/[.!?]["”’']?$/.test(w) ? 6 : /[,;:]["”’']?$/.test(w) ? 3 : 0), 0);
  test.skip(total <= 20 || words.length < 3, 'needs a page with a few words');
  expect(await page.evaluate(() => (window as any).YS_READ.pace())).toBe(62);
  await page.locator('#readit').click();
  // This voice takes 100 ms a letter at speed 0.8, slower than the first guess, so the marker reaches the last word
  // by the time the voice ends, and from then on moves at the voice's own pace.
  const took = Math.round((100 * total) / 0.8);
  await page.clock.fastForward(took);
  await expect(page.locator('#ltext .w').nth(words.length - 1)).toHaveClass(/now/);
  await page.evaluate(() => { const u = (window as any).__u; u.onend({ type: 'end' }); });
  await expect(page.locator('#ltext .w.now')).toHaveCount(0);
  const pace = await page.evaluate(() => (window as any).YS_READ.pace());
  expect(pace).toBeGreaterThan(85);
  expect(pace).toBeLessThan(95);
  // A word the voice reports moves the marker to that word straight away.
  await page.locator('#readit').click();
  await page.evaluate(() => (window as any).__boundary(2));
  await expect(page.locator('#ltext .w').nth(2)).toHaveClass(/now/);
});

for (const [age, want, name] of [[0, '0.8', 'Gentle'], [4, '0.7', 'Slow'], [6, '0.8', 'Gentle'], [9, '0.95', 'Normal']] as const) {
  test(`the reading speed starts at ${name} for ${age ? `a child of ${age}` : 'no profile'}, and can be changed`, async ({ page }) => {
    await openFirstBook(page, age || undefined);
    await expect(page.locator('#rspeed')).toHaveValue(want);
    await expect(page.locator('#rspeed option:checked')).toHaveText(name);
    await page.evaluate(() => { (window as any).__hold = true; });
    await page.locator('#readall').click();
    await expect.poll(() => page.evaluate(() => (window as any).__rates.at(-1))).toBe(+want);
    await page.locator('#rspeed').selectOption('0.6');
    await expect.poll(() => page.evaluate(() => (window as any).__rates.at(-1))).toBe(0.6);
    for (const b of await page.locator('#reader button:visible, #rspeed').all()) {
      const box = (await b.boundingBox())!;
      expect(box.height, await b.innerText()).toBeGreaterThanOrEqual(47.5);
    }
  });
}

test('stores nothing, and the Yaanstep Sprouts page links to the library', async ({ page }) => {
  await page.goto('/library.html');
  await page.locator('#shelf .bookbtn').first().click();
  await page.locator('#rnext').click();
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await page.goto('/sprouts.html');
  await expect(page.locator('a[href="library.html"]')).toHaveText('Open the library');
});

// Recorded stories (Manish, 24 Nov 2026: "Are the recorded voice better choice? I still feel that voice is not appropriain
// chrome browser", then "Yes, start with stories"). Books marked "audio" in the catalog are read from a recording made with
// Kokoro (an open voice), one file per page, with each word's time so the marker follows the recording.
interface Rec { voice: string; speed: number; pages: { f: string; d: number; w: [number, number][] }[] }

async function shortestRecorded(page: Page): Promise<Entry & { audio?: number }> {
  const cat: (Entry & { audio?: number })[] = await catalog(page);
  const rec = cat.filter((c) => c.audio).sort((a, b) => a.pages - b.pages || a.words - b.words);
  test.skip(!rec.length, 'no recorded stories yet');
  return rec[0];
}
async function openTitle(page: Page, c: Entry) {
  await page.locator('#ages').selectOption('all');
  await page.locator('#q').fill(c.title);
  await page.locator(`#shelf .bookbtn[data-id="${c.id}"]`).click();
  await expect(page.locator('#btitle')).toHaveText(c.title);
}
const SPEECH_SPY = `window.__said=[]; window.YS_TURN_MS=0;
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); setTimeout(()=>u.onend&&u.onend(),20); };`;

test('every recorded story has a recording for each page, with a time for every word', async ({ page }) => {
  const cat: (Entry & { audio?: number })[] = await catalog(page);
  const problems: string[] = [];
  for (const c of cat.filter((x) => x.audio)) {
    const b: Book = await (await page.request.get(`/stories/books/${c.id}.json`)).json();
    const r = await page.request.get(`/stories/audio/${c.id}/index.json`);
    if (!r.ok()) { problems.push(`${c.id}: no index.json`); continue; }
    const rec: Rec = await r.json();
    if (rec.pages.length !== b.pages.length) { problems.push(`${c.id}: ${rec.pages.length} recorded pages, ${b.pages.length} pages`); continue; }
    rec.pages.forEach((p, i) => {
      const words = b.pages[i].text.match(/\S+/g) || [];
      if (p.w.length !== words.length) problems.push(`${c.id} page ${i + 1}: ${p.w.length} word times, ${words.length} words`);
      if (!(p.d > 0)) problems.push(`${c.id} page ${i + 1}: no length`);
      if (p.w.some(([s, e], k) => e < s || s > p.d + 0.5 || (k > 0 && s < p.w[k - 1][0]))) problems.push(`${c.id} page ${i + 1}: word times out of order`);
    });
    if (rec.pages.some((p) => !p.f.endsWith('.mp3'))) problems.push(`${c.id}: not MP3`);
    const f = await page.request.head(`/stories/audio/${c.id}/${rec.pages[0].f}`);
    if (!f.ok()) problems.push(`${c.id}: page 1 file missing`);
  }
  expect(problems).toEqual([]);
});

test('a recorded story is read from its recording, with the marker on each word and the pages turning by themselves', async ({ page }) => {
  test.setTimeout(120000);
  const errors = watchErrors(page);
  await page.addInitScript(SPEECH_SPY);
  await page.goto('/library.html');
  const c = await shortestRecorded(page);
  const files: string[] = [];
  page.on('request', (r) => { if (r.url().includes(`/stories/audio/${c.id}/`)) files.push(r.url().split('/').pop()!); });
  await openTitle(page, c);
  await expect(page.locator('#novoice')).toBeHidden();
  await page.locator('#readall').click();
  await expect(page.locator('#rcount')).toHaveText(`Page 1 of ${c.pages}`);
  await expect(page.locator('#ltext .w.now')).toHaveCount(1, { timeout: 10000 });
  expect(await page.evaluate(() => (window as any).YS_READ.recorded())).toBe(true);
  await expect(page.locator('#ltheend')).toHaveText('The end.', { timeout: 100000 });
  expect(files).toContain('index.json');
  // MP3, so iPhones and iPads play it too (Manish, 24 Nov 2026: "No, so no voice is coming.").
  expect(files).toContain('01.mp3');
  expect(await page.evaluate(() => (window as any).__said)).toEqual([]);
  expect(errors).toEqual([]);
});

test('changing the speed changes how fast the recording plays, without starting the page again', async ({ page }) => {
  await page.addInitScript(SPEECH_SPY);
  await page.goto('/library.html');
  const c = await shortestRecorded(page);
  await openTitle(page, c);
  await page.locator('#rspeed').selectOption('0.8');
  await page.locator('#rnext').click();
  await page.locator('#readit').click();
  await expect.poll(() => page.evaluate(() => { const p = (window as any).YS_READ.player(); return p && !p.paused; })).toBe(true);
  expect(await page.evaluate(() => (window as any).YS_READ.player().playbackRate)).toBeCloseTo(1, 5);
  await page.locator('#rspeed').selectOption('0.6');
  expect(await page.evaluate(() => (window as any).YS_READ.player().playbackRate)).toBeCloseTo(0.75, 5);
  expect(await page.evaluate(() => (window as any).YS_READ.player().paused)).toBe(false);
  expect(await page.evaluate(() => (window as any).__said)).toEqual([]);
});

test('when a recording can\'t be played, the device voice reads the page instead', async ({ page }) => {
  await page.addInitScript(SPEECH_SPY);
  await page.route('**/stories/audio/**/*.mp3', (r) => r.fulfill({ status: 404, body: '' }));
  await page.goto('/library.html');
  const c = await shortestRecorded(page);
  const b: Book = await (await page.request.get(`/stories/books/${c.id}.json`)).json();
  await openTitle(page, c);
  await page.locator('#rnext').click();
  await page.locator('#readit').click();
  await expect.poll(() => page.evaluate(() => (window as any).__said)).toEqual([b.pages[0].text]);
});

test('when a recording can\'t be played and the device has no voice, a note says so instead of staying silent', async ({ page }) => {
  await page.addInitScript(`window.YS_TURN_MS=0; window.speechSynthesis.getVoices=()=>[];`);
  await page.route('**/stories/audio/**/*.mp3', (r) => r.fulfill({ status: 404, body: '' }));
  await page.goto('/library.html');
  const c = await shortestRecorded(page);
  await openTitle(page, c);
  await expect(page.locator('#recerr')).toBeHidden();
  await page.locator('#readall').click();
  await expect(page.locator('#recerr')).toBeVisible();
  await expect(page.locator('#recerr')).toContainText("The recording didn't play on this device");
  await expect(page.locator('#pauseread')).toBeHidden();
});

test('a recording that never starts (as on some phones) gives way to the device voice instead of silence', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(SPEECH_SPY);
  await page.route('**/stories/audio/**/*.mp3', () => new Promise(() => { /* never answers */ }));
  await page.goto('/library.html');
  const c = await shortestRecorded(page);
  const b: Book = await (await page.request.get(`/stories/books/${c.id}.json`)).json();
  await openTitle(page, c);
  await page.locator('#rnext').click();
  await page.locator('#readit').click();
  await expect.poll(() => page.evaluate(() => (window as any).__said), { timeout: 15000 }).toEqual([b.pages[0].text]);
  await expect(page.locator('#recerr')).toContainText("so the device's own voice is reading instead");
});
