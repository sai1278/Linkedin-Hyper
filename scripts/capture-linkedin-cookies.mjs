#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';

const DEBUG_SCREENSHOT_DIR =
  process.env.LI_DEBUG_SCREENSHOT_DIR ||
  path.resolve(process.cwd(), 'artifacts', 'cookie-capture-debug');
const CAPTURE_STABLE_MS = Math.max(3000, Number(process.env.LI_CAPTURE_STABLE_MS || 5000));
const CAPTURE_POLL_MS = 2000;
const AUTH_BLOCK_TOKENS = [
  '/uas/login',
  '/login',
  '/checkpoint',
  '/authwall',
  'challenge',
];

function safeName(value) {
  return String(value || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'unknown';
}

function isBlockedAuthPage(url) {
  const value = String(url || '').toLowerCase();
  if (!value.includes('linkedin.com')) return true;
  return AUTH_BLOCK_TOKENS.some((token) => value.includes(token));
}

function isLikelyMemberUrl(url) {
  const value = String(url || '').toLowerCase();
  if (!value.includes('linkedin.com')) return false;
  if (isBlockedAuthPage(value)) return false;
  try {
    const u = new URL(value);
    const p = String(u.pathname || '/').toLowerCase();
    return (
      p === '/' ||
      p === '/feed/' || p.startsWith('/feed') ||
      p.startsWith('/in/') ||
      p.startsWith('/messaging') ||
      p.startsWith('/search') ||
      p.startsWith('/mynetwork') ||
      p.startsWith('/notifications') ||
      p.startsWith('/jobs')
    );
  } catch {
    return false;
  }
}

function isAuthenticatedLinkedInPage(state) {
  const hasUiSignal = Boolean(state?.hasSignedInNav || state?.hasMessagingShell);
  const hasMemberUrlSignal = isLikelyMemberUrl(state?.url);
  return Boolean(
    state &&
    !state.blockedAuthPage &&
    !state.hasLoginForm &&
    !state.hasAuthwallMarkers &&
    !state.hasGuestCta &&
    (hasUiSignal || hasMemberUrlSignal)
  );
}

function classifyCaptureFailureCode(state) {
  if (state?.blockedAuthPage) {
    const u = String(state?.url || '').toLowerCase();
    if (u.includes('/checkpoint') || u.includes('challenge')) {
      return 'CHECKPOINT_INCOMPLETE';
    }
    return 'LOGIN_NOT_FINISHED';
  }
  if (!state?.hasLiAt || !state?.hasJsession) {
    return 'COOKIES_MISSING';
  }
  return 'AUTHENTICATED_STATE_NOT_REACHED';
}

function explainCaptureRejection(state) {
  if (!state) return 'No browser state available during capture.';
  if (state.blockedAuthPage) {
    const u = String(state.url || '').toLowerCase();
    if (u.includes('/checkpoint') || u.includes('challenge')) {
      return `LinkedIn checkpoint/challenge is still active at ${state.url || 'unknown URL'}.`;
    }
    return `LinkedIn login flow is not finished yet at ${state.url || 'unknown URL'}.`;
  }
  if (!state.hasLiAt || !state.hasJsession) {
    return `Required cookies missing (li_at=${state.hasLiAt}, JSESSIONID=${state.hasJsession}).`;
  }
  return 'Authenticated LinkedIn UI state was not reached.';
}

function logCaptureState(source, state, stableForMs = 0) {
  const title = String(state?.title || '').trim() || 'n/a';
  console.log(
    `[capture:${source}] url=${state?.url || 'n/a'} | title=${title} | li_at=${Boolean(state?.hasLiAt)} | JSESSIONID=${Boolean(state?.hasJsession)} | signedInNav=${Boolean(state?.hasSignedInNav)} | messagingShell=${Boolean(state?.hasMessagingShell)} | authenticated=${Boolean(state?.authenticated)} | blocked=${Boolean(state?.blockedAuthPage)} | stableMs=${stableForMs} | reason=${state?.failureReason || 'none'}`
  );
}

function extractLinkedInCookies(allCookies) {
  return (Array.isArray(allCookies) ? allCookies : []).filter((c) =>
    String(c?.domain || '').includes('linkedin.com')
  );
}

function computeCookieFlags(linkedInCookies) {
  const liAtCookie = linkedInCookies.find((c) => c?.name === 'li_at' && c?.value);
  const hasLiAt = Boolean(liAtCookie);
  const hasJsession = linkedInCookies.some((c) => c?.name === 'JSESSIONID' && c?.value);
  const liAtExpires = Number(liAtCookie?.expires || -1);
  const liAtFresh =
    hasLiAt &&
    (
      !Number.isFinite(liAtExpires) ||
      liAtExpires <= 0 ||
      liAtExpires > Math.floor(Date.now() / 1000) + 300
    );
  return { hasLiAt, hasJsession, liAtFresh };
}

async function screenshotViaPlaywright(page, label) {
  if (!page || page.isClosed?.()) return null;
  ensureDir(DEBUG_SCREENSHOT_DIR);
  const filePath = path.join(DEBUG_SCREENSHOT_DIR, `${safeName(label)}-${Date.now()}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`Screenshot saved: ${filePath}`);
  return filePath;
}

async function screenshotViaCdp(cdp, label) {
  ensureDir(DEBUG_SCREENSHOT_DIR);
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, 15000);
  const filePath = path.join(DEBUG_SCREENSHOT_DIR, `${safeName(label)}-${Date.now()}.png`);
  fs.writeFileSync(filePath, result?.data || '', 'base64');
  console.log(`Screenshot saved: ${filePath}`);
  return filePath;
}

async function waitForStableAuthenticatedState({
  sourceLabel,
  timeoutMs,
  stableMs = CAPTURE_STABLE_MS,
  pollMs = CAPTURE_POLL_MS,
  getState,
  captureScreenshot,
}) {
  const deadline = Date.now() + timeoutMs;
  let stableSince = 0;
  let lastSig = '';
  let lastState = null;
  let lastLogAt = 0;

  while (Date.now() < deadline) {
    const state = await getState();
    state.blockedAuthPage = isBlockedAuthPage(state.url);
    state.authenticated = isAuthenticatedLinkedInPage(state);
    state.failureCode = classifyCaptureFailureCode(state);
    state.failureReason = explainCaptureRejection(state);
    lastState = state;

    if (state.authenticated && state.hasLiAt && state.hasJsession && state.liAtFresh && !state.blockedAuthPage) {
      if (!stableSince) stableSince = Date.now();
      const stableFor = Date.now() - stableSince;
      const sig = `${state.url}|${state.title}|${state.hasLiAt}|${state.hasJsession}|${state.authenticated}|stable:${Math.floor(stableFor / 1000)}`;
      if (sig !== lastSig || (Date.now() - lastLogAt) >= 10000) {
        logCaptureState(sourceLabel, state, stableFor);
        lastSig = sig;
        lastLogAt = Date.now();
      }
      if (stableFor >= stableMs) {
        return state;
      }
    } else {
      stableSince = 0;
      const sig = `${state.url}|${state.title}|${state.hasLiAt}|${state.hasJsession}|${state.authenticated}|${state.failureReason}`;
      if (sig !== lastSig || (Date.now() - lastLogAt) >= 10000) {
        logCaptureState(sourceLabel, state, 0);
        lastSig = sig;
        lastLogAt = Date.now();
      }
    }

    await delay(pollMs);
  }

  const code = lastState?.failureCode || 'AUTHENTICATED_STATE_NOT_REACHED';
  const reason = lastState?.failureReason || 'Stable authenticated LinkedIn session was not reached before timeout.';
  const screenshot = captureScreenshot ? await captureScreenshot(code).catch(() => null) : null;
  throw new Error(`[${code}] ${reason}${screenshot ? ` Screenshot: ${screenshot}` : ''}`);
}

function parseArgs(argv) {
  const out = {
    browser: 'chrome',
    timeoutSec: 240,
    port: 9229,
    output: path.resolve(process.cwd(), 'linkedin-cookies-plain.json'),
    profile: '',
    keepTemp: false,
    closeBrowser: true,
    useTempCopy: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--browser' && argv[i + 1]) {
      out.browser = String(argv[++i]).toLowerCase();
      continue;
    }
    if (arg === '--timeoutSec' && argv[i + 1]) {
      out.timeoutSec = Number(argv[++i]);
      continue;
    }
    if (arg === '--port' && argv[i + 1]) {
      out.port = Number(argv[++i]);
      continue;
    }
    if (arg === '--output' && argv[i + 1]) {
      out.output = path.resolve(argv[++i]);
      continue;
    }
    if (arg === '--profile' && argv[i + 1]) {
      out.profile = String(argv[++i]);
      continue;
    }
    if (arg === '--keep-temp') {
      out.keepTemp = true;
      continue;
    }
    if (arg === '--no-close-browser') {
      out.closeBrowser = false;
      continue;
    }
    if (arg === '--use-temp-copy') {
      out.useTempCopy = true;
      continue;
    }
    if (arg === '--use-live-profile') {
      out.useTempCopy = false;
      continue;
    }
  }

  if (!Number.isFinite(out.timeoutSec) || out.timeoutSec <= 0) {
    throw new Error(`Invalid --timeoutSec value: ${out.timeoutSec}`);
  }
  if (!Number.isFinite(out.port) || out.port < 1024 || out.port > 65535) {
    throw new Error(`Invalid --port value: ${out.port}`);
  }
  if (!['chrome', 'edge'].includes(out.browser)) {
    throw new Error(`Unsupported --browser '${out.browser}'. Use 'chrome' or 'edge'.`);
  }

  return out;
}

function findBrowserConfig(browser) {
  if (browser === 'edge') {
    const candidates = [
      path.join(process.env['ProgramFiles'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ].filter(Boolean);

    const executablePath = candidates.find((p) => fs.existsSync(p));
    return {
      processImageName: 'msedge.exe',
      executablePath,
      userDataRoot: path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data'),
    };
  }

  const candidates = [
    path.join(process.env['ProgramFiles'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);

  const executablePath = candidates.find((p) => fs.existsSync(p));
  return {
    processImageName: 'chrome.exe',
    executablePath,
    userDataRoot: path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data'),
  };
}

function resolveProfile(userDataRoot, explicitProfile = '') {
  if (!fs.existsSync(userDataRoot)) {
    throw new Error(`User data directory not found: ${userDataRoot}`);
  }

  if (explicitProfile) {
    const explicitPath = path.join(userDataRoot, explicitProfile);
    if (!fs.existsSync(explicitPath)) {
      throw new Error(`Profile '${explicitProfile}' not found under ${userDataRoot}`);
    }
    return explicitProfile;
  }

  const localStatePath = path.join(userDataRoot, 'Local State');
  if (fs.existsSync(localStatePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
      const lastUsed = parsed?.profile?.last_used;
      if (lastUsed && fs.existsSync(path.join(userDataRoot, lastUsed))) {
        return lastUsed;
      }
    } catch {
      // Ignore parse errors and continue with fallback ordering.
    }
  }

  const fallbacks = ['Profile', 'Default'];
  for (const name of fallbacks) {
    if (fs.existsSync(path.join(userDataRoot, name))) {
      return name;
    }
  }

  const profiles = fs
    .readdirSync(userDataRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && (d.name === 'Default' || d.name.startsWith('Profile')))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));

  if (profiles.length === 0) {
    throw new Error(`No Chromium profiles found under ${userDataRoot}`);
  }
  return profiles[0];
}

function closeBrowserProcesses(imageName) {
  const result = spawnSync('taskkill', ['/F', '/IM', imageName], {
    stdio: 'ignore',
    windowsHide: true,
  });
  if (result.status !== 0) {
    // taskkill returns non-zero when no process exists; not fatal.
    return;
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFileIfExists(src, dst) {
  if (!fs.existsSync(src)) return;
  ensureDir(path.dirname(dst));
  try {
    fs.copyFileSync(src, dst);
  } catch {
    // Ignore locked/transient files.
  }
}

function copyProfileArtifacts(srcProfile, dstProfile) {
  ensureDir(dstProfile);

  const filesToCopy = [
    'Preferences',
    'Secure Preferences',
    path.join('Network', 'Network Persistent State'),
    path.join('Network', 'TransportSecurity'),
  ];

  for (const rel of filesToCopy) {
    copyFileIfExists(path.join(srcProfile, rel), path.join(dstProfile, rel));
  }
}

function prepareTempUserData(userDataRoot, profileName) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'li-cookie-capture-'));
  const srcProfile = path.join(userDataRoot, profileName);
  const dstProfile = path.join(tempRoot, profileName);

  const localStateSrc = path.join(userDataRoot, 'Local State');
  const localStateDst = path.join(tempRoot, 'Local State');

  if (fs.existsSync(localStateSrc)) {
    fs.copyFileSync(localStateSrc, localStateDst);
  }

  if (!fs.existsSync(srcProfile)) {
    throw new Error(`Profile directory not found: ${srcProfile}`);
  }
  copyProfileArtifacts(srcProfile, dstProfile);

  return tempRoot;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res.json();
}

async function waitForDebuggerEndpoint(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const payload = await fetchJson(`http://127.0.0.1:${port}/json/version`);
      if (payload?.webSocketDebuggerUrl) return true;
    } catch {
      // Keep waiting.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for DevTools endpoint on port ${port}`);
}

async function waitForPageTargetWs(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const pageTarget = Array.isArray(targets)
        ? targets.find((t) => t?.type === 'page' && t?.webSocketDebuggerUrl && String(t?.url || '').includes('linkedin.com'))
        : null;

      if (pageTarget?.webSocketDebuggerUrl) {
        return pageTarget.webSocketDebuggerUrl;
      }
    } catch {
      // Keep waiting.
    }
    await delay(500);
  }
  throw new Error('Timed out waiting for a LinkedIn page target in DevTools.');
}

