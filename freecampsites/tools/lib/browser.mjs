/**
 * Launch Chromium, tolerating environments where the browser Playwright wants
 * isn't the one that's installed.
 *
 * Normally `npx playwright install` handles this. In sandboxes and CI images the
 * browser is often pre-baked at a version that doesn't match the npm package, so
 * fall back to whatever Chromium is actually on disk.
 *
 * Override explicitly with CHROMIUM_PATH=/path/to/chrome.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CANDIDATE_DIRS = [
  process.env.PLAYWRIGHT_BROWSERS_PATH,
  '/opt/pw-browsers',
  join(process.env.HOME ?? '', '.cache/ms-playwright'),
].filter(Boolean);

const CANDIDATE_BINARIES = [
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

export function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

  for (const dir of CANDIDATE_DIRS) {
    if (!existsSync(dir)) continue;
    let entries;
    try { entries = readdirSync(dir); } catch { continue; }
    // Prefer full chromium over headless_shell — headless shell can't do headed runs.
    const ordered = entries
      .filter((e) => e.startsWith('chromium'))
      .sort((a, b) => Number(a.includes('headless')) - Number(b.includes('headless')));
    for (const entry of ordered) {
      for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
        const p = join(dir, entry, rel);
        if (existsSync(p)) return p;
      }
    }
  }

  return CANDIDATE_BINARIES.find((p) => existsSync(p)) ?? null;
}

export async function launchChromium(options = {}) {
  const { chromium } = await import('playwright');
  try {
    return await chromium.launch(options);
  } catch (err) {
    const fallback = findChromium();
    if (!fallback) throw err;
    console.log(`• playwright's bundled browser is missing; using ${fallback}`);
    return chromium.launch({ ...options, executablePath: fallback });
  }
}
