import { test } from '@playwright/test';
import { site } from './site';

/**
 * Open bugs that a test is known to catch.
 *
 * A test listed here is reported as an "expected failure" with the Jira key, so the run stays readable
 * and a NEW failure stands out. When the bug is fixed the test starts passing, Playwright then reports
 * it as "unexpectedly passed", and that is the signal to delete the entry here and close the Jira bug.
 *
 * Rule (Marcus): nothing goes in this list without a Jira bug. High bugs still block a release even
 * though the run shows them as expected.
 */
interface KnownBug { jira: string; profile: 'live' | 'next' | 'both'; title: RegExp; note: string }

export const KNOWN_BUGS: KnownBug[] = [
  // SCRUM-418 (footer link contrast) was fixed on main: footer links now use --teal-dark, 6.25:1. Removed 22 Nov 2026.
];

/** Call at the top of a test body. */
export function knownBug() {
  const title = test.info().titlePath.slice(1).join(' › ');
  for (const bug of KNOWN_BUGS) {
    if ((bug.profile === 'both' || bug.profile === site.name) && bug.title.test(title)) {
      test.info().annotations.push({ type: 'known bug', description: `${bug.jira}: ${bug.note}` });
      test.fail(true, `${bug.jira}: ${bug.note}`);
      return;
    }
  }
}
