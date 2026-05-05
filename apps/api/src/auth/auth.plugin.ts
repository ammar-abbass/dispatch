import { prisma } from '@dispatch/db';
import { DispatchError } from '@dispatch/shared';
import { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { sha256 } from './auth.crypto.js';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
    userId: string;
    userRole: string;
    authMethod: 'jwt' | 'api_key';
    apiKeyId?: string;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>;
    authorize: (roles: string[]) => (req: FastifyRequest) => Promise<void>;
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorate('authenticate', async (req: FastifyRequest) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw new DispatchError('AUTHENTICATION_ERROR', 'Missing Authorization header', 401);
    }

    // --- JWT Bearer token ---
    if (authHeader.startsWith('Bearer ')) {
      try {
        const decoded = await req.jwtVerify<{ sub: string; tenantId: string; role: string }>();
        req.tenantId = decoded.tenantId;
        req.userId = decoded.sub;
        req.userRole = decoded.role;
        req.authMethod = 'jwt';
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '';
        if (message.includes('expired')) {
          throw new DispatchError('AUTHENTICATION_ERROR', 'Token has expired', 401, {
            code: 'TOKEN_EXPIRED',
          });
        }
        throw new DispatchError('AUTHENTICATION_ERROR', 'Invalid or missing token', 401);
      }
      return;
    }

    // --- API key ---
    if (authHeader.startsWith('Api-Key ')) {
      const raw = authHeader.slice('Api-Key '.length).trim();
      if (!raw.startsWith('atk_')) {
        throw new DispatchError('AUTHENTICATION_ERROR', 'Invalid API key format', 401);
      }
      const hash = sha256(raw);
      const apiKey = await prisma.apiKey.findUnique({ where: { keyHash: hash } });
      if (!apiKey) {
        throw new DispatchError('AUTHENTICATION_ERROR', 'Invalid API key', 401);
      }
      if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
        throw new DispatchError('AUTHENTICATION_ERROR', 'API key has expired', 401);
      }
      // Update lastUsedAt without blocking the request
      void prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      });
      req.tenantId = apiKey.tenantId;
      // API keys are tenant-scoped — they act as 'operator' by default
      req.userId = 'api_key';
      req.userRole = 'operator';
      req.authMethod = 'api_key';
      req.apiKeyId = apiKey.id;
      return;
    }

    throw new DispatchError('AUTHENTICATION_ERROR', 'Unsupported authorization scheme', 401);
  });

  app.decorate('authorize', (roles: string[]) => {
    return async (req: FastifyRequest) => {
      if (!roles.includes(req.userRole)) {
        throw new DispatchError('AUTHORIZATION_ERROR', 'Insufficient permissions', 403);
      }
    };
  });
});
