import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, ScopedRepository } from '@atlas/db';
import { AtlasError, tenantScope, paginate } from '@atlas/shared';
import { jobsDefaultQueue } from '@atlas/queue';
import { nanoid } from 'nanoid';
import { auditLog } from '../audit/audit.service.js';
import { checkRateLimit } from '../rate-limit/rate-limit.service.js';

export async function executionRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  app.get('/', {
    schema: {
      tags: ['Executions'],
      summary: 'List job executions',
      querystring: z.object({
        status: z.string().optional(),
        definitionId: z.string().uuid().optional(),
        cursor: z.string().optional(),
        limit: z.string().optional(),
      }),
    },
    preHandler: app.authorize(['admin', 'operator', 'viewer']),
  }, async (req) => {
    const { status, definitionId, limit: limitStr = '20' } = req.query as Record<string, string>;
    const limit = Math.min(Number(limitStr), 100);

    const repo = new ScopedRepository(prisma, req.tenantId);

    const where = {
      ...(status ? { status } : {}),
      ...(definitionId ? { jobDefinitionId: definitionId } : {}),
    };

    const [items, total] = await Promise.all([
      repo.jobExecutions().findMany({
        where,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { jobDefinition: { select: { name: true, type: true } } },
      }),
      repo.jobExecutions().count({ where }),
    ]);

    return paginate(items, total, limit);
  });

  app.get('/:id', {
    schema: {
      tags: ['Executions'],
      summary: 'Get execution details',
      params: z.object({ id: z.string().uuid() }),
    },
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
    schema: {
      tags: ['Executions'],
      summary: 'Get execution logs',
      params: z.object({ id: z.string().uuid() }),
      querystring: z.object({
        page: z.string().optional(),
        limit: z.string().optional(),
      }),
    },
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
    schema: {
      tags: ['Executions'],
      summary: 'Cancel an execution',
      params: z.object({ id: z.string().uuid() }),
    },
    preHandler: app.authorize(['admin', 'operator']),
  }, async (req) => {
    await checkRateLimit(req, 'executions:cancel');
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
    schema: {
      tags: ['Executions'],
      summary: 'Retry a failed execution',
      params: z.object({ id: z.string().uuid() }),
    },
    preHandler: app.authorize(['admin', 'operator']),
  }, async (req) => {
    await checkRateLimit(req, 'executions:retry');
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

  /** GET /v1/executions/:id/steps — list steps for a workflow execution */
  app.get('/:id/steps', {
    schema: {
      tags: ['Executions'],
      summary: 'List steps for a workflow execution',
      params: z.object({ id: z.string().uuid() }),
    },
    preHandler: app.authorize(['admin', 'operator', 'viewer']),
  }, async (req) => {
    const { id } = req.params as { id: string };

    const execution = await prisma.jobExecution.findFirst({
      where: { id, ...tenantScope(req.tenantId) },
      select: { id: true },
    });
    if (!execution) throw new AtlasError('NOT_FOUND', 'Execution not found', 404);

    const steps = await prisma.jobStep.findMany({
      where: { executionId: id, tenantId: req.tenantId },
      orderBy: { startedAt: 'asc' },
    });

    return { data: steps, meta: { total: steps.length } };
  });
}
