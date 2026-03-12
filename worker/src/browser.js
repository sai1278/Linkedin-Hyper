'use strict';

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
 * @param {string|undefined} proxyUrl  Optional proxy e.g. "http://user:pass@host:port"
 */
async function createBrowser(proxyUrl) {
  const opts = {
    headless:       false, // NEVER headless — LinkedIn detects it
    executablePath: '/usr/bin/google-chrome-stable',
    channel:        'chrome',
    args:           CHROME_ARGS,
  };
  if (proxyUrl) opts.proxy = { server: proxyUrl };
  return chromium.launch(opts);
}

/**
 * Create a browser context with full fingerprint spoofing.
 * Must be called before any page navigation.
 */
async function createContext(browser) {
  const context = await browser.newContext({
    userAgent:         'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport:          { width: 1366, height: 768 },
    locale:            'en-US',
    timezoneId:        'America/New_York',
    colorScheme:       'light',
    deviceScaleFactor: 1,
    hasTouch:          false,
    isMobile:          false,
    javaScriptEnabled: true,
    permissions:       ['notifications'],
  });

  // Patch all automation fingerprint vectors before any navigation
  await context.addInitScript(() => {
    // Remove webdriver flag
    try { delete Object.getPrototypeOf(navigator).webdriver; } catch (_) {}

    // Realistic plugin list
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin',  filename: 'internal-pdf-viewer',             description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer',  filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client',      filename: 'internal-nacl-plugin',            description: '' },
      ],
    });

    Object.defineProperty(navigator, 'languages',           { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });

    // Realistic screen dimensions
    Object.defineProperty(screen, 'width',       { get: () => 1366 });
    Object.defineProperty(screen, 'height',      { get: () => 768 });
    Object.defineProperty(screen, 'availWidth',  { get: () => 1366 });
    Object.defineProperty(screen, 'availHeight', { get: () => 728 });
  });

  return context;
}

const activeContexts = new Map();

async function getAccountContext(accountId, proxyUrl) {
  const existing = activeContexts.get(accountId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.lastUsed = Date.now();
    existing.timer = setTimeout(() => cleanupContext(accountId), 5 * 60 * 1000); // 5 mins
    await existing.context.clearCookies();
    return { browser: existing.browser, context: existing.context };
  }

  const browser = await createBrowser(proxyUrl);
  const context = await createContext(browser);

  const timer = setTimeout(() => cleanupContext(accountId), 5 * 60 * 1000);
  activeContexts.set(accountId, { browser, context, lastUsed: Date.now(), timer });

  return { browser, context };
}

async function cleanupContext(accountId) {
  const existing = activeContexts.get(accountId);
  if (existing) {
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
