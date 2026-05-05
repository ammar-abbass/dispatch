import { env } from '@dispatch/config';
import { DispatchError } from '@dispatch/shared';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AuthService } from './auth.service.js';
import { checkIpRateLimit } from '../rate-limit/rate-limit.service.js';

const COOKIE_NAME = 'refresh_token';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  tenantName: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  /** POST /v1/auth/signup */
  app.post(
    '/signup',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Signup to create a new tenant and admin user',
        body: signupSchema,
        // Public endpoint — no authentication required
        security: [],
      },
    },
    async (req, reply) => {
      await checkIpRateLimit(req, 'auth:signup');
      const { email, password, tenantName } = signupSchema.parse(req.body);

      const { user, rawRefreshToken } = await AuthService.signup(email, password, tenantName);

      const accessToken = app.jwt.sign(
        { sub: user.id, tenantId: user.tenantId, role: user.role },
        { expiresIn: AuthService.getAccessTokenTtlSeconds() },
      );

      reply.setCookie(COOKIE_NAME, rawRefreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: AuthService.getRefreshTokenTtlMs() / 1000,
        path: '/v1/auth',
      });

      return reply
        .code(201)
        .send({ accessToken, expiresIn: AuthService.getAccessTokenTtlSeconds() });
    },
  );

  /** POST /v1/auth/login */
  app.post(
    '/login',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Login with email and password',
        body: loginSchema,
        // Public endpoint — no authentication required
        security: [],
      },
    },
    async (req, reply) => {
      await checkIpRateLimit(req, 'auth:login');
      const { email, password } = loginSchema.parse(req.body);

      const { user, rawRefreshToken } = await AuthService.login(email, password);

      const accessToken = app.jwt.sign(
        { sub: user.id, tenantId: user.tenantId, role: user.role },
        { expiresIn: AuthService.getAccessTokenTtlSeconds() },
      );

      reply.setCookie(COOKIE_NAME, rawRefreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: AuthService.getRefreshTokenTtlMs() / 1000,
        path: '/v1/auth',
      });

      return reply
        .code(200)
        .send({ accessToken, expiresIn: AuthService.getAccessTokenTtlSeconds() });
    },
  );

  /** POST /v1/auth/refresh */
  app.post(
    '/refresh',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Exchange a refresh token for a new access token',
        // Public endpoint — refresh token is in cookie, not Authorization header
        security: [],
      },
    },
    async (req, reply) => {
      const raw = req.cookies?.[COOKIE_NAME];
      if (!raw) {
        throw new DispatchError('AUTHENTICATION_ERROR', 'Missing refresh token', 401);
      }

      const { user, newRawRefreshToken } = await AuthService.refresh(raw);

      const accessToken = app.jwt.sign(
        { sub: user.id, tenantId: user.tenantId, role: user.role },
        { expiresIn: AuthService.getAccessTokenTtlSeconds() },
      );

      reply.setCookie(COOKIE_NAME, newRawRefreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: AuthService.getRefreshTokenTtlMs() / 1000,
        path: '/v1/auth',
      });

      return reply
        .code(200)
        .send({ accessToken, expiresIn: AuthService.getAccessTokenTtlSeconds() });
    },
  );

  /** POST /v1/auth/logout */
  app.post(
    '/logout',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Revoke the current refresh token and clear the cookie',
        // Public endpoint — refresh token is in cookie, not Authorization header
        security: [],
      },
    },
    async (req, reply) => {
      const raw = req.cookies?.[COOKIE_NAME];
      if (raw) {
        await AuthService.logout(raw);
      }

      reply.clearCookie(COOKIE_NAME, { path: '/v1/auth' });
      return reply.code(204).send();
    },
  );
}
