'use strict';

function registerPublicHealthRoute(app, deps) {
  const {
    getRedis,
    withTimeout,
    accountRepo,
    getWorkerStatus,
    getBrowserStats,
    isBrowserManagerReady,
    logger,
  } = deps;

  app.get('/health', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const log = (req.log || logger).child({ route: '/health' });
    const startedAt = Date.now();

    const dependencies = {
      redis: { status: 'unknown' },
      database: { status: 'unknown' },
      worker: { status: 'unknown' },
      browser: { status: 'unknown' },
    };

    let redisHealthy = false;
    let databaseHealthy = false;

    try {
      const redis = getRedis();
      const ping = await withTimeout(redis.ping(), 2_000, 'REDIS_TIMEOUT');
      redisHealthy = String(ping).toUpperCase() === 'PONG';
      dependencies.redis = {
        status: redisHealthy ? 'healthy' : 'unhealthy',
        detail: String(ping),
      };
    } catch (error) {
      dependencies.redis = {
        status: 'unhealthy',
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      const dbAccounts = await withTimeout(accountRepo.getAllAccounts(), 6_000, 'DB_TIMEOUT');
      databaseHealthy = Array.isArray(dbAccounts);
      dependencies.database = {
        status: databaseHealthy ? 'healthy' : 'unhealthy',
        detail: databaseHealthy ? `${dbAccounts.length} account row(s) readable` : 'Database returned unexpected payload',
      };
    } catch (error) {
      dependencies.database = {
        status: 'unhealthy',
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    const workerStatus = getWorkerStatus();
    dependencies.worker = {
      status: workerStatus.ready ? 'healthy' : 'degraded',
      detail: workerStatus.queueDisabled ? 'Queue disabled; direct execution mode' : `${workerStatus.activeWorkers} worker(s) active`,
      activeWorkers: workerStatus.activeWorkers,
      schedulerEnabled: workerStatus.schedulerEnabled,
      directExecution: workerStatus.directExecution,
    };

    const browserStats = getBrowserStats();
    dependencies.browser = {
      status: isBrowserManagerReady() ? 'healthy' : 'degraded',
      detail: browserStats.shuttingDown ? 'Browser manager is shutting down' : `${browserStats.activeContexts} active context(s)`,
      activeContexts: browserStats.activeContexts,
      maxContexts: browserStats.maxContexts,
      busyAccounts: browserStats.busyAccounts,
    };

    const criticalHealthy = redisHealthy && databaseHealthy;
    const statusCode = criticalHealthy ? 200 : 503;
    const payload = {
      status: criticalHealthy ? 'ok' : 'unhealthy',
      generatedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      criticalDependencies: {
        redis: redisHealthy,
        database: databaseHealthy,
      },
      dependencies,
    };

    log.info('health.checked', {
      durationMs: payload.durationMs,
      statusCode,
      redis: dependencies.redis.status,
      database: dependencies.database.status,
      worker: dependencies.worker.status,
      browser: dependencies.browser.status,
    });

    res.status(statusCode).json(payload);
  });
}

function registerInternalHealthRoutes(app, deps) {
  const {
    buildHealthSummary,
    buildStartupValidationReport,
    logger,
  } = deps;

  app.get('/health/summary', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const payload = await buildHealthSummary();
      res.json(payload);
    } catch (err) {
      (req.log || logger).error('health.summary_failed', {
        errorCode: err?.code || 'HEALTH_SUMMARY_FAILED',
        error: err,
      });
      res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
    }
  });

  app.get('/health/startup-validation', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const report = await buildStartupValidationReport();
      res.json(report);
    } catch (err) {
      (req.log || logger).error('health.startup_validation_failed', {
        errorCode: err?.code || 'STARTUP_VALIDATION_FAILED',
        error: err,
      });
      res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
    }
  });
}

module.exports = {
  registerInternalHealthRoutes,
  registerPublicHealthRoute,
};
