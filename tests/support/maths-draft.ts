import { expect, type Page } from '@playwright/test';

// Helpers for the hidden maths draft page (maths-draft.html, SCRUM-409). Expected answers are worked out HERE from what is on the
// screen (the words, the number of shapes drawn, the shape geometry), never from the page's own code or its aria-labels.

export const PAGE = '/maths-draft.html';
export const BANDS = ['3-4', '5-6', '7-8', '9-10', '11-12'] as const;
export const MAX: Record<string, number> = { '3-4': 5, '5-6': 20, '7-8': 100, '9-10': 1000, '11-12': 10000 };
export const MULT_LIMIT: Record<string, number> = { '7-8': 10, '9-10': 12, '11-12': 25 };
export const DAY0 = Date.UTC(2026, 0, 1);
export const dayTime = (n: number) => new Date(DAY0 + n * 864e5 + 12 * 36e5); // noon UTC on day n

export type Kind = 'add' | 'add3' | 'subtract' | 'multiply' | 'divide' | 'missing' | 'compare' | 'extreme' | 'count' | 'onemore' | 'more' | 'odd';

export function kindOf(prompt: string): Kind {
  if (/^How many .* can you see\?$/.test(prompt)) return 'count';
  if (/add one more\?$/.test(prompt)) return 'onemore';
  if (prompt === 'Which group has more? Tap it.') return 'more';
  if (prompt === 'Which one is different? Tap it.') return 'odd';
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
  options: string[];            // text of the answer buttons under the picture
  groups: number[];             // number of shapes drawn in each dashed group
  cards: { n: number; label: string; w: number; h: number }[]; // "which group has more" cards
  picks: Pick[];                // odd-one-out buttons
  slots: number;                // "+1" slot buttons
  artLabel: string;
  artRole: string | null;
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
    return {
      prompt: document.getElementById('q')!.textContent!.trim(),
      options: [...document.querySelectorAll('#opts button')].map((b) => b.textContent!.trim()),
      groups: [...art.querySelectorAll('.grp')].map((g) => g.querySelectorAll('svg').length),
      cards: [...art.querySelectorAll('.card')].map((c) => { const r = c.getBoundingClientRect(); return { n: c.querySelectorAll('svg').length, label: c.getAttribute('aria-label') ?? '', w: r.width, h: r.height }; }),
      picks: [...art.querySelectorAll('.pick')].map((b) => { const r = b.getBoundingClientRect(); return { sig: sig(b.querySelector('svg')), color: b.querySelector('svg [fill]')?.getAttribute('fill') ?? null, label: b.getAttribute('aria-label') ?? '', w: r.width, h: r.height, disabled: (b as HTMLButtonElement).disabled, glowing: b.classList.contains('on') }; }),
      slots: art.querySelectorAll('.slot').length,
      artLabel: art.getAttribute('aria-label') ?? '',
      artRole: art.getAttribute('role'),
      msg: document.getElementById('msg')!.textContent!.trim(),
    };
  });
  const sigName: Record<string, string> = { circle: 'circle', rect: 'square', polygon3: 'triangle', polygon10: 'star', path: 'heart' };
  return {
    prompt: raw.prompt,
    kind: kindOf(raw.prompt),
    options: raw.options,
    groups: raw.groups,
    cards: raw.cards,
    picks: raw.picks.map((p) => ({ shape: sigName[p.sig] ?? p.sig, color: p.color, label: p.label, w: p.w, h: p.h, disabled: p.disabled, glowing: p.glowing })),
    slots: raw.slots,
    artLabel: raw.artLabel,
    artRole: raw.artRole,
    msg: raw.msg,
  };
}

/** What the right tap is, from what is drawn. */
export function rightAnswer(s: Snapshot): { text?: string; card?: number; pick?: number } {
  switch (s.kind) {
    case 'count': return { text: String(s.groups[0]) };
    case 'onemore': return { text: String(s.groups[0] + 1) };
    case 'more': return { card: s.cards[0].n > s.cards[1].n ? 0 : 1 };
    case 'odd': {
      const counts = new Map<string, number>();
      s.picks.forEach((p) => counts.set(p.shape, (counts.get(p.shape) ?? 0) + 1));
      const odd = s.picks.findIndex((p) => counts.get(p.shape) === 1);
      return { pick: odd };
    }
    default: return { text: String(answerFromPrompt(s.prompt)) };
  }
}

/** A tap that is wrong. */
export function wrongAnswer(s: Snapshot): { text?: string; card?: number; pick?: number } {
  const r = rightAnswer(s);
  if (s.kind === 'more') return { card: 1 - r.card! };
  if (s.kind === 'odd') return { pick: s.picks.findIndex((_, i) => i !== r.pick) };
  return { text: s.options.find((o) => o !== r.text)! };
}

