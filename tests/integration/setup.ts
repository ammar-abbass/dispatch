import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { PrismaClient } from '@atlas/db';
import IORedis from 'ioredis';

let postgresContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;

export let prisma: PrismaClient;
export let redis: IORedis;

export async function setupTestContainers() {
  postgresContainer = await new GenericContainer('postgres:18-alpine')
    .withEnvironment({
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test',
      POSTGRES_DB: 'atlas_test',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections'))
    .start();

  redisContainer = await new GenericContainer('redis:8-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();

  const pgPort = postgresContainer.getMappedPort(5432);
  const pgHost = postgresContainer.getHost();
  const redisPort = redisContainer.getMappedPort(6379);
  const redisHost = redisContainer.getHost();

  process.env.DATABASE_URL = `postgresql://test:test@${pgHost}:${pgPort}/atlas_test`;
  process.env.REDIS_URL = `redis://${redisHost}:${redisPort}`;

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
}

export async function teardownTestContainers() {
  if (prisma) await prisma.$disconnect();
  if (redis) await redis.quit();
  if (postgresContainer) await postgresContainer.stop();
  if (redisContainer) await redisContainer.stop();
}
