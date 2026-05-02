import { createHash, randomBytes } from 'crypto';
import bcryptjs from 'bcryptjs';
import fp from 'fastify-plugin';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@atlas/db';
import { AtlasError } from '@atlas/shared';

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

export { bcryptjs };

/**
 * Hash a high-entropy token with SHA-256.
 * Used for API keys and refresh tokens — not for passwords.
 * bcrypt is not appropriate here because these tokens are already high-entropy (256-bit random).
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Generate a cryptographically secure random token.
 * Returns base64url-encoded bytes prefixed with `atk_`.
 */
export function generateApiKey(): { raw: string; hash: string } {
  const raw = `atk_${randomBytes(32).toString('base64url')}`;
  return { raw, hash: sha256(raw) };
}

/**
 * Generate a cryptographically secure refresh token.
 * Returns the raw token (stored in httpOnly cookie) and its SHA-256 hash (stored in DB).
 */
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(40).toString('base64url');
  return { raw, hash: sha256(raw) };
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorate('authenticate', async (req: FastifyRequest) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw new AtlasError('AUTHENTICATION_ERROR', 'Missing Authorization header', 401);
    }

    // --- JWT Bearer token ---
    if (authHeader.startsWith('Bearer ')) {
      try {
        const decoded = await req.jwtVerify<{ sub: string; tenantId: string; role: string }>();
        req.tenantId = decoded.tenantId;
        req.userId = decoded.sub;
        req.userRole = decoded.role;
        req.authMethod = 'jwt';
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '';
        if (message.includes('expired')) {
          throw new AtlasError('AUTHENTICATION_ERROR', 'Token has expired', 401, { code: 'TOKEN_EXPIRED' });
        }
        throw new AtlasError('AUTHENTICATION_ERROR', 'Invalid or missing token', 401);
      }
      return;
    }

    // --- API key ---
    if (authHeader.startsWith('Api-Key ')) {
      const raw = authHeader.slice('Api-Key '.length).trim();
      if (!raw.startsWith('atk_')) {
        throw new AtlasError('AUTHENTICATION_ERROR', 'Invalid API key format', 401);
      }
      const hash = sha256(raw);
      const apiKey = await prisma.apiKey.findUnique({ where: { keyHash: hash } });
      if (!apiKey) {
        throw new AtlasError('AUTHENTICATION_ERROR', 'Invalid API key', 401);
      }
      if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
        throw new AtlasError('AUTHENTICATION_ERROR', 'API key has expired', 401);
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

    throw new AtlasError('AUTHENTICATION_ERROR', 'Unsupported authorization scheme', 401);
  });

  app.decorate('authorize', (roles: string[]) => {
    return async (req: FastifyRequest) => {
      if (!roles.includes(req.userRole)) {
        throw new AtlasError('AUTHORIZATION_ERROR', 'Insufficient permissions', 403);
      }
    };
  });
});
