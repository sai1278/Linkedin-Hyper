'use strict';

function createJobRunner(deps) {
  const {
    getQueue,
    getQueueEvents,
    runNamedJob,
  } = deps;

  const nonIdempotentJobs = new Set(['sendMessageNew', 'sendConnectionRequest']);
  const selfRetryingJobs = new Set(['verifySession', 'readConnections', 'readMessages', 'readThread', 'searchPeople']);
  const dedupeWindowJobs = new Set(['messageSync']);

  function toQueueUnavailableError(originalErr) {
    const msg = originalErr instanceof Error ? originalErr.message : String(originalErr);
    const err = new Error('Background queue unavailable. Start Redis and retry.');
    err.status = 503;
    err.code = 'QUEUE_UNAVAILABLE';
    err.cause = msg;
    return err;
  }

  function isQueueConnectivityError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      msg.includes('Connection is closed') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('getaddrinfo')
    );
  }

  async function runDirectJob(name, data) {
    return runNamedJob(name, data);
  }

  async function runJob(name, data, timeoutMs = 120_000) {
    const runDirectly = process.env.DIRECT_EXECUTION === '1' || process.env.DISABLE_QUEUE === '1';
    if (runDirectly) {
      return runDirectJob(name, data);
    }

    const accountId = data.accountId || 'default';
    const queue = getQueue(accountId);
    const queueEvents = getQueueEvents(accountId);
    const jobId = dedupeWindowJobs.has(name)
      ? `${name}:${accountId}:${Math.floor(Date.now() / 30_000)}`
      : undefined;

    let job;
    try {
      const retryOptions = (nonIdempotentJobs.has(name) || selfRetryingJobs.has(name))
        ? { attempts: 1 }
        : {
            attempts: 2,
            backoff: { type: 'exponential', delay: 5000 },
          };

      job = await queue.add(name, data, {
        ...(jobId ? { jobId } : {}),
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
        ...retryOptions,
      });
    } catch (err) {
      if (isQueueConnectivityError(err)) throw toQueueUnavailableError(err);
      throw err;
    }

    try {
      return await job.waitUntilFinished(queueEvents, timeoutMs);
    } catch (err) {
      if (isQueueConnectivityError(err)) throw toQueueUnavailableError(err);

      if (err.message && err.message.includes('timed out')) {
        await job.remove().catch(() => {});
        const toErr = new Error(`Job ${name} timed out after ${timeoutMs}ms`);
        toErr.status = 504;
        throw toErr;
      }
      const reason = String(job.failedReason || err?.message || 'Job failed');
      const lowerReason = reason.toLowerCase();
      const failErr = new Error(reason);

      failErr.code = err?.code || job?.failedReasonCode || undefined;
      failErr.status = err?.status || 500;

      if (!failErr.code) {
        if (
          reason.includes('CHECKPOINT_INCOMPLETE') ||
          lowerReason.includes('checkpoint/challenge is still pending')
        ) {
          failErr.code = 'CHECKPOINT_INCOMPLETE';
          failErr.status = 401;
        } else if (
          reason.includes('NAVIGATION_REDIRECT_LOOP') ||
          lowerReason.includes('redirected too many times') ||
          lowerReason.includes('err_too_many_redirects')
        ) {
          failErr.code = 'NAVIGATION_REDIRECT_LOOP';
          failErr.status = 401;
        } else if (reason.includes('LOGIN_NOT_FINISHED') || lowerReason.includes('login is not fully completed')) {
          failErr.code = 'LOGIN_NOT_FINISHED';
          failErr.status = 401;
        } else if (reason.includes('COOKIES_MISSING') || lowerReason.includes('li_at/jsessionid')) {
          failErr.code = 'COOKIES_MISSING';
          failErr.status = 401;
        } else if (reason.includes('AUTHENTICATED_STATE_NOT_REACHED') || lowerReason.includes('authenticated linkedin member state was not reached')) {
          failErr.code = 'AUTHENTICATED_STATE_NOT_REACHED';
          failErr.status = 401;
        } else if (reason.includes('Session expired for account')) {
          failErr.code = 'SESSION_EXPIRED';
          failErr.status = 401;
        } else if (reason.includes('No session for account')) {
          failErr.code = 'NO_SESSION';
          failErr.status = 401;
        } else if (reason.includes('All LinkedIn sessions are missing or expired')) {
          failErr.code = 'NO_ACTIVE_SESSION';
          failErr.status = 401;
        } else if (
          lowerReason.includes('could not open message composer from profile') ||
          lowerReason.includes('not_messageable') ||
          lowerReason.includes('not messageable')
        ) {
          failErr.code = 'NOT_MESSAGEABLE';
          failErr.status = 400;
        } else if (
          reason.includes('Message send could not be confirmed in thread') ||
          reason.includes('Send clicked but LinkedIn thread ID was not resolved') ||
          reason.includes('Message was not found in thread after send confirmation')
        ) {
          failErr.code = 'SEND_NOT_CONFIRMED';
          failErr.status = 502;
        } else if (lowerReason.includes('operation failed')) {
          failErr.code = 'SEND_NOT_CONFIRMED';
          failErr.status = 502;
          failErr.message = 'LinkedIn UI transient failure while sending message. Please retry once with fresh cookies.';
        } else if (reason.includes('Daily limit reached:')) {
          failErr.code = 'RATE_LIMIT_EXCEEDED';
          failErr.status = 429;
        }
      }

      throw failErr;
    }
  }

  return {
    runJob,
  };
}

module.exports = {
  createJobRunner,
};
