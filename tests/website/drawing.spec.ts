import { test, expect, type Page } from '@playwright/test';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { axeViolations, horizontalOverflow, storedData, watchErrors, watchRequests } from '../support/checks';

// Drawing (SCRUM-515, Manish 23 Nov 2026): 2,000+ coloring pages drawn by our own code, sorted by picture
// (category, then subject such as Rose or Sunflower, then its pages), each with the Yaanstep Sprouts name in a corner;
// color on screen, print, or download as PNG or PDF. Plus step-by-step drawing, one line at a time, with a drawing box.
// No points, nothing stored, nothing sent.
// Levels (Manish 23 Nov 2026, "add filter and the level (easy, medium, hard)"): every coloring page and every
// step-by-step drawing is Easy, Medium or Hard, and big buttons show only one level.

const SITE = process.env.SITE_DIR ?? '../yaanstep-website';
const VOICE = `window.__said=[];
  window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.rate=1;this.voice=null;this.lang='';}};
  const SS=window.speechSynthesis;
  SS.getVoices=()=>[{name:'Local Sam',lang:'en-US',localService:true,voiceURI:'ls'}];
  SS.cancel=()=>{};
  SS.speak=(u)=>{ window.__said.push(u.text); };`;

interface Sub { id: string; name: string; n: number; lv: string }
interface Cat { id: string; name: string; icon: string; subjects: Sub[] }
interface Index { total: number; categories: Cat[] }

async function open(page: Page, hash = '') {
  await page.addInitScript(VOICE);
  await page.goto('/drawing.html' + hash);
}
const said = (page: Page) => page.evaluate(() => (window as any).__said as string[]);

