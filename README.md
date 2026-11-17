# yaanstep-tests

Automated tests for Yaanstep, written with Playwright and TypeScript. This project is separate from the website and the apps (Manish's decision, 14 Nov 2026).

**Owner:** the QA chat. Priya Raman (QA Automation Engineer, AI) writes and maintains the tests. Marcus Chen (QA Lead, AI) decides what the release gate needs. Since 15 Nov 2026 other chats do not change tests here; they ask QA on the Status Board.

A green run is **not** a release sign-off. Sign-off is Marcus's comment in Jira, after the review rule is met. Publishing is Manish's decision each time.

## Run it

```
npm install
SITE_DIR=../yaanstep-website npm test      # test a folder with the website files
BASE_URL=https://yaanstep.com npm test     # test a real address
npm run summary                            # short summary of the last run
npm run test:report                        # open the full HTML report
```

`SITE_PROFILE` says which site the tests expect (see `tests/support/site.ts`):

| Value | Meaning |
| --- | --- |
| `live` (default) | The site as published on main of `smanish83/yaanstep-website`: 11 pages, 8-item menu, no themes. |
| `next` | The build waiting to be published: shared menu, Products page, four themes. QA has not seen this build yet, so its expectations are looser. |

When the new build is published, copy the `next` values into `live` in the same change and delete `next`.

## What is tested (website)

| File | What it checks |
| --- | --- |
| `tests/website/pages.spec.ts` | Every page: loads, title and description, one h1, landmarks, no script errors, exact shared menu with the current page marked, skip link, no sideways scroll (device width and 320 px), no requests to other sites, nothing sent, nothing stored (cookies, localStorage, sessionStorage, IndexedDB, caches, service workers), axe scan for WCAG 2.2 A and AA. |
| `tests/website/links.spec.ts` | Every link, picture, style sheet and script resolves; links that leave the site must be on an allowed list; every page can be reached. |
| `tests/website/content.spec.ts` | Company rules: banned claims, no price amounts, no unapproved product name, advisors never called psychologists, footer statements, no data-collecting forms, legal pages marked as drafts, team cards labeled AI, How it works examples from the approved list. |
| `tests/website/no-javascript.spec.ts` | Every page works with JavaScript off, with the fallback tables in place of the interactive parts. |
| `tests/website/try-it.spec.ts` | Try it demo: every step is an approved step word for word (doc 05, doc 11), the 10 second countdown with a controlled clock, Not now, keyboard, focus, no shame wording, nothing stored or sent. |
| `tests/website/time-calculator.spec.ts` | Time calculator: hand-worked numbers, bad input, keyboard, labels, nothing stored or sent. |
| `tests/website/learning.spec.ts` | Learning page: 18,000 generated story questions and 18,000 number cards checked against an answer worked out separately; both games played to the end by tap, keyboard and mouse drag; all five maths styles; mistake hints in order (words, then dots); lesson steps; Keep going; game mode and Exit; focus and screen-reader hooks; layout and axe scan in every game view; nothing stored or sent. |
| `tests/website/themes.spec.ts` | Theme switcher (only with `SITE_PROFILE=next`). |

Screen sizes: desktop (1280 px), phone (Pixel 7 size), and tablet (820 px) for layout and the Learning games.

| `tests/website/maths-draft.spec.ts` | Hidden maths draft (`/maths-draft.html`, not linked, not public): menu, chapter list, every lesson (sums written in it are true, pictures agree with the words, Back/Next/Skip), chapter of ten and the 8-of-10 pass rule, wrong-answer hints, points, streak by day, ten-frame, number-line hop, storage, Reset, keyboard, screen-reader hooks, layout and axe scan in six screens, and that "Hear it" speaks words not symbols. |
| `tests/website/maths-draft-sweep.spec.ts` | The same page over thousands of random puzzles (seeded, so a failure can be replayed): every chapter 12 times, free play 120 questions per age, 1 000 "Which is bigger" questions (both numbers offered), 500 odd-one-out questions (3 to 5 tappable shapes). Each answer is worked out by the test from the words and pictures on screen. |
| `tests/website/reading-draft.spec.ts` | Hidden reading draft (`/reading-draft.html`, mode A, not linked, not public): hidden-page rules, the four steps, every letter, picture word, blend word and common word against the content list in doc 18 (what is shown and exactly what is spoken, using a recorded speech stub), calm rules (no score, wrong-answer or timer wording), break screen, speed and break-length settings, English on-device voices only, storage limited to parent settings, keyboard, 44 px targets, 320 px layout and axe scan. |

Run the reading draft only: `SITE_DIR=../yaanstep-website npm run test:reading` (about 1 minute).

Run the maths draft only: `SITE_DIR=../yaanstep-website npm run test:maths` (about 8 minutes) or `npm run test:maths:quick` (about 2 minutes, no sweeps). On Windows PowerShell: `$env:SITE_DIR="../yaanstep-website"; npm run test:maths`. Then `npm run summary`.

## Known bugs

`tests/support/known-bugs.ts` lists open Jira bugs that a test catches. Those tests show as expected failures, so a new failure stands out. When a bug is fixed, its test reports "now passing": remove the entry and close the Jira bug. Nothing goes in that list without a Jira bug, and a High bug blocks a release even though the run shows it as expected.

## Do the tests have teeth?

On 15 Nov 2026 the site was broken on purpose in nine ways, in throwaway copies (a wrong maths answer, a wrong answer check, a cookie, a picture from another site, a broken link, a changed step, a wrong constant in the calculator, a localStorage write, a price and a banned claim). Every break was caught. Repeat this check when a test file changes a lot.

## NOT covered (be honest)

- Chrome only. No Safari, no Firefox, no real iPhone or Android phone.
- No real screen reader. The tests check the hooks a screen reader uses (labels, roles, live regions, focus), not what it actually says.
- No real finger on a touch screen. Drag and drop is tested with a mouse on desktop only.
- No real child or parent. The tests check that the sums are right and the games work, not that a lesson suits a child of that age. That is the advisors' review.
- The short "needs JavaScript" notices inside `<noscript>` cannot be checked by this tool.
- The real address and HTTPS are only tested when `BASE_URL` is set and the address is reachable from where the tests run.
- The habit web app (`yaanstep-app`) and the Sprouts puzzle engine are not covered here yet.

These gaps are covered by manual test cases for Manish's own devices (SCRUM-388).

## Adding or changing a test

1. One behavior per test, with a title a non-developer can read.
2. Work the expected result out separately from the page's own code (by hand, or from an approved document). Do not copy the page's formula into the test.
3. Put selectors and helpers in `tests/support`, not in the test.
4. A test that finds a real bug stays failing until there is a Jira bug; then list it in `known-bugs.ts`.
5. `npm run typecheck` and a full run before pushing. No retries: a test that passes only on a second try is a finding.

## Project guide
What each Yaanstep project covers, how to run it and which documents it needs: see `docs/projects/` in the private repo `smanish83/yaanstep-app`.
