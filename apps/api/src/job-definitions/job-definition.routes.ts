import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, ScopedRepository, Prisma } from '@atlas/db';
import { AtlasError } from '@atlas/shared';
import { jobsDefaultQueue } from '@atlas/queue';
import { nanoid } from 'nanoid';
import { auditLog } from '../audit/audit.service.js';
import { validateCron } from '../validation/cron-validator.js';
import { checkRateLimit } from '../rate-limit/rate-limit.service.js';

const createSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['one_off', 'delayed', 'recurring', 'workflow']),
  payloadSchema: z.record(z.unknown()).optional(),
  scheduleCron: z.string().optional(),
  retryPolicy: z.object({
    maxAttempts: z.number().int().min(1).max(20),
    backoff: z.enum(['fixed', 'exponential']),
    delay: z.number().int().min(100).max(3600000),
  }),
}).strict();

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  retryPolicy: z.object({
    maxAttempts: z.number().int().min(1).max(20),
    backoff: z.enum(['fixed', 'exponential']),
    delay: z.number().int().min(100).max(3600000),
  }).optional(),
  scheduleCron: z.string().optional(),
  isActive: z.boolean().optional(),
}).strict();

export async function jobDefinitionRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  app.post('/', {
    preHandler: app.authorize(['admin']),
  }, async (req, reply) => {
    await checkRateLimit(req.tenantId, 'job-definitions:create');
    const body = createSchema.parse(req.body);

    if (body.type === 'recurring' && body.scheduleCron) {
      validateCron(body.scheduleCron);
    }

    if (body.type === 'recurring' && !body.scheduleCron) {
      throw new AtlasError('VALIDATION_ERROR', 'Recurring jobs require scheduleCron', 400);
    }

    if (body.type === 'workflow' && body.payloadSchema) {
      const steps = (body.payloadSchema as Record<string, unknown>)?.steps;
      if (Array.isArray(steps) && steps.length > 10) {
        throw new AtlasError('VALIDATION_ERROR', 'Workflow depth capped at 10 steps', 400);
      }
    }

    const repo = new ScopedRepository(prisma, req.tenantId);
    const def = await repo.jobDefinitions().create({
      data: {
        name: body.name,
        type: body.type,
        payloadSchema: body.payloadSchema ? (body.payloadSchema as Prisma.InputJsonValue) : Prisma.DbNull,
        scheduleCron: body.scheduleCron ?? null,
        retryPolicy: body.retryPolicy as Prisma.InputJsonValue,
      },
    });

    await auditLog({
      tenantId: req.tenantId,
      actorId: req.userId,
      action: 'job_definition.created',
      entityType: 'job_definition',
      entityId: def.id,
    });

    return reply.code(201).send(def);
  });

  app.get('/', {
    preHandler: app.authorize(['admin', 'operator', 'viewer']),
  }, async (req) => {
    const { page = '1', limit = '20' } = req.query as Record<string, string>;
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const repo = new ScopedRepository(prisma, req.tenantId);

    const [items, count] = await Promise.all([
      repo.jobDefinitions().findMany({
        where: { isActive: true },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      repo.jobDefinitions().count({
        where: { isActive: true },
      }),
    ]);

    return { items, total: count, page: Number(page), limit: take };
  });

  app.get('/:id', {
    preHandler: app.authorize(['admin', 'operator', 'viewer']),
  }, async (req) => {
    const { id } = req.params as { id: string };
    const repo = new ScopedRepository(prisma, req.tenantId);
    const def = await repo.jobDefinitions().findFirst({
      where: { id },
    });
    if (!def) throw new AtlasError('NOT_FOUND', 'Job definition not found', 404);
    return def;
  });

  app.patch('/:id', {
    preHandler: app.authorize(['admin']),
  }, async (req) => {
    await checkRateLimit(req.tenantId, 'job-definitions:update');
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);

    if (body.scheduleCron) {
      validateCron(body.scheduleCron);
    }

    const repo = new ScopedRepository(prisma, req.tenantId);
    const existing = await repo.jobDefinitions().findFirst({
      where: { id },
    });
    if (!existing) throw new AtlasError('NOT_FOUND', 'Job definition not found', 404);

    const dataToUpdate: Prisma.JobDefinitionUpdateInput = { updatedAt: new Date() };
    if (body.name !== undefined) dataToUpdate.name = body.name;
    if (body.scheduleCron !== undefined) dataToUpdate.scheduleCron = body.scheduleCron;
    if (body.isActive !== undefined) dataToUpdate.isActive = body.isActive;
    if (body.retryPolicy !== undefined) dataToUpdate.retryPolicy = body.retryPolicy as Prisma.InputJsonValue;

    const updated = await prisma.jobDefinition.update({
      where: { id },
      data: dataToUpdate,
    });

    await auditLog({
      tenantId: req.tenantId,
      actorId: req.userId,
      action: 'job_definition.updated',
      entityType: 'job_definition',
      entityId: updated.id,
    });

    return updated;
  });

  app.delete('/:id', {
    preHandler: app.authorize(['admin']),
  }, async (req, reply) => {
    await checkRateLimit(req.tenantId, 'job-definitions:delete');
    const { id } = req.params as { id: string };

    const repo = new ScopedRepository(prisma, req.tenantId);
    const existing = await repo.jobDefinitions().findFirst({
      where: { id },
    });
    if (!existing) throw new AtlasError('NOT_FOUND', 'Job definition not found', 404);

    await prisma.jobDefinition.update({
      where: { id },
      data: { isActive: false, updatedAt: new Date() },
    });

    await auditLog({
      tenantId: req.tenantId,
      actorId: req.userId,
      action: 'job_definition.deleted',
      entityType: 'job_definition',
      entityId: id,
    });

    return reply.code(204).send();
  });

  app.post('/:id/trigger', {
    preHandler: app.authorize(['admin', 'operator']),
  }, async (req, reply) => {
    await checkRateLimit(req.tenantId, 'job-definitions:trigger');
    const { id } = req.params as { id: string };
    const idempotencyKey = (req.headers['idempotency-key'] as string) ?? nanoid();

    const repo = new ScopedRepository(prisma, req.tenantId);
    const def = await repo.jobDefinitions().findFirst({
      where: { id, isActive: true },
    });
    if (!def) throw new AtlasError('NOT_FOUND', 'Job definition not found', 404);

    const existingExecution = await prisma.jobExecution.findUnique({
      where: { idempotencyKey },
    });
    if (existingExecution) {
      throw new AtlasError('CONFLICT_ERROR', 'Execution already exists for this idempotency key', 409);
    }

    const execution = await prisma.jobExecution.create({
      data: {
        tenantId: req.tenantId,
        jobDefinitionId: def.id,
        status: 'scheduled',
        idempotencyKey,
        triggeredBy: 'api',
        scheduledFor: new Date(),
      },
    });

    const bullJobId = `${req.tenantId}:${def.id}:${idempotencyKey}`;

    await jobsDefaultQueue.add(
      def.name,
      {
        executionId: execution.id,
        tenantId: req.tenantId,
        jobDefinitionId: def.id,
        payload: (req.body as Record<string, unknown> | undefined) ?? {},
        meta: {
          correlationId: req.requestId ?? nanoid(),
          triggeredBy: 'api',
        },
      },
      {
        jobId: bullJobId,
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

    await auditLog({
      tenantId: req.tenantId,
      actorId: req.userId,
      action: 'job.triggered',
      entityType: 'job_execution',
      entityId: execution.id,
      metadata: { jobDefinitionId: def.id, idempotencyKey },
    });

    return reply.code(202).send(execution);
  });

  app.post('/:id/pause', {
    preHandler: app.authorize(['admin', 'operator']),
  }, async (req) => {
    const { id } = req.params as { id: string };
    const repo = new ScopedRepository(prisma, req.tenantId);
    const def = await repo.jobDefinitions().findFirst({
      where: { id, type: 'recurring' },
    });
    if (!def) throw new AtlasError('NOT_FOUND', 'Recurring job definition not found', 404);

    await prisma.jobDefinition.update({
      where: { id },
      data: { isActive: false, updatedAt: new Date() },
    });

    await auditLog({
      tenantId: req.tenantId,
      actorId: req.userId,
      action: 'job.paused',
      entityType: 'job_definition',
      entityId: id,
    });

    return { paused: true };
  });

  app.post('/:id/resume', {
    preHandler: app.authorize(['admin', 'operator']),
  }, async (req) => {
    const { id } = req.params as { id: string };
    const repo = new ScopedRepository(prisma, req.tenantId);
    const def = await repo.jobDefinitions().findFirst({
      where: { id, type: 'recurring' },
    });
    if (!def) throw new AtlasError('NOT_FOUND', 'Recurring job definition not found', 404);

    await prisma.jobDefinition.update({
      where: { id },
      data: { isActive: true, updatedAt: new Date() },
    });

    await auditLog({
      tenantId: req.tenantId,
      actorId: req.userId,
      action: 'job.resumed',
      entityType: 'job_definition',
      entityId: id,
    });

    return { resumed: true };
  });
}