test('every coloring page exists, is our own SVG with the Yaanstep Sprouts name, and no two pages of a picture are the same', async ({ request }) => {
  const ix: Index = await (await request.get('/coloring/index.json')).json();
  expect(ix.total, 'coloring pages in all').toBeGreaterThanOrEqual(2000);
  expect(ix.categories.length).toBeGreaterThanOrEqual(12);
  const problems: string[] = [];
  let counted = 0;
  const levels = [0, 0, 0, 0];
  const ids = new Set<string>();
  for (const c of ix.categories) {
    if (ids.has(c.id)) problems.push(`category ${c.id} twice`);
    ids.add(c.id);
    if (c.subjects.length < 3) problems.push(`${c.id}: only ${c.subjects.length} pictures`);
    if (!c.subjects.some((s) => `${s.id}-1.svg` === c.icon)) problems.push(`${c.id}: icon ${c.icon} is not a first page`);
    for (const s of c.subjects) {
      if (!s.name.trim() || s.n < 1) problems.push(`${c.id}/${s.id}: name or page count missing`);
      if (!new RegExp(`^[123]{${s.n}}$`).test(s.lv ?? '')) problems.push(`${c.id}/${s.id}: no Easy, Medium or Hard for every page`);
      for (const d of '123') levels[+d] += (s.lv ?? '').split(d).length - 1;
      const seen = new Map<string, number>();
      for (let n = 1; n <= s.n; n++) {
        counted++;
        const f = join(SITE, 'coloring', c.id, `${s.id}-${n}.svg`);
        if (!existsSync(f)) { problems.push(`${f} missing`); continue; }
        if (statSync(f).size > 80_000) problems.push(`${f} is over 80 KB`);
        const svg = readFileSync(f, 'utf8');
        if (!svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 850 1100"')) problems.push(`${f}: not a letter-size SVG`);
        if (!svg.includes('id="ys-badge"') || !svg.includes('>Yaanstep Sprouts</text>') || !svg.includes('yaanstep.com')) problems.push(`${f}: no Yaanstep Sprouts badge`);
        if (/<image|href="http|<script|@import|url\(/i.test(svg)) problems.push(`${f}: loads something or runs code`);
        const h = createHash('md5').update(svg.replace(/<text[\s\S]*?<\/text>/g, '')).digest('hex');
        if (seen.has(h)) problems.push(`${c.id}/${s.id}: page ${n} is the same as page ${seen.get(h)}`);
        seen.set(h, n);
      }
    }
  }
  expect(counted).toBe(ix.total);
  expect(problems.slice(0, 30)).toEqual([]);
  for (const d of [1, 2, 3]) expect(levels[d], `pages at level ${d}`).toBeGreaterThanOrEqual(300);
  const patterns = ix.categories.find((c) => c.id === 'patterns');
  if (patterns) expect(patterns.subjects.every((s) => !s.lv.includes('1')), 'patterns and mandalas are never Easy').toBe(true);
});

test('the Drawing page opens with two picture choices, loads nothing from other sites and stores nothing', async ({ page, context }) => {
  const errors = watchErrors(page);
  const reqs = watchRequests(page);
  await open(page);
  await expect(page.locator('h1')).toHaveText('Drawing');
  await expect(page.locator('#v-home .bigtile')).toHaveCount(2);
  await expect(page.locator('#go-color')).toContainText('Coloring pages');
  await expect(page.locator('#go-steps')).toContainText('Step by step');
  expect(await axeViolations(page)).toEqual([]);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await horizontalOverflow(page), 'at 320 px').toBeLessThanOrEqual(1);
  expect(reqs.external('http://127.0.0.1:4173')).toEqual([]);
  expect(reqs.sending()).toEqual([]);
  expect((await storedData(page, context)).local).toEqual([]);
  expect(errors).toEqual([]);
});

test('coloring: pick a picture, then a flower, then a page; color it by tapping, undo, and download PNG and PDF', async ({ page, context }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.locator('#go-color').click();
  await expect(page.locator('#cats .tile-a').first()).toBeVisible();
  const ix: Index = await (await page.request.get('/coloring/index.json')).json();
  await expect(page.locator('#cats .tile-a')).toHaveCount(ix.categories.length);
  await expect(page.locator('#total')).toContainText(`${ix.total} coloring pages`);
  expect(await axeViolations(page, '#v-cats')).toEqual([]);

  const flowers = ix.categories.find((c) => c.id === 'flowers') ?? ix.categories[0];
  await page.locator(`#cats a[href="#color/${flowers.id}"]`).click();
  await expect(page.locator('#subs-h')).toHaveText(flowers.name);
  await expect(page.locator('#subs .tile-a')).toHaveCount(flowers.subjects.length);
  if (flowers.id === 'flowers') for (const name of ['Rose', 'Sunflower', 'Tulip']) await expect(page.locator('#subs .w', { hasText: name })).toHaveCount(1);
  expect((await said(page)).at(-1)).toBe(flowers.name);

  const sub = flowers.subjects[0];
  await page.locator(`#subs a[href="#color/${flowers.id}/${sub.id}"]`).click();
  await expect(page.locator('#vars .tile-a')).toHaveCount(sub.n);
  const NAMES = ['', 'Easy', 'Medium', 'Hard'];
  await expect(page.locator('#vars .tag')).toHaveText([...sub.lv].map((d) => NAMES[+d]));
  expect(await axeViolations(page, '#v-vars')).toEqual([]);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await page.locator(`#vars a[href="#page/${flowers.id}/${sub.id}/1"]`).click();
  await expect(page.locator('#sheet svg #ys-badge')).toContainText('Yaanstep Sprouts');
  await expect(page.locator('#page-count')).toHaveText(`Page 1 of ${sub.n}`);
  await expect(page.locator('#prev')).toHaveAttribute('aria-disabled', 'true');
  const info = await page.evaluate(() => (window as any).YS_DRAW.page());
  expect(info.fillable, 'spaces a child can color').toBeGreaterThan(5);

  await page.locator('#palette button[aria-label="Blue"]').click();
  await expect(page.locator('#palette button[aria-label="Blue"]')).toHaveAttribute('aria-pressed', 'true');
  const target = page.locator('#sheet svg #paper');
  await target.click({ position: { x: 20, y: 20 } });
  await expect(target).toHaveAttribute('fill', '#1E63C4');
  await page.locator('#undo').click();
  await expect(target).toHaveAttribute('fill', '#fff');
  await target.click({ position: { x: 20, y: 20 } });

  const [png] = await Promise.all([page.waitForEvent('download'), page.locator('#png').click()]);
  expect(png.suggestedFilename()).toBe(`yaanstep-sprouts-${sub.id}-1.png`);
  const pngBytes = readFileSync((await png.path())!);
  expect(pngBytes.subarray(1, 4).toString()).toBe('PNG');
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.locator('#pdf').click()]);
  expect(pdf.suggestedFilename()).toBe(`yaanstep-sprouts-${sub.id}-1.pdf`);
  const pdfText = readFileSync((await pdf.path())!).toString('latin1');
  expect(pdfText.startsWith('%PDF-1.4')).toBe(true);
  expect(pdfText.trimEnd().endsWith('%%EOF')).toBe(true);
  expect(pdfText).toContain('/Filter /DCTDecode');

  await page.locator('#next').click();
  await expect(page.locator('#page-count')).toHaveText(`Page 2 of ${sub.n}`);
  expect(await axeViolations(page, '#v-page')).toEqual([]);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#palette')).toBeHidden();
  await expect(page.locator('#sheet svg')).toBeVisible();
  await expect(page.locator('.back')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  expect((await storedData(page, context)).local).toEqual([]);
  expect(errors).toEqual([]);
});

