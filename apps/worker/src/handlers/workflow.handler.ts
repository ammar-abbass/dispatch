import { Job } from 'bullmq';
import { prisma } from '@atlas/db';
import { createLogger } from '@atlas/logger';
import { JobPayload } from '@atlas/queue';
import { jobsCompletedCounter, jobDurationHistogram } from '../metrics.js';

export async function workflowJobHandler(job: Job<JobPayload>): Promise<void> {
  const { executionId, tenantId, meta } = job.data;
  const logger = createLogger({
    jobId: job.id ?? 'unknown',
    executionId,
    tenantId,
    correlationId: meta.correlationId,
  });

  logger.info('Workflow parent job started (all children completed)');

  const execution = await prisma.jobExecution.findUnique({
    where: { id: executionId },
  });

  if (!execution) {
    throw new Error(`Execution ${executionId} not found`);
  }

  const durationSec = execution.startedAt ? (Date.now() - execution.startedAt.getTime()) / 1000 : 0;
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
      message: 'Workflow completed successfully',
      metadata: { durationSec },
    },
  });

  logger.info({ durationSec }, 'Workflow completed');
}

import { WorkflowStepPayload } from '@atlas/queue';
import { classifyFailure } from '../failure-classifier.js';

export async function workflowStepHandler(job: Job<WorkflowStepPayload>): Promise<void> {
  const { executionId, tenantId, stepName, stepIndex, payload, meta } = job.data;
  const logger = createLogger({
    jobId: job.id ?? 'unknown',
    executionId,
    tenantId,
    correlationId: meta.correlationId,
    stepName,
  });

  const startTime = Date.now();
  logger.info({ attempt: job.attemptsMade + 1 }, 'Workflow step started');

  // If this is the first step, ensure execution is active
  if (stepIndex === 0 && job.attemptsMade === 0) {
    await prisma.jobExecution.update({
      where: { id: executionId },
      data: { status: 'active', startedAt: new Date() },
    });
  }

  // Create or update the job_step record
  const stepRecord = await prisma.jobStep.create({
    data: {
      tenantId,
      executionId,
      stepName,
      status: 'active',
      attemptCount: job.attemptsMade + 1,
      startedAt: new Date(),
    },
  });

  try {
    // Simulate work for step
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (Math.random() < 0.05) throw new Error('Simulated transient step failure');

    const durationSec = (Date.now() - startTime) / 1000;

    await prisma.jobStep.update({
      where: { id: stepRecord.id },
      data: { status: 'completed', finishedAt: new Date() },
    });

    await prisma.executionLog.create({
      data: {
        executionId,
        tenantId,
        level: 'info',
        message: `Step ${stepName} completed successfully`,
        metadata: { durationSec, stepName },
      },
    });

    logger.info({ durationSec }, 'Workflow step completed');
  } catch (error) {
    const failureType = classifyFailure(error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.warn({ attempt: job.attemptsMade + 1, failureType, errorMessage }, 'Workflow step failed');

    const exhausted = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

    await prisma.jobStep.update({
      where: { id: stepRecord.id },
      data: {
        status: exhausted ? 'failed' : 'retrying',
        finishedAt: exhausted ? new Date() : null,
      },
    });

    // If a step exhausts all retries, the whole execution fails
    if (exhausted) {
      await prisma.jobExecution.update({
        where: { id: executionId },
        data: {
          status: 'failed',
          errorMessage: `Step ${stepName} failed: ${errorMessage}`,
          failureType,
          finishedAt: new Date(),
        },
      });
    }

    await prisma.executionLog.create({
      data: {
        executionId,
        tenantId,
        level: 'error',
        message: `Step ${stepName} failed: ${errorMessage}`,
        metadata: { failureType, attempt: job.attemptsMade + 1, stepName },
      },
    });

    throw error;
  }
}
