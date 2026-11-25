import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { site } from './site';

/** Folder of the website under test, when tests run from files (not BASE_URL). */
export const siteDir = process.env.BASE_URL ? undefined : (process.env.SITE_DIR ?? '../yaanstep-website');

/**
 * Every .html page the site has (found by looking in the folder), so a new page is picked up by the smoke and
 * accessibility suites without anyone remembering to add it. With BASE_URL (a real address) there is no folder,
 * so the list falls back to the pages named in the site profile.
 */
export function allPages(): string[] {
  if (siteDir && existsSync(siteDir)) {
    return readdirSync(siteDir).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')).sort();
  }
  return site.pages;
}

/** Hidden draft pages: not in the menu, tested as pages but not required to be in the sitemap. */
export const HIDDEN = ['maths-draft', 'reading-draft'];

/** The few pages a visitor meets first. Used by the limited visual suite. */
export const KEY_PAGES = ['index', 'products', 'learning', 'pricing', 'accessibility'];
