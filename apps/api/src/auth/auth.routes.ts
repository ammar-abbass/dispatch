import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcryptjs from 'bcryptjs';
import { prisma } from '@atlas/db';
import { AtlasError } from '@atlas/shared';
import { generateRefreshToken, sha256 } from './auth.crypto.js';

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
const COOKIE_NAME = 'refresh_token';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  /** POST /v1/auth/login */
  app.post('/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Login with email and password',
      body: loginSchema,
    },
  }, async (req, reply) => {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      throw new AtlasError('AUTHENTICATION_ERROR', 'Invalid credentials', 401);
    }

    const valid = await bcryptjs.compare(password, user.passwordHash);
    if (!valid) {
      throw new AtlasError('AUTHENTICATION_ERROR', 'Invalid credentials', 401);
    }

    // Issue access token
    const accessToken = app.jwt.sign(
      { sub: user.id, tenantId: user.tenantId, role: user.role },
      { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );

    // Issue refresh token
    const { raw, hash } = generateRefreshToken();
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    reply.setCookie(COOKIE_NAME, raw, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'strict',
      maxAge: REFRESH_TOKEN_TTL_MS / 1000,
      path: '/v1/auth',
    });

    return reply.code(200).send({ accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS });
  });

  /** POST /v1/auth/refresh */
  app.post('/refresh', {
    schema: {
      tags: ['Auth'],
      summary: 'Exchange a refresh token for a new access token',
    },
  }, async (req, reply) => {
    const raw = req.cookies?.[COOKIE_NAME];
    if (!raw) {
      throw new AtlasError('AUTHENTICATION_ERROR', 'Missing refresh token', 401);
    }

    const hash = sha256(raw);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new AtlasError('AUTHENTICATION_ERROR', 'Refresh token is invalid or expired', 401);
    }

    const user = await prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user) {
      throw new AtlasError('AUTHENTICATION_ERROR', 'User not found', 401);
    }

    // Rotate: revoke old, issue new
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const { raw: newRaw, hash: newHash } = generateRefreshToken();
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: newHash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    const accessToken = app.jwt.sign(
      { sub: user.id, tenantId: user.tenantId, role: user.role },
      { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );

    reply.setCookie(COOKIE_NAME, newRaw, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'strict',
      maxAge: REFRESH_TOKEN_TTL_MS / 1000,
      path: '/v1/auth',
    });

    return reply.code(200).send({ accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS });
  });

  /** POST /v1/auth/logout */
  app.post('/logout', {
    schema: {
      tags: ['Auth'],
      summary: 'Revoke the current refresh token and clear the cookie',
    },
  }, async (req, reply) => {
    const raw = req.cookies?.[COOKIE_NAME];
    if (raw) {
      const hash = sha256(raw);
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    reply.clearCookie(COOKIE_NAME, { path: '/v1/auth' });
    return reply.code(204).send();
  });
}