test('step by step: 30+ drawings from easy to harder; one line at a time, read aloud, with Back and a drawing box', async ({ page, context }) => {
  const errors = watchErrors(page);
  await open(page, '#steps');
  const list = await page.evaluate(() => (window as any).YS_DRAW.steps()) as { id: string; name: string; level: number; n: number }[];
  expect(list.length).toBeGreaterThanOrEqual(30);
  expect(list.map((d) => d.level)).toEqual([...list.map((d) => d.level)].sort((a, b) => a - b));
  for (const d of list) expect(d.n, d.id).toBeGreaterThanOrEqual(3);
  await expect(page.locator('#steplist .tile-a')).toHaveCount(list.length);
  expect(await axeViolations(page, '#v-steps')).toEqual([]);

  const duck = list.find((d) => d.id === 'duck') ?? list[0];
  await page.locator(`#steplist a[href="#steps/${duck.id}"]`).click();
  await expect(page.locator('#step-count')).toHaveText(`Step 1 of ${duck.n}`);
  const s1 = await page.evaluate(() => (window as any).YS_DRAW.step());
  await expect(page.locator('#say')).toHaveText(s1.say);
  expect((await said(page)).at(-1)).toBe(s1.say);
  await expect(page.locator('#sback')).toBeDisabled();
  const first = await page.locator('#stepsvg path').count();
  expect(first).toBeGreaterThan(0);

  await page.locator('#snext').click();
  await expect(page.locator('#step-count')).toHaveText(`Step 2 of ${duck.n}`);
  expect(await page.locator('#stepsvg path').count()).toBeGreaterThan(first);
  await expect(page.locator('#stepsvg path.now').first()).toBeVisible();
  await page.locator('#sback').click();
  await expect(page.locator('#step-count')).toHaveText(`Step 1 of ${duck.n}`);
  await page.locator('#hear').click();
  expect((await said(page)).at(-1)).toBe(s1.say);

  // draw along
  await page.locator('#guide').click();
  await expect(page.locator('#ghost')).toBeVisible();
  await page.locator('#canvas').scrollIntoViewIfNeeded();
  const box = (await page.locator('#canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  const inked = await page.evaluate(() => {
    const c = document.getElementById('canvas') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  expect(inked).toBeGreaterThan(200);
  expect(await axeViolations(page, '#v-step')).toEqual([]);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  for (let k = 1; k < duck.n; k++) await page.locator('#snext').click();
  await expect(page.locator('#snext')).toHaveText('Draw something else');
  await page.locator('#snext').click();
  await expect(page.locator('#v-steps')).toBeVisible();
  expect((await storedData(page, context)).local).toEqual([]);
  expect(errors).toEqual([]);
});

test('every step-by-step stroke is a valid path and each drawing ends by asking to color it in', async ({ page }) => {
  await open(page, '#steps');
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.appendChild(svg);
    for (const d of (window as any).YS_STEPS) {
      const last = d.steps[d.steps.length - 1];
      if (last.d.length || !/color/i.test(last.say)) out.push(`${d.id}: last step`);
      d.steps.forEach((s: any, i: number) => {
        if (!s.say || s.say.split(/\s+/).length > 16) out.push(`${d.id} step ${i + 1}: sentence`);
        for (const p of s.d) {
          const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          el.setAttribute('d', p);
          svg.appendChild(el);
          const len = el.getTotalLength();
          const b = el.getBBox();
          if (!(len > 0)) out.push(`${d.id} step ${i + 1}: empty stroke`);
          if (b.x < -5 || b.y < -5 || b.x + b.width > 405 || b.y + b.height > 405) out.push(`${d.id} step ${i + 1}: outside the box`);
        }
      });
    }
    return out;
  });
  expect(bad).toEqual([]);
});

