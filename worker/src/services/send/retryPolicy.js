'use strict';

function isRecoverableBrowserError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (!msg) return false;

  return (
    msg === 'operation failed' ||
    msg.includes('operation failed') ||
    msg.includes('err_too_many_redirects') ||
    msg.includes('too many redirects') ||
    msg.includes('session closed') ||
    msg.includes('frame was detached') ||
    msg.includes('target page, context or browser has been closed') ||
    msg.includes('protocol error (page.createisolatedworld)') ||
    msg.includes('protocol error (page.addscripttoevaluateonnewdocument)') ||
    msg.includes('net::err_aborted')
  );
}

function wrapSendError(accountId, err) {
  const msg = String(err?.message || err || '');
  const lowered = msg.toLowerCase();

  if (lowered.includes('err_too_many_redirects') || lowered.includes('too many redirects')) {
    const wrapped = new Error(
      `LinkedIn redirected too many times for account ${accountId}. Session is likely invalid or challenged. Re-import cookies and retry.`
    );
    wrapped.code = 'SESSION_EXPIRED';
    wrapped.status = 401;
    return wrapped;
  }

  if (lowered.includes('operation failed')) {
    const wrapped = new Error(
      'LinkedIn UI transient failure while sending message. Please retry once with fresh cookies.'
    );
    wrapped.code = 'SEND_NOT_CONFIRMED';
    wrapped.status = 502;
    return wrapped;
  }

  return err;
}

module.exports = {
  isRecoverableBrowserError,
  wrapSendError,
};
