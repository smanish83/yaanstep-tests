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
  '5-6': ['Seeing 5 and 10 in blocks', 'Adding up to 5', 'Adding up to 10', 'Taking away within 10', 'Make 10', 'Adding up to 20', 'Taking away within 20', 'Bigger or smaller', 'Adding three numbers', 'Put in order', 'Coins: penny, nickel, dime, quarter', 'Counting pennies and dimes', "Clock: o'clock", 'Clock: half past'],
  '7-8': ['Adding up to 100', 'Taking away within 100', 'Groups of 2, 5 and 10', 'Groups of 3 and 4', 'Sharing equally', 'Missing numbers', 'Counting coins', 'Dollar notes: $1, $5, $10', 'Clock: quarter past and quarter to', 'Clock: five minutes at a time'],
  '9-10': ['Adding up to 1000', 'Taking away within 1000', 'Times tables to 12', 'Sharing and dividing', 'Missing numbers', 'Put in order', 'Dollars and cents: notes', 'Making change', 'Clock: any minute'],
  '11-12': ['Adding big numbers', 'Taking away big numbers', 'Multiplying bigger numbers', 'Dividing bigger numbers', 'Missing numbers', 'Put in order', 'Making change (bigger)', 'Clock: any minute', 'How long will it take?'],
};

export type Kind = 'coin' | 'coinmore' | 'money' | 'clock' | 'change' | 'duration' | 'add' | 'add3' | 'subtract' | 'multiply' | 'divide' | 'missing' | 'compare' | 'extreme' | 'count' | 'onemore' | 'more' | 'odd' | 'frame';

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
  if (prompt === 'What is this coin called?') return 'coin';
  if (prompt === 'Which coin is worth more?') return 'coinmore';
  if (prompt === 'How much money is this?') return 'money';
  if (prompt === 'What time is it?') return 'clock';
  if (/^You pay \$\d+ for something that costs \$\d+(\.\d\d)?\. How much change do you get\?$/.test(prompt)) return 'change';
  if (/^A film starts at \d+:\d\d and lasts \d+ minutes\. When does it end\?$/.test(prompt)) return 'duration';
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
  coins: { text: string; width: number }[]; // coins drawn (the words written on each coin, and its drawn width)
  price: string | null; // the price tag drawn next to the notes ("$1.05"), if shown
  clock: { hourAngle: number; minuteAngle: number; hourLen: number; minuteLen: number } | null; // hands of the clock face, from the drawing
  artLabel: string;
  msg: string;
}

/** The mid-set stretch break (draft of 17 Nov): a screen between questions with "I am ready" and "Skip the break". Helpers walk through it
 *  so the question tests do not see it; maths-draft.spec.ts has its own test for the break. */
export async function passStretchBreak(page: Page): Promise<boolean> {
  if (!(await page.locator('#q').innerText()).trim().startsWith('Stretch break!')) return false;
  await page.locator('#opts button', { hasText: 'I am ready' }).click();
  await page.clock.runFor(1700);
  return true;
}

