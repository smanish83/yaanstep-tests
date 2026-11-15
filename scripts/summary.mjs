// Prints a short, honest summary of the last run from reports/results.json:
// passed, failed, known bugs (expected failures, with their Jira keys), fixed-but-still-listed, skipped.
// Usage: npm run summary   (after npm test)
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'reports/results.json';
const report = JSON.parse(readFileSync(file, 'utf8'));
const rows = [];
(function walk(suite, path) {
  for (const spec of suite.specs ?? []) for (const t of spec.tests) {
    const last = t.results[t.results.length - 1] ?? {};
    const bug = (t.annotations ?? []).find((a) => a.type === 'known bug');
    rows.push({ project: t.projectName, title: [...path, spec.title].join(' › '), outcome: t.status, result: last.status, bug: bug?.description });
  }
  for (const child of suite.suites ?? []) walk(child, child.file === child.title ? path : [...path, child.title]);
})({ suites: report.suites }, []);

const passed = rows.filter((r) => r.outcome === 'expected' && r.result === 'passed');
const known = rows.filter((r) => r.outcome === 'expected' && r.result === 'failed');
const fixed = rows.filter((r) => r.outcome === 'unexpected' && r.result === 'passed');
const failed = rows.filter((r) => r.outcome === 'unexpected' && r.result !== 'passed');
const flaky = rows.filter((r) => r.outcome === 'flaky');
const skipped = rows.filter((r) => r.outcome === 'skipped');

const byProject = (list) => Object.entries(list.reduce((m, r) => ({ ...m, [r.project]: (m[r.project] ?? 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(', ');
console.log(`Checks run: ${rows.length - skipped.length}  (${byProject(rows.filter((r) => r.outcome !== 'skipped'))})`);
console.log(`Passed: ${passed.length}`);
console.log(`Failed (new, needs triage): ${failed.length}`);
console.log(`Known bugs still open (expected failures): ${known.length}`);
console.log(`Listed as a known bug but now passing (remove from known-bugs.ts, close the Jira bug): ${fixed.length}`);
console.log(`Passed only on a retry: ${flaky.length}`);
console.log(`Skipped: ${skipped.length}`);
const keys = {};
for (const r of known) { const k = (r.bug ?? 'no Jira key').split(':')[0]; keys[k] = (keys[k] ?? 0) + 1; }
for (const [k, n] of Object.entries(keys)) console.log(`  ${k}: ${n} checks`);
for (const r of failed) console.log(`  FAILED [${r.project}] ${r.title}`);
for (const r of fixed) console.log(`  NOW PASSING [${r.project}] ${r.title} (${r.bug ?? ''})`);
process.exitCode = failed.length || fixed.length ? 1 : 0;
