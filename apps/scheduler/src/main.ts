import { setInterval } from 'node:timers/promises';

import { env } from '@dispatch/config';
import { prisma } from '@dispatch/db';
import { rootLogger } from '@dispatch/logger';
import { jobsDefaultQueue } from '@dispatch/queue';
import { nanoid } from 'nanoid';

const logger = rootLogger.child({ service: 'scheduler' });

async function syncSchedules() {
  logger.debug('Syncing recurring job schedules');

  const recurringDefs = await prisma.jobDefinition.findMany({
    where: {
      type: 'recurring',
      isActive: true,
    },
  });

  for (const def of recurringDefs) {
    if (!def.scheduleCron) continue;

    // Check if there's already a waiting execution for this definition
    const existing = await prisma.jobExecution.findFirst({
      where: {
        jobDefinitionId: def.id,
        status: { in: ['waiting', 'scheduled'] },
      },
    });

    if (existing) continue;

    const execution = await prisma.jobExecution.create({
      data: {
        tenantId: def.tenantId,
        jobDefinitionId: def.id,
        status: 'scheduled',
        triggeredBy: 'scheduler',
        scheduledFor: new Date(),
      },
    });

    const bullJobId = `${def.tenantId}:${def.id}:${nanoid()}`;

    await jobsDefaultQueue.add(
      def.name,
      {
        executionId: execution.id,
        tenantId: def.tenantId,
        jobDefinitionId: def.id,
        payload: {},
        meta: {
          correlationId: nanoid(),
          triggeredBy: 'scheduler',
        },
      },
      {
        jobId: bullJobId,
        repeat: { pattern: def.scheduleCron },
        attempts: (def.retryPolicy as { maxAttempts: number }).maxAttempts,
        backoff: {
          type: (def.retryPolicy as { backoff: string }).backoff,
          delay: (def.retryPolicy as { delay: number }).delay,
        },
        removeOnComplete: { count: 100 },
        removeOnFail: false,
      },
    );

    await prisma.jobExecution.update({
      where: { id: execution.id },
      data: { bullJobId, status: 'waiting' },
    });

    logger.info({ jobDefinitionId: def.id, executionId: execution.id }, 'Scheduled recurring job');
  }
}

async function main() {
  logger.info('Scheduler starting');

  const intervalMs = Number(env.SCHEDULER_INTERVAL_MS);

  for await (const _ of setInterval(intervalMs, undefined, { ref: false })) {
    try {
      await syncSchedules();
    } catch (error) {
      logger.error({ err: error }, 'Schedule sync failed');
    }
  }
}

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down scheduler');
  await prisma.$disconnect();
  process.exit(0);
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

main().catch((error: unknown) => {
  logger.fatal(error);
  process.exit(1);
});
