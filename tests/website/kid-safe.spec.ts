import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { BLOCKED_WORDS, blockedIn } from '../support/kid-safe';

// Kid-safe gate for the word of the day, the picture dictionary and the grammar pages (Manish, 23 Nov 2026; SCRUM-516):
// "Do not include bad words or inappropriate words." The pages only ever show words from their own checked lists
// (an allowlist), so this test reads every list straight from the website files and fails the build if a blocked word
// appears anywhere: in a word, a meaning, a split, a word family, a synonym, an opposite, an origin line, a sentence,
// a grammar lesson or a practice question. It also checks the lists are well formed.

const SITE = process.env.SITE_DIR ?? '../yaanstep-website';
const only = (name: string) => test.skip(name !== 'desktop', 'file checks run once');

function load(dir: string, key: string): any[] {
  const box: any = { window: {} };
  for (const f of readdirSync(join(SITE, dir)).filter((f) => f.endsWith('.js')).sort()) runInNewContext(readFileSync(join(SITE, dir, f), 'utf8'), box, { filename: f });
  return box.window[key] ?? [];
}
function strings(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) x.forEach((y) => strings(y, out));
  else if (x && typeof x === 'object') Object.values(x).forEach((y) => strings(y, out));
  return out;
}

test('the blocked-word list itself works', async ({}, info) => {
  only(info.project.name);
  expect(BLOCKED_WORDS.length).toBeGreaterThan(50);
  expect(blockedIn('Butter and skill and a class of grass are fine.')).toEqual([]);
  expect(blockedIn('This sentence says ' + BLOCKED_WORDS[0] + '.')).toEqual([BLOCKED_WORDS[0]]);
});

test('no blocked word appears anywhere in the dictionary words', async ({}, info) => {
  only(info.project.name);
  const words = load('assets/words', 'YS_WORDS');
  expect(words.length).toBeGreaterThanOrEqual(400);
  const found = words.flatMap((e) => blockedIn(strings(e).join(' \n ')).map((b) => `${e.w}: ${b}`));
  expect(found).toEqual([]);
});

test('no blocked word appears anywhere in the grammar lessons and questions', async ({}, info) => {
  only(info.project.name);
  const topics = load('assets/grammar', 'YS_GRAMMAR');
  expect(topics.length).toBeGreaterThanOrEqual(17);
  const found = topics.flatMap((t) => blockedIn(strings(t).join(' \n ')).map((b) => `${t.id}: ${b}`));
  expect(found).toEqual([]);
});

test('no blocked word appears in the page text or scripts of the word and grammar pages', async ({}, info) => {
  only(info.project.name);
  const files = ['words.html', 'grammar.html', 'assets/words.js', 'assets/grammar.js'].filter((f) => existsSync(join(SITE, f)));
  expect(files.length).toBe(4);
  const found = files.flatMap((f) => blockedIn(readFileSync(join(SITE, f), 'utf8')).map((b) => `${f}: ${b}`));
  expect(found).toEqual([]);
});

