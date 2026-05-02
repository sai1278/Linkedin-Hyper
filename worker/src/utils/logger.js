'use strict';

const crypto = require('crypto');

const LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = String(
  process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
).toLowerCase();
const minimumLevel = LEVEL_ORDER[configuredLevel] || LEVEL_ORDER.info;

function sanitizeValue(value) {
  if (value === undefined) return undefined;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      code: value.code,
      stack: value.stack,
    };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, entry]) => [key, sanitizeValue(entry)])
        .filter(([, entry]) => entry !== undefined)
    );
  }
  return value;
}

function writeRecord(level, message, baseFields, extraFields) {
  if ((LEVEL_ORDER[level] || LEVEL_ORDER.info) < minimumLevel) {
    return;
  }

  const record = {
    ts: new Date().toISOString(),
    level,
    msg: String(message || ''),
    ...sanitizeValue(baseFields || {}),
    ...sanitizeValue(extraFields || {}),
  };

  const serialized = `${JSON.stringify(record)}\n`;
  if (level === 'error') {
    process.stderr.write(serialized);
    return;
  }
  process.stdout.write(serialized);
}

function createLogger(baseFields = {}) {
  return {
    child(extraFields = {}) {
      return createLogger({ ...baseFields, ...extraFields });
    },
    debug(message, fields) {
      writeRecord('debug', message, baseFields, fields);
    },
    info(message, fields) {
      writeRecord('info', message, baseFields, fields);
    },
    warn(message, fields) {
      writeRecord('warn', message, baseFields, fields);
    },
    error(message, fields) {
      writeRecord('error', message, baseFields, fields);
    },
  };
}

const logger = createLogger({
  service: 'linkedin-hyper-worker',
  pid: process.pid,
});

function createRequestLoggerMiddleware() {
  return (req, res, next) => {
    const requestId = String(req.headers['x-request-id'] || crypto.randomUUID());
    const startedAt = Date.now();
    const route = req.originalUrl || req.url || '';

    req.requestId = requestId;
    req.log = logger.child({
      requestId,
      route,
      method: req.method,
    });

    res.setHeader('X-Request-Id', requestId);

    res.on('finish', () => {
      req.log.info('request.completed', {
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });

    next();
  };
}

module.exports = {
  logger,
  createLogger,
  createRequestLoggerMiddleware,
};
