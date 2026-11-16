import { expect, type Page } from '@playwright/test';

// Helpers for the hidden maths draft page (maths-draft.html, SCRUM-409).
// Expected answers are worked out HERE from what is on the screen (the words, the number of shapes drawn, the shape geometry),
// never from the page's own code or its aria-labels. The page's timers run on a fake clock (see boot) so the pause after a right
// answer costs nothing.
//
// How the page works (draft of 15 Nov 2026, evening): pick an age band -> the next unfinished chapter starts with a short lesson
// (Next / Back / Skip the lesson) -> ten questions -> the chapter is passed with 8 right first time. "Chapters" lists all
// chapters; free play (endless) is offered at the end of a chapter.

export const PAGE = '/maths-draft.html';
export const BANDS = ['3-4', '5-6', '7-8', '9-10', '11-12'] as const;
export const DAY0 = Date.UTC(2026, 0, 1);
export const dayTime = (n: number) => new Date(DAY0 + n * 864e5 + 12 * 36e5); // noon UTC on day n

/** Chapter titles as the person sees them in the chapter list (the oracle for what each chapter may ask). */
export const CHAPTERS: Record<string, string[]> = {
  '3-4': ['Counting', 'One more', 'Which has more?', 'Odd one out', 'Fill the frame'],
  '5-6': ['Adding up to 5', 'Adding up to 10', 'Taking away within 10', 'Make 10', 'Adding up to 20', 'Taking away within 20', 'Bigger or smaller', 'Adding three numbers', 'Put in order'],
  '7-8': ['Adding up to 100', 'Taking away within 100', 'Groups of 2, 5 and 10', 'Groups of 3 and 4', 'Sharing equally', 'Missing numbers'],
  '9-10': ['Adding up to 1000', 'Taking away within 1000', 'Times tables to 12', 'Sharing and dividing', 'Missing numbers', 'Put in order'],
  '11-12': ['Adding big numbers', 'Taking away big numbers', 'Multiplying bigger numbers', 'Dividing bigger numbers', 'Missing numbers', 'Put in order'],
};

export type Kind = 'add' | 'add3' | 'subtract' | 'multiply' | 'divide' | 'missing' | 'compare' | 'extreme' | 'count' | 'onemore' | 'more' | 'odd' | 'frame';

/** Kinds that may turn up in free play, by band. */
export const FREE_KINDS: Record<string, Kind[]> = {
  '3-4': ['count', 'more', 'onemore', 'odd', 'frame'],
  '5-6': ['add', 'subtract', 'missing', 'compare', 'add3', 'extreme', 'frame'],
  '7-8': ['add', 'subtract', 'multiply', 'missing', 'compare'],
  '9-10': ['add', 'subtract', 'multiply', 'divide', 'missing', 'compare'],
  '11-12': ['add', 'subtract', 'multiply', 'divide', 'missing', 'compare'],
};

export function kindOf(prompt: string): Kind {
  if (/^How many .* can you see\?$/.test(prompt)) return 'count';
  if (/add one more\?$/.test(prompt)) return 'onemore';
  if (prompt === 'Which group has more? Tap it.') return 'more';
  if (prompt === 'Which one is different? Tap it.') return 'odd';
  if (/^Make \d+\. Tap the circles to fill the frame\.$/.test(prompt)) return 'frame';
  if (/^\d+ \+ \d+ \+ \d+ = \?$/.test(prompt)) return 'add3';
  if (/^\d+ \+ \d+ = \?$/.test(prompt)) return 'add';
  if (/^\d+ - \d+ = \?$/.test(prompt)) return 'subtract';
  if (/^\d+ x \d+ = \?$/.test(prompt)) return 'multiply';
  if (/^\d+ \/ \d+ = \?$/.test(prompt)) return 'divide';
  if (/^\d+ \+ \? = \d+$/.test(prompt)) return 'missing';
  if (/^Which is bigger: \d+ or \d+\?$/.test(prompt)) return 'compare';
  if (/^Which is (smallest|biggest): \d+, \d+ or \d+\?$/.test(prompt)) return 'extreme';
  throw new Error(`question not understood by the test: "${prompt}"`);
}

