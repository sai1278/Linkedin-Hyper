#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function usage() {
  console.log(`Usage:
  npm run cookies:capture -- --accountId <id> [--browser chrome|edge] [--useLiveProfile]
  npm run cookies:capture-interactive -- --accountId <id> [--browser chrome|edge]
  npm run cookies:refresh-direct -- --accountId <id> --baseUrl <url> --apiSecret <API_SECRET>
  npm run cookies:import -- --accountId <id> [--autoCapture] [--cookieFile <path>] [--baseUrl <url>] [--routeAuthToken <token>] [--apiKey <key>]
  npm run cookies:verify -- --accountId <id> [--baseUrl <url>] [--routeAuthToken <token>] [--apiKey <key>]
  npm run cookies:status -- --accountId <id> [--baseUrl <url>] [--routeAuthToken <token>] [--apiKey <key>]

Examples:
  npm run cookies:capture -- --accountId saikanchi130 --browser chrome --useLiveProfile
  npm run cookies:capture-interactive -- --accountId saikanchi130
  npm run cookies:refresh-direct -- --accountId saikanchi130 --baseUrl http://139.59.98.240:3002/api --apiSecret <API_SECRET>
  npm run cookies:import -- --accountId saikanchi130 --autoCapture --useLiveProfile --baseUrl http://139.59.98.240:3002/api --routeAuthToken <token>
  npm run cookies:verify -- --accountId saikanchi130 --baseUrl http://127.0.0.1:3001 --apiKey <API_SECRET>`);
}