export async function tap(page: Page, a: { text?: string; card?: number; pick?: number }) {
  if (a.text !== undefined) await page.locator('#opts button', { hasText: new RegExp(`^${a.text}$`) }).click();
  else if (a.card !== undefined) await page.locator('#art .card').nth(a.card).click();
  else await page.locator('#art .pick').nth(a.pick!).click();
}

/** Everything that must be true of one question on screen. Returns a list of problems (empty = fine). */
export function problemsWith(s: Snapshot, band: string): string[] {
  const out: string[] = [];
  const bad = (m: string) => out.push(`${s.kind} "${s.prompt}": ${m}`);
  if (/undefined|NaN|null/.test(s.prompt)) bad('the question text contains undefined/NaN/null');
  const numeric = !['count', 'onemore', 'more', 'odd'].includes(s.kind);
  const nums = (s.prompt.match(/\d+/g) ?? []).map(Number);

  // Answer buttons under the picture/question (not used by "more" and "odd", which are tapped on the picture itself).
  if (s.kind === 'more' || s.kind === 'odd') {
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
      for (const n of nums) if (!s.options.includes(String(n))) bad(`the number ${n} shown in the question is not among the choices ${JSON.stringify(s.options)}`);
    }
    if (s.kind === 'extreme') {
      if (new Set(nums).size !== 3) bad('the three numbers are not all different');
      for (const n of nums) if (!s.options.includes(String(n))) bad(`the number ${n} shown in the question is not among the choices ${JSON.stringify(s.options)}`);
    }
    const max = MAX[band];
    if (s.kind === 'add' || s.kind === 'subtract') nums.forEach((n) => { if (n > max || n < 1) bad(`number ${n} outside 1..${max} for ages ${band}`); });
    if (s.kind === 'subtract' && nums[1] >= nums[0]) bad('the answer would be zero or negative');
    if (s.kind === 'compare') nums.forEach((n) => { if (n > max + 1 || n < 1) bad(`number ${n} outside 1..${max + 1} for ages ${band}`); });
    if (s.kind === 'extreme') nums.forEach((n) => { if (n > max || n < 1) bad(`number ${n} outside 1..${max} for ages ${band}`); });
    if (s.kind === 'add3') nums.forEach((n) => { if (n > 9 || n < 1) bad(`number ${n} outside 1..9`); });
    if (s.kind === 'missing') { if (nums[1] <= nums[0] || nums[0] > max || nums[1] > 2 * max) bad('numbers outside the range or the total is not bigger than the first number'); }
    if (s.kind === 'multiply' || s.kind === 'divide') {
      const lim = MULT_LIMIT[band];
      if (!lim) bad(`${s.kind} is not for ages ${band}`);
      else if (s.kind === 'multiply') nums.forEach((n) => { if (n < 2 || n > lim) bad(`factor ${n} outside 2..${lim}`); });
      else { if (nums[0] % nums[1] !== 0) bad('does not divide exactly'); else if (nums[1] > lim || nums[0] / nums[1] > lim || nums[1] < 2) bad('divisor or answer outside the times table'); }
    }
    const allowed: Record<string, Kind[]> = {
      '5-6': ['add', 'subtract', 'missing', 'compare', 'add3', 'extreme'], '7-8': ['add', 'subtract', 'multiply', 'missing', 'compare'],
      '9-10': ['add', 'subtract', 'multiply', 'divide', 'missing', 'compare'], '11-12': ['add', 'subtract', 'multiply', 'divide', 'missing', 'compare'],
    };
    if (!allowed[band]?.includes(s.kind)) bad(`kind ${s.kind} is not planned for ages ${band}`);
    const label = s.artLabel;
    if (label) bad(`number puzzle has a picture label "${label}"`);
  } else {
    if (band !== '3-4') bad(`picture puzzle shown to ages ${band}`);
    if (s.artLabel === '') bad('the picture has no description for a screen reader');
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

/** Plays a started set. wrongFirst = how many questions to answer wrongly once before answering right. Returns every question seen. */
export async function playSet(page: Page, band: string, wrongFirst = 0, hooks?: { afterRight?: () => Promise<void> }): Promise<Snapshot[]> {
  const seen: Snapshot[] = [];
  for (let i = 0; i < 40; i++) {
    const prog = (await page.locator('#prog').textContent()) ?? '';
    const s = await snapshot(page);
    seen.push(s);
    const problems = problemsWith(s, band);
    expect(problems, `question ${i + 1}`).toEqual([]);
    if (i < wrongFirst) {
      await tap(page, wrongAnswer(s));
      await expect(page.locator('#msg')).toContainText('Nearly!');
    }
    await tap(page, rightAnswer(s));
    await expect(page.locator('#msg')).toContainText(/Yes! Well done\.|You got it!/);
    if (hooks?.afterRight) await hooks.afterRight();
    else await page.waitForFunction((p) => document.getElementById('prog')!.textContent !== p || !document.getElementById('done')!.hidden, prog, { timeout: 4000 });
    if (await page.locator('#done').isVisible()) return seen;
  }
  throw new Error('set did not finish');
}