export async function snapshot(page: Page): Promise<Snapshot> {
  await passStretchBreak(page);
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
      coins: [...art.querySelectorAll('.money svg')].filter((v) => !(v.getAttribute('aria-label') ?? '').startsWith('Price ')).map((v) => ({ text: [...v.querySelectorAll('text')].map((t) => t.textContent!.trim()).join(' '), width: +(v.getAttribute('width') ?? 0) })),
      price: (() => { const v = [...art.querySelectorAll('.money svg')].find((x) => (x.getAttribute('aria-label') ?? '').startsWith('Price ')); return v ? [...v.querySelectorAll('text')].map((t) => t.textContent!.trim()).join(' ') : null; })(),
      clock: (() => {
        const hands = [...art.querySelectorAll('.clockbox svg line')].filter((l) => l.getAttribute('x1') === '80' && l.getAttribute('y1') === '80');
        if (hands.length !== 2) return null;
        const f = (l: Element) => { const dx = +l.getAttribute('x2')! - 80, dy = 80 - +l.getAttribute('y2')!; return { a: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360, len: Math.hypot(dx, dy) }; };
        const [p, q] = hands.map(f);
        const [hour, minute] = p.len < q.len ? [p, q] : [q, p];
        return { hourAngle: hour.a, minuteAngle: minute.a, hourLen: hour.len, minuteLen: minute.len };
      })(),
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

/** Coin name and value from the words written on the drawn coin (not from the page's own label). */
export function coinFromText(text: string): { name: string; cents: number } | null {
  const note = text.match(/^\$(\d+) .*PLAY MONEY$/);
  if (note) return { name: `$${note[1]}`, cents: +note[1] * 100 };
  if (text === 'ONE CENT') return { name: 'penny', cents: 1 };
  if (text === 'FIVE CENTS') return { name: 'nickel', cents: 5 };
  if (text === 'ONE DIME') return { name: 'dime', cents: 10 };
  if (text === 'QUARTER DOLLAR') return { name: 'quarter', cents: 25 };
  return null;
}
/** An amount of money in cents, written the way the page offers it: 65¢ below a dollar, $4 or $3.95 from a dollar up. */
export function pickMoneyText(cents: number, options: string[]): string {
  const forms = [`${cents}¢`, `$${(cents / 100).toFixed(2)}`, `$${cents / 100}`];
  return forms.find((f) => options.includes(f)) ?? forms[cents < 100 ? 0 : 1];
}
export const COIN_VALUE: Record<string, number> = { penny: 1, nickel: 5, dime: 10, quarter: 25 };

/** The time shown by the hands of a clock face, worked out from the angles. Null if the hands do not agree with each other. */
export function timeFromHands(c: { hourAngle: number; minuteAngle: number }): { h: number; m: number; hourHandOff: number } {
  const m = Math.round(c.minuteAngle / 6) % 60;
  const hoursFloat = c.hourAngle / 30; // 0..12
  const h = Math.round(hoursFloat - m / 60 + 12) % 12 || 12;
  // how far the hour hand is from where it should be for h:m (it moves half a degree a minute)
  const expected = ((h % 12) * 30 + m / 2) % 360;
  const off = Math.abs(((c.hourAngle - expected + 540) % 360) - 180);
  return { h, m, hourHandOff: off };
}
export const fmtTime = (t: { h: number; m: number }) => `${t.h}:${String(t.m).padStart(2, '0')}`;

/** What the right tap is, from what is drawn. */
export function rightAnswer(s: Snapshot): { text?: string; card?: number; pick?: number; cells?: number } {
  switch (s.kind) {
    case 'count': return { text: String(s.groups[0]) };
    case 'onemore': return { text: String(s.groups[0] + 1) };
    case 'more': return { card: s.cards[0].n > s.cards[1].n ? 0 : 1 };
    case 'frame': return { cells: +s.prompt.match(/\d+/)![0] };
    case 'coin': return { text: coinFromText(s.coins[0].text)!.name };
    case 'coinmore': { const names = s.coins.map((c) => coinFromText(c.text)!.name); return { text: names.reduce((a, b) => (COIN_VALUE[a] >= COIN_VALUE[b] ? a : b)) }; }
    case 'money': return { text: pickMoneyText(s.coins.reduce((sum, c) => sum + coinFromText(c.text)!.cents, 0), s.options) };
    case 'change': { const paid = coinFromText(s.coins[0].text)!.cents; const price = Math.round(parseFloat(s.price!.replace('$', '')) * 100); return { text: pickMoneyText(paid - price, s.options) }; }
    case 'duration': { const m = s.prompt.match(/starts at (\d+):(\d\d) and lasts (\d+) minutes/)!; const t = ((+m[1] % 12) * 60 + +m[2] + +m[3]) % 720; return { text: `${Math.floor(t / 60) || 12}:${String(t % 60).padStart(2, '0')}` }; }
    case 'clock': return { text: fmtTime(timeFromHands(s.clock!)) };
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
  if (title === 'Coins: penny, nickel, dime, quarter') { if (!['coin', 'coinmore'].includes(s.kind)) bad('expected a coin-name or which-coin-is-worth-more question'); return out; }
  if (title === 'Counting coins') { if (s.kind !== 'money') bad('expected a how-much-money question'); else if (s.coins.some((c) => !c.text.match(/CENT|DIME|QUARTER/))) bad('a note in a coin chapter'); return out; }
  if (/^Dollar notes: |^Dollars and cents: notes$/.test(title)) {
    const allowed = title.startsWith('Dollar notes') ? [1, 5, 10] : [1, 5, 10, 20];
    if (s.kind !== 'money') bad('expected a how-much-money question');
    else if (s.coins.some((c) => { const n = coinFromText(c.text); return !n || !n.name.startsWith('$') || !allowed.includes(n.cents / 100); })) bad(`a note outside $${allowed.join(', $')}: ${JSON.stringify(s.coins.map((c) => c.text))}`);
    return out;
  }
  if (/^Making change/.test(title)) { if (s.kind !== 'change') bad('expected a change question'); return out; }
  if (title === 'How long will it take?') { if (s.kind !== 'duration') bad('expected a how-long question'); return out; }
  if (title === 'Counting pennies and dimes') {
    if (s.kind !== 'money') bad('expected a how-much-money question');
    else if (s.coins.some((c) => !['ONE CENT', 'ONE DIME'].includes(c.text))) bad(`a coin other than a penny or dime: ${JSON.stringify(s.coins.map((c) => c.text))}`);
    return out;
  }
  if (/^Clock: /.test(title)) {
    if (s.kind !== 'clock') bad('expected a what-time-is-it question');
    else if (s.clock) {
      const t = timeFromHands(s.clock);
      const ok = title === "Clock: o'clock" ? t.m === 0 : title === 'Clock: half past' ? t.m === 0 || t.m === 30 : title === 'Clock: quarter past and quarter to' ? t.m % 15 === 0 : title === 'Clock: five minutes at a time' ? t.m % 5 === 0 : true;
      if (!ok) bad(`the clock shows ${fmtTime(t)}, outside what this chapter teaches`);
    }
    return out;
  }
  if (s.kind === 'frame' || ['count', 'onemore', 'more', 'odd', 'coin', 'coinmore', 'money', 'clock'].includes(s.kind)) { bad('a picture question in a number chapter'); return out; }
  const nums = (s.prompt.match(/\d+/g) ?? []).map(Number);
  const need = (k: Kind) => { if (s.kind !== k) bad(`expected a ${k} question`); };
  let m: RegExpMatchArray | null;
  if ((m = title.match(/^Adding up to (\d+)$/))) { need('add'); if (s.kind === 'add' && nums[0] + nums[1] > +m[1]) bad(`the sum is above ${m[1]}`); }
  else if ((m = title.match(/^Taking away within (\d+)$/))) { need('subtract'); if (s.kind === 'subtract' && nums[0] > +m[1]) bad(`starts above ${m[1]}`); }
  else if (title === 'Seeing 5 and 10 in blocks') { need('missing'); if (s.kind === 'missing' && ![5, 10].includes(nums[1])) bad('the total is not 5 or 10'); }
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
  const special = ['coin', 'coinmore', 'money', 'clock', 'change', 'duration'].includes(s.kind);
  const numeric = !['count', 'onemore', 'more', 'odd', 'frame'].includes(s.kind) && !special;
  const nums = (s.prompt.match(/\d+/g) ?? []).map(Number);
  if (allowed && !allowed.includes(s.kind)) bad(`kind ${s.kind} is not planned here`);

  if (s.kind === 'more' || s.kind === 'odd' || s.kind === 'frame') {
    if (s.options.length) bad(`has answer buttons ${JSON.stringify(s.options)} as well as the tappable picture`);
  } else if (['coin', 'coinmore', 'money', 'clock', 'change', 'duration'].includes(s.kind)) {
    // money and clock questions have their own option rules (below)
  } else {
    if (s.options.length !== 4) bad(`has ${s.options.length} choices, expected 4: ${JSON.stringify(s.options)}`);
    if (new Set(s.options).size !== s.options.length) bad(`has repeated choices ${JSON.stringify(s.options)}`);
    if (!s.options.every((o) => /^\d+$/.test(o))) bad(`has a choice that is not a whole number ${JSON.stringify(s.options)}`);
  }

  if (special) {
    if (new Set(s.options).size !== s.options.length) bad(`has repeated choices ${JSON.stringify(s.options)}`);
    if (s.options.length < 2) bad(`has fewer than 2 choices ${JSON.stringify(s.options)}`);
    if (s.kind === 'coin' || s.kind === 'coinmore' || s.kind === 'money' || s.kind === 'change') {
      const known = s.coins.map((c) => coinFromText(c.text));
      if (known.some((c) => !c)) bad(`a coin has unknown words on it: ${JSON.stringify(s.coins.map((c) => c.text))}`);
      else {
        // real coins: dime smallest, then penny, nickel, quarter (the drawn sizes should keep that order)
        const size = (n: string) => s.coins.find((c) => coinFromText(c.text)!.name === n)?.width;
        const order = ['dime', 'penny', 'nickel', 'quarter'].map(size).filter((w) => w !== undefined) as number[];
        if (order.some((w, i) => i > 0 && w <= order[i - 1])) bad(`coin sizes are not in real-life order (dime < penny < nickel < quarter): ${JSON.stringify(s.coins)}`);
        const names = known.map((c) => c!.name);
        if (s.artLabel === '') bad('the coins have no description for a screen reader');
        const label = s.artLabel;
        if (s.kind === 'coin') {
          if (s.coins.length !== 1) bad(`expected one coin, found ${s.coins.length}`);
          if (JSON.stringify([...s.options].sort()) !== JSON.stringify(['dime', 'nickel', 'penny', 'quarter'])) bad(`choices should be the four coin names, got ${JSON.stringify(s.options)}`);
          if (label !== `A coin worth ${known[0]!.cents}¢`) bad(`the description "${label}" does not match the coin drawn (${known[0]!.cents}¢)`);
        } else if (s.kind === 'coinmore') {
          if (s.coins.length !== 2) bad(`expected two coins, found ${s.coins.length}`);
          if (new Set(names).size !== 2) bad(`both coins are the same: ${names}`);
          if (JSON.stringify([...s.options].sort()) !== JSON.stringify([...names].sort())) bad(`choices ${JSON.stringify(s.options)} are not the two coins drawn ${JSON.stringify(names)}`);
        } else if (s.kind === 'money') {
          const total = known.reduce((a, c) => a + c!.cents, 0);
          const notes = names.filter((n) => n.startsWith('$')).length;
          if (notes !== 0 && notes !== names.length) bad(`coins and notes are mixed: ${names}`);
          if (s.coins.length < 2 || s.coins.length > 8) bad(`${s.coins.length} items is outside 2 to 8`);
          const want = pickMoneyText(total, s.options);
          if (!s.options.includes(want)) bad(`the total (${want}) is not among the choices ${JSON.stringify(s.options)}`);
          if (s.options.length !== 4) bad(`expected 4 choices, found ${JSON.stringify(s.options)}`);
          if (!s.options.every((o) => /^(\d+¢|\$\d+(\.\d\d)?)$/.test(o))) bad(`a choice is not written as N¢ or $N: ${JSON.stringify(s.options)}`);
          if (label !== `${notes ? 'Notes' : 'Coins'}: ${names.join(', ')}`) bad(`the description "${label}" does not match what is drawn (${names.join(', ')})`);
        } else {
          // change: one note and a price tag
          if (s.coins.length !== 1 || !names[0].startsWith('$')) bad(`expected one play note, found ${JSON.stringify(names)}`);
          else if (!s.price) bad('no price tag is drawn');
          else {
            const paid = known[0]!.cents, price = Math.round(parseFloat(s.price.replace('$', '')) * 100);
            const m = s.prompt.match(/^You pay \$(\d+) for something that costs \$(\d+(?:\.\d\d)?)\./)!;
            if (+m[1] * 100 !== paid) bad(`the words say you pay $${m[1]} but the note drawn is ${names[0]}`);
            if (Math.round(parseFloat(m[2]) * 100) !== price) bad(`the words say it costs $${m[2]} but the price tag shows ${s.price}`);
            if (price >= paid) bad(`the price ${s.price} is not less than what is paid (${names[0]})`);
            if (label !== `Price tag ${s.price}, paying with ${names[0]}`) bad(`the description "${label}" does not match the picture (${s.price}, ${names[0]})`);
            const want = pickMoneyText(paid - price, s.options);
            if (!s.options.includes(want)) bad(`the change (${want}) is not among the choices ${JSON.stringify(s.options)}`);
            if (s.options.length !== 4) bad(`expected 4 choices, found ${JSON.stringify(s.options)}`);
            if (!s.options.every((o) => /^(\d+¢|\$\d+(\.\d\d)?)$/.test(o))) bad(`a choice is not written as N¢ or $N.NN: ${JSON.stringify(s.options)}`);
            if (s.options.some((o) => o !== want && pickMoneyText(paid - price, [o]) === o && false)) bad('unreachable');
          }
        }
      }
    }
    if (s.kind === 'duration') {
      const m = s.prompt.match(/starts at (\d+):(\d\d) and lasts (\d+) minutes/)!;
      const want = rightAnswer(s).text!;
      if (!s.options.includes(want)) bad(`the end time ${want} is not among the choices ${JSON.stringify(s.options)}`);
      if (s.options.length !== 4) bad(`expected 4 choices, found ${JSON.stringify(s.options)}`);
      if (!s.options.every((o) => /^(1[0-2]|[1-9]):[0-5]\d$/.test(o))) bad(`a choice is not a clock time: ${JSON.stringify(s.options)}`);
      if (!s.clock) bad('no clock is drawn for the start time');
      else if (fmtTime(timeFromHands(s.clock)) !== `${+m[1]}:${m[2]}`) bad(`the clock shows ${fmtTime(timeFromHands(s.clock))} but the words say the film starts at ${m[1]}:${m[2]}`);
      if (s.artLabel !== `Clock showing ${+m[1]}:${m[2]}`) bad(`the description "${s.artLabel}" does not match the start time ${m[1]}:${m[2]}`);
    }
    if (s.kind === 'clock') {
      if (!s.clock) bad('no clock hands found in the picture');
      else {
        const t = timeFromHands(s.clock);
        if (s.clock.hourLen >= s.clock.minuteLen - 5) bad(`the hour hand (${s.clock.hourLen.toFixed(0)}) is not clearly shorter than the minute hand (${s.clock.minuteLen.toFixed(0)})`);
        if (t.hourHandOff > 3) bad(`the hour hand is ${t.hourHandOff.toFixed(1)} degrees away from where it should be at ${fmtTime(t)}`);
        if (Math.abs(s.clock.minuteAngle - Math.round(s.clock.minuteAngle / 6) * 6) > 1.5) bad(`the minute hand is not on a minute mark (${s.clock.minuteAngle.toFixed(1)} degrees)`);
        if (s.artLabel !== `Clock face showing ${fmtTime(t)}`) bad(`the description "${s.artLabel}" does not match the hands (${fmtTime(t)})`);
        if (!s.options.includes(fmtTime(t))) bad(`the time ${fmtTime(t)} is not among the choices ${JSON.stringify(s.options)}`);
        if (s.options.length !== 4) bad(`expected 4 choices, found ${JSON.stringify(s.options)}`);
        if (!s.options.every((o) => /^(1[0-2]|[1-9]):[0-5]\d$/.test(o))) bad(`a choice is not a clock time: ${JSON.stringify(s.options)}`);
      }
    }
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
    await passStretchBreak(page); // the break between questions also uses the "endbtns" row, so it must be walked through first
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
      blocks: [...art.querySelectorAll('.blocks')].map((b) => [...b.querySelectorAll('.blk')].map((k) => (k.classList.contains('ba') ? 'a' : k.classList.contains('bb') ? 'b' : k.classList.contains('bx') ? 'x' : '.')).join('')),
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
  // Block patterns (draft of 16 Nov): two columns of five blocks, filled column by column. The counts are checked against the
  // numbers written in the step, and the filled blocks must come first (no gaps) so the columns of 5 read correctly.
  for (const b of info.blocks) {
    const a = (b.match(/a/g) ?? []).length, c = (b.match(/b/g) ?? []).length;
    if (b.length !== 10) out.push(`"${say}": the block picture has ${b.length} blocks, not 10 (two columns of 5)`);
    if (!/^a*b*[.x]*$/.test(b)) out.push(`"${say}": filled blocks are not together at the start: ${b}`);
    if ((m = say.match(/(\d+) filled, and (\d+) more to fill/)) && (a !== +m[1] || c !== +m[2])) out.push(`"${say}": blocks show ${a} filled and ${c} more, expected ${m[1]} and ${m[2]}`);
    if ((m = say.match(/(\d+) \+ (\d+) = (\d+):$/)) && (a !== +m[1] || c !== +m[2])) out.push(`"${say}": blocks show ${a} + ${c}, expected ${m[1]} + ${m[2]}`);
    if ((m = say.match(/Take away (\d+), and (\d+) are left/)) && a + c !== +m[2]) out.push(`"${say}": blocks show ${a + c} left, expected ${m[2]}`);
  }
  return out;
}
