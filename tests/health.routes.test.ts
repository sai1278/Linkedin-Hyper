import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
type HealthHandler = (req: unknown, res: ReturnType<typeof createMockResponse>) => Promise<unknown> | unknown;
const {
  registerPublicHealthRoute,
} = require('../worker/src/routes/health.js') as {
  registerPublicHealthRoute: (app: { get: (path: string, handler: HealthHandler) => void }, deps: Record<string, unknown>) => void;
};

function createMockLogger() {
  const logger = {
    child: () => logger,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return logger;
}

function createMockResponse() {
  return {
    headers: new Map<string, string>(),
    statusCode: 200,
    payload: null as unknown,
    set(name: string, value: string) {
      this.headers.set(name, value);
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
}

describe('health routes', () => {
  it('returns 200 when redis and database are healthy', async () => {
    let handler: HealthHandler | undefined;
    const logger = createMockLogger();
    const app = {
      get: (path: string, routeHandler: HealthHandler) => {
        if (path === '/health') handler = routeHandler;
      },
    };

    registerPublicHealthRoute(app, {
      getRedis: () => ({ ping: vi.fn().mockResolvedValue('PONG') }),
      getRedisRuntimeState: () => ({ shared: { status: 'ready' } }),
      withTimeout: async (promise: Promise<unknown>) => await promise,
      accountRepo: { getAllAccounts: vi.fn().mockResolvedValue([{ id: 'acct-1' }]) },
      getWorkerStatus: () => ({ ready: true, queueDisabled: false, activeWorkers: 2, schedulerEnabled: true, directExecution: false }),
      getBrowserStats: () => ({ shuttingDown: false, activeContexts: 1, maxContexts: 5, busyAccounts: [] }),
      isBrowserManagerReady: () => true,
      getQueueStats: async () => ({ queueCount: 1, readyQueues: 1, totals: { waiting: 0, active: 0, delayed: 0, failed: 0 } }),
      logger,
    });

    if (!handler) throw new Error('Expected /health route handler to be registered');

    const res = createMockResponse();
    await handler({ log: logger }, res);

    expect(res.statusCode).toBe(200);
    expect((res.payload as { status: string }).status).toBe('ok');
  });

  it('returns 503 when a critical dependency is unhealthy', async () => {
    let handler: HealthHandler | undefined;
    const logger = createMockLogger();
    const app = {
      get: (path: string, routeHandler: HealthHandler) => {
        if (path === '/health') handler = routeHandler;
      },
    };

    registerPublicHealthRoute(app, {
      getRedis: () => ({ ping: vi.fn().mockResolvedValue('PONG') }),
      getRedisRuntimeState: () => ({ shared: { status: 'ready' } }),
      withTimeout: async (promise: Promise<unknown>) => await promise,
      accountRepo: { getAllAccounts: vi.fn().mockRejectedValue(new Error('db unavailable')) },
      getWorkerStatus: () => ({ ready: true, queueDisabled: false, activeWorkers: 1, schedulerEnabled: true, directExecution: false }),
      getBrowserStats: () => ({ shuttingDown: false, activeContexts: 0, maxContexts: 5, busyAccounts: [] }),
      isBrowserManagerReady: () => true,
      getQueueStats: async () => ({ queueCount: 1, readyQueues: 1, totals: { waiting: 0, active: 0, delayed: 0, failed: 0 } }),
      logger,
    });

    if (!handler) throw new Error('Expected /health route handler to be registered');

    const res = createMockResponse();
    await handler({ log: logger }, res);

    expect(res.statusCode).toBe(503);
    expect((res.payload as { status: string }).status).toBe('unhealthy');
  });
});
