import {
  getConfig,
  logStep,
  runPreflightChecks,
  sanitizeSummaryForPrint,
} from './e2e-message-session-lib.mjs';

const config = getConfig();

logStep('Starting local LinkedIn message-session preflight', {
  frontendBaseUrl: config.frontendBaseUrl,
  workerBaseUrl: config.workerBaseUrl,
  accountId: config.accountId,
  realLinkedInTestsEnabled: config.enableRealLinkedinTests,
});

const result = await runPreflightChecks(config);

const output = {
  frontend: result.summary.frontend,
  worker: result.summary.worker,
  db: result.summary.db,
  redis: result.summary.redis,
  session: result.summary.session,
  cookies: result.summary.cookies,
  verify: result.summary.verify,
  rateLimit: result.summary.rateLimit,
  recipient: result.summary.recipient,
  details: result.details,
  ...(result.error ? { error: result.error } : {}),
};

console.log(sanitizeSummaryForPrint(output));

if (!result.ok) {
  process.exitCode = 1;
}
