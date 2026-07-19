/**
 * Playwright automated test for CBGames-Offline-Launcher
 *
 * Flow:
 *   1. Load the committed game ZIP fixture
 *   2. Open the launcher (file://)
 *   3. Import the ZIP via the hidden #zipInput file input
 *   4. Click Play on the imported game card
 *   5. Capture the popup player window
 *   6. Wait for runWebglAutoTest() to be available, then call it
 *   7. Collect logs, wait for [AUTOTEST] DONE, report results
 *
 * Usage:
 *   node playwright-launcher-test.mjs
 *   PAUSE_MS=5000 node playwright-launcher-test.mjs   # keep browser open longer
 *   HEADLESS=1 node playwright-launcher-test.mjs      # run headless (CI default)
 */

import { chromium } from 'playwright';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In CI the bundle is pre-built to dist/index.debug.html; locally use index.html
// (dev version with external src/ refs, which file:// can load fine).
const LAUNCHER_PATH  = process.env.CI
  ? path.join(__dirname, '../dist', 'index.debug.html')
  : path.join(__dirname, 'index.html');
const LAUNCHER_URL   = 'file://' + LAUNCHER_PATH;
const FIXTURE_ZIP    = path.join(__dirname, '../test-fixtures', 'webgl-test-game.zip');

const AUTOTEST_TIMEOUT_MS = 10 * 60 * 1000;
const PAUSE_MS  = parseInt(process.env.PAUSE_MS ?? (process.env.CI ? '0' : '3000'), 10);
const HEADLESS  = process.env.HEADLESS === '1' || Boolean(process.env.CI);

// ---------------------------------------------------------------------------
// ZIP resolution
// ---------------------------------------------------------------------------
function resolveZipPath() {
  if (!existsSync(FIXTURE_ZIP)) {
    throw new Error(`Test fixture not found at ${FIXTURE_ZIP}`);
  }
  console.log(`[setup] Using committed test fixture: ${FIXTURE_ZIP}`);
  return FIXTURE_ZIP;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const zipPath = resolveZipPath();

const browser = await chromium.launch({
  headless: HEADLESS,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell',
});

  const context = await browser.newContext();
  const page    = await context.newPage();

  page.on('console', msg => {
    const t = msg.text();
    if (t.startsWith('[runner]') || t.includes('[AUTOTEST]')) {
      console.log(`  [launcher] ${t}`);
    }
  });

  // ---------------------------------------------------------------------------
  // Open launcher
  // ---------------------------------------------------------------------------
  console.log(`[runner] Opening launcher: ${LAUNCHER_URL}`);
  await page.goto(LAUNCHER_URL);
  await page.waitForLoadState('domcontentloaded');
  console.log('[runner] Launcher loaded.');

  // ---------------------------------------------------------------------------
  // Import ZIP
  // ---------------------------------------------------------------------------
  console.log(`[runner] Importing ZIP: ${zipPath}`);
  await page.setInputFiles('#zipInput', zipPath);

  // After a fresh import the launcher opens the game-edit modal (name/thumbnail).
  // Wait for it and click Save Changes so the card appears in the library.
  try {
    await page.waitForSelector('#gameEditModal[aria-hidden="false"]', { timeout: 15_000 });
    console.log('[runner] Game-edit modal appeared — clicking Save Changes');
    await page.click('#saveGameEditChanges');
  } catch {
    // Modal didn't appear (e.g. game already existed and was replaced) — that's fine
  }

  await page.waitForSelector('[data-action="launch"]', { timeout: 30_000 });
  console.log('[runner] Game imported — card visible in library.');

  // ---------------------------------------------------------------------------
  // Click Play and capture popup
  // ---------------------------------------------------------------------------
  const popupPromise = page.waitForEvent('popup');
  await page.click('[data-action="launch"]');
  console.log('[runner] Clicked Play — waiting for popup...');

  const popup = await popupPromise;
  console.log('[runner] Popup opened.');

  const logs = [];
  popup.on('console', msg => {
    const text = msg.text();
    logs.push(text);
    if (
      text.includes('[AUTOTEST]') ||
      text.includes('[IDBFS]') ||
      text.includes('[Browser]') ||
      text.includes('[Launcher]') ||
      msg.type() === 'error'
    ) {
      const prefix = msg.type() === 'error' ? '[ERR]' : '[LOG]';
      console.log(`  ${prefix} ${text}`);
    }
  });

  // ---------------------------------------------------------------------------
  // Wait for scripts, trigger autotest
  // ---------------------------------------------------------------------------
  console.log('[runner] Waiting for game scripts to initialise...');
  try {
    await popup.waitForFunction(
      () => typeof runWebglAutoTest === 'function',
      { timeout: 60_000 }
    );
  } catch {
    console.error('[runner] runWebglAutoTest never became available.');
  }

  console.log('[runner] Triggering autotest...');
  await popup.evaluate(() => {
    if (typeof runWebglAutoTest === 'function') {
      runWebglAutoTest();
    } else {
      console.error('[autotest] runWebglAutoTest is not defined — cannot run tests.');
    }
  });

  // ---------------------------------------------------------------------------
  // Wait for [AUTOTEST] DONE
  // ---------------------------------------------------------------------------
  const deadline = Date.now() + AUTOTEST_TIMEOUT_MS;
  let doneMsg = null;

  while (!doneMsg && Date.now() < deadline) {
    doneMsg = logs.find(l => l.includes('[AUTOTEST] DONE'));
    if (!doneMsg) await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n========================================');
  if (!doneMsg) {
    console.error('[runner] TIMEOUT — [AUTOTEST] DONE never received.');
    const passed = logs.filter(l => l.includes('[AUTOTEST] PASS')).length;
    const failed = logs.filter(l => l.includes('[AUTOTEST] FAIL')).length;
    console.log(`[runner] Last state: ${passed} passed, ${failed} failed`);
    process.exitCode = 1;
  } else {
    console.log('[runner] AUTOTEST DONE:', doneMsg);
    console.log('========================================\n');

    const failLines = logs.filter(l => l.includes('[AUTOTEST] FAIL'));
    // The one known expected failure on file:// is BrowserFetchAPI (CORS from null origin)
    const expectedFailures = new Set(['BrowserFetchAPI']);
    const unexpectedFails = failLines.filter(l => {
      const m = l.match(/\[AUTOTEST\] FAIL (\w+)/);
      return m && !expectedFailures.has(m[1]);
    });

    if (unexpectedFails.length > 0) {
      console.log(`[runner] ${unexpectedFails.length} UNEXPECTED failure(s):`);
      unexpectedFails.forEach(l => console.log('  ', l));
      process.exitCode = 1;
    } else if (failLines.length > 0) {
      console.log(`[runner] ${failLines.length} known/expected failure(s) (not blocking):`);
      failLines.forEach(l => console.log('  ', l));
      console.log('[runner] All unexpected-failure checks PASSED.');
    } else {
      console.log('[runner] All autotest steps PASSED.');
    }
  }
  console.log('========================================\n');

  if (PAUSE_MS > 0) {
    console.log(`[runner] Keeping browser open for ${PAUSE_MS}ms...`);
    await new Promise(r => setTimeout(r, PAUSE_MS));
  }

  await browser.close();
}

main().then(() => process.exit(process.exitCode ?? 0));
