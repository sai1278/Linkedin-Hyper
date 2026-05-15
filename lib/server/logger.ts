const LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

type LogLevel = keyof typeof LEVEL_ORDER;

type LogFields = Record<string, unknown>;

const configuredLevel = String(
  process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
).toLowerCase() as LogLevel;
const minimumLevel = LEVEL_ORDER[configuredLevel] ?? LEVEL_ORDER.info;

function sanitizeValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value as Error & { code?: string }).code ? { code: (value as Error & { code?: string }).code } : {},
      stack: value.stack,
    };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, entry]) => [key, sanitizeValue(entry)])
        .filter(([, entry]) => entry !== undefined)
    );
  }
  return value;
}

function writeRecord(level: LogLevel, message: string, baseFields: LogFields, extraFields?: LogFields): void {
  if ((LEVEL_ORDER[level] ?? LEVEL_ORDER.info) < minimumLevel) {
    return;
  }

  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: String(message || ''),
  };

  const sanitizedBase = sanitizeValue(baseFields);
  if (sanitizedBase && typeof sanitizedBase === 'object' && !Array.isArray(sanitizedBase)) {
    Object.assign(record, sanitizedBase as Record<string, unknown>);
  }

  const sanitizedExtra = sanitizeValue(extraFields || {});
  if (sanitizedExtra && typeof sanitizedExtra === 'object' && !Array.isArray(sanitizedExtra)) {
    Object.assign(record, sanitizedExtra as Record<string, unknown>);
  }

  const serialized = `${JSON.stringify(record)}\n`;
  if (level === 'error') {
    process.stderr.write(serialized);
    return;
  }
  process.stdout.write(serialized);
}

export function createServerLogger(baseFields: LogFields = {}) {
  return {
    child(extraFields: LogFields = {}) {
      return createServerLogger({ ...baseFields, ...extraFields });
    },
    debug(message: string, fields?: LogFields) {
      writeRecord('debug', message, baseFields, fields);
    },
    info(message: string, fields?: LogFields) {
      writeRecord('info', message, baseFields, fields);
    },
    warn(message: string, fields?: LogFields) {
      writeRecord('warn', message, baseFields, fields);
    },
    error(message: string, fields?: LogFields) {
      writeRecord('error', message, baseFields, fields);
    },
  };
}

export const serverLogger = createServerLogger({
  service: 'linkedin-hyper-web',
  pid: process.pid,
});
