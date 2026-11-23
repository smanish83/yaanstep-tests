/**
 * One place that says what the website under test is expected to look like.
 *
 * One profile: the site as published on main of smanish83/yaanstep-website (shared menu, products on the home page,
 * four themes). The old "next" profile became "live" when website v2 went out (22 Nov 2026, SCRUM-481).
 * Add a second profile again only while a build that changes these values waits to be published.
 * Owner: QA (Priya Raman, QA Automation Engineer, AI). Gate: Marcus Chen (QA Lead, AI).
 */
export interface MenuItem { label: string; href: string }
export interface SiteProfile {
  name: 'live';
  pages: string[];
  menu: MenuItem[];
  /** true: the menu must be exactly these items in this order. false: these items must all be present. */
  exactMenu: boolean;
  themes: string[];
  /** Browser storage keys the site is allowed to set (approved by Manish, SCRUM-401). Everything else is a failure. */
  allowedStorageKeys: string[];
}

const live: SiteProfile = {
  name: 'live',
  pages: ['index', 'how-it-works', 'team', 'testers', 'try-it', 'time-calculator', 'sprouts', 'pricing', 'privacy', 'terms', 'accessibility', 'teens'],
  menu: [
    { label: 'Home', href: 'index.html' },
    { label: 'How it works', href: 'how-it-works.html' },
    { label: 'Team', href: 'team.html' },
    { label: 'Join the testers', href: 'testers.html' },
  ],
  exactMenu: true,
  themes: ['', 'sunrise', 'midnight', 'bloom'],
  allowedStorageKeys: ['yaanstep-theme'],
};

export const site: SiteProfile = live;
export const url = (page: string) => `/${page}.html`;
