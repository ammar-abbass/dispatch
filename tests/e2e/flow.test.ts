import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import Fastify from 'fastify';
import { PrismaClient, setPrisma } from '@atlas/db';
import IORedis from 'ioredis';
import jwt from '@fastify/jwt';
import { jobDefinitionRoutes } from '../../apps/api/src/job-definitions/job-definition.routes.js';
import { executionRoutes } from '../../apps/api/src/executions/execution.routes.js';
import { healthRoutes } from '../../apps/api/src/health/health.routes.js';
import { errorHandler } from '../../apps/api/src/error-handler.js';

describe('E2E Flow', () => {
  let postgresContainer: Awaited<ReturnType<typeof GenericContainer.prototype.start>>;
  let redisContainer: Awaited<ReturnType<typeof GenericContainer.prototype.start>>;
  let prisma: PrismaClient;
  let redis: IORedis;
  let app: ReturnType<typeof Fastify>;
  let tenantId: string;
  let token: string;

  beforeAll(async () => {
    postgresContainer = await new GenericContainer('postgres:17-alpine')
      .withEnvironment({ POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'atlas_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections'))
      .start();

    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start();

    const pgPort = postgresContainer.getMappedPort(5432);
    const pgHost = postgresContainer.getHost();
    const redisPort = redisContainer.getMappedPort(6379);
    const redisHost = redisContainer.getHost();

    process.env.DATABASE_URL = `postgresql://test:test@${pgHost}:${pgPort}/atlas_test`;
    process.env.REDIS_URL = `redis://${redisHost}:${redisPort}`;
    process.env.JWT_SECRET = 'test-secret';

    // Push schema to the test database before creating the client
    const { execSync } = await import('node:child_process');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    execSync('npx prisma db push --accept-data-loss', {
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '../../packages/db'),
      stdio: 'pipe',
    });

    const { Pool } = await import('pg');
    const { PrismaPg } = await import('@prisma/adapter-pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaPg(pool);

    prisma = new PrismaClient({ adapter });
    redis = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

    // Override the global prisma singleton so route handlers use the test database
    setPrisma(prisma);

    const tenant = await prisma.tenant.create({
      data: { slug: 'e2e-tenant', name: 'E2E Tenant' },
    });
    tenantId = tenant.id;

    const user = await prisma.user.create({
      data: { tenantId, email: 'e2e@atlas.dev', role: 'admin' },
    });

    app = Fastify({ logger: false });
    app.setErrorHandler(errorHandler);
    await app.register(jwt, { secret: process.env.JWT_SECRET });

    app.decorate('authenticate', async (req: any) => {
      req.tenantId = tenantId;
      req.userId = user.id;
      req.userRole = 'admin';
    });

    // authorize is a preHandler factory; in tests all roles are allowed
    app.decorate('authorize', (_roles: string[]) => async (_req: any, _reply: any) => {});

    await app.register(healthRoutes, { prefix: '/' });
    await app.register(jobDefinitionRoutes, { prefix: '/v1/job-definitions' });
    await app.register(executionRoutes, { prefix: '/v1/executions' });

    await app.ready();

    token = app.jwt.sign({ tenantId, userId: user.id, role: 'admin' });
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    await redis.quit();
    await postgresContainer.stop();
    await redisContainer.stop();
  });

  it('should create a job definition and trigger an execution', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/job-definitions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'E2E Test Job',
        type: 'one_off',
        retryPolicy: { maxAttempts: 3, backoff: 'exponential', delay: 1000 },
      },
    });

    expect(createRes.statusCode).toBe(201);
    const def = JSON.parse(createRes.payload);
    expect(def.name).toBe('E2E Test Job');

    const triggerRes = await app.inject({
      method: 'POST',
      url: `/v1/job-definitions/${def.id}/trigger`,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': 'e2e-key-1',
      },
      payload: { foo: 'bar' },
    });

    expect(triggerRes.statusCode).toBe(202);
    const execution = JSON.parse(triggerRes.payload);
    expect(['scheduled', 'waiting']).toContain(execution.status);

    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/executions',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(listRes.statusCode).toBe(200);
    const list = JSON.parse(listRes.payload);
    expect(list.items.length).toBeGreaterThanOrEqual(1);
  });

  it('should enforce idempotency on duplicate triggers', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/job-definitions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Idempotent Job',
        type: 'one_off',
        retryPolicy: { maxAttempts: 1, backoff: 'fixed', delay: 100 },
      },
    });

    const def = JSON.parse(createRes.payload);

    const trigger1 = await app.inject({
      method: 'POST',
      url: `/v1/job-definitions/${def.id}/trigger`,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': 'dup-key',
      },
    });
    expect(trigger1.statusCode).toBe(202);

    const trigger2 = await app.inject({
      method: 'POST',
      url: `/v1/job-definitions/${def.id}/trigger`,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': 'dup-key',
      },
    });
    expect(trigger2.statusCode).toBe(409);
  });

  it('should cancel a waiting execution', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/job-definitions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Cancel Job',
        type: 'one_off',
        retryPolicy: { maxAttempts: 1, backoff: 'fixed', delay: 100 },
      },
    });

    const def = JSON.parse(createRes.payload);

    const triggerRes = await app.inject({
      method: 'POST',
      url: `/v1/job-definitions/${def.id}/trigger`,
      headers: { authorization: `Bearer ${token}` },
    });

    const execution = JSON.parse(triggerRes.payload);

    const cancelRes = await app.inject({
      method: 'POST',
      url: `/v1/executions/${execution.id}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(cancelRes.statusCode).toBe(200);
    expect(JSON.parse(cancelRes.payload).cancelled).toBe(true);
  });

  it('should return health and readiness status', async () => {
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(JSON.parse(health.payload).status).toBe('ok');

    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
  });
});
