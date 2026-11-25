// Merges reports/coverage-raw/*.json (written when tests run with COVERAGE=1) into reports/coverage/.
// Three numbers: (1) JavaScript and CSS the tests actually ran (bytes), per file and overall, (2) pages visited by
// tests out of the pages the site has, (3) open Jira stories that no test mentions (see scripts/traceability.mjs).
// Honest limit: this is "code that ran during tests" (Chrome's own measure), not proof that it was checked.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const RAW = 'reports/coverage-raw', OUT = 'reports/coverage';
const siteDir = process.env.SITE_DIR ?? '../yaanstep-website';
if (!existsSync(RAW)) { console.error('No coverage records. Run: COVERAGE=1 npx playwright test --project=desktop   (then npm run coverage)'); process.exit(1); }

const files = new Map(); // key -> {kind,url,length,mask}
const visited = new Set();
for (const f of readdirSync(RAW).filter((n) => n.endsWith('.json'))) {
  const r = JSON.parse(readFileSync(`${RAW}/${f}`, 'utf8'));
  r.visited.forEach((v) => visited.add(v));
  for (const e of r.files) {
    let m = files.get(e.key);
    if (!m) files.set(e.key, (m = { kind: e.kind, url: e.url, length: e.length, mask: new Uint8Array(e.length) }));
    for (const [a, b] of e.used) m.mask.fill(1, a, Math.min(b, m.length));
  }
}
const rows = [...files.values()].map((m) => ({ kind: m.kind, url: m.url, total: m.length, used: m.mask.reduce((a, b) => a + b, 0) }));
// the same file can show up as several scripts (inline scripts on one page): add them up per url and kind
const byFile = new Map();
for (const r of rows) { const k = `${r.kind} ${r.url}`; const x = byFile.get(k) ?? { kind: r.kind, url: r.url, total: 0, used: 0 }; x.total += r.total; x.used += r.used; byFile.set(k, x); }
const list = [...byFile.values()].sort((a, b) => a.url.localeCompare(b.url));
const pct = (u, t) => (t ? (100 * u / t).toFixed(1) : '0.0');
const sum = (k) => list.filter((r) => !k || r.kind === k).reduce((a, r) => ({ u: a.u + r.used, t: a.t + r.total }), { u: 0, t: 0 });

const pages = existsSync(siteDir) ? readdirSync(siteDir).filter((f) => f.endsWith('.html')) : [];
const pageUrls = new Set([...visited].map((v) => (v === '/' ? '/index.html' : v)));
const untested = pages.filter((p) => !pageUrls.has(`/${p}`));

const js = sum('js'), css = sum('css'), all = sum();
let md = `# Test coverage (generated ${new Date().toISOString().slice(0, 10)})\n\n`;
md += `| Measure | Result |\n|---|---|\n`;
md += `| JavaScript that ran during tests | ${pct(js.u, js.t)}% (${js.u} of ${js.t} bytes) |\n`;
md += `| CSS that was applied during tests | ${pct(css.u, css.t)}% (${css.u} of ${css.t} bytes) |\n`;
md += `| All code | ${pct(all.u, all.t)}% |\n`;
if (pages.length) md += `| Pages visited by at least one test | ${pages.length - untested.length} of ${pages.length} (${pct(pages.length - untested.length, pages.length)}%) |\n`;
md += `\n## By file\n\n| File | Type | Ran | Size (bytes) |\n|---|---|---|---|\n`;
for (const r of list) md += `| ${r.url} | ${r.kind} | ${pct(r.used, r.total)}% | ${r.total} |\n`;
if (untested.length) md += `\n## Pages no test visited\n\n${untested.map((p) => `- ${p}`).join('\n')}\n`;
md += `\nLimit: Chrome only (desktop and phone projects). "Ran" means the code executed while a test was running, not that a check looked at the result.\n`;
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/summary.md`, md);
writeFileSync(`${OUT}/coverage.json`, JSON.stringify({ js, css, all, files: list, pagesVisited: [...visited].sort(), pagesNotVisited: untested }, null, 2));
console.log(md.split('\n## By file')[0]);
console.log(`Full table: ${OUT}/summary.md`);
if (untested.length) console.log(`Pages no test visited: ${untested.join(', ')}`);