async function getLinkedInPageUrl(port) {
  const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
  if (!Array.isArray(targets)) return '';

  const pageTarget = targets.find(
    (t) =>
      t?.type === 'page' &&
      typeof t?.url === 'string' &&
      t.url.includes('linkedin.com')
  );
  return pageTarget?.url || '';
}

function mapCookie(cookie) {
  const sameSiteRaw = String(cookie.sameSite || '').toLowerCase();
  let sameSite;
  if (sameSiteRaw === 'lax') sameSite = 'Lax';
  else if (sameSiteRaw === 'strict') sameSite = 'Strict';
  else if (sameSiteRaw === 'none' || sameSiteRaw === 'no_restriction') sameSite = 'None';
  else sameSite = 'Lax';

  const isSession = cookie.session === true || cookie.expires === -1;
  const mapped = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || '/',
    httpOnly: Boolean(cookie.httpOnly),
    secure: Boolean(cookie.secure),
    sameSite,
  };
  if (!isSession) {
    mapped.expires = Math.floor(Number(cookie.expires || -1));
  }
  return mapped;
}

function getRequireFromWorkerPackage() {
  const workerPkg = path.join(process.cwd(), 'worker', 'package.json');
  if (!fs.existsSync(workerPkg)) {
    throw new Error(`Worker package.json not found for Playwright fallback: ${workerPkg}`);
  }
  return createRequire(workerPkg);
}

