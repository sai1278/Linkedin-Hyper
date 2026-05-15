'use strict';

const fs = require('fs');
const { chromium } = require('rebrowser-playwright');
const { logger } = require('./utils/logger');
const { setGauge } = require('./utils/metrics');

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

const MAX_ACTIVE_CONTEXTS = Math.max(3, parseInt(process.env.BROWSER_CONTEXT_CACHE_LIMIT || '5', 10) || 5);
const CONTEXT_IDLE_TTL_MS = Math.max(60_000, parseInt(process.env.BROWSER_CONTEXT_IDLE_TTL_MS || String(5 * 60 * 1000), 10) || (5 * 60 * 1000));
const SHUTDOWN_WAIT_MS = Math.max(5_000, parseInt(process.env.BROWSER_SHUTDOWN_WAIT_MS || '15000', 10) || 15_000);

const activeContexts = new Map();
const accountLocks = new Map();
let shutdownRequested = false;
let shutdownPromise = null;

function syncActiveContextGauge() {
  setGauge('browser.activeContexts', activeContexts.size);
}

syncActiveContextGauge();

function resolveChromeExecutablePath() {
  if (process.env.BROWSER_USE_SYSTEM_CHROME !== '1') {
    return null;
  }

  if (process.platform === 'linux') {
    const candidate = '/usr/bin/google-chrome-stable';
    return fs.existsSync(candidate) ? candidate : null;
  }

  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA
        ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
        : null,
    ].filter(Boolean);

    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
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
  }

  if (proxyUrl) opts.proxy = { server: proxyUrl };
  return chromium.launch(opts);
}

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

  context.setDefaultTimeout(60_000);
  context.setDefaultNavigationTimeout(60_000);

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

  await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,mp4,woff,woff2}', (route) => route.abort());
  await context.route('**/li/track**', (route) => route.abort());
  await context.route('**/beacon**', (route) => route.abort());
  await context.route('**/analytics**', (route) => route.abort());

  return context;
}

function getOrCreateAccountLock(accountId) {
  const key = String(accountId || 'default').trim() || 'default';
  let lock = accountLocks.get(key);
  if (!lock) {
    lock = { locked: false, queue: [], activeCount: 0 };
    accountLocks.set(key, lock);
  }
  return { key, lock };
}

function isAccountBusy(accountId) {
  const key = String(accountId || 'default').trim() || 'default';
  const lock = accountLocks.get(key);
  return Boolean(lock?.locked || (lock?.activeCount || 0) > 0);
}

function scheduleCleanup(accountId, delayMs = CONTEXT_IDLE_TTL_MS) {
  const entry = activeContexts.get(accountId);
  if (!entry || entry.isClosing) return;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    void cleanupContext(accountId, { reason: 'idle-timeout' });
  }, delayMs);
}

async function withAccountLock(accountId, fn) {
  if (shutdownRequested) {
    const err = new Error('Worker is shutting down. Please retry shortly.');
    err.code = 'SERVICE_SHUTTING_DOWN';
    err.status = 503;
    throw err;
  }

  const { key, lock } = getOrCreateAccountLock(accountId);

  await new Promise((resolve) => {
    if (!lock.locked) {
      lock.locked = true;
      lock.activeCount += 1;
      resolve();
      return;
    }
    lock.queue.push(resolve);
  });

  try {
    return await fn();
  } finally {
    lock.activeCount = Math.max(0, lock.activeCount - 1);
    const existingEntry = activeContexts.get(key);
    if (existingEntry && !existingEntry.isClosing) {
      existingEntry.lastUsed = Date.now();
      scheduleCleanup(key);
    }

    const next = lock.queue.shift();
    if (next) {
      lock.activeCount += 1;
      next();
    } else {
      lock.locked = false;
      if (lock.activeCount === 0 && lock.queue.length === 0) {
        accountLocks.delete(key);
      }
    }
  }
}

function evictContext(accountId, expectedEntry) {
  const current = activeContexts.get(accountId);
  if (!current) return;
  if (expectedEntry && current !== expectedEntry) return;
  clearTimeout(current.timer);
  activeContexts.delete(accountId);
  syncActiveContextGauge();
}

function getBrowserStats() {
  return {
    activeContexts: activeContexts.size,
    maxContexts: MAX_ACTIVE_CONTEXTS,
    shuttingDown: shutdownRequested,
    busyAccounts: Array.from(accountLocks.entries())
      .filter(([, lock]) => lock.locked || lock.activeCount > 0)
      .map(([accountId]) => accountId),
  };
}

function isBrowserManagerReady() {
  return !shutdownRequested;
}

