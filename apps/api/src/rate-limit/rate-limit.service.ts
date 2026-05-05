import { redis } from '@dispatch/queue';
import { DispatchError } from '@dispatch/shared';
import { FastifyRequest } from 'fastify';

/**
 * Rate limiting using a Redis sorted-set sliding window.
 *
 * - JWT requests: rate limited per tenantId
 * - API key requests: rate limited per apiKeyId
 * - Public endpoints (auth): rate limited per IP address
 *
 * Window: 60 seconds. Limits vary by action.
 */
const WINDOW_MS = 60_000;

const ACTION_LIMITS: Record<string, number> = {
  'job-definitions:trigger': 60,
  'job-definitions:create': 30,
  'job-definitions:update': 30,
  'job-definitions:delete': 20,
  'executions:cancel': 60,
  'executions:retry': 30,
  'api-keys:create': 10,
  'api-keys:delete': 10,
  'auth:login': 10,
  'auth:signup': 5,
  default: 100,
};

export async function checkRateLimit(req: FastifyRequest, action: string): Promise<void> {
  // Rate limit subject: per API key takes precedence over per tenant
  const subject =
    req.authMethod === 'api_key' && req.apiKeyId
      ? `apikey:${req.apiKeyId}`
      : `tenant:${req.tenantId}`;

  const limit = ACTION_LIMITS[action] ?? ACTION_LIMITS.default ?? 100;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const redisKey = `ratelimit:${subject}:${action}`;

  // Sliding window using a sorted set:
  //   ZADD  key now now        (add current request timestamp as both score and member)
  //   ZREMRANGEBYSCORE key 0 windowStart  (remove entries outside the window)
  //   ZCARD key                (count requests in window)
  //   EXPIRE key 60            (auto-cleanup)
  const pipeline = redis.pipeline();
  pipeline.zadd(redisKey, now, String(now));
  pipeline.zremrangebyscore(redisKey, 0, windowStart);
  pipeline.zcard(redisKey);
  pipeline.expire(redisKey, Math.ceil(WINDOW_MS / 1000));
  const results = await pipeline.exec();

  // zcard result is at index 2
  const count = (results?.[2]?.[1] as number) ?? 0;

  if (count > limit) {
    throw new DispatchError(
      'RATE_LIMITED',
      `Rate limit exceeded for ${action}. Try again later.`,
      429,
    );
  }
}

/**
 * IP-based rate limiting for public endpoints (login, signup).
 * Uses the same sliding window algorithm but keyed by client IP.
 */
export async function checkIpRateLimit(req: FastifyRequest, action: string): Promise<void> {
  const ip = req.ip ?? 'unknown';
  const limit = ACTION_LIMITS[action] ?? ACTION_LIMITS.default ?? 100;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const redisKey = `ratelimit:ip:${ip}:${action}`;

  const pipeline = redis.pipeline();
  pipeline.zadd(redisKey, now, String(now));
  pipeline.zremrangebyscore(redisKey, 0, windowStart);
  pipeline.zcard(redisKey);
  pipeline.expire(redisKey, Math.ceil(WINDOW_MS / 1000));
  const results = await pipeline.exec();

  const count = (results?.[2]?.[1] as number) ?? 0;

  if (count > limit) {
    throw new DispatchError(
      'RATE_LIMITED',
      `Rate limit exceeded for ${action}. Try again later.`,
      429,
    );
  }
}
