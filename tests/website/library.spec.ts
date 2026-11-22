import { test, expect, type Page } from '@playwright/test';
import { axeViolations, horizontalOverflow, watchErrors, watchRequests } from '../support/checks';

// Story library (SCRUM-497, Manish 22 Nov 2026): complete free picture books with pictures, from open libraries,
// kept on this site with the credits each licence asks for. Only CC BY or public domain books.

interface Entry { id: string; title: string; ages: string; minutes: number; pages: number; words: number; cover: string; platform: string; licence: string }
interface Book {
  id: string; title: string; pages: { img: string | null; text: string }[]; words: number; minutes: number; ages: string;
  credits: { authors: string[]; illustrators: string[]; translators: string[]; publisher: string; platform: string; source: string; licence: string; licenceUrl: string; changes: string };
}

const FAKE_VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); window.__u=u; };
  window.__boundary=(i)=>{ const u=window.__u; const at=[...u.text.matchAll(/\\S+/g)][i].index; u.onboundary&&u.onboundary({name:'word',charIndex:at}); };`;

async function catalog(page: Page): Promise<Entry[]> {
  return (await page.request.get('/stories/catalog.json')).json();
}

test('every book is complete, credited and openly licensed', async ({ page }) => {
  const cat = await catalog(page);
  expect(cat.length, 'books in the library').toBeGreaterThanOrEqual(500);
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
    if (!/^https:\/\/(storyweaver\.org\.in|www\.africanstorybook\.org|africanstorybook\.org)\//.test(k.source)) problems.push(`${c.id}: source link ${k.source}`);
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

test('stores nothing, and the Yaanstep Sprouts page links to the library', async ({ page }) => {
  await page.goto('/library.html');
  await page.locator('#shelf .bookbtn').first().click();
  await page.locator('#rnext').click();
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await page.goto('/sprouts.html');
  await expect(page.locator('a[href="library.html"]')).toHaveText('Open the library');
});