async function getAccountContext(accountId, proxyUrl) {
  const key = String(accountId || 'default').trim() || 'default';
  const existing = activeContexts.get(key);
  if (existing) {
    if (!existing.browser?.isConnected() || existing.isClosing) {
      await cleanupContext(key, { force: true, reason: 'stale-context' });
    } else {
      try {
        const probePage = await existing.context.newPage();
        await probePage.close().catch(() => {});
      } catch (probeErr) {
        logger.warn('browser.context_recycle', {
          accountId: key,
          errorCode: 'STALE_CONTEXT',
          detail: probeErr instanceof Error ? probeErr.message : String(probeErr),
        });
        await cleanupContext(key, { force: true, reason: 'stale-context' });
      }
    }
  }

  const refreshed = activeContexts.get(key);
  if (refreshed) {
    clearTimeout(refreshed.timer);
    refreshed.lastUsed = Date.now();
    scheduleCleanup(key);
    logger.debug('browser.context_reuse', { accountId: key });
    return { browser: refreshed.browser, context: refreshed.context, cookiesLoaded: true };
  }

  if (activeContexts.size >= MAX_ACTIVE_CONTEXTS) {
    let oldestEvictableId = null;
    let oldestEvictableTime = Infinity;
    for (const [candidateId, ctx] of activeContexts.entries()) {
      if (ctx.isClosing || isAccountBusy(candidateId)) {
        continue;
      }
      if (ctx.lastUsed < oldestEvictableTime) {
        oldestEvictableTime = ctx.lastUsed;
        oldestEvictableId = candidateId;
      }
    }

    if (oldestEvictableId) {
      logger.info('browser.context_evict', { accountId: oldestEvictableId, reason: 'lru-cap' });
      await cleanupContext(oldestEvictableId, { force: true, reason: 'lru-cap' });
    } else {
      logger.warn('browser.context_cap_exceeded', {
        accountId: key,
        activeContexts: activeContexts.size,
        maxContexts: MAX_ACTIVE_CONTEXTS,
      });
    }
  }

  const browser = await createBrowser(proxyUrl);
  const context = await createContext(browser);

  const entry = {
    browser,
    context,
    lastUsed: Date.now(),
    timer: null,
    isClosing: false,
  };

  browser.on('disconnected', () => evictContext(key, entry));
  context.on('close', () => evictContext(key, entry));

  activeContexts.set(key, entry);
  syncActiveContextGauge();
  scheduleCleanup(key);

  logger.info('browser.context_created', {
    accountId: key,
    activeContexts: activeContexts.size,
  });

  return { browser, context, cookiesLoaded: false };
}

async function cleanupContext(accountId, options = {}) {
  const key = String(accountId || 'default').trim() || 'default';
  const existing = activeContexts.get(key);
  if (!existing) {
    return false;
  }

  const force = options.force === true;
  if (!force && isAccountBusy(key)) {
    logger.debug('browser.context_cleanup_deferred', {
      accountId: key,
      reason: options.reason || 'busy',
    });
    scheduleCleanup(key, 30_000);
    return false;
  }

  if (existing.isClosing) {
    return false;
  }

  existing.isClosing = true;
  clearTimeout(existing.timer);
  activeContexts.delete(key);
  syncActiveContextGauge();

  try {
    await existing.context.close().catch(() => {});
    await existing.browser.close().catch(() => {});
    logger.info('browser.context_closed', {
      accountId: key,
      reason: options.reason || 'manual',
    });
    return true;
  } finally {
    existing.isClosing = false;
  }
}

async function waitForActiveActions(timeoutMs = SHUTDOWN_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const activeCount = Array.from(accountLocks.values()).reduce(
      (sum, lock) => sum + (lock.locked || lock.activeCount > 0 ? 1 : 0),
      0
    );
    if (activeCount === 0) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function cleanupAllContexts(options = {}) {
  for (const accountId of Array.from(activeContexts.keys())) {
    await cleanupContext(accountId, {
      force: options.force === true,
      reason: options.reason || 'bulk-cleanup',
    });
  }
}

async function shutdownBrowserManager(signal) {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownRequested = true;
  logger.warn('browser.shutdown_started', {
    signal,
    activeContexts: activeContexts.size,
  });

  shutdownPromise = (async () => {
    const drained = await waitForActiveActions();
    if (!drained) {
      logger.warn('browser.shutdown_forcing_cleanup', {
        activeContexts: activeContexts.size,
      });
    }

    await cleanupAllContexts({ force: true, reason: 'shutdown' });
    logger.info('browser.shutdown_completed', { signal });
  })();

  return shutdownPromise;
}

process.on('SIGTERM', async () => {
  await shutdownBrowserManager('SIGTERM');
  process.exit(0);
});

process.on('SIGINT', async () => {
  await shutdownBrowserManager('SIGINT');
  process.exit(0);
});

module.exports = {
  cleanupAllContexts,
  cleanupContext,
  createBrowser,
  createContext,
  getAccountContext,
  getBrowserStats,
  isBrowserManagerReady,
  shutdownBrowserManager,
  withAccountLock,
};
