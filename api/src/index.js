import express from 'express';
import winston from 'winston';
import healthRoutes from './routes/health.js';
import messageRoutes from './routes/messages.js';
import accountRoutes from './routes/accounts.js';
import connectionRoutes from './routes/connections.js';
import profileRoutes from './routes/profiles.js';
import { redis } from '../queue.js'; // Ensure connection cleanly

const logger = winston.createLogger({
  level: 'info',
  format: process.env.NODE_ENV === 'production'
    ? winston.format.json()
    : winston.format.simple(),
  transports: [new winston.transports.Console()],
});

const app = express();

app.use(express.json({ limit: '50kb' }));

app.use('/health', healthRoutes);
app.use('/messages', messageRoutes);
app.use('/accounts', accountRoutes);
app.use('/connections', connectionRoutes);
app.use('/profiles', profileRoutes);

app.use((err, req, res, next) => {
  logger.error({ msg: 'Unhandled error', error: err.message });
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    code: err.code || 'INTERNAL_ERROR'
  });
});

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  logger.info({ msg: `API listening on port ${port}` });
});

const shutdown = async () => {
  logger.info({ msg: 'Shutting down gracefully' });
  server.close(async () => {
    await redis.quit();
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