/** The right answer for a number question, worked out from its words. */
export function answerFromPrompt(prompt: string): number {
  let m: RegExpMatchArray | null;
  if ((m = prompt.match(/^(\d+) \+ (\d+) \+ (\d+) = \?$/))) return +m[1] + +m[2] + +m[3];
  if ((m = prompt.match(/^(\d+) \+ (\d+) = \?$/))) return +m[1] + +m[2];
  if ((m = prompt.match(/^(\d+) - (\d+) = \?$/))) return +m[1] - +m[2];
  if ((m = prompt.match(/^(\d+) x (\d+) = \?$/))) return +m[1] * +m[2];
  if ((m = prompt.match(/^(\d+) \/ (\d+) = \?$/))) return +m[1] / +m[2];
  if ((m = prompt.match(/^(\d+) \+ \? = (\d+)$/))) return +m[2] - +m[1];
  if ((m = prompt.match(/^Which is bigger: (\d+) or (\d+)\?$/))) return Math.max(+m[1], +m[2]);
  if ((m = prompt.match(/^Which is (smallest|biggest): (\d+), (\d+) or (\d+)\?$/))) {
    const n = [+m[2], +m[3], +m[4]];
    return m[1] === 'smallest' ? Math.min(...n) : Math.max(...n);
  }
  throw new Error(`not a number question: "${prompt}"`);
}

export interface Pick { shape: string; color: string | null; label: string; w: number; h: number; disabled: boolean; glowing: boolean }
export interface Snapshot {
  prompt: string;
  kind: Kind;
  options: string[];            // text of the answer buttons (balloons) under the picture
  groups: number[];             // number of shapes drawn in each dashed group
  cards: { n: number; label: string; w: number; h: number }[]; // "which group has more" cards
  picks: Pick[];                // odd-one-out buttons
  slots: number;                // "+1" slot buttons
  cells: number;                // ten-frame circles
  hop: { label: string; start: number } | null; // number-line hop game, if shown
  artLabel: string;
  msg: string;
}

export async function snapshot(page: Page): Promise<Snapshot> {
  const raw = await page.evaluate(() => {
    const sig = (svg: Element | null) => {
      const el = svg?.firstElementChild;
      if (!el) return 'none';
      if (el.tagName === 'polygon') return `polygon${(el.getAttribute('points') ?? '').trim().split(/\s+/).length}`;
      return el.tagName;
    };
    const art = document.getElementById('art')!;
    const opts = document.getElementById('opts')!;
    const line = art.querySelector('.line');
    return {
      prompt: document.getElementById('q')!.textContent!.trim(),
      options: opts.classList.contains('endbtns') ? [] : [...opts.querySelectorAll('button')].map((b) => b.textContent!.trim()),
      groups: [...art.querySelectorAll('.grp')].map((g) => g.querySelectorAll('svg').length),
      cards: [...art.querySelectorAll('.card')].map((c) => { const r = c.getBoundingClientRect(); return { n: c.querySelectorAll('svg').length, label: c.getAttribute('aria-label') ?? '', w: r.width, h: r.height }; }),
      picks: [...art.querySelectorAll('.pick')].map((b) => { const r = b.getBoundingClientRect(); return { sig: sig(b.querySelector('svg')), color: b.querySelector('svg [fill]')?.getAttribute('fill') ?? null, label: b.getAttribute('aria-label') ?? '', w: r.width, h: r.height, disabled: (b as HTMLButtonElement).disabled, glowing: b.classList.contains('on') }; }),
      slots: art.querySelectorAll('.slot').length,
      cells: art.querySelectorAll('button.cell').length,
      hop: document.getElementById('hop') && line ? { label: line.getAttribute('aria-label') ?? '', start: +(line.querySelector('.bead.here')?.textContent ?? -1) } : null,
      artLabel: art.getAttribute('aria-label') ?? '',
      msg: document.getElementById('msg')!.textContent!.trim(),
    };
  });
  const sigName: Record<string, string> = { circle: 'circle', rect: 'square', polygon3: 'triangle', polygon10: 'star', path: 'heart' };
  return {
    ...raw,
    kind: kindOf(raw.prompt),
    picks: raw.picks.map((p) => ({ shape: sigName[p.sig] ?? p.sig, color: p.color, label: p.label, w: p.w, h: p.h, disabled: p.disabled, glowing: p.glowing })),
  };
}

