# yaanstep-tests

Playwright + TypeScript test automation for Yaanstep (separate from the site and the apps).

Run: `npm install`, then `SITE_DIR=../yaanstep-website npx playwright test` (local site folder) or `BASE_URL=https://yaanstep.com npx playwright test` (live site). HTML report: `npm run test:report`.

Covers: page load, shared menu, layout fit, no trackers or cookies, accessibility (axe, WCAG 2.1 A/AA, all four themes), banned privacy claims, legal draft labels, Try it, Time calculator, Learning page.

Not covered: Safari, Firefox, real screen reader, real touch, real children. Test report: project doc "13 Test Report - Website Automation v1". This suite is not a release sign-off; Marcus (QA Lead, AI) owns the gate.
