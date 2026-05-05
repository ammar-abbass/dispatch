import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { paginate } from '@dispatch/shared';
import { checkRateLimit } from '../rate-limit/rate-limit.service.js';
import { ApiKeyService } from './api-key.service.js';
import { ApiKeyRepository } from './api-key.repository.js';

const createSchema = z
  .object({
    name: z.string().min(1).max(100),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();

export async function apiKeyRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  const apiKeyService = new ApiKeyService(new ApiKeyRepository());

  /** POST /v1/api-keys */
  app.post(
    '/',
    {
      schema: {
        tags: ['API Keys'],
        summary: 'Create a new API key (secret shown only once)',
        body: createSchema,
      },
      preHandler: app.authorize(['admin']),
    },
    async (req, reply) => {
      await checkRateLimit(req, 'api-keys:create');
      const { name, expiresAt } = createSchema.parse(req.body);

      const result = await apiKeyService.createApiKey(req.tenantId, req.userId, name, expiresAt);

      return reply.code(201).send(result);
    },
  );

  /** GET /v1/api-keys */
  app.get(
    '/',
    {
      schema: {
        tags: ['API Keys'],
        summary: 'List all active API keys for this tenant',
        querystring: z.object({ cursor: z.string().optional(), limit: z.string().optional() }),
      },
      preHandler: app.authorize(['admin']),
    },
    async (req) => {
      const { limit: limitStr = '20' } = req.query as { cursor?: string; limit?: string };
      const limit = Math.min(Number(limitStr), 100);

      const { items, total } = await apiKeyService.listApiKeys(req.tenantId, limit);

      return paginate(
        items.map((k) => ({ ...k, id: k.id, createdAt: k.createdAt })),
        total,
        limit,
      );
    },
  );

  /** DELETE /v1/api-keys/:id */
  app.delete(
    '/:id',
    {
      schema: {
        tags: ['API Keys'],
        summary: 'Revoke an API key immediately',
        params: z.object({ id: z.string().uuid() }),
      },
      preHandler: app.authorize(['admin']),
    },
    async (req, reply) => {
      await checkRateLimit(req, 'api-keys:delete');
      const { id } = req.params as { id: string };

      await apiKeyService.revokeApiKey(req.tenantId, req.userId, id);

      return reply.code(204).send();
    },
  );
}
