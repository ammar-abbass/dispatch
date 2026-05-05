import { Worker } from 'bullmq';

import { env } from '@dispatch/config';
import { prisma } from '@dispatch/db';
import { rootLogger } from '@dispatch/logger';
import { redis, jobsDlqQueue } from '@dispatch/queue';

import { defaultJobHandler } from './handlers/default.handler.js';
import { workflowJobHandler } from './handlers/workflow.handler.js';
import { jobsDeadLetteredCounter, workerHeartbeatGauge } from './metrics.js';

const logger = rootLogger.child({ service: 'worker' });
const workerId = `worker-${process.pid}`;

const defaultWorker = new Worker('jobs-default', defaultJobHandler, {
  connection: redis,
  concurrency: Number(env.WORKER_CONCURRENCY),
  stalledInterval: 30_000,
  maxStalledCount: 2,
});

const workflowWorker = new Worker('jobs-workflow', workflowJobHandler, {
  connection: redis,
  concurrency: Number(env.WORKER_CONCURRENCY),
  stalledInterval: 30_000,
  maxStalledCount: 2,
});

const dlqWorker = new Worker(
  'jobs-dlq',
  async (job) => {
    const { executionId, tenantId } = job.data as { executionId?: string; tenantId?: string };
    logger.error({ jobId: job.id, executionId }, 'Dead-lettered job received');

    if (executionId && tenantId) {
      await prisma.jobExecution.update({
        where: { id: executionId },
        data: {
          status: 'dead_lettered',
          finishedAt: new Date(),
        },
      });

      await prisma.executionLog.create({
        data: {
          executionId,
          tenantId,
          level: 'error',
          message: 'Job moved to dead-letter queue after exhausting all retries',
          metadata: { jobId: job.id, queue: job.queueName },
        },
      });
    }
  },
  {
    connection: redis,
    concurrency: 1,
    stalledInterval: 30_000,
    maxStalledCount: 1,
  },
);

// Heartbeat
const heartbeatInterval = setInterval(() => {
  workerHeartbeatGauge.set({ worker_id: workerId }, Date.now() / 1000);
}, 10_000);

for (const worker of [defaultWorker, workflowWorker, dlqWorker]) {
  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, queue: worker.name }, 'Worker completed job');
  });

  worker.on('failed', (job, err) => {
    if (job) {
      const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
      if (exhausted) {
        logger.error({ jobId: job.id, error: err.message }, 'Job exhausted retries, moving to DLQ');
        jobsDeadLetteredCounter.inc({ queue: worker.name });
        jobsDlqQueue
          .add(job.name, job.data, { ...(job.id ? { jobId: job.id } : {}) })
          .catch((error: unknown) => {
            logger.error({ err: error }, 'Failed to move job to DLQ');
          });
      } else {
        logger.warn(
          { jobId: job.id, attempt: job.attemptsMade + 1, error: err.message },
          'Job failed, will retry',
        );
      }
    }
  });
}

logger.info({ workerId, concurrency: env.WORKER_CONCURRENCY }, 'Workers started');

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down workers');
  clearInterval(heartbeatInterval);

  await defaultWorker.pause();
  await workflowWorker.pause();
  await dlqWorker.pause();

  await defaultWorker.close();
  await workflowWorker.close();
  await dlqWorker.close();

  await prisma.$disconnect();
  await redis.quit();

  logger.info('Workers shut down gracefully');
  process.exit(0);
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}
