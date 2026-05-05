import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UserService } from './user.service.js';
import { auditLog } from '../audit/audit.service.js';

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['admin', 'operator', 'viewer']),
});

export async function userRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  /** POST /v1/users */
  app.post(
    '/',
    {
      schema: {
        tags: ['Users'],
        summary: 'Create a new user within the current tenant',
        body: createUserSchema,
      },
      preHandler: app.authorize(['admin']),
    },
    async (req, reply) => {
      const { email, password, role } = createUserSchema.parse(req.body);

      const user = await UserService.createUser(req.tenantId, email, password, role);

      await auditLog({
        tenantId: req.tenantId,
        actorId: req.userId,
        action: 'user.created',
        entityType: 'user',
        entityId: user.id,
        metadata: { role, email },
      });

      return reply.code(201).send(user);
    },
  );
}
