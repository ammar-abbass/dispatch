import { PrismaClient } from '../src/generated/client/client.js';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '@atlas/config';

const connectionString = env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

async function main() {
  const tenant = await prisma.tenant.create({
    data: {
      slug: 'dev-tenant',
      name: 'Development Tenant',
      plan: 'pro',
    },
  });

  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'admin@atlas.dev',
      role: 'admin',
    },
  });

  const oneOff = await prisma.jobDefinition.create({
    data: {
      tenantId: tenant.id,
      name: 'Send Welcome Email',
      type: 'one_off',
      retryPolicy: { maxAttempts: 3, backoff: 'exponential', delay: 2000 },
    },
  });

  const recurring = await prisma.jobDefinition.create({
    data: {
      tenantId: tenant.id,
      name: 'Daily Report',
      type: 'recurring',
      scheduleCron: '0 9 * * *',
      retryPolicy: { maxAttempts: 5, backoff: 'fixed', delay: 5000 },
    },
  });

  const workflow = await prisma.jobDefinition.create({
    data: {
      tenantId: tenant.id,
      name: 'Onboarding Workflow',
      type: 'workflow',
      retryPolicy: { maxAttempts: 3, backoff: 'exponential', delay: 1000 },
    },
  });

  // Sample executions
  await prisma.jobExecution.create({
    data: {
      tenantId: tenant.id,
      jobDefinitionId: oneOff.id,
      status: 'completed',
      triggeredBy: 'api',
      startedAt: new Date(Date.now() - 3600000),
      finishedAt: new Date(Date.now() - 3595000),
    },
  });

  await prisma.jobExecution.create({
    data: {
      tenantId: tenant.id,
      jobDefinitionId: recurring.id,
      status: 'failed',
      triggeredBy: 'scheduler',
      startedAt: new Date(Date.now() - 7200000),
      finishedAt: new Date(Date.now() - 7199000),
      errorMessage: 'Connection timeout',
      failureType: 'transient',
    },
  });

  await prisma.jobExecution.create({
    data: {
      tenantId: tenant.id,
      jobDefinitionId: workflow.id,
      status: 'dead_lettered',
      triggeredBy: 'api',
      startedAt: new Date(Date.now() - 86400000),
      finishedAt: new Date(Date.now() - 86395000),
      errorMessage: 'Max attempts exceeded',
      failureType: 'permanent',
    },
  });

  console.log('Seed data created.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
