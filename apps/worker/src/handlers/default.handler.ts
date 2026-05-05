import { prisma } from '@dispatch/db';
import { createLogger } from '@dispatch/logger';
import { JobPayload, WorkflowStepPayload } from '@dispatch/queue';
import { Job } from 'bullmq';

import { classifyFailure } from '../failure-classifier.js';
import { jobsCompletedCounter, jobsFailedCounter, jobDurationHistogram } from '../metrics.js';
import { workflowStepHandler } from './workflow.handler.js';

export async function defaultJobHandler(job: Job<JobPayload>): Promise<void> {
  if ('stepName' in job.data) {
    return workflowStepHandler(job as unknown as Job<WorkflowStepPayload>);
  }

  const { executionId, tenantId, jobDefinitionId, payload, meta } = job.data;
  const logger = createLogger({
    jobId: job.id ?? 'unknown',
    executionId,
    tenantId,
    correlationId: meta.correlationId,
  });

  const startTime = Date.now();
  logger.info({ attempt: job.attemptsMade + 1 }, 'Job started');

  await prisma.jobExecution.update({
    where: { id: executionId },
    data: { status: 'active', startedAt: new Date() },
  });

  await prisma.executionLog.create({
    data: {
      executionId,
      tenantId,
      level: 'info',
      message: `Job started (attempt ${job.attemptsMade + 1})`,
      metadata: { payload: payload as any, queue: job.queueName },
    },
  });

  try {
    await simulateWork(jobDefinitionId, payload);

    const durationSec = (Date.now() - startTime) / 1000;
    jobDurationHistogram.observe({ queue: job.queueName }, durationSec);
    jobsCompletedCounter.inc({ queue: job.queueName });

    await prisma.jobExecution.update({
      where: { id: executionId },
      data: { status: 'completed', finishedAt: new Date() },
    });

    await prisma.executionLog.create({
      data: {
        executionId,
        tenantId,
        level: 'info',
        message: 'Job completed successfully',
        metadata: { durationSec },
      },
    });

    logger.info({ durationSec }, 'Job completed');
  } catch (error) {
    const durationSec = (Date.now() - startTime) / 1000;
    const failureType = classifyFailure(error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    jobsFailedCounter.inc({ queue: job.queueName, failure_type: failureType });

    logger.warn(
      { attempt: job.attemptsMade + 1, failureType, errorMessage, durationSec },
      'Job failed',
    );

    // Note: attemptsMade is already incremented by BullMQ for the current attempt.
    const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);

    await prisma.jobExecution.update({
      where: { id: executionId },
      data: {
        status: exhausted ? 'failed' : 'retrying',
        errorMessage,
        failureType,
        finishedAt: exhausted ? new Date() : null,
      },
    });

    await prisma.executionLog.create({
      data: {
        executionId,
        tenantId,
        level: 'error',
        message: errorMessage,
        metadata: { failureType, attempt: job.attemptsMade + 1, durationSec },
      },
    });

    throw error;
  }
}

async function simulateWork(
  _jobDefinitionId: string,
  _payload: Record<string, unknown>,
): Promise<void> {
  // Placeholder for actual job logic
  // In production, this would dispatch to a registry of handlers by jobDefinitionId
  await new Promise((resolve) => setTimeout(resolve, 100));

  if (Math.random() < 0.05) {
    throw new Error('Simulated transient failure');
  }
}
