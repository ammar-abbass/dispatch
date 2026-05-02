import fp from 'fastify-plugin';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { AtlasError } from '@atlas/shared';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
    userId: string;
    userRole: string;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>;
    authorize: (roles: string[]) => (req: FastifyRequest) => Promise<void>;
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorate('authenticate', async (req: FastifyRequest) => {
    try {
      const decoded = await req.jwtVerify<{ tenantId: string; userId: string; role: string }>();
      req.tenantId = decoded.tenantId;
      req.userId = decoded.userId;
      req.userRole = decoded.role;
    } catch {
      throw new AtlasError('AUTHENTICATION_ERROR', 'Invalid or missing token', 401);
    }
  });

  app.decorate('authorize', (roles: string[]) => {
    return async (req: FastifyRequest) => {
      if (!roles.includes(req.userRole)) {
        throw new AtlasError('AUTHORIZATION_ERROR', 'Insufficient permissions', 403);
      }
    };
  });
});
