import { redis } from '@atlas/queue';
import { AtlasError } from '@atlas/shared';

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 100;

export async function checkRateLimit(tenantId: string, key: string): Promise<void> {
  const redisKey = `tenant:${tenantId}:ratelimit:${key}:${Math.floor(Date.now() / WINDOW_MS)}`;
  const current = await redis.incr(redisKey);
  if (current === 1) {
    await redis.pexpire(redisKey, WINDOW_MS);
  }
  if (current > MAX_REQUESTS) {
    throw new AtlasError('RATE_LIMITED', 'Rate limit exceeded. Please try again later.', 429);
  }
}
