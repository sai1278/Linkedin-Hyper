'use strict';

const fs = require('fs');
const { chromium } = require('rebrowser-playwright');

const CHROME_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--use-gl=egl',
  '--use-angle=swiftshader-webgl',
  '--window-size=1366,768',
  '--start-maximized',
  '--lang=en-US,en',
  '--disable-extensions',
  '--disable-infobars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

/**
 * Launch a stealth Chrome browser instance.
 * @param {string|undefined} proxyUrl Optional proxy e.g. "http://user:pass@host:port"
 */
function resolveChromeExecutablePath() {
  if (process.platform === 'linux') {
    return '/usr/bin/google-chrome-stable';
  }

  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA
        ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
        : null,
    ].filter(Boolean);

    return candidates.find((p) => fs.existsSync(p)) || null;
  }

  return null;
}

async function createBrowser(proxyUrl) {
  const headless = process.env.BROWSER_HEADLESS === '0' ? false : true;
  const opts = {
    headless,
    args: CHROME_ARGS,
  };

  const executablePath = resolveChromeExecutablePath();
  if (executablePath) {
    opts.executablePath = executablePath;
  } else {
    // Fallback to installed Chrome channel when explicit path is unavailable.
    opts.channel = 'chrome';
  }

  if (proxyUrl) opts.proxy = { server: proxyUrl };
  return chromium.launch(opts);
}

/**
 * Create a browser context with full fingerprint spoofing.
 * Must be called before any page navigation.
 */
async function createContext(browser) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    colorScheme: 'light',
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
    javaScriptEnabled: true,
    permissions: ['notifications'],
  });

  // Keep actions bounded to avoid stuck playwright calls.
  context.setDefaultTimeout(60000);
  context.setDefaultNavigationTimeout(60000);

  // Patch automation fingerprint vectors before any navigation.
  await context.addInitScript(() => {
    try {
      delete Object.getPrototypeOf(navigator).webdriver;
    } catch (_) {}

    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ],
    });

    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });

    Object.defineProperty(screen, 'width', { get: () => 1366 });
    Object.defineProperty(screen, 'height', { get: () => 768 });
    Object.defineProperty(screen, 'availWidth', { get: () => 1366 });
    Object.defineProperty(screen, 'availHeight', { get: () => 728 });
  });

  // Block heavy assets and analytics to speed up navigation.
  await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,mp4,woff,woff2}', (r) => r.abort());
  await context.route('**/li/track**', (r) => r.abort());
  await context.route('**/beacon**', (r) => r.abort());
  await context.route('**/analytics**', (r) => r.abort());

  return context;
}

const activeContexts = new Map();

function evictContext(accountId, expectedEntry) {
  const current = activeContexts.get(accountId);
  if (!current) return;
  if (expectedEntry && current !== expectedEntry) return;
  clearTimeout(current.timer);
  activeContexts.delete(accountId);
}

async function getAccountContext(accountId, proxyUrl) {
  const existing = activeContexts.get(accountId);
  if (existing) {
    if (!existing.browser?.isConnected()) {
      await cleanupContext(accountId);
    } else {
      // Rebrowser/Playwright sessions can become half-closed while browser still reports connected.
      // Probe a lightweight page; recycle context immediately on protocol/session failures.
      try {
        const probePage = await existing.context.newPage();
        await probePage.close().catch(() => {});
      } catch (probeErr) {
        const message = probeErr instanceof Error ? probeErr.message : String(probeErr);
        console.warn(`[Browser] Recycling stale context for ${accountId}: ${message}`);
        await cleanupContext(accountId);
      }
    }
  }

  const refreshed = activeContexts.get(accountId);
  if (refreshed) {
      clearTimeout(refreshed.timer);
      refreshed.lastUsed = Date.now();
      refreshed.timer = setTimeout(() => cleanupContext(accountId), 5 * 60 * 1000);
      return { browser: refreshed.browser, context: refreshed.context, cookiesLoaded: true };
  }

  // LRU cache cap of 5 active contexts.
  if (activeContexts.size >= 5) {
    let oldestId = null;
    let oldestTime = Infinity;
    for (const [id, ctx] of activeContexts.entries()) {
      if (ctx.lastUsed < oldestTime) {
        oldestTime = ctx.lastUsed;
        oldestId = id;
      }
    }
    if (oldestId) {
      await cleanupContext(oldestId);
    }
  }

  const browser = await createBrowser(proxyUrl);
  const context = await createContext(browser);

  const entry = {
    browser,
    context,
    lastUsed: Date.now(),
    timer: null,
  };
  entry.timer = setTimeout(() => cleanupContext(accountId), 5 * 60 * 1000);

  browser.on('disconnected', () => evictContext(accountId, entry));
  context.on('close', () => evictContext(accountId, entry));

  activeContexts.set(accountId, entry);

  return { browser, context, cookiesLoaded: false };
}

async function cleanupContext(accountId) {
  const existing = activeContexts.get(accountId);
  if (existing) {
    clearTimeout(existing.timer);
    activeContexts.delete(accountId);
    await existing.context.close().catch(() => {});
    await existing.browser.close().catch(() => {});
  }
}

async function cleanupAllContexts() {
  for (const accountId of activeContexts.keys()) {
    await cleanupContext(accountId);
  }
}

process.on('SIGTERM', async () => {
  await cleanupAllContexts();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await cleanupAllContexts();
  process.exit(0);
});

module.exports = { createBrowser, createContext, getAccountContext, cleanupContext, cleanupAllContexts };