function safeName(value) {
  return String(value || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'unknown';
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return new Map();
  }

  const values = new Map();
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

const envValues = parseEnvFile(path.join(repoRoot, '.env'));

function getConfigValue(key) {
  const envValue = process.env[key];
  if (typeof envValue === 'string' && envValue.trim()) {
    return envValue.trim();
  }
  return envValues.get(key)?.trim() || '';
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command: command || '',
    accountId: '',
    cookieFile: '',
    autoCapture: false,
    useLiveProfile: false,
    browser: 'chrome',
    captureTimeoutSec: 240,
    capturePort: 9229,
    captureProfile: '',
    baseUrl: getConfigValue('COOKIE_IMPORT_BASE_URL') || 'http://localhost:3001',
    routeAuthToken: getConfigValue('API_ROUTE_AUTH_TOKEN'),
    apiKey: getConfigValue('API_SECRET'),
  };

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    switch (arg) {
      case '--accountId':
        options.accountId = String(rest[++i] || '').trim();
        break;
      case '--cookieFile':
        options.cookieFile = path.resolve(String(rest[++i] || '').trim());
        break;
      case '--browser':
        options.browser = String(rest[++i] || 'chrome').trim().toLowerCase();
        break;
      case '--captureTimeoutSec':
        options.captureTimeoutSec = Number(rest[++i] || 240);
        break;
      case '--capturePort':
        options.capturePort = Number(rest[++i] || 9229);
        break;
      case '--captureProfile':
        options.captureProfile = String(rest[++i] || '').trim();
        break;
      case '--baseUrl':
        options.baseUrl = String(rest[++i] || '').trim();
        break;
      case '--routeAuthToken':
        options.routeAuthToken = String(rest[++i] || '').trim();
        break;
      case '--apiKey':
        options.apiKey = String(rest[++i] || '').trim();
        break;
      case '--apiSecret':
        options.apiKey = String(rest[++i] || '').trim();
        break;
      case '--autoCapture':
        options.autoCapture = true;
        break;
      case '--useLiveProfile':
        options.useLiveProfile = true;
        break;
      case '--help':
      case '-h':
        usage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function ensureCommand(options) {
  if (!options.command) {
    usage();
    throw new Error('Missing command. Use capture, capture-interactive, refresh-direct, import, verify, or status.');
  }
}

function ensureAccountId(options) {
  if (!options.accountId) {
    throw new Error('Missing --accountId');
  }
}

function defaultCookieFile(accountId) {
  return path.join(repoRoot, 'artifacts', 'cookies', safeName(accountId), 'linkedin-cookies-plain.json');
}

function isFrontendApi(baseUrl) {
  return /\/api\/?$/i.test(String(baseUrl || ''));
}

function buildHeaders(options) {
  if (isFrontendApi(options.baseUrl)) {
    if (options.apiKey) {
      return {
        'Content-Type': 'application/json',
        'X-Api-Key': options.apiKey,
      };
    }

    if (!options.routeAuthToken) {
      throw new Error(
        'BaseUrl points to the public /api BFF. Provide --apiSecret for the cookie-operator allowlist, or use --routeAuthToken only if your deployment explicitly allows static bearer tokens.'
      );
    }
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.routeAuthToken}`,
    };
  }

  if (!options.apiKey) {
    throw new Error(
      'Missing API key. Provide --apiKey, or set API_SECRET in .env/environment for direct worker access.'
    );
  }

  return {
    'Content-Type': 'application/json',
    'X-Api-Key': options.apiKey,
  };
}

async function requestJson(url, init) {
  const res = await fetch(url, init);
  const raw = await res.text();
  let data = null;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }
  }

  if (!res.ok) {
    const error = new Error(
      data?.error || data?.raw || `${res.status} ${res.statusText}`
    );
    error.status = res.status;
    error.code = data?.code;
    error.payload = data;
    throw error;
  }

  return data ?? {};
}

function hasRequiredLinkedInCookies(cookies) {
  let hasLiAt = false;
  let hasJsession = false;
  for (const cookie of cookies) {
    if (!cookie || typeof cookie !== 'object') continue;
    if (cookie.name === 'li_at' && cookie.value) hasLiAt = true;
    if (cookie.name === 'JSESSIONID' && cookie.value) hasJsession = true;
  }
  return hasLiAt && hasJsession;
}

function loadCookiesFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Cookie file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) {
    throw new Error(`Cookie file is empty: ${filePath}`);
  }

  const parsed = JSON.parse(raw);
  const cookies = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.cookies)
      ? parsed.cookies
      : typeof parsed?.data === 'string' && parsed.data.trim().startsWith('[')
        ? JSON.parse(parsed.data)
        : null;

  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new Error('Unsupported cookie JSON format. Expected a JSON array of cookie objects.');
  }

  if (!hasRequiredLinkedInCookies(cookies)) {
    throw new Error('Required LinkedIn cookies li_at and JSESSIONID are missing from the selected file.');
  }

  return cookies;
}

function printOperatorHint(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === 'SESSION_EXPIRED' || /session expired/i.test(message)) {
    console.error('Hint: the imported cookies are already expired. Capture fresh cookies and retry.');
    return;
  }
  if (code === 'CHECKPOINT_INCOMPLETE' || /checkpoint/i.test(message)) {
    console.error('Hint: LinkedIn checkpoint/challenge is still pending. Complete it in the browser, then re-run the import.');
    return;
  }
  if (code === 'LOGIN_NOT_FINISHED' || /login is not fully completed/i.test(message)) {
    console.error('Hint: LinkedIn login was not fully completed during capture. Finish login, wait for feed or messaging, then retry.');
    return;
  }
  if (code === 'COOKIES_MISSING' || /li_at/i.test(message)) {
    console.error('Hint: required LinkedIn cookies were not captured. Capture again from an authenticated LinkedIn session.');
    return;
  }
  if (/Static service bearer tokens are disabled in production/i.test(message)) {
    console.error('Hint: this production deployment blocks static bearer tokens. Use --baseUrl http://<host>:3002/api --apiSecret <API_SECRET> for the cookie operator allowlist, or server-local worker access if your runbook prefers it.');
    return;
  }
  if (/fetch failed/i.test(message)) {
    console.error('Hint: the target baseUrl is unreachable from this laptop. If port 3001 is blocked, use the public BFF URL http://<host>:3002/api with --apiSecret <API_SECRET>.');
    return;
  }
  if (/request timed out/i.test(message) || /backend request timed out/i.test(message)) {
    console.error('Hint: cookie import may already have succeeded. Retry verification once, or check session status before recapturing cookies.');
  }
}

function isTimeoutLikeError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code.includes('timeout') || message.includes('timed out');
}

function spawnLogged(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
      ...options,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

async function runCapture(options) {
  ensureAccountId(options);
  const outputFile = options.cookieFile || defaultCookieFile(options.accountId);
  const args = [
    path.join('scripts', 'capture-linkedin-cookies.mjs'),
    '--browser',
    options.browser,
    '--timeoutSec',
    String(options.captureTimeoutSec),
    '--port',
    String(options.capturePort),
    '--output',
    outputFile,
  ];

  if (options.captureProfile) {
    args.push('--profile', options.captureProfile);
  }
  args.push(options.useLiveProfile ? '--use-live-profile' : '--use-temp-copy');

  console.log(`Starting LinkedIn cookie capture for account '${options.accountId}'.`);
  console.log(`Cookie file will be written to: ${outputFile}`);
  try {
    await spawnLogged(process.execPath, args);
  } catch (error) {
    if (options.useLiveProfile) {
      console.error('Live profile capture failed. Use cookies:capture-interactive instead.');
      console.error(`Suggested command: npm run cookies:capture-interactive -- --accountId ${options.accountId}`);
    }
    throw error;
  }

  if (!fs.existsSync(outputFile)) {
    throw new Error(`Cookie file was not created: ${outputFile}`);
  }

  console.log('');
  console.log(`Cookie capture succeeded for account '${options.accountId}'.`);
  console.log(`Saved file: ${outputFile}`);
  console.log('Next step: import the file into the worker and verify the session.');
  return outputFile;
}

async function runCaptureInteractive(options) {
  ensureAccountId(options);
  const outputFile = options.cookieFile || defaultCookieFile(options.accountId);
  const args = [
    path.join('scripts', 'capture-linkedin-cookies-interactive.mjs'),
    '--accountId',
    options.accountId,
    '--browser',
    options.browser,
    '--timeoutSec',
    String(Math.max(300, options.captureTimeoutSec || 600)),
    '--output',
    outputFile,
  ];

  console.log(`Starting interactive LinkedIn cookie capture for account '${options.accountId}'.`);
  console.log(`Cookie file will be written to: ${outputFile}`);
  await spawnLogged(process.execPath, args);

  if (!fs.existsSync(outputFile)) {
    throw new Error(`Cookie file was not created: ${outputFile}`);
  }

  const cookies = loadCookiesFromFile(outputFile);
  console.log('');
  console.log(`Interactive cookie capture succeeded for account '${options.accountId}'.`);
  console.log(`Saved file: ${outputFile}`);
  console.log(`Validated cookies: ${cookies.length} entries with li_at + JSESSIONID present.`);
  console.log('Next step: upload the file through the cookie operator or import it with your preferred runbook.');
  return outputFile;
}

async function getSessionStatus(options) {
  ensureAccountId(options);
  const headers = buildHeaders(options);
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/accounts/${encodeURIComponent(options.accountId)}/session/status`;
  return requestJson(url, { method: 'GET', headers });
}

async function runVerify(options, label = 'Verification') {
  ensureAccountId(options);
  const headers = buildHeaders(options);
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/accounts/${encodeURIComponent(options.accountId)}/verify`;
  const result = await requestJson(url, { method: 'POST', headers });
  if (result?.ok) {
    console.log(`${label} succeeded for account '${options.accountId}'.`);
    console.log(`Reached URL: ${result.url || 'n/a'}`);
    console.log(`Verified via: ${result.via || 'n/a'}`);
  } else {
    console.log(`${label} finished but did not return ok=true.`);
  }
  return result;
}

async function runVerifyWithRetry(options, label = 'Verification', attempts = 2) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (attempt > 1) {
        console.log(`${label} retry ${attempt}/${attempts}...`);
      }
      return await runVerify(options, label);
    } catch (error) {
      lastError = error;
      if (!isTimeoutLikeError(error) || attempt >= attempts) {
        throw error;
      }
      console.log(`${label} timed out on attempt ${attempt}/${attempts}. Waiting 10 seconds before retrying...`);
      await delay(10_000);
    }
  }
  throw lastError || new Error(`${label} failed`);
}

async function runSync(options, label = 'Sync') {
  ensureAccountId(options);
  const headers = buildHeaders(options);
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/sync/messages`;
  const result = await requestJson(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ accountId: options.accountId }),
  });

  if (result?.success) {
    console.log(`${label} completed for account '${options.accountId}'.`);
    if (result?.completed === true) {
      console.log('Sync finished before returning.');
    }
    if (result?.stats) {
      const summary = {
        conversationsProcessed: result.stats.conversationsProcessed,
        newMessages: result.stats.newMessages,
        updatedConversations: result.stats.updatedConversations,
        durationMs: result.stats.durationMs,
      };
      console.log(`Sync stats: ${JSON.stringify(summary)}`);
    }
  }

  return result;
}

