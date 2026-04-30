#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

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

function usage() {
  console.log(`Usage:
  node scripts/capture-linkedin-cookies-interactive.mjs --accountId <id> [--browser chrome|edge] [--timeoutSec 600] [--output <path>] [--profileDir <path>] [--port 9333]

Example:
  node scripts/capture-linkedin-cookies-interactive.mjs --accountId saikanchi130`);
}

function parseArgs(argv) {
  const out = {
    accountId: '',
    browser: 'chrome',
    timeoutSec: 600,
    output: '',
    profileDir: '',
    port: 9333,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--accountId' && argv[i + 1]) {
      out.accountId = String(argv[++i]).trim();
      continue;
    }
    if (arg === '--browser' && argv[i + 1]) {
      out.browser = String(argv[++i]).toLowerCase().trim();
      continue;
    }
    if (arg === '--timeoutSec' && argv[i + 1]) {
      out.timeoutSec = Number(argv[++i]);
      continue;
    }
    if (arg === '--output' && argv[i + 1]) {
      out.output = path.resolve(String(argv[++i]).trim());
      continue;
    }
    if (arg === '--profileDir' && argv[i + 1]) {
      out.profileDir = path.resolve(String(argv[++i]).trim());
      continue;
    }
    if (arg === '--port' && argv[i + 1]) {
      out.port = Number(argv[++i]);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!out.accountId) {
    throw new Error('Missing --accountId');
  }
  if (!['chrome', 'edge'].includes(out.browser)) {
    throw new Error(`Unsupported --browser '${out.browser}'. Use 'chrome' or 'edge'.`);
  }
  if (!Number.isFinite(out.timeoutSec) || out.timeoutSec <= 0) {
    throw new Error(`Invalid --timeoutSec value: ${out.timeoutSec}`);
  }
  if (!Number.isFinite(out.port) || out.port < 1024 || out.port > 65535) {
    throw new Error(`Invalid --port value: ${out.port}`);
  }

  return out;
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function findBrowserConfig(browser) {
  if (browser === 'edge') {
    const candidates = [
      path.join(process.env['ProgramFiles'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ].filter(Boolean);

    return {
      executablePath: candidates.find((p) => fs.existsSync(p)),
    };
  }

  const candidates = [
    path.join(process.env['ProgramFiles'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);

  return {
    executablePath: candidates.find((p) => fs.existsSync(p)),
  };
}

function getDefaultOutput(accountId) {
  return path.resolve(process.cwd(), 'artifacts', 'cookies', safeName(accountId), 'linkedin-cookies-plain.json');
}

function getDefaultProfileDir(accountId) {
  const root = path.resolve(process.cwd(), 'artifacts', 'chrome-profiles', safeName(accountId));
  return path.join(root, `interactive-${Date.now()}`);
}

function killProcessTree(pid) {
  if (!pid || Number.isNaN(pid)) return;
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

function extractLinkedInCookies(allCookies) {
  return (Array.isArray(allCookies) ? allCookies : []).filter((cookie) =>
    String(cookie?.domain || '').includes('linkedin.com')
  );
}

function computeCookieFlags(linkedInCookies) {
  const liAtCookie = linkedInCookies.find((cookie) => cookie?.name === 'li_at' && cookie?.value);
  const hasLiAt = Boolean(liAtCookie);
  const hasJsession = linkedInCookies.some((cookie) => cookie?.name === 'JSESSIONID' && cookie?.value);
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

function isBlockedAuthPage(url) {
  const value = String(url || '').toLowerCase();
  if (!value.includes('linkedin.com')) return true;
  return AUTH_BLOCK_TOKENS.some((token) => value.includes(token));
}

function isStrongMemberUrl(url) {
  const value = String(url || '').toLowerCase();
  if (!value.includes('linkedin.com') || isBlockedAuthPage(value)) return false;
  try {
    const parsed = new URL(value);
    const pathname = String(parsed.pathname || '/').toLowerCase();
    return pathname === '/feed/' || pathname.startsWith('/feed') || pathname.startsWith('/messaging');
  } catch {
    return false;
  }
}

function isAuthenticatedLinkedInPage(state) {
  const hasUiSignal = Boolean(state?.hasSignedInNav || state?.hasMessagingShell);
  const hasStrongUrlSignal = isStrongMemberUrl(state?.url);
  const guestOnlyState = Boolean(state?.hasGuestCta && !hasUiSignal);
  return Boolean(
    state &&
    !state.blockedAuthPage &&
    !state.hasLoginForm &&
    !state.hasAuthwallMarkers &&
    !guestOnlyState &&
    (hasUiSignal || hasStrongUrlSignal)
  );
}

function formatStateReason(state) {
  if (!state) return 'No browser state available.';
  if (state.blockedAuthPage) {
    if (String(state.url || '').toLowerCase().includes('/checkpoint') || String(state.url || '').toLowerCase().includes('challenge')) {
      return 'LinkedIn challenge/checkpoint is still active.';
    }
    return 'LinkedIn login is not finished yet.';
  }
  if (!state.hasLiAt || !state.hasJsession) {
    return `Waiting for required cookies (li_at=${state.hasLiAt}, JSESSIONID=${state.hasJsession}).`;
  }
  if (!state.authenticated) {
    return 'Waiting for a stable authenticated LinkedIn page.';
  }
  return 'Authenticated session detected.';
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
      if (payload?.webSocketDebuggerUrl) return payload.webSocketDebuggerUrl;
    } catch {
      // keep waiting
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
        ? targets.find((target) => target?.type === 'page' && target?.webSocketDebuggerUrl)
        : null;

      if (pageTarget?.webSocketDebuggerUrl) {
        return pageTarget.webSocketDebuggerUrl;
      }
    } catch {
      // keep waiting
    }
    await delay(500);
  }
  throw new Error('Timed out waiting for a page target in DevTools.');
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
        // ignore malformed frame
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
      const wrappedReject = (error) => {
        clearTimeout(timer);
        reject(error);
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

async function inspectLinkedInDomStateViaCdp(cdp) {
  const expression = `
    (() => {
      const text = (document.body?.innerText || '').toLowerCase();
      const navLinkSelectors = [
        'a[href*="/feed"]',
        'a[href*="/mynetwork"]',
        'a[href*="/messaging"]',
        'a[href*="/notifications"]'
      ].join(', ');
      const navLinks = Array.from(document.querySelectorAll(navLinkSelectors))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const hasPrimaryNavLinks = navLinks.length >= 2;

      return {
        url: location.href,
        title: document.title || '',
        hasLoginForm: Boolean(document.querySelector('input[name="session_key"], input[name="session_password"], form[action*="login"]')),
        hasAuthwallMarkers:
          text.includes('join linkedin') ||
          text.includes('sign in') ||
          text.includes('new to linkedin') ||
          text.includes('continue to linkedin') ||
          text.includes('unlock your profile') ||
          text.includes('challenge'),
        hasSignedInNav:
          hasPrimaryNavLinks ||
          Boolean(
            document.querySelector(
              '.global-nav__me, .global-nav__me-photo, #global-nav-search, .search-global-typeahead, header.global-nav, .global-nav'
            )
          ),
        hasMessagingShell: Boolean(document.querySelector('.msg-conversations-container, .msg-overlay-list-bubble, .msg-s-message-list')),
        hasGuestCta: Boolean(
          document.querySelector(
            'a[data-tracking-control-name*="guest_homepage"], .nav__button-secondary, main section a[href*="/signup"]'
          )
        ),
      };
    })()
  `;

  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, 12000);

  return result?.result?.value || {};
}

function createEnterWatcher() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let pressed = false;
  rl.on('line', () => {
    pressed = true;
  });

  return {
    wasPressed() {
      const current = pressed;
      pressed = false;
      return current;
    },
    close() {
      rl.close();
    },
  };
}

function logState(state, stableForMs = 0, manualCheck = false) {
  const title = String(state?.title || '').trim() || 'n/a';
  const prefix = manualCheck ? '[interactive-capture:manual-check]' : '[interactive-capture]';
  console.log(
    `${prefix} url=${state?.url || 'n/a'} | title=${title} | li_at=${Boolean(state?.hasLiAt)} | JSESSIONID=${Boolean(state?.hasJsession)} | signedInNav=${Boolean(state?.hasSignedInNav)} | messagingShell=${Boolean(state?.hasMessagingShell)} | authenticated=${Boolean(state?.authenticated)} | blocked=${Boolean(state?.blockedAuthPage)} | stableMs=${stableForMs} | reason=${state?.reason || 'none'}`
  );
}

function validateCapturedCookies(cookies, outputFile) {
  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new Error(`Cookie capture did not produce a non-empty JSON array. Expected file: ${outputFile}`);
  }

  const hasLiAt = cookies.some((cookie) => cookie?.name === 'li_at' && cookie?.value);
  const hasJsession = cookies.some((cookie) => cookie?.name === 'JSESSIONID' && cookie?.value);

  if (!hasLiAt || !hasJsession) {
    throw new Error(`Cookie file was created but required LinkedIn cookies are missing (li_at=${hasLiAt}, JSESSIONID=${hasJsession}).`);
  }
}

async function getCaptureState(cdp) {
  const cookieResult = await cdp.send('Network.getAllCookies', {}, 20000);
  const linkedInCookies = extractLinkedInCookies(cookieResult?.cookies || []);
  const flags = computeCookieFlags(linkedInCookies);
  const dom = await inspectLinkedInDomStateViaCdp(cdp).catch(() => ({
    url: '',
    title: '',
    hasLoginForm: false,
    hasAuthwallMarkers: false,
    hasSignedInNav: false,
    hasMessagingShell: false,
    hasGuestCta: false,
  }));

  const state = {
    ...dom,
    ...flags,
    cookies: linkedInCookies,
  };
  state.blockedAuthPage = isBlockedAuthPage(state.url);
  state.authenticated = isAuthenticatedLinkedInPage(state);
  state.reason = formatStateReason(state);
  return state;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browserCfg = findBrowserConfig(args.browser);

  if (!browserCfg.executablePath) {
    throw new Error(`Could not find ${args.browser} executable.`);
  }

  const outputFile = args.output || getDefaultOutput(args.accountId);
  const profileDir = args.profileDir || getDefaultProfileDir(args.accountId);
  ensureDir(path.dirname(outputFile));
  ensureDir(profileDir);

  console.log(`Launching ${args.browser} with temporary profile: ${profileDir}`);
  console.log(`Cookie file will be written to: ${outputFile}`);
  console.log('A new browser window will open. Log into LinkedIn there.');
  console.log('The script will auto-detect a stable login, or you can press Enter in this terminal after login if detection is slow.');

  const child = spawn(browserCfg.executablePath, [
    `--remote-debugging-port=${args.port}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    'https://www.linkedin.com/',
  ], {
    stdio: 'ignore',
    windowsHide: false,
  });

  const enterWatcher = createEnterWatcher();
  let cdp = null;
  let saved = false;

  try {
    await waitForDebuggerEndpoint(args.port, 30000);
    const wsUrl = await waitForPageTargetWs(args.port, 30000);

    cdp = new CdpClient(wsUrl);
    await cdp.connect();
    await cdp.send('Network.enable').catch(() => {});
    await cdp.send('Runtime.enable').catch(() => {});
    await cdp.send('Page.enable').catch(() => {});
    await cdp.send('Page.navigate', { url: 'https://www.linkedin.com/' }, 15000).catch(() => {});

    const deadline = Date.now() + args.timeoutSec * 1000;
    let stableSince = 0;
    let lastSignature = '';
    let lastLogAt = 0;
    let finalState = null;

    while (Date.now() < deadline) {
      const state = await getCaptureState(cdp);

      if (state.authenticated && state.hasLiAt && state.hasJsession && state.liAtFresh) {
        if (!stableSince) {
          stableSince = Date.now();
        }

        const currentStableFor = Date.now() - stableSince;
        const signature = `${state.url}|${state.title}|${state.hasLiAt}|${state.hasJsession}|${state.authenticated}|stable:${Math.floor(currentStableFor / 1000)}`;
        if (signature !== lastSignature || (Date.now() - lastLogAt) >= 10000) {
          logState(state, currentStableFor, false);
          lastSignature = signature;
          lastLogAt = Date.now();
        }

        if (currentStableFor >= CAPTURE_STABLE_MS) {
          finalState = state;
          break;
        }
      } else {
        stableSince = 0;
        const signature = `${state.url}|${state.title}|${state.hasLiAt}|${state.hasJsession}|${state.authenticated}|${state.reason}`;
        if (signature !== lastSignature || (Date.now() - lastLogAt) >= 10000) {
          logState(state, 0, false);
          lastSignature = signature;
          lastLogAt = Date.now();
        }
      }

      if (enterWatcher.wasPressed()) {
        const stateNow = await getCaptureState(cdp);
        logState(stateNow, 0, true);
        if (stateNow.authenticated && stateNow.hasLiAt && stateNow.hasJsession && stateNow.liAtFresh) {
          finalState = stateNow;
          break;
        }
        console.log('Login not fully detected yet. Keep the browser open, finish LinkedIn login, and press Enter again if needed.');
      }

      await delay(CAPTURE_POLL_MS);
    }

    if (!finalState) {
      throw new Error('Timed out waiting for a stable authenticated LinkedIn session. The cookie file was not created.');
    }

    const cookies = finalState.cookies.map(mapCookie);
    validateCapturedCookies(cookies, outputFile);
    fs.writeFileSync(outputFile, JSON.stringify(cookies, null, 2), 'utf8');
    saved = true;

    console.log(`Interactive cookie capture succeeded for account '${args.accountId}'.`);
    console.log(`Saved ${cookies.length} LinkedIn cookies to: ${outputFile}`);
    console.log('Cookie file is a JSON array and includes li_at + JSESSIONID.');
  } finally {
    enterWatcher.close();
    cdp?.close();
    killProcessTree(child.pid);
  }

  if (!saved || !fs.existsSync(outputFile)) {
    throw new Error(`Cookie file was not created: ${outputFile}`);
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