/** What the right tap is, from what is drawn. */
export function rightAnswer(s: Snapshot): { text?: string; card?: number; pick?: number; cells?: number } {
  switch (s.kind) {
    case 'count': return { text: String(s.groups[0]) };
    case 'onemore': return { text: String(s.groups[0] + 1) };
    case 'more': return { card: s.cards[0].n > s.cards[1].n ? 0 : 1 };
    case 'frame': return { cells: +s.prompt.match(/\d+/)![0] };
    case 'odd': {
      const counts = new Map<string, number>();
      s.picks.forEach((p) => counts.set(p.shape, (counts.get(p.shape) ?? 0) + 1));
      return { pick: s.picks.findIndex((p) => counts.get(p.shape) === 1) };
    }
    default: return { text: String(answerFromPrompt(s.prompt)) };
  }
}

/** A tap that is wrong. (The ten-frame has none: the question ends as soon as the right number is filled.) */
export function wrongAnswer(s: Snapshot): { text?: string; card?: number; pick?: number } | null {
  const r = rightAnswer(s);
  if (s.kind === 'frame') return null;
  if (s.kind === 'more') return { card: 1 - r.card! };
  if (s.kind === 'odd') return { pick: s.picks.findIndex((_, i) => i !== r.pick) };
  return { text: s.options.find((o) => o !== r.text)! };
}

export async function tap(page: Page, a: { text?: string; card?: number; pick?: number; cells?: number }) {
  if (a.text !== undefined) await page.locator('#opts button', { hasText: new RegExp(`^\\s*${a.text}\\s*$`) }).click();
  else if (a.card !== undefined) await page.locator('#art .card').nth(a.card).click();
  else if (a.cells !== undefined) for (let i = 0; i < a.cells; i++) await page.locator('#art button.cell').nth(i).click();
  else await page.locator('#art .pick').nth(a.pick!).click();
}

// ---------- what each chapter may ask (from the chapter titles) ----------

/** Problems for a number question that does not fit its chapter title. Empty = fine. */
export function chapterProblems(title: string, band: string, s: Snapshot): string[] {
  const out: string[] = [];
  const bad = (m: string) => out.push(`chapter "${title}" (ages ${band}): ${s.kind} "${s.prompt}": ${m}`);
  const pictureChapter: Record<string, Kind> = { Counting: 'count', 'One more': 'onemore', 'Which has more?': 'more', 'Odd one out': 'odd', 'Fill the frame': 'frame' };
  if (pictureChapter[title]) { if (s.kind !== pictureChapter[title]) bad(`expected a ${pictureChapter[title]} question`); return out; }
  if (s.kind === 'frame' || ['count', 'onemore', 'more', 'odd'].includes(s.kind)) { bad('a picture question in a number chapter'); return out; }
  const nums = (s.prompt.match(/\d+/g) ?? []).map(Number);
  const need = (k: Kind) => { if (s.kind !== k) bad(`expected a ${k} question`); };
  let m: RegExpMatchArray | null;
  if ((m = title.match(/^Adding up to (\d+)$/))) { need('add'); if (s.kind === 'add' && nums[0] + nums[1] > +m[1]) bad(`the sum is above ${m[1]}`); }
  else if ((m = title.match(/^Taking away within (\d+)$/))) { need('subtract'); if (s.kind === 'subtract' && nums[0] > +m[1]) bad(`starts above ${m[1]}`); }
  else if (title === 'Make 10') { need('missing'); if (s.kind === 'missing' && nums[1] !== 10) bad('the total is not 10'); }
  else if (title === 'Bigger or smaller') { need('compare'); if (nums.some((n) => n > 20)) bad('number above 20'); }
  else if (title === 'Adding three numbers') need('add3');
  else if (title === 'Put in order') { need('extreme'); const max = band === '5-6' ? 20 : band === '9-10' ? 1000 : 10000; if (nums.some((n) => n > max)) bad(`number above ${max}`); }
  else if (title === 'Groups of 2, 5 and 10') { need('multiply'); if (s.kind === 'multiply' && (!nums.some((n) => [2, 5, 10].includes(n)) || nums.some((n) => n > 10))) bad('not a 2, 5 or 10 times table within 10'); }
  else if (title === 'Groups of 3 and 4') { need('multiply'); if (s.kind === 'multiply' && (!nums.some((n) => [3, 4].includes(n)) || nums.some((n) => n > 10))) bad('not a 3 or 4 times table within 10'); }
  else if (title === 'Sharing equally') { need('divide'); if (s.kind === 'divide' && (![2, 3, 4, 5, 10].includes(nums[1]) || nums[0] / nums[1] > 10)) bad('divisor not 2, 3, 4, 5 or 10, or answer above 10'); }
  else if (title === 'Times tables to 12') { need('multiply'); if (nums.some((n) => n > 12)) bad('factor above 12'); }
  else if (title === 'Sharing and dividing') { need('divide'); if (s.kind === 'divide' && (nums[1] > 12 || nums[0] / nums[1] > 12)) bad('divisor or answer above 12'); }
  else if (title === 'Multiplying bigger numbers') { need('multiply'); if (nums.some((n) => n > 25)) bad('factor above 25'); }
  else if (title === 'Dividing bigger numbers') { need('divide'); if (s.kind === 'divide' && (nums[1] > 25 || nums[0] / nums[1] > 25)) bad('divisor or answer above 25'); }
  else if (title === 'Adding big numbers') { need('add'); if (s.kind === 'add' && nums[0] + nums[1] > 10000) bad('sum above 10 000'); }
  else if (title === 'Taking away big numbers') { need('subtract'); if (s.kind === 'subtract' && nums[0] > 10000) bad('starts above 10 000'); }
  else if (title === 'Missing numbers') {
    need('missing');
    const max = band === '7-8' ? 50 : band === '9-10' ? 500 : 5000;
    if (s.kind === 'missing' && (nums[0] > max || nums[1] - nums[0] > max)) bad(`a part above ${max}`);
  }
  return out;
}

