import { prisma, ScopedRepository } from '@dispatch/db';
import { paginate } from '@dispatch/shared';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

export async function auditRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  /** GET /v1/audit-logs */
  app.get(
    '/',
    {
      schema: {
        tags: ['Audit Logs'],
        summary: 'List audit log entries for the tenant',
        querystring: z.object({
          action: z.string().optional(),
          entityType: z.string().optional(),
          actorId: z.string().uuid().optional(),
          cursor: z.string().optional(),
          limit: z.string().optional(),
        }),
      },
      preHandler: app.authorize(['admin', 'operator', 'viewer']),
    },
    async (req) => {
      const {
        action,
        entityType,
        actorId,
        limit: limitStr = '50',
      } = req.query as {
        action?: string;
        entityType?: string;
        actorId?: string;
        cursor?: string;
        limit?: string;
      };

      const limit = Math.min(Number(limitStr), 200);
      const repo = new ScopedRepository(prisma, req.tenantId);

      const where = {
        ...(action ? { action } : {}),
        ...(entityType ? { entityType } : {}),
        ...(actorId ? { actorId } : {}),
      };

      const [items, total] = await Promise.all([
        repo.auditLogs().findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        repo.auditLogs().count({ where }),
      ]);

      return paginate(items, total, limit);
    },
  );
}
