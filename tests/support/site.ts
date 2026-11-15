/**
 * One place that says what the website under test is expected to look like.
 *
 * SITE_PROFILE=live (default): the site as it is on main of smanish83/yaanstep-website today.
 * SITE_PROFILE=next: the build that is waiting to be published (shared menu, Products page, four themes).
 *
 * When the "next" build is published, copy its values into "live" in the same change and delete "next".
 * Owner: QA (Priya Raman, QA Automation Engineer, AI). Gate: Marcus Chen (QA Lead, AI).
 */
export interface MenuItem { label: string; href: string }
export interface SiteProfile {
  name: 'live' | 'next';
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
  pages: ['index', 'how-it-works', 'try-it', 'time-calculator', 'learning', 'pricing', 'team', 'testers', 'privacy', 'terms', 'accessibility'],
  menu: [
    { label: 'Home', href: 'index.html' },
    { label: 'How it works', href: 'how-it-works.html' },
    { label: 'Try it', href: 'try-it.html' },
    { label: 'Time calculator', href: 'time-calculator.html' },
    { label: 'Learning', href: 'learning.html' },
    { label: 'Pricing', href: 'pricing.html' },
    { label: 'Team', href: 'team.html' },
    { label: 'Join the testers', href: 'testers.html' },
  ],
  exactMenu: true,
  themes: [],
  allowedStorageKeys: [],
};

const next: SiteProfile = {
  name: 'next',
  pages: ['index', 'products', 'how-it-works', 'team', 'testers', 'try-it', 'time-calculator', 'learning', 'pricing', 'privacy', 'terms', 'accessibility'],
  menu: [
    { label: 'Home', href: 'index.html' },
    { label: 'Products', href: 'products.html' },
    { label: 'How it works', href: 'how-it-works.html' },
    { label: 'Team', href: 'team.html' },
    { label: 'Join the testers', href: 'testers.html' },
  ],
  exactMenu: false, // QA has not seen this build yet; tighten to true once it has.
  themes: ['', 'sunrise', 'midnight', 'bloom'],
  allowedStorageKeys: ['yaanstep-theme'],
};

export const site: SiteProfile = process.env.SITE_PROFILE === 'next' ? next : live;
export const url = (page: string) => `/${page}.html`;
