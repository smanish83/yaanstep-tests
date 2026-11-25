// Which Jira stories have tests? Scans tests/ for SCRUM-nnn keys and compares them with scripts/stories.json
// (the stories QA is responsible for testing, with the reason when no automated test is possible yet).
// Usage: npm run traceability
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []; });
const mentions = new Map();
for (const f of walk('tests')) for (const m of readFileSync(f, 'utf8').matchAll(/SCRUM-(\d+)/g)) { const k = `SCRUM-${m[1]}`; mentions.set(k, (mentions.get(k) ?? new Set()).add(f.replace('tests/', ''))); }
const stories = JSON.parse(readFileSync('scripts/stories.json', 'utf8'));
let md = `# Story to test traceability (generated ${new Date().toISOString().slice(0, 10)})\n\n| Story | Summary | Automated tests | Note |\n|---|---|---|---|\n`;
let covered = 0, gaps = [];
for (const s of stories) {
  const t = mentions.get(s.key);
  if (t) covered++; else if (s.automatable) gaps.push(s.key);
  md += `| ${s.key} | ${s.summary} | ${t ? [...t].join(', ') : '**none**'} | ${s.note ?? ''} |\n`;
}
const auto = stories.filter((s) => s.automatable).length;
md += `\n${covered} of ${stories.length} listed stories are named in at least one test. ${gaps.length} automatable stories have no test: ${gaps.join(', ') || 'none'}.\n`;
mkdirSync('reports/coverage', { recursive: true });
writeFileSync('reports/coverage/traceability.md', md);
console.log(md.split('\n').slice(-3).join('\n'));
console.log('Table: reports/coverage/traceability.md');
if (gaps.length && process.argv.includes('--strict')) process.exit(1);