test('Easy, Medium and Hard buttons show only pages and drawings at that level, and the choice stays while browsing', async ({ page, context }) => {
  const errors = watchErrors(page);
  await open(page, '#color');
  const ix: Index = await (await page.request.get('/coloring/index.json')).json();
  const bar = page.locator('#v-cats .lvbar');
  await expect(bar.locator('button')).toHaveText([/All/, /Easy/, /Medium/, /Hard/]);
  await expect(bar.locator('button[data-lv="0"]')).toHaveAttribute('aria-pressed', 'true');
  for (const b of await bar.locator('button').all()) {
    const box = (await b.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(48);
    expect(box.width).toBeGreaterThanOrEqual(48);
  }

  await bar.locator('button[data-lv="1"]').click();
  await expect(bar.locator('button[data-lv="1"]')).toHaveAttribute('aria-pressed', 'true');
  expect((await said(page)).at(-1)).toBe('Easy');
  const easyIn = (s: Sub) => [...s.lv].filter((d) => d === '1').length;
  const easyCats = ix.categories.filter((c) => c.subjects.some((s) => easyIn(s) > 0));
  const easyTotal = ix.categories.reduce((t, c) => t + c.subjects.reduce((u, s) => u + easyIn(s), 0), 0);
  await expect(page.locator('#cats .tile-a')).toHaveCount(easyCats.length);
  await expect(page.locator('#total')).toContainText(`${easyTotal} easy coloring pages`);
  expect(await axeViolations(page, '#v-cats')).toEqual([]);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  // a picture with easy and harder pages
  const cat = easyCats.find((c) => c.subjects.some((s) => easyIn(s) > 0 && easyIn(s) < s.n))!;
  const sub = cat.subjects.find((s) => easyIn(s) > 0 && easyIn(s) < s.n)!;
  await page.locator(`#cats a[href="#color/${cat.id}"]`).click();
  await expect(page.locator('#v-subs .lvbar button[data-lv="1"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#subs .tile-a')).toHaveCount(cat.subjects.filter((s) => easyIn(s) > 0).length);
  await page.locator(`#subs a[href="#color/${cat.id}/${sub.id}"]`).click();
  await expect(page.locator('#vars .tile-a')).toHaveCount(easyIn(sub));
  await expect(page.locator('#vars .tag')).toHaveText(Array(easyIn(sub)).fill('Easy'));

  // Next page skips the pages that are not easy
  const easyPages = [...sub.lv].map((d, i) => (d === '1' ? i + 1 : 0)).filter(Boolean);
  await page.locator('#vars .tile-a').first().click();
  await expect(page.locator('#page-h')).toHaveText(`${sub.name}, page ${easyPages[0]} (Easy)`);
  await expect(page.locator('#prev')).toHaveAttribute('aria-disabled', 'true');
  if (easyPages.length > 1) {
    await page.locator('#next').click();
    await expect(page.locator('#page-count')).toHaveText(`Page ${easyPages[1]} of ${sub.n}`);
  }

  // All shows every page again
  await page.locator('#page-back').click();
  await page.locator('#v-vars .lvbar button[data-lv="0"]').click();
  await expect(page.locator('#vars .tile-a')).toHaveCount(sub.n);

  // the same buttons on step by step
  await page.goto('/drawing.html#steps');
  const list = await page.evaluate(() => (window as any).YS_DRAW.steps()) as { level: number }[];
  await page.locator('#v-steps .lvbar button[data-lv="3"]').click();
  await expect(page.locator('#steplist .tile-a')).toHaveCount(list.filter((d) => d.level === 3).length);
  await expect(page.locator('#steplist .tag')).toHaveText(Array(list.filter((d) => d.level === 3).length).fill('Hard'));
  await expect(page.locator('#steplist h3')).toHaveText(['Hard, ages 8 to 12']);
  await page.locator('#v-steps .lvbar button[data-lv="1"]').click();
  await expect(page.locator('#steplist .tile-a')).toHaveCount(list.filter((d) => d.level === 1).length);
  expect(await axeViolations(page, '#v-steps')).toEqual([]);
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await horizontalOverflow(page), 'at 320 px').toBeLessThanOrEqual(1);

  expect((await storedData(page, context)).local).toEqual([]);
  expect(errors).toEqual([]);
});
