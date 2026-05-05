import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@dispatch/db';
import { DispatchError, paginate } from '@dispatch/shared';
import { jobsDefaultQueue, flowProducer } from '@dispatch/queue';
import { nanoid } from 'nanoid';
import { auditLog } from '../audit/audit.service.js';
import { validateCron } from '../validation/cron-validator.js';
import { checkRateLimit } from '../rate-limit/rate-limit.service.js';
import { JobDefinitionService } from './job-definition.service.js';
import { JobDefinitionRepository } from './job-definition.repository.js';

const createSchema = z
  .object({
    name: z.string().min(1).max(200),
    type: z.enum(['one_off', 'delayed', 'recurring', 'workflow']),
    payloadSchema: z.any().optional(),
    scheduleCron: z.string().optional(),
    retryPolicy: z.object({
      maxAttempts: z.number().int().min(1).max(20),
      backoff: z.enum(['fixed', 'exponential']),
      delay: z.number().int().min(100).max(3600000),
    }),
  })
  .strict();

const updateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    retryPolicy: z
      .object({
        maxAttempts: z.number().int().min(1).max(20),
        backoff: z.enum(['fixed', 'exponential']),
        delay: z.number().int().min(100).max(3600000),
      })
      .optional(),
    scheduleCron: z.string().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export async function jobDefinitionRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  const jobDefService = new JobDefinitionService(new JobDefinitionRepository());

  app.post(
    '/',
    {
      schema: {
        tags: ['Job Definitions'],
        summary: 'Create a new job definition',
        body: createSchema,
      },
      preHandler: app.authorize(['admin']),
    },
    async (req, reply) => {
      await checkRateLimit(req, 'job-definitions:create');
      const body = createSchema.parse(req.body);

      const result = await jobDefService.createJobDefinition(req.tenantId, req.userId, body);

      return reply.code(201).send(result);
    },
  );

  app.get(
    '/',
    {
      schema: {
        tags: ['Job Definitions'],
        summary: 'List job definitions',
        querystring: z.object({
          cursor: z.string().optional(),
          limit: z.string().optional(),
        }),
      },
      preHandler: app.authorize(['admin', 'operator', 'viewer']),
    },
    async (req) => {
      const { limit: limitStr = '20' } = req.query as Record<string, string>;
      const limit = Math.min(Number(limitStr), 100);

      const { items, total } = await jobDefService.listJobDefinitions(req.tenantId, limit);

      return paginate(items, total, limit);
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['Job Definitions'],
        summary: 'Get a job definition by ID',
        params: z.object({ id: z.string().uuid() }),
      },
      preHandler: app.authorize(['admin', 'operator', 'viewer']),
    },
    async (req) => {
      const { id } = req.params as { id: string };

      return jobDefService.getJobDefinition(req.tenantId, id);
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['Job Definitions'],
        summary: 'Update a job definition',
        params: z.object({ id: z.string().uuid() }),
        body: updateSchema,
      },
      preHandler: app.authorize(['admin']),
    },
    async (req, reply) => {
      await checkRateLimit(req, 'job-definitions:update');
      const { id } = req.params as { id: string };
      const body = updateSchema.parse(req.body);

      if (body.scheduleCron) {
        validateCron(body.scheduleCron);
      }

      const result = await jobDefService.updateJobDefinition(req.tenantId, req.userId, id, body);

      return result;
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['Job Definitions'],
        summary: 'Delete a job definition',
        params: z.object({ id: z.string().uuid() }),
      },
      preHandler: app.authorize(['admin']),
    },
    async (req, reply) => {
      await checkRateLimit(req, 'job-definitions:delete');
      const { id } = req.params as { id: string };

      await jobDefService.deleteJobDefinition(req.tenantId, req.userId, id);

      return reply.code(204).send();
    },
  );

  app.post(
    '/:id/trigger',
    {
      schema: {
        tags: ['Job Definitions'],
        summary: 'Trigger a job execution manually',
        params: z.object({ id: z.string().uuid() }),
        body: z.any().optional(),
      },
      preHandler: app.authorize(['admin', 'operator']),
    },
    async (req, reply) => {
      await checkRateLimit(req, 'job-definitions:trigger');
      const { id } = req.params as { id: string };
      const body = req.body as { idempotencyKey?: string; payload?: Record<string, unknown> };

      const execution = await jobDefService.triggerJobDefinition(
        req.tenantId,
        req.userId,
        id,
        req.requestId,
        body.idempotencyKey,
        body.payload,
      );

      return reply.code(202).send(execution);
    },
  );

  app.post(
    '/:id/pause',
    {
      preHandler: app.authorize(['admin', 'operator']),
    },
    async (req) => {
      const { id } = req.params as { id: string };

      await jobDefService.pauseJobDefinition(req.tenantId, req.userId, id);

      return { paused: true };
    },
  );

  app.post(
    '/:id/resume',
    {
      preHandler: app.authorize(['admin', 'operator']),
    },
    async (req) => {
      const { id } = req.params as { id: string };

      await jobDefService.resumeJobDefinition(req.tenantId, req.userId, id);

      return { resumed: true };
    },
  );
}