test('every dictionary word is well formed: split spells the word, 3 or more sentences, no repeats', async ({}, info) => {
  only(info.project.name);
  const words = load('assets/words', 'YS_WORDS');
  const seen = new Set<string>(), problems: string[] = [];
  const CATS = ['animals', 'nature', 'food', 'home', 'people', 'feelings', 'actions', 'describing', 'school', 'science', 'places', 'time', 'bigwords'];
  for (const e of words) {
    if (seen.has(e.w)) problems.push(`${e.w}: listed twice`);
    seen.add(e.w);
    if (!/^[a-z]+(?:[ -][a-z]+)?$/.test(e.w)) problems.push(`${e.w}: not a plain lowercase word`);
    if (!CATS.includes(e.cat)) problems.push(`${e.w}: category ${e.cat}`);
    if (!(e.age >= 3 && e.age <= 12)) problems.push(`${e.w}: age ${e.age}`);
    if (!e.mean || e.mean.length > 140) problems.push(`${e.w}: meaning`);
    if (e.split.map((p: any) => p.t).join('').toLowerCase() !== e.w.replace(/[ -]/g, '')) problems.push(`${e.w}: split does not spell the word`);
    for (const p of e.split) if ((p.k === 'pre' || p.k === 'suf') && !p.m) problems.push(`${e.w}: ${p.t} has no meaning`);
    if (!Array.isArray(e.ex) || e.ex.length < 3) problems.push(`${e.w}: fewer than 3 sentences`);
    for (const s of e.ex ?? []) if (!/^[A-Z"].*[.!?]"?$/.test(s)) problems.push(`${e.w}: sentence "${s}"`);
    for (const k of ['family', 'syn', 'opp']) if (!Array.isArray(e[k]) || e[k].includes(e.w)) problems.push(`${e.w}: ${k}`);
    if (!e.from) problems.push(`${e.w}: no origin line`);
  }
  expect(problems).toEqual([]);
  // Enough words for each age group's word of the day.
  for (const [lo, hi] of [[3, 5], [6, 8], [9, 12]]) expect(words.filter((e) => e.age >= lo && e.age <= hi).length, `ages ${lo}-${hi}`).toBeGreaterThanOrEqual(60);
});

test('every grammar question has a clear answer that exists', async ({}, info) => {
  only(info.project.name);
  const topics = load('assets/grammar', 'YS_GRAMMAR');
  const problems: string[] = [];
  const n = (s: string) => s.split(/\s+/).filter(Boolean).length;
  for (const t of topics) {
    if (t.learn.length < 4) problems.push(`${t.id}: short lesson`);
    for (const p of t.learn) for (const h of p.hi ?? []) if (!p.s || h >= n(p.s)) problems.push(`${t.id}: lesson index ${h}`);
    if (t.q.length < 24) problems.push(`${t.id}: only ${t.q.length} questions`);
    t.q.forEach((q: any, i: number) => {
      const at = `${t.id} q${i + 1}`;
      if (q.k === 'pick' && !q.opts.includes(q.ans)) problems.push(`${at}: answer not among the choices`);
      if (q.k === 'tap' && q.ans.some((h: number) => h < 0 || h >= n(q.s))) problems.push(`${at}: tap index out of range`);
      if (q.k === 'build' && !(/^[A-Z]/.test(q.words[0]) && /[.!?]$/.test(q.words[q.words.length - 1]))) problems.push(`${at}: build sentence`);
      if (q.k === 'whole' && q.whole === false && !q.opts.includes(q.fix)) problems.push(`${at}: fix not among the choices`);
      if (q.k === 'meaning') {
        if (!q.opts.includes(q.ans)) problems.push(`${at}: answer not among the choices`);
        const bare = new Set(q.opts.map((o: string) => o.replace(/[^A-Za-z ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()));
        if (bare.size !== 1) problems.push(`${at}: meaning choices must differ only in punctuation`);
      }
      if (q.k === 'place') {
        const hits = q.full.split(/\s+/).map((w: string, j: number) => (w.endsWith(q.mark) ? j : -1)).filter((j: number) => j > -1);
        if (!hits.length || (hits.length > 1 && !Number.isInteger(q.nth)) || (q.nth ?? 0) >= hits.length) problems.push(`${at}: place mark ${q.mark}`);
      }
      if (q.t !== undefined || ['mixups'].includes(t.id) && q.k === 'pick') {
        const gaps = (q.s ?? '').split('___').length - 1;
        if (gaps !== 1) problems.push(`${at}: needs exactly one gap`);
        else if (!/^[A-Z"].*[.!?]"?$/.test(q.s.replace('___', q.ans))) problems.push(`${at}: filled sentence "${q.s.replace('___', q.ans)}"`);
      }
      if (q.t !== undefined && !topics.some((x: any) => x.id === q.t)) problems.push(`${at}: topic ${q.t}`);
      if (!['pick', 'tap', 'build', 'whole', 'place', 'meaning'].includes(q.k)) problems.push(`${at}: kind ${q.k}`);
      if (!q.why) problems.push(`${at}: no explanation`);
    });
  }
  expect(problems).toEqual([]);
});
