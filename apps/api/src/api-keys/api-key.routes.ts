import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, ScopedRepository } from '@atlas/db';
import { AtlasError, paginate } from '@atlas/shared';
import { generateApiKey } from '../auth/auth.crypto.js';
import { checkRateLimit } from '../rate-limit/rate-limit.service.js';
import { auditLog } from '../audit/audit.service.js';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  expiresAt: z.string().datetime().optional(),
}).strict();

export async function apiKeyRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  /** POST /v1/api-keys */
  app.post('/', {
    schema: {
      tags: ['API Keys'],
      summary: 'Create a new API key (secret shown only once)',
      body: createSchema,
    },
    preHandler: app.authorize(['admin']),
  }, async (req, reply) => {
    await checkRateLimit(req, 'api-keys:create');
    const { name, expiresAt } = createSchema.parse(req.body);

    const { raw, hash } = generateApiKey();

    const apiKey = await prisma.apiKey.create({
      data: {
        tenantId: req.tenantId,
        name,
        keyHash: hash,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    await auditLog({
      tenantId: req.tenantId,
      actorId: req.userId,
      action: 'api_key.created',
      entityType: 'api_key',
      entityId: apiKey.id,
    });

    // Return the raw key ONCE — never stored, never returned again
    return reply.code(201).send({
      id: apiKey.id,
      name: apiKey.name,
      key: raw,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    });
  });

  /** GET /v1/api-keys */
  app.get('/', {
    schema: {
      tags: ['API Keys'],
      summary: 'List all active API keys for this tenant',
      querystring: z.object({ cursor: z.string().optional(), limit: z.string().optional() }),
    },
    preHandler: app.authorize(['admin']),
  }, async (req) => {
    const { limit: limitStr = '20' } = req.query as { cursor?: string; limit?: string };
    const limit = Math.min(Number(limitStr), 100);

    const repo = new ScopedRepository(prisma, req.tenantId);
    const [items, total] = await Promise.all([
      repo.apiKeys().findMany({
        select: { id: true, name: true, lastUsedAt: true, expiresAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      repo.apiKeys().count(),
    ]);

    return paginate(
      items.map((k) => ({ ...k, id: k.id, createdAt: k.createdAt })),
      total,
      limit,
    );
  });

  /** DELETE /v1/api-keys/:id */
  app.delete('/:id', {
    schema: {
      tags: ['API Keys'],
      summary: 'Revoke an API key immediately',
      params: z.object({ id: z.string().uuid() }),
    },
    preHandler: app.authorize(['admin']),
  }, async (req, reply) => {
    await checkRateLimit(req, 'api-keys:delete');
    const { id } = req.params as { id: string };

    const repo = new ScopedRepository(prisma, req.tenantId);
    const existing = await repo.apiKeys().findFirst({ where: { id } });
    if (!existing) throw new AtlasError('NOT_FOUND', 'API key not found', 404);

    await prisma.apiKey.delete({ where: { id } });

    await auditLog({
      tenantId: req.tenantId,
      actorId: req.userId,
      action: 'api_key.revoked',
      entityType: 'api_key',
      entityId: id,
    });

    return reply.code(204).send();
  });
}
