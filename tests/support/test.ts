/**
 * Use this instead of '@playwright/test' in spec files. It is the same `test`, plus one automatic step:
 * when COVERAGE=1 (Chrome only), it records which parts of the site's JavaScript and CSS ran, and which pages were
 * visited. `npm run coverage` merges the records into reports/coverage/. Without COVERAGE=1 it does nothing.
 */
import { test as base } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export * from '@playwright/test';

const ON = process.env.COVERAGE === '1';
const OUT = 'reports/coverage-raw';

type Range = [number, number];

function usedRanges(fns: { ranges: { startOffset: number; endOffset: number; count: number }[] }[], length: number): Range[] {
  // V8 lists a function's range first and the blocks inside it after, so later (inner) ranges override earlier ones.
  const used = new Uint8Array(length);
  for (const f of fns) for (const r of f.ranges) used.fill(r.count > 0 ? 1 : 0, Math.min(r.startOffset, length), Math.min(r.endOffset, length));
  const out: Range[] = [];
  let start = -1;
  for (let i = 0; i <= length; i++) {
    if (i < length && used[i]) { if (start < 0) start = i; }
    else if (start >= 0) { out.push([start, i]); start = -1; }
  }
  return out;
}

export const test = base.extend<{ _coverage: void }>({
  _coverage: [async ({ page, browserName, baseURL }, use, testInfo) => {
    if (!ON || browserName !== 'chromium') { await use(); return; }
    const visited = new Set<string>();
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) visited.add(new URL(f.url()).pathname); });
    await page.coverage.startJSCoverage({ resetOnNavigation: false }).catch(() => {});
    await page.coverage.startCSSCoverage({ resetOnNavigation: false }).catch(() => {});
    await use();
    const js = await page.coverage.stopJSCoverage().catch(() => []);
    const css = await page.coverage.stopCSSCoverage().catch(() => []);
    const mine = (u: string) => !!baseURL && u.startsWith(baseURL);
    const files = [
      ...js.filter((e) => mine(e.url) && e.source).map((e) => ({ kind: 'js', url: new URL(e.url).pathname, length: e.source!.length, key: `${e.url}#${e.source!.length}`, used: usedRanges(e.functions, e.source!.length) })),
      ...css.filter((e) => mine(e.url)).map((e) => ({ kind: 'css', url: new URL(e.url).pathname, length: (e.text ?? '').length, key: `${e.url}#${(e.text ?? '').length}`, used: e.ranges.map((r) => [r.start, r.end] as Range) })),
    ];
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/${randomUUID()}.json`, JSON.stringify({ project: testInfo.project.name, visited: [...visited], files }));
  }, { auto: true }],
});
