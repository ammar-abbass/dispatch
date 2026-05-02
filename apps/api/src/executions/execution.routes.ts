import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, ScopedRepository } from '@atlas/db';
import { AtlasError, tenantScope } from '@atlas/shared';
import { jobsDefaultQueue } from '@atlas/queue';
import { nanoid } from 'nanoid';
import { auditLog } from '../audit/audit.service.js';
import { checkRateLimit } from '../rate-limit/rate-limit.service.js';

export async function executionRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  app.get('/', {
    preHandler: app.authorize(['admin', 'operator', 'viewer']),
  }, async (req) => {
    const { status, definitionId, page = '1', limit = '20' } = req.query as Record<string, string>;
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const repo = new ScopedRepository(prisma, req.tenantId);

    const where = {
      ...(status ? { status } : {}),
      ...(definitionId ? { jobDefinitionId: definitionId } : {}),
    };

    const [items, count] = await Promise.all([
      repo.jobExecutions().findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { jobDefinition: { select: { name: true, type: true } } },
      }),
      repo.jobExecutions().count({ where }),
    ]);

    return { items, total: count, page: Number(page), limit: take };
  });

  app.get('/:id', {
    preHandler: app.authorize(['admin', 'operator', 'viewer']),
  }, async (req) => {
    const { id } = req.params as { id: string };
    const execution = await prisma.jobExecution.findFirst({
      where: { id, ...tenantScope(req.tenantId) },
      include: {
        jobDefinition: { select: { name: true, type: true, retryPolicy: true } },
        jobSteps: true,
      },
    });
    if (!execution) throw new AtlasError('NOT_FOUND', 'Execution not found', 404);
    return execution;
  });

  app.get('/:id/logs', {
    preHandler: app.authorize(['admin', 'operator', 'viewer']),
  }, async (req) => {
    const { id } = req.params as { id: string };
    const { page = '1', limit = '50' } = req.query as Record<string, string>;
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const repo = new ScopedRepository(prisma, req.tenantId);
    const execution = await repo.jobExecutions().findFirst({
      where: { id },
      select: { id: true },
    });
    if (!execution) throw new AtlasError('NOT_FOUND', 'Execution not found', 404);

    const [items, count] = await Promise.all([
      repo.executionLogs().findMany({
        where: { executionId: id },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      repo.executionLogs().count({ where: { executionId: id } }),
    ]);

    return { items, total: count, page: Number(page), limit: take };
  });

  app.post('/:id/cancel', {
    preHandler: app.authorize(['admin', 'operator']),
  }, async (req) => {
    await checkRateLimit(req.tenantId, 'executions:cancel');
    const { id } = req.params as { id: string };

    const repo = new ScopedRepository(prisma, req.tenantId);
    const execution = await repo.jobExecutions().findFirst({
      where: { id },
    });
    if (!execution) throw new AtlasError('NOT_FOUND', 'Execution not found', 404);
    if (!['waiting', 'scheduled'].includes(execution.status)) {
      throw new AtlasError('CONFLICT_ERROR', 'Cannot cancel active or finished execution', 409);
    }

    if (execution.bullJobId) {
      const job = await jobsDefaultQueue.getJob(execution.bullJobId);
      if (job) await job.remove();
    }

    await prisma.jobExecution.update({
      where: { id },
      data: { status: 'cancelled', finishedAt: new Date() },
    });

    await auditLog({
      tenantId: req.tenantId,
      actorId: req.userId,
      action: 'job.cancelled',
      entityType: 'job_execution',
      entityId: id,
    });

    return { cancelled: true };
  });

  app.post('/:id/retry', {
    preHandler: app.authorize(['admin', 'operator']),
  }, async (req) => {
    await checkRateLimit(req.tenantId, 'executions:retry');
    const { id } = req.params as { id: string };

    const execution = await prisma.jobExecution.findFirst({
      where: { id, ...tenantScope(req.tenantId) },
      include: { jobDefinition: true },
    });
    if (!execution) throw new AtlasError('NOT_FOUND', 'Execution not found', 404);
    if (!['failed', 'dead_lettered'].includes(execution.status)) {
      throw new AtlasError('CONFLICT_ERROR', 'Only failed or dead-lettered executions can be retried', 409);
    }

    const newExecution = await prisma.jobExecution.create({
      data: {
        tenantId: req.tenantId,
        jobDefinitionId: execution.jobDefinitionId,
        status: 'scheduled',
        triggeredBy: 'manual_retry',
        scheduledFor: new Date(),
      },
    });

    const bullJobId = `${req.tenantId}:${execution.jobDefinitionId}:${newExecution.id}`;

    await jobsDefaultQueue.add(
      execution.jobDefinition.name,
      {
        executionId: newExecution.id,
        tenantId: req.tenantId,
        jobDefinitionId: execution.jobDefinitionId,
        payload: {},
        meta: {
          correlationId: req.requestId ?? nanoid(),
          triggeredBy: 'manual_retry',
        },
      },
      {
        jobId: bullJobId,
        attempts: (execution.jobDefinition.retryPolicy as { maxAttempts: number }).maxAttempts,
        backoff: {
          type: (execution.jobDefinition.retryPolicy as { backoff: string }).backoff,
          delay: (execution.jobDefinition.retryPolicy as { delay: number }).delay,
        },
        removeOnComplete: { count: 100 },
        removeOnFail: false,
      },
    );

    await prisma.jobExecution.update({
      where: { id: newExecution.id },
      data: { bullJobId, status: 'waiting' },
    });

    await auditLog({
      tenantId: req.tenantId,
      actorId: req.userId,
      action: 'job.retried',
      entityType: 'job_execution',
      entityId: newExecution.id,
      metadata: { originalExecutionId: id },
    });

    return { retried: true, executionId: newExecution.id };
  });
}
