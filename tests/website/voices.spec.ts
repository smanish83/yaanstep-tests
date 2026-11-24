import { test, expect, type Page } from '@playwright/test';

// More natural voices (Manish, 23 Nov 2026): "Voice feel like artificial, are there any option to make it better?",
// then "Yes please" to using the browsers' natural voices. assets/voices.js ranks English voices: natural ones
// (Edge "Natural", Apple "Enhanced"/"Premium", Siri) first, then Chrome's Google voices, then the device's basic voices.

const v = (name: string, lang: string, localService: boolean) => ({ name, lang, localService, voiceURI: name });
const EDGE = [
  v('Microsoft David - English (United States)', 'en-US', true),
  v('Microsoft Zira - English (United States)', 'en-US', true),
  v('Microsoft Sonia Online (Natural) - English (United Kingdom)', 'en-GB', false),
  v('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false),
  v('Microsoft Denise Online (Natural) - French (France)', 'fr-FR', false),
];
const CHROME = [v('Microsoft Zira - English (United States)', 'en-US', true), v('Google US English', 'en-US', false), v('Google UK English Female', 'en-GB', false), v('Google français', 'fr-FR', false)];
const APPLE = [v('Samantha', 'en-US', true), v('Ava (Premium)', 'en-US', true), v('Daniel', 'en-GB', true)];
const BASIC = [v('Local Sam', 'en-US', true), v('Some Online Voice', 'en-US', false)];

const names = (page: Page, list: unknown[]) => page.evaluate((l) => (window as any).YSVoice.english(l).map((x: { name: string }) => x.name), list);

test('the most natural English voices come first, and only those are offered when the device has them', async ({ page }) => {
  await page.goto('/opposites.html');
  expect(await names(page, EDGE)).toEqual(['Microsoft Sonia Online (Natural) - English (United Kingdom)', 'Microsoft Aria Online (Natural) - English (United States)']);
  expect(await names(page, CHROME)).toEqual(['Google US English', 'Google UK English Female']);
  expect(await names(page, APPLE)).toEqual(['Ava (Premium)']);
  expect(await names(page, BASIC)).toEqual(['Local Sam']);
  expect(await names(page, [v('Google français', 'fr-FR', false)])).toEqual([]);
  expect(await names(page, [v('Unknown Online', 'en-US', false)])).toEqual([]);
});

test('a game reads aloud with the natural US English voice on a browser that has one', async ({ page }) => {
  await page.addInitScript((list) => {
    (window as any).__voices = [];
    (window as any).SpeechSynthesisUtterance = class { text: string; rate = 1; voice: any = null; lang = ''; constructor(t: string) { this.text = t; } };
    const SS = window.speechSynthesis as any;
    SS.getVoices = () => list;
    SS.cancel = () => {};
    SS.speak = (u: any) => { (window as any).__voices.push(u.voice && u.voice.name); };
  }, EDGE);
  await page.goto('/opposites.html');
  await page.locator('#play-find').click();
  await expect.poll(() => page.evaluate(() => (window as any).__voices.length)).toBeGreaterThan(0);
  expect(new Set(await page.evaluate(() => (window as any).__voices))).toEqual(new Set(['Microsoft Aria Online (Natural) - English (United States)']));
});

test('the privacy page says where the words go when a natural online voice reads them', async ({ page }) => {
  await page.goto('/privacy.html');
  const s = page.locator('#voices');
  await expect(s).toHaveText('Reading aloud');
  const text = await page.locator('main').innerText();
  expect(text).toContain('go to Microsoft or Google to be spoken. Nothing about your child goes with them');
  expect(text).toMatch(/Enhanced.*Premium.*stay on the device/);
});