async function inspectLinkedInDomStateViaCdp(cdp) {
  const expression = `
    (() => {
      const txt = (document.body?.innerText || '').toLowerCase();
      const hasLoginForm = Boolean(document.querySelector('input[name="session_key"], input[name="session_password"], form[action*="login"]'));
      const hasAuthwallMarkers =
        txt.includes('join linkedin') ||
        txt.includes('sign in') ||
        txt.includes('new to linkedin') ||
        txt.includes('continue to linkedin') ||
        txt.includes('unlock your profile') ||
        txt.includes('challenge');
      const hasSignedInNav = Boolean(
        document.querySelector(
          [
            '.global-nav__me',
            '.global-nav__me-photo',
            '.global-nav__primary-link-me-menu-trigger',
            '#global-nav-search',
            '.search-global-typeahead',
            '[data-test-global-nav-me]'
          ].join(', ')
        )
      );
      const hasMessagingShell = Boolean(document.querySelector('.msg-conversations-container, .msg-overlay-list-bubble, .msg-s-message-list'));
      const hasGuestCta = Boolean(
        document.querySelector(
          [
            'a[href*="/login"]',
            'a[href*="/signup"]',
            'a[data-tracking-control-name*="guest_homepage"]'
          ].join(', ')
        )
      );
      return {
        url: location.href,
        title: document.title || '',
        hasLoginForm,
        hasAuthwallMarkers,
        hasSignedInNav,
        hasMessagingShell,
        hasGuestCta
      };
    })()
  `;
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, 12000);
  return result?.result?.value || {};
}

