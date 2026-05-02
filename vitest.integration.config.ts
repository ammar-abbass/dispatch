import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: [],
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