async function runImport(options) {
  ensureAccountId(options);
  const cookieFile = options.autoCapture
    ? await runCapture(options)
    : (options.cookieFile || defaultCookieFile(options.accountId));
  const cookies = loadCookiesFromFile(cookieFile);
  const headers = buildHeaders(options);
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const importUrl = `${baseUrl}/accounts/${encodeURIComponent(options.accountId)}/session`;

  console.log(`Importing cookies for account '${options.accountId}' from: ${cookieFile}`);
  const importResult = await requestJson(importUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(cookies),
  });
  console.log(`Cookie import succeeded for account '${options.accountId}'.`);
  console.log(`Imported cookies: ${importResult?.cookieCount ?? cookies.length}`);

  await runVerifyWithRetry(options, 'Immediate verification');
  await delay(5000);
  await runVerifyWithRetry(options, 'Persistence verification');

  const status = await getSessionStatus(options);
  if (status?.exists) {
    console.log(`Session status is healthy for '${options.accountId}'.`);
    if (typeof status.savedAt === 'number') {
      console.log(`savedAt: ${new Date(status.savedAt).toISOString()}`);
    }
    if (typeof status.ageSeconds === 'number') {
      console.log(`ageSeconds: ${status.ageSeconds}`);
    }
  }
}

async function runRefreshDirect(options) {
  ensureAccountId(options);
  if (!options.baseUrl) {
    throw new Error('Missing --baseUrl');
  }
  if (!options.apiKey) {
    throw new Error('Missing --apiSecret');
  }

  const directOptions = {
    ...options,
    routeAuthToken: '',
  };

  let cookieFile = directOptions.cookieFile || defaultCookieFile(directOptions.accountId);

  console.log(`Capturing cookies for account '${directOptions.accountId}'...`);
  try {
    cookieFile = await runCapture({
      ...directOptions,
      cookieFile,
      useLiveProfile: true,
    });
  } catch {
    console.log('Live profile capture failed. Falling back to interactive capture...');
    cookieFile = await runCaptureInteractive({
      ...directOptions,
      cookieFile,
    });
  }

  console.log('Validating cookie file...');
  const cookies = loadCookiesFromFile(cookieFile);
  console.log(`Validated ${cookies.length} cookies. Required LinkedIn cookies are present.`);

  const headers = buildHeaders(directOptions);
  const baseUrl = directOptions.baseUrl.replace(/\/$/, '');
  const importUrl = `${baseUrl}/accounts/${encodeURIComponent(directOptions.accountId)}/session`;

  console.log('Uploading cookies...');
  const importResult = await requestJson(importUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(cookies),
  });
  console.log(`Uploaded cookies successfully for '${directOptions.accountId}'.`);
  console.log(`Server accepted ${importResult?.cookieCount ?? cookies.length} cookies.`);

  console.log('Verifying session...');
  await runVerifyWithRetry(directOptions, 'Session verification');

  console.log('Running sync...');
  await runSync(directOptions, 'Sync');

  console.log(`SUCCESS: cookie refresh completed for account '${directOptions.accountId}'.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureCommand(options);

  try {
    switch (options.command) {
      case 'capture':
        await runCapture(options);
        break;
      case 'capture-interactive':
        await runCaptureInteractive(options);
        break;
      case 'refresh-direct':
        await runRefreshDirect(options);
        break;
      case 'import':
        await runImport(options);
        break;
      case 'verify':
        await runVerify(options);
        break;
      case 'status': {
        const status = await getSessionStatus(options);
        if (status?.exists) {
          console.log(`Session exists for '${options.accountId}'.`);
          console.log(JSON.stringify(status, null, 2));
        } else {
          console.log(`No saved session found for '${options.accountId}'.`);
        }
        break;
      }
      default:
        usage();
        throw new Error(`Unsupported command: ${options.command}`);
    }
  } catch (error) {
    console.error(`Cookie operator failed: ${error.message || String(error)}`);
    printOperatorHint(error);
    process.exitCode = 1;
  }
}

main();
