import { Redis } from 'ioredis';
import { env } from '@dispatch/config';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redis.on('error', (err: Error) => {
  console.error('Redis connection error', err);
});
