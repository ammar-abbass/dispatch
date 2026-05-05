import { FastifyInstance } from 'fastify';
import { prisma } from '@dispatch/db';
import { redis } from '@dispatch/queue';
import { register, collectDefaultMetrics } from 'prom-client';
import { apiRequestDurationHistogram } from '../metrics/metrics.js';

collectDefaultMetrics({ register });

export async function healthRoutes(app: FastifyInstance) {
  // Collect API request duration on every request
  app.addHook('onResponse', async (req, reply) => {
    apiRequestDurationHistogram.observe(
      { method: req.method, route: req.url, status: reply.statusCode.toString() },
      reply.elapsedTime / 1000,
    );
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await redis.ping();
      return { status: 'ready' };
    } catch {
      return { status: 'not_ready' };
    }
  });

  app.get('/metrics', async (_req, reply) => {
    const metrics = await register.metrics();
    return reply.type('text/plain').send(metrics);
  });
}