/** Everything that must be true of one question on screen. Returns a list of problems (empty = fine). */
export function problemsWith(s: Snapshot, band: string, allowed?: Kind[]): string[] {
  const out: string[] = [];
  const bad = (m: string) => out.push(`${s.kind} "${s.prompt}": ${m}`);
  if (/undefined|NaN|null/.test(s.prompt)) bad('the question text contains undefined/NaN/null');
  const numeric = !['count', 'onemore', 'more', 'odd', 'frame'].includes(s.kind);
  const nums = (s.prompt.match(/\d+/g) ?? []).map(Number);
  if (allowed && !allowed.includes(s.kind)) bad(`kind ${s.kind} is not planned here`);

  if (s.kind === 'more' || s.kind === 'odd' || s.kind === 'frame') {
    if (s.options.length) bad(`has answer buttons ${JSON.stringify(s.options)} as well as the tappable picture`);
  } else {
    if (s.options.length !== 4) bad(`has ${s.options.length} choices, expected 4: ${JSON.stringify(s.options)}`);
    if (new Set(s.options).size !== s.options.length) bad(`has repeated choices ${JSON.stringify(s.options)}`);
    if (!s.options.every((o) => /^\d+$/.test(o))) bad(`has a choice that is not a whole number ${JSON.stringify(s.options)}`);
  }

  if (numeric) {
    if (band === '3-4') bad('ages 3 to 4 got a number-only question');
    const right = String(answerFromPrompt(s.prompt));
    if (!s.options.includes(right)) bad(`the right answer ${right} is not among the choices ${JSON.stringify(s.options)}`);
    if (s.kind === 'compare') {
      if (nums[0] === nums[1]) bad('the two numbers are the same, so there is no bigger one');
      for (const n of nums) if (!s.options.includes(String(n))) bad(`the number ${n} shown in the question is not among the choices ${JSON.stringify(s.options)} (SCRUM-447)`);
    }
    if (s.kind === 'extreme') {
      if (new Set(nums).size !== 3) bad('the three numbers are not all different');
      for (const n of nums) if (!s.options.includes(String(n))) bad(`the number ${n} shown in the question is not among the choices ${JSON.stringify(s.options)}`);
    }
    if (s.kind === 'subtract' && nums[1] >= nums[0]) bad('the answer would be zero or negative');
    if (s.kind === 'add3') nums.forEach((n) => { if (n > 9 || n < 1) bad(`number ${n} outside 1..9`); });
    if (s.kind === 'missing' && nums[1] <= nums[0]) bad('the total is not bigger than the first number');
    if (s.kind === 'divide' && (nums[0] % nums[1] !== 0 || nums[1] < 2)) bad('does not divide exactly (or divides by 1)');
    if (s.kind === 'multiply' && nums.some((n) => n < 2)) bad('a factor is below 2');
    if (s.artLabel) bad(`number puzzle has a picture label "${s.artLabel}"`);
    // The number-line hop game belongs to small adding and taking-away questions only.
    const small = (s.kind === 'add' || s.kind === 'subtract') && nums[0] <= 20 && nums[1] <= 20 && answerFromPrompt(s.prompt) <= 20 && answerFromPrompt(s.prompt) >= 0;
    if (small && !s.hop) bad('a small add/take-away question should show the number-line hop game');
    if (!small && s.hop) bad('the number-line hop game is shown for a question outside 1 to 20');
    if (s.hop) {
      if (s.hop.start !== nums[0]) bad(`the hop game starts at ${s.hop.start}, not at ${nums[0]}`);
      if (!s.hop.label.includes(`Start at ${nums[0]}.`)) bad(`the hop game description "${s.hop.label}" does not start at ${nums[0]}`);
    }
  } else {
    if (band !== '3-4' && s.kind !== 'frame') bad(`picture puzzle shown to ages ${band}`);
    if (s.kind === 'frame') {
      if (s.cells !== 10) bad(`the frame has ${s.cells} circles, expected 10`);
      const n = +s.prompt.match(/\d+/)![0];
      if (band === '3-4' ? n < 1 || n > 5 : n < 3 || n > 10) bad(`the frame asks for ${n}, outside the range for ages ${band}`);
    } else if (s.artLabel === '') bad('the picture has no description for a screen reader');
    if (s.kind === 'count') {
      if (s.groups.length !== 1) bad(`expected one group of shapes, found ${s.groups.length}`);
      const n = s.groups[0];
      if (n < 1 || n > 5) bad(`${n} shapes is outside 1 to 5`);
      if (!s.options.includes(String(n))) bad(`the number of shapes drawn (${n}) is not among the choices`);
      if (s.options.some((o) => +o < 1 || +o > 5)) bad(`choices outside 1 to 5: ${JSON.stringify(s.options)}`);
      if (+(s.artLabel.match(/\d+/)?.[0] ?? -1) !== n) bad(`the description "${s.artLabel}" does not say ${n}`);
    }
    if (s.kind === 'onemore') {
      const n = s.groups[0];
      if (s.groups.length !== 1) bad(`expected one group, found ${s.groups.length}`);
      if (n < 1 || n > 4) bad(`${n} shapes to start from is outside 1 to 4`);
      if (s.slots !== 1) bad(`expected one "+1" slot, found ${s.slots}`);
      if (!s.options.includes(String(n + 1))) bad(`the right answer ${n + 1} is not among the choices`);
      if (s.options.some((o) => +o < 1 || +o > 5)) bad(`choices outside 1 to 5: ${JSON.stringify(s.options)}`);
      if (+(s.artLabel.match(/\d+/)?.[0] ?? -1) !== n) bad(`the description "${s.artLabel}" does not say ${n}`);
    }
    if (s.kind === 'more') {
      if (s.cards.length !== 2) bad(`expected two tappable groups, found ${s.cards.length}`);
      if (s.groups.length !== 2) bad(`expected two groups drawn, found ${s.groups.length}`);
      if (s.cards.length === 2) {
        if (s.cards[0].n === s.cards[1].n) bad('both groups have the same number of shapes, so there is no right answer');
        for (const c of s.cards) { if (c.n < 1 || c.n > 5) bad(`a group has ${c.n} shapes, outside 1 to 5`); if (c.w < 48 || c.h < 48) bad(`a group is only ${Math.round(c.w)}x${Math.round(c.h)} px to tap`); if (+(c.label.match(/\d+/)?.[0] ?? -1) !== c.n) bad(`a group's label "${c.label}" does not say ${c.n}`); }
      }
    }
    if (s.kind === 'odd') {
      // SCRUM-448: this question once showed two boxes (a group of triangles and a star) and nothing could be tapped.
      if (s.cards.length) bad(`shows ${s.cards.length} summary boxes instead of tappable shapes (SCRUM-448)`);
      if (s.groups.length !== 1) bad(`expected one box with all the shapes, found ${s.groups.length} boxes`);
      if (s.picks.length < 3 || s.picks.length > 5) bad(`expected 3 to 5 tappable shapes, found ${s.picks.length}`);
      if (s.groups[0] !== s.picks.length) bad(`${s.groups[0]} shapes drawn but ${s.picks.length} tappable`);
      const counts = new Map<string, number>();
      s.picks.forEach((p) => counts.set(p.shape, (counts.get(p.shape) ?? 0) + 1));
      const odd = [...counts.values()].filter((c) => c === 1).length;
      if (counts.size !== 2 || odd !== 1) bad(`there must be exactly two kinds of shape with exactly one odd one; found ${JSON.stringify([...counts])}`);
      if (new Set(s.picks.map((p) => p.color)).size !== 1) bad('the shapes are not all the same colour');
      for (const [i, p] of s.picks.entries()) {
        if (p.w < 48 || p.h < 48) bad(`shape ${i + 1} is only ${Math.round(p.w)}x${Math.round(p.h)} px to tap`);
        if (p.disabled) bad(`shape ${i + 1} cannot be tapped`);
        if (!p.label.toLowerCase().includes(p.shape)) bad(`shape ${i + 1} is drawn as a ${p.shape} but is called "${p.label}"`);
      }
      if (+(s.artLabel.match(/\d+/)?.[0] ?? -1) !== s.picks.length) bad(`the description "${s.artLabel}" does not say ${s.picks.length}`);
      const oddShape = s.picks.find((p) => counts.get(p.shape) === 1)?.shape;
      if (oddShape && !s.artLabel.includes(`one is a ${oddShape}`)) bad(`the description "${s.artLabel}" does not name the odd shape (${oddShape})`);
    }
  }
  return out;
}

