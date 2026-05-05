import { paginate } from '@dispatch/shared';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ExecutionRepository } from './execution.repository.js';
import { ExecutionService } from './execution.service.js';
import { checkRateLimit } from '../rate-limit/rate-limit.service.js';

export async function executionRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  const executionService = new ExecutionService(new ExecutionRepository());

  app.get(
    '/',
    {
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
    },
    async (req) => {
      const { status, definitionId, limit: limitStr = '20' } = req.query as Record<string, string>;
      const limit = Math.min(Number(limitStr), 100);

      const { items, total } = await executionService.listExecutions(
        req.tenantId,
        limit,
        status,
        definitionId,
      );

      return paginate(items, total, limit);
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['Executions'],
        summary: 'Get execution details',
        params: z.object({ id: z.string().uuid() }),
      },
      preHandler: app.authorize(['admin', 'operator', 'viewer']),
    },
    async (req) => {
      const { id } = req.params as { id: string };
      return executionService.getExecution(req.tenantId, id);
    },
  );

  app.get(
    '/:id/logs',
    {
      schema: {
        tags: ['Executions'],
        summary: 'Get execution logs',
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({
          cursor: z.string().optional(),
          limit: z.string().optional(),
        }),
      },
      preHandler: app.authorize(['admin', 'operator', 'viewer']),
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { limit: limitStr = '50' } = req.query as Record<string, string>;
      const limit = Math.min(Number(limitStr), 200);

      const { items, total } = await executionService.getExecutionLogs(req.tenantId, id, limit);

      return paginate(items, total, limit);
    },
  );

  app.post(
    '/:id/cancel',
    {
      schema: {
        tags: ['Executions'],
        summary: 'Cancel an execution',
        params: z.object({ id: z.string().uuid() }),
      },
      preHandler: app.authorize(['admin', 'operator']),
    },
    async (req) => {
      await checkRateLimit(req, 'executions:cancel');
      const { id } = req.params as { id: string };

      return executionService.cancelExecution(req.tenantId, req.userId, id);
    },
  );

  app.post(
    '/:id/retry',
    {
      schema: {
        tags: ['Executions'],
        summary: 'Retry a failed execution',
        params: z.object({ id: z.string().uuid() }),
      },
      preHandler: app.authorize(['admin', 'operator']),
    },
    async (req) => {
      await checkRateLimit(req, 'executions:retry');
      const { id } = req.params as { id: string };

      return executionService.retryExecution(req.tenantId, req.userId, id, req.requestId);
    },
  );

  /** GET /v1/executions/:id/steps — list steps for a workflow execution */
  app.get(
    '/:id/steps',
    {
      schema: {
        tags: ['Executions'],
        summary: 'List steps for a workflow execution',
        params: z.object({ id: z.string().uuid() }),
      },
      preHandler: app.authorize(['admin', 'operator', 'viewer']),
    },
    async (req) => {
      const { id } = req.params as { id: string };

      const steps = await executionService.getExecutionSteps(req.tenantId, id);

      return { data: steps, meta: { total: steps.length } };
    },
  );
}
