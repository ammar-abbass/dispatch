import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    env: {
      DATABASE_URL: 'postgresql://placeholder:placeholder@localhost:5432/placeholder',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-secret',
      NODE_ENV: 'test',
    },
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