// ---------- driving the page ----------

/** Fake clock + optional seeded Math.random, then load the page. Same seed = same puzzles. */
export async function boot(page: Page, opts: { seed?: number; day?: number } = {}) {
  if (opts.seed !== undefined) {
    await page.addInitScript(`(() => { let t = ${opts.seed} >>> 0; Math.random = () => { t = (t + 1831565813) >>> 0; let r = Math.imul(t ^ (t >>> 15), t | 1); r ^= r + Math.imul(r ^ (r >>> 7), r | 61); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; })();`);
  }
  await page.clock.install({ time: dayTime(opts.day ?? 300) });
  await page.goto(PAGE);
}

export const band = (page: Page, b: string) => page.locator(`#bands button[data-b="${b}"]`);

/** After a right answer the page waits 1.5 s then moves on; the fake clock skips the wait. */
export async function next(page: Page) { await page.clock.runFor(1600); }

/** The lesson: click Next until "Start the questions", then start. Returns the text of every lesson step. */
export async function lessonThenQuestions(page: Page, skip = false): Promise<string[]> {
  const steps: string[] = [];
  if (skip && (await page.locator('#ts').count())) { await page.locator('#ts').click(); return steps; }
  for (let i = 0; i < 30; i++) {
    steps.push((await page.locator('#q').innerText()).trim());
    const label = (await page.locator('#tn').innerText()).trim();
    await page.locator('#tn').click();
    if (label === 'Start the questions') return steps;
  }
  throw new Error('lesson did not end');
}

