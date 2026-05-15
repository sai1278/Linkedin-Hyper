import {
  appApiRequest,
  buildUniqueSafeMessage,
  findMessageInInbox,
  findPersistedMessages,
  getConfig,
  getWorkerLimits,
  hashValue,
  loginDashboard,
  logStep,
  pollUntil,
  requestJson,
  runPreflightChecks,
  sanitizeSummaryForPrint,
} from './e2e-message-session-lib.mjs';

const config = getConfig();
const summary = {
  health: 'SKIPPED',
  session: 'SKIPPED',
  verify: 'SKIPPED',
  appToLinkedIn: 'SKIPPED',
  linkedInToApp: 'SKIPPED',
  vulnerabilities: [],
};

function recordVulnerability(severity, area, evidence, risk, recommendation, fixedNow = false) {
  summary.vulnerabilities.push({
    severity,
    area,
    evidence,
    risk,
    recommendation,
    fixedNow,
  });
}

async function expectUnauthorizedSend() {
  const response = await requestJson(`${config.frontendBaseUrl}/api/messages/send-new`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Origin: config.frontendBaseUrl,
      Referer: `${config.frontendBaseUrl}/`,
    },
    body: JSON.stringify({
      accountId: config.accountId,
      profileUrl: config.recipientProfileUrl || 'https://www.linkedin.com/in/example',
      text: 'unauthenticated probe',
    }),
  }, { timeoutMs: 20_000 });

  if (response.status !== 401) {
    recordVulnerability(
      'High',
      'Auth / Authorization',
      `Unauthenticated send returned ${response.status} instead of 401.`,
      'A browser or script could attempt message sends without a valid app session.',
      'Require a valid authenticated dashboard session before forwarding /api/messages/send-new.',
      false
    );
  }
}

