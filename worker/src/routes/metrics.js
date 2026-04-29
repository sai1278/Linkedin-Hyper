'use strict';

function registerMetricsRoutes(app, deps) {
  const {
    getMetricsSnapshot,
    getBrowserStats,
    getWorkerStatus,
  } = deps;

  app.get('/metrics', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(
      getMetricsSnapshot({
        worker: getWorkerStatus(),
        browser: getBrowserStats(),
      })
    );
  });
}

module.exports = {
  registerMetricsRoutes,
};