/** Opens a chapter from the chapter list (lesson first). */
export async function openChapter(page: Page, b: string, index: number) {
  if (await page.locator('#menu').isVisible()) await band(page, b).click();
  if (!(await page.locator('#chaps').isVisible())) await page.locator('#chbtn').click();
  await page.locator(`#chlist button[data-i="${index}"]`).click();
}

/** Plays questions until the chapter end screen (or `limit`). wrongFirst: how many questions to miss once first. */
export async function playQuestions(page: Page, band: string, opts: { wrongFirst?: number; limit?: number; allowed?: Kind[]; title?: string; onQuestion?: (s: Snapshot, i: number) => Promise<void> } = {}): Promise<Snapshot[]> {
  const seen: Snapshot[] = [];
  const limit = opts.limit ?? 12;
  for (let i = 0; i < limit; i++) {
    const s = await snapshot(page);
    seen.push(s);
    expect([...problemsWith(s, band, opts.allowed), ...(opts.title ? chapterProblems(opts.title, band, s) : [])], `question ${i + 1}`).toEqual([]);
    if (opts.onQuestion) await opts.onQuestion(s, i);
    const wrong = i < (opts.wrongFirst ?? 0) ? wrongAnswer(s) : null;
    if (wrong) {
      await tap(page, wrong);
      await expect(page.locator('#msg')).toContainText('Nearly!');
    }
    await tap(page, rightAnswer(s));
    await expect(page.locator('#msg')).toContainText(/Good job!|Great work!|Well done!|Super!|Brilliant!|You got it!/);
    await next(page);
    if ((await page.locator('#opts.endbtns').count()) > 0) return seen; // the chapter end screen
  }
  return seen;
}