async function captureLinkedInCookiesViaPlaywrightFallback({
  cfg,
  userDataDir,
  profileName,
  timeoutSec,
}) {
  const requireFromWorker = getRequireFromWorkerPackage();
  let rebrowser;
  try {
    rebrowser = requireFromWorker('rebrowser-playwright');
  } catch (err) {
    throw new Error(`Playwright fallback unavailable (rebrowser-playwright not found): ${String(err?.message || err)}`);
  }

  const chromium = rebrowser?.chromium;
  if (!chromium || typeof chromium.launchPersistentContext !== 'function') {
    throw new Error('Playwright fallback unavailable: chromium.launchPersistentContext is missing.');
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: cfg.executablePath,
    args: [
      `--profile-directory=${profileName}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--new-window',
      '--start-maximized',
    ],
    viewport: { width: 1366, height: 768 },
  });

  const deadline = Date.now() + timeoutSec * 1000;
  let page;

  try {
    page = context.pages().find((p) => String(p.url() || '').includes('linkedin.com'));
    if (!page) {
      page = await context.newPage();
    }

    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    console.log('Playwright fallback started. Complete LinkedIn login in the opened browser window if prompted.');

    const stableState = await waitForStableAuthenticatedState({
      sourceLabel: 'playwright',
      timeoutMs: Math.max(5000, deadline - Date.now()),
      getState: async () => {
        const linkedinPages = context.pages().filter((p) => String(p.url() || '').includes('linkedin.com'));
        const activePage = linkedinPages[linkedinPages.length - 1] || page;
        page = activePage;

        const dom = await activePage.evaluate(() => {
          const txt = (document.body?.innerText || '').toLowerCase();
          return {
            url: location.href,
            title: document.title || '',
            hasLoginForm: Boolean(document.querySelector('input[name="session_key"], input[name="session_password"], form[action*="login"]')),
            hasAuthwallMarkers:
              txt.includes('join linkedin') ||
              txt.includes('sign in') ||
              txt.includes('new to linkedin') ||
              txt.includes('continue to linkedin') ||
              txt.includes('unlock your profile') ||
              txt.includes('challenge'),
            hasSignedInNav: Boolean(document.querySelector('.global-nav__me, .global-nav__me-photo, #global-nav-search, .search-global-typeahead')),
            hasMessagingShell: Boolean(document.querySelector('.msg-conversations-container, .msg-overlay-list-bubble, .msg-s-message-list')),
            hasGuestCta: Boolean(document.querySelector('a[href*="/login"], a[href*="/signup"]')),
          };
        }).catch(() => ({ url: activePage.url(), title: '' }));

        const allCookies = await context.cookies();
        const linkedIn = extractLinkedInCookies(allCookies);
        const flags = computeCookieFlags(linkedIn);

        return {
          ...dom,
          ...flags,
          cookies: linkedIn,
          linkedInCookieCount: linkedIn.length,
        };
      },
      captureScreenshot: async (code) => screenshotViaPlaywright(page, `capture-rejected-${String(code || 'unknown').toLowerCase()}`),
    });
    return stableState.cookies.map(mapCookie);
  } finally {
    await context.close().catch(() => {});
  }
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.seq = 0;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);

    await new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (event) => {
        cleanup();
        reject(new Error(`WebSocket connect error: ${String(event?.message || 'unknown error')}`));
      };
      const cleanup = () => {
        this.ws.removeEventListener('open', onOpen);
        this.ws.removeEventListener('error', onError);
      };

      this.ws.addEventListener('open', onOpen, { once: true });
      this.ws.addEventListener('error', onError, { once: true });
    });

    this.ws.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload.id && this.pending.has(payload.id)) {
          const { resolve, reject } = this.pending.get(payload.id);
          this.pending.delete(payload.id);
          if (payload.error) reject(new Error(payload.error.message || 'CDP error'));
          else resolve(payload.result || {});
        }
      } catch {
        // Ignore malformed CDP frame.
      }
    });

    this.ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error('CDP socket closed'));
      }
      this.pending.clear();
    });
  }

  async send(method, params = {}, timeoutMs = 15000) {
    const id = ++this.seq;
    const frame = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);

      const wrappedResolve = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      const wrappedReject = (err) => {
        clearTimeout(timer);
        reject(err);
      };
      this.pending.set(id, { resolve: wrappedResolve, reject: wrappedReject });
      this.ws.send(frame);
    });
  }

  close() {
    if (this.ws && this.ws.readyState < 2) {
      this.ws.close();
    }
  }
}

async function captureLinkedInCookies(port, wsUrl, timeoutSec) {
  const cdp = new CdpClient(wsUrl);
  await cdp.connect();
  await cdp.send('Network.enable');
  await cdp.send('Runtime.enable').catch(() => {});
  await cdp.send('Page.enable').catch(() => {});

  try {
    const stableState = await waitForStableAuthenticatedState({
      sourceLabel: 'cdp',
      timeoutMs: timeoutSec * 1000,
      getState: async () => {
        let result;
        try {
          result = await cdp.send('Network.getAllCookies', {}, 20_000);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            url: '',
            title: '',
            hasLoginForm: false,
            hasAuthwallMarkers: false,
            hasSignedInNav: false,
            hasMessagingShell: false,
            hasGuestCta: false,
            hasLiAt: false,
            hasJsession: false,
            liAtFresh: false,
            cookies: [],
            linkedInCookieCount: 0,
            failureReason: `Cookie poll warning: ${message}`,
          };
        }

        const linkedIn = extractLinkedInCookies(result.cookies);
        const flags = computeCookieFlags(linkedIn);
        const dom = await inspectLinkedInDomStateViaCdp(cdp).catch(async () => ({
          url: await getLinkedInPageUrl(port).catch(() => ''),
          title: '',
        }));

        return { ...dom, ...flags, cookies: linkedIn, linkedInCookieCount: linkedIn.length };
      },
      captureScreenshot: async (code) => screenshotViaCdp(cdp, `capture-rejected-${String(code || 'unknown').toLowerCase()}`),
    });
    return stableState.cookies.map(mapCookie);
  } finally {
    cdp.close();
  }
}

function killProcessTree(pid) {
  if (!pid || Number.isNaN(pid)) return;
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = findBrowserConfig(args.browser);

  if (!cfg.executablePath) {
    throw new Error(`Could not find ${args.browser} executable.`);
  }

  const profileName = resolveProfile(cfg.userDataRoot, args.profile);
  console.log(`Using ${args.browser} profile: ${profileName}`);

  if (args.closeBrowser) {
    closeBrowserProcesses(cfg.processImageName);
    await delay(1000);
  }

  let launchedUserDataDir = cfg.userDataRoot;
  let tempUserData = null;
  if (args.useTempCopy) {
    tempUserData = prepareTempUserData(cfg.userDataRoot, profileName);
    launchedUserDataDir = tempUserData;
    console.log(`Prepared temporary browser profile: ${tempUserData}`);
    console.log('LinkedIn cookies are intentionally not pre-copied; sign in in this window to capture fresh cookies.');
  } else {
    console.log(`Using live browser profile at: ${cfg.userDataRoot}`);
  }

  const browserArgs = [
    `--remote-debugging-port=${args.port}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${launchedUserDataDir}`,
    `--profile-directory=${profileName}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    'https://www.linkedin.com/feed/',
  ];

  const child = spawn(cfg.executablePath, browserArgs, {
    stdio: 'ignore',
    windowsHide: false,
  });

  let savedPath = null;
  let cdpError = null;
  try {
    await waitForDebuggerEndpoint(args.port, 30_000);
    const wsUrl = await waitForPageTargetWs(args.port, 30_000);
    console.log('DevTools endpoint ready.');
    console.log('If LinkedIn asks for login, complete login in the opened browser window.');

    const cookies = await captureLinkedInCookies(args.port, wsUrl, args.timeoutSec);
    ensureDir(path.dirname(args.output));
    fs.writeFileSync(args.output, JSON.stringify(cookies, null, 2), 'utf8');
    savedPath = args.output;

    console.log(`Captured ${cookies.length} LinkedIn cookies to: ${savedPath}`);
  } catch (err) {
    cdpError = err;
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`CDP capture failed: ${message}`);
  } finally {
    killProcessTree(child.pid);
  }

  if (!savedPath) {
    const modeLabel = args.useTempCopy ? 'temp profile copy' : 'live profile';
    console.warn(`Falling back to Playwright direct capture (${modeLabel}).`);
    const fallbackCookies = await captureLinkedInCookiesViaPlaywrightFallback({
      cfg,
      userDataDir: launchedUserDataDir,
      profileName,
      timeoutSec: args.timeoutSec,
    }).catch((fallbackErr) => {
      const cdpMessage = cdpError ? (cdpError instanceof Error ? cdpError.message : String(cdpError)) : 'unknown CDP failure';
      const fbMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      throw new Error(`CDP capture failed (${cdpMessage}); Playwright fallback failed (${fbMessage})`);
    });
    ensureDir(path.dirname(args.output));
    fs.writeFileSync(args.output, JSON.stringify(fallbackCookies, null, 2), 'utf8');
    savedPath = args.output;
    console.log(`Captured ${fallbackCookies.length} LinkedIn cookies to: ${savedPath} (Playwright fallback)`);
  }

  if (tempUserData && !args.keepTemp) {
    try {
      fs.rmSync(tempUserData, { recursive: true, force: true });
    } catch {
      // Ignore cleanup issues.
    }
  } else if (tempUserData && args.keepTemp) {
    console.log(`Keeping temp user data dir for debug: ${tempUserData}`);
  }

  if (!savedPath) {
    throw new Error('Cookie capture did not produce an output file.');
  }
}

main().catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});