async function expectUnauthorizedSync() {
  const response = await requestJson(`${config.frontendBaseUrl}/api/sync/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Origin: config.frontendBaseUrl,
      Referer: `${config.frontendBaseUrl}/`,
    },
    body: JSON.stringify({ accountId: config.accountId }),
  }, { timeoutMs: 20_000 });

  if (response.status !== 401) {
    recordVulnerability(
      'High',
      'Auth / Authorization',
      `Unauthenticated sync returned ${response.status} instead of 401.`,
      'An unauthenticated caller could trigger inbox synchronization or account activity.',
      'Require a valid authenticated dashboard session or scoped operator secret before forwarding /api/sync/messages.',
      false
    );
  }
}

if (!config.enableRealLinkedinTests) {
  logStep('Real LinkedIn E2E tests are disabled. Set E2E_ENABLE_REAL_LINKEDIN_TESTS=true to run the controlled send/sync flow.');
  console.log(sanitizeSummaryForPrint(summary));
  process.exit(0);
}

logStep('Running controlled local LinkedIn message-session E2E', {
  accountId: config.accountId,
  frontendBaseUrl: config.frontendBaseUrl,
  workerBaseUrl: config.workerBaseUrl,
});

const preflight = await runPreflightChecks(config);
summary.health = preflight.summary.worker === 'PASS' && preflight.summary.db === 'PASS' && preflight.summary.redis === 'PASS' ? 'PASS' : 'FAIL';
summary.session = preflight.summary.session === 'PASS' && preflight.summary.cookies === 'PASS' ? 'PASS' : 'FAIL';
summary.verify = preflight.summary.verify === 'PASS' ? 'PASS' : 'FAIL';

if (!preflight.ok) {
  console.log(sanitizeSummaryForPrint({ ...summary, preflightError: preflight.error, details: preflight.details }));
  process.exit(1);
}

await expectUnauthorizedSend();
await expectUnauthorizedSync();

const { cookieHeader, user } = await loginDashboard(config);
logStep('Authenticated dashboard session for E2E run', {
  authMode: user?.authMode || 'user',
  role: user?.role || 'unknown',
});

const outboundMessage = buildUniqueSafeMessage(config.messagePrefix);
const outboundRequestId = `e2e-send-${Date.now()}-${hashValue(outboundMessage.text)}`;
const preExistingRows = await findPersistedMessages(config, config.accountId, outboundMessage.text);
if (preExistingRows.length > 0) {
  throw new Error('Refusing to send because the generated outbound test message already exists in the database.');
}

const limitsBefore = await getWorkerLimits(config, config.accountId);
const sendResponse = await appApiRequest(config, cookieHeader, '/api/messages/send-new', {
  method: 'POST',
  headers: {
    'x-request-id': outboundRequestId,
  },
  body: {
    accountId: config.accountId,
    profileUrl: config.recipientProfileUrl,
    text: outboundMessage.text,
  },
  timeoutMs: config.timeoutMs,
});

if (!sendResponse.ok) {
  console.log(sanitizeSummaryForPrint({ ...summary, sendError: sendResponse.json || sendResponse.text }));
  process.exit(1);
}

const sendPayload = sendResponse.json || {};
const outboundThreadId = String(sendPayload.chatId || '').trim();
const outboundMessageId = String(sendPayload.id || '').trim() || null;

const liveThreadMatch = await pollUntil('Sent message in live LinkedIn thread', async () => {
  if (!outboundThreadId) return null;
  const thread = await appApiRequest(
    config,
    cookieHeader,
    `/api/messages/thread?accountId=${encodeURIComponent(config.accountId)}&chatId=${encodeURIComponent(outboundThreadId)}&refresh=1&limit=250`,
    { method: 'GET', timeoutMs: 90_000 }
  );

  const items = Array.isArray(thread.json?.items) ? thread.json.items : [];
  return items.find((item) => item?.text === outboundMessage.text) || null;
}, { timeoutMs: Math.min(config.timeoutMs, 180_000), intervalMs: 8_000 });

summary.appToLinkedIn = liveThreadMatch ? 'PASS' : 'FAIL';

const syncResponseOne = await appApiRequest(config, cookieHeader, '/api/sync/messages', {
  method: 'POST',
  body: { accountId: config.accountId },
  timeoutMs: config.timeoutMs,
});

if (!syncResponseOne.ok) {
  console.log(sanitizeSummaryForPrint({ ...summary, syncError: syncResponseOne.json || syncResponseOne.text }));
  process.exit(1);
}

const inboxMatch = await pollUntil('Sent message in app inbox after sync', async () => {
  const inbox = await appApiRequest(config, cookieHeader, '/api/inbox/unified?limit=100', {
    method: 'GET',
    timeoutMs: 30_000,
  });

  return findMessageInInbox(inbox.json?.conversations, outboundMessage.text, config.accountId);
}, { timeoutMs: Math.min(config.timeoutMs, 120_000), intervalMs: 6_000 });

const persistedAfterFirstSync = await pollUntil('Persisted outbound message in database', async () => {
  const rows = await findPersistedMessages(config, config.accountId, outboundMessage.text);
  return rows.length > 0 ? rows : null;
}, { timeoutMs: Math.min(config.timeoutMs, 120_000), intervalMs: 5_000 });

const syncResponseTwo = await appApiRequest(config, cookieHeader, '/api/sync/messages', {
  method: 'POST',
  body: { accountId: config.accountId },
  timeoutMs: config.timeoutMs,
});

const persistedAfterSecondSync = await findPersistedMessages(config, config.accountId, outboundMessage.text);
if (persistedAfterSecondSync.length !== persistedAfterFirstSync.length) {
  recordVulnerability(
    'Medium',
    'Replay / Duplicate Sends',
    `Message row count changed from ${persistedAfterFirstSync.length} to ${persistedAfterSecondSync.length} after a second sync.`,
    'Repeated sync could create duplicate message rows or duplicate inbox entries.',
    'Keep dedupe protections on conversationId + sentAt + text and preserve LinkedIn message-id matching during sync.',
    false
  );
}

const limitsAfter = await getWorkerLimits(config, config.accountId);
const beforeCurrent = Number(limitsBefore.json?.messagesSent?.current ?? NaN);
const afterCurrent = Number(limitsAfter.json?.messagesSent?.current ?? NaN);
if (Number.isFinite(beforeCurrent) && Number.isFinite(afterCurrent) && afterCurrent < beforeCurrent + 1) {
  recordVulnerability(
    'Low',
    'Rate Limit / Abuse',
    `messagesSent counter did not advance as expected (${beforeCurrent} -> ${afterCurrent}).`,
    'Cooldown and quota visibility could drift from real send activity, making operator safety checks less reliable.',
    'Keep rate-limit counters consistent with successful sends and verify post-send metrics during release checks.',
    false
  );
}

const responseBodies = [
  JSON.stringify(sendResponse.json || {}),
  JSON.stringify(syncResponseOne.json || {}),
  JSON.stringify(syncResponseTwo.json || {}),
];
for (const marker of ['li_at', 'JSESSIONID', 'API_SECRET', 'x-api-key', 'authorization']) {
  if (responseBodies.some((body) => body.includes(marker))) {
    recordVulnerability(
      'High',
      'Logging / Secrets',
      `API response payload contained sensitive marker ${marker}.`,
      'Session cookies or credentials could leak to operators or browser clients.',
      'Mask secrets and never include credential-bearing fields in API JSON responses.',
      false
    );
  }
}

summary.linkedInToApp = 'PASS';

let inboundResult = {
  inboundSenderConfigured: false,
  sent: 'SKIPPED',
  syncVerified: 'SKIPPED',
  duplicateCheck: 'SKIPPED',
  messageId: null,
};

if (config.inboundSenderAccountId && config.inboundReceiverProfileUrl) {
  inboundResult.inboundSenderConfigured = true;

  const inboundVerify = await requestJson(`${config.workerBaseUrl}/accounts/${encodeURIComponent(config.inboundSenderAccountId)}/verify`, {
    method: 'POST',
    headers: {
      ...((config.apiSecret) ? { 'x-api-key': config.apiSecret } : {}),
      'content-type': 'application/json',
      'x-request-id': `e2e-inbound-verify-${Date.now()}`,
    },
    body: JSON.stringify({}),
  }, { timeoutMs: Math.max(90_000, config.timeoutMs) });

  if (!inboundVerify.ok || inboundVerify.json?.ok !== true) {
    recordVulnerability(
      'Low',
      'Session Handling',
      inboundVerify.json?.error || `Inbound sender verify failed with status ${inboundVerify.status}.`,
      'The optional second-account inbound validation could not prove session stability.',
      'Re-import cookies for the inbound sender account before running the full two-account test.',
      false
    );
  } else {
    const inboundMessage = buildUniqueSafeMessage(config.inboundMessagePrefix);
    const inboundSend = await appApiRequest(config, cookieHeader, '/api/messages/send-new', {
      method: 'POST',
      body: {
        accountId: config.inboundSenderAccountId,
        profileUrl: config.inboundReceiverProfileUrl,
        text: inboundMessage.text,
      },
      timeoutMs: config.timeoutMs,
    });

    if (inboundSend.ok) {
      inboundResult.sent = 'PASS';
      inboundResult.messageId = inboundSend.json?.id || null;

      await appApiRequest(config, cookieHeader, '/api/sync/messages', {
        method: 'POST',
        body: { accountId: config.inboundReceiverAccountId },
        timeoutMs: config.timeoutMs,
      });

      const inboundInboxMatch = await pollUntil('Inbound message in receiver inbox', async () => {
        const inbox = await appApiRequest(config, cookieHeader, '/api/inbox/unified?limit=100', {
          method: 'GET',
          timeoutMs: 30_000,
        });
        return findMessageInInbox(inbox.json?.conversations, inboundMessage.text, config.inboundReceiverAccountId);
      }, { timeoutMs: Math.min(config.timeoutMs, 120_000), intervalMs: 6_000 });

      if (inboundInboxMatch) {
        inboundResult.syncVerified = 'PASS';
      }

      const inboundFirstRows = await findPersistedMessages(config, config.inboundReceiverAccountId, inboundMessage.text);
      await appApiRequest(config, cookieHeader, '/api/sync/messages', {
        method: 'POST',
        body: { accountId: config.inboundReceiverAccountId },
        timeoutMs: config.timeoutMs,
      });
      const inboundSecondRows = await findPersistedMessages(config, config.inboundReceiverAccountId, inboundMessage.text);
      inboundResult.duplicateCheck = inboundFirstRows.length === inboundSecondRows.length ? 'PASS' : 'FAIL';
      if (inboundResult.duplicateCheck === 'FAIL') {
        recordVulnerability(
          'Medium',
          'Replay / Duplicate Sends',
          `Inbound sync row count changed from ${inboundFirstRows.length} to ${inboundSecondRows.length}.`,
          'Repeated sync could duplicate inbound rows in the receiver inbox.',
          'Keep LinkedIn message-id dedupe and conversation+timestamp uniqueness intact for inbound sync.',
          false
        );
      }
    }
  }
} else {
  console.log('Inbound real LinkedIn test skipped: second managed test account not configured.');
}

const output = {
  health: summary.health,
  session: summary.session,
  verify: summary.verify,
  appToLinkedIn: summary.appToLinkedIn,
  linkedInToApp: summary.linkedInToApp,
  outbound: {
    messageFingerprint: outboundMessage.fingerprint,
    messageId: outboundMessageId,
    threadId: outboundThreadId || inboxMatch?.conversationId || null,
    dbPersisted: persistedAfterFirstSync.length > 0 ? 'PASS' : 'FAIL',
    syncVerified: inboxMatch ? 'PASS' : 'FAIL',
    duplicateCheck: persistedAfterSecondSync.length === persistedAfterFirstSync.length ? 'PASS' : 'FAIL',
    rateLimitCounterUpdated: Number.isFinite(beforeCurrent) && Number.isFinite(afterCurrent) ? afterCurrent >= beforeCurrent + 1 : 'UNKNOWN',
    syncResponses: {
      first: syncResponseOne.json?.success === true ? 'PASS' : 'FAIL',
      second: syncResponseTwo.ok ? 'PASS' : 'FAIL',
    },
  },
  inbound: inboundResult,
  vulnerabilities: summary.vulnerabilities,
};

console.log(sanitizeSummaryForPrint(output));

if (summary.appToLinkedIn !== 'PASS' || summary.linkedInToApp !== 'PASS') {
  process.exitCode = 1;
}