// ---------- the lessons ----------

/** Every "a + b = c", "a − b = c", "a × b = c", "a ÷ b = c" and "n = a + b + c" written in a lesson step must be arithmetically true. */
export function lessonArithmeticProblems(text: string): string[] {
  const out: string[] = [];
  const ev = (expr: string): number | null => {
    const t = expr.split(' ');
    let v = +t[0];
    for (let i = 1; i < t.length; i += 2) {
      const n = +t[i + 1];
      if (t[i] === '+') v += n; else if (t[i] === '−' || t[i] === '-') v -= n; else if (t[i] === '×' || t[i] === 'x') v *= n; else if (t[i] === '÷' || t[i] === '/') v /= n; else return null;
    }
    return v;
  };
  const num = '\\d+';
  const op = '[+−×÷\\-x/]';
  for (const m of text.matchAll(new RegExp(`(${num}(?: ${op} ${num})+) = (${num})`, 'g'))) {
    const v = ev(m[1]);
    if (v !== +m[2]) out.push(`"${m[0]}" is not true (it is ${v})`);
  }
  for (const m of text.matchAll(new RegExp(`(?<![\\d+] )\\b(${num}) = (${num}(?: ${op} ${num})+)`, 'g'))) {
    const v = ev(m[2]);
    if (v !== +m[1]) out.push(`"${m[0]}" is not true (it is ${v})`);
  }
  return out;
}

/** The pictures in one lesson step must agree with the words: dots in an array, bar-model parts, frame circles. */
export async function lessonPictureProblems(page: Page): Promise<string[]> {
  const out: string[] = [];
  const say = ((await page.locator('#q').innerText()) ?? '').trim();
  const info = await page.evaluate(() => {
    const art = document.getElementById('art')!;
    const arr = art.querySelector('.arr');
    const bar = art.querySelector('.bm');
    return {
      arrDots: arr ? arr.querySelectorAll('.dot').length : null,
      arrCols: arr ? +((arr as HTMLElement).style.gridTemplateColumns.match(/repeat\((\d+)/)?.[1] ?? -1) : null,
      bar: bar ? { top: bar.querySelector('.bmtop')!.textContent!.trim(), parts: [...bar.querySelectorAll('.bmp')].map((p) => p.textContent!.trim()) } : null,
      filled: art.querySelectorAll('.frame .cell.on').length,
      extra: art.querySelectorAll('.frame .cell.on2').length,
      cells: art.querySelectorAll('.frame .cell').length,
      objects: [...art.querySelectorAll('.grp')].map((g) => g.querySelectorAll('svg').length),
      crossed: art.querySelectorAll('.obj.cross').length,
    };
  });
  let m: RegExpMatchArray | null;
  if (info.arrDots !== null && (m = say.match(/^(\d+) rows with (\d+) in each row/))) {
    if (info.arrDots !== +m[1] * +m[2]) out.push(`"${say}": the picture has ${info.arrDots} dots, expected ${+m[1] * +m[2]}`);
    if (info.arrCols !== +m[2]) out.push(`"${say}": the picture has ${info.arrCols} columns, expected ${m[2]}`);
  }
  if (info.bar) {
    const known = [info.bar.top, ...info.bar.parts].filter((v) => v !== '?');
    if (known.length === 3 && +info.bar.parts[0] + +info.bar.parts[1] !== +info.bar.top) out.push(`"${say}": the bar model shows ${info.bar.parts.join(' + ')} but the whole is ${info.bar.top}`);
  }
  if (info.cells && info.cells !== 10) out.push(`"${say}": the frame has ${info.cells} circles, not 10`);
  if (info.cells && info.filled + info.extra > 10) out.push(`"${say}": more than 10 circles are filled`);
  if ((m = say.match(/^A frame holds up to ten circles\. Let us fill (\d+)\./)) && info.filled !== +m[1]) out.push(`"${say}": ${info.filled} circles are filled`);
  if ((m = say.match(/^Here are (\d+) (?:red circles|blue stars)\./)) && info.objects[0] !== +m[1]) out.push(`"${say}": ${info.objects[0]} shapes are drawn`);
  if ((m = say.match(/^(\d+) apples\. Take away (\d+)\./)) && (info.objects[0] !== +m[1] || info.crossed !== +m[2])) out.push(`"${say}": ${info.objects[0]} shapes with ${info.crossed} crossed out`);
  return out;
}
