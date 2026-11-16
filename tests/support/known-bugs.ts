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
  {
    jira: 'SCRUM-456', profile: 'both', title: /chapter "Bigger or smaller" stays within 20/,
    note: 'maths draft: ages 5-6 Bigger or smaller can ask 20 or 21 (equal numbers get +1)',
  },
  {
    jira: 'SCRUM-469', profile: 'next', title: /the footer says the app is 13 and up and these lessons are for a parent and child together/,
    note: 'the shared footer dropped the Learning page line "for a parent and child to use together"',
  },
  {
    jira: 'SCRUM-418', profile: 'live', title: /^page [\w-]+ › accessibility scan/,
    note: 'footer links have contrast 4.34:1 (AA needs 4.5:1) on every page; fix exists but is not published',
  },
  {
    jira: 'SCRUM-419', profile: 'both', title: /dice: "Up to 10" keeps every answer at 10 or below|dice: "Taking away" asks a taking-away question/,
    note: 'the dice game ignores the "Up to 10" and "Taking away" choices',
  },
  {
    jira: 'SCRUM-420', profile: 'both', title: /How it works: example steps are approved steps/,
    note: 'the How it works examples are not from the approved Tiny-Step Library (doc 05)',
  },
  {
    jira: 'SCRUM-453', profile: 'both', title: /Reset after confirming clears points, streak AND the chapters done/,
    note: 'maths draft: Reset clears points and streak but not the chapters already finished (key demo-ch)',
  },
  {
    jira: 'SCRUM-454', profile: 'both', title: /maths draft: (lesson|number question|picture question|end screen) view fits the screen and passes the accessibility scan/,
    note: 'maths draft: the Hear it button is named "Read it to me" but shows "Hear it" (WCAG 2.5.3 label in name)',
  },
  {
    jira: 'SCRUM-455', profile: 'both', title: /screen reader hooks: progress and messages are live regions/,
    note: 'maths draft: Chapters and Skip the lesson buttons are 40 px high, below the 48 px rule',
  },
  {
    jira: 'SCRUM-449', profile: 'both', title: /"Hear it" speaks words, not symbols/,
    note: 'maths-draft.html sends the written symbols to the voice, so "12 - 4" is read as "12 by 4"',
  },
  {
    jira: 'SCRUM-446', profile: 'both', title: /maths draft: has an icon link like the other pages/,
    note: 'maths-draft.html has no icon link (browsers ask for /favicon.ico and get a 404)',
  },
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
