'use strict';

function registerMetricsRoutes(app, deps) {
  const {
    getMetricsSnapshot,
    getBrowserStats,
    getWorkerStatus,
    getQueueStats,
  } = deps;

  app.get('/metrics', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const queue = typeof getQueueStats === 'function'
      ? await getQueueStats().catch(() => null)
      : null;
    res.json(
      getMetricsSnapshot({
        worker: getWorkerStatus(),
        browser: getBrowserStats(),
        queue,
      })
    );
  });
}

module.exports = {
  registerMetricsRoutes,
};
