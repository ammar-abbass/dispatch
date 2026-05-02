import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestContainers, teardownTestContainers, prisma } from './setup.js';

describe('Job Execution Integration', () => {
  beforeAll(async () => {
    await setupTestContainers();
  });

  afterAll(async () => {
    await teardownTestContainers();
  });

  it('should track execution state transitions', async () => {
    const tenant = await prisma.tenant.create({
      data: { slug: 'exec-tenant', name: 'Exec Tenant' },
    });

    const def = await prisma.jobDefinition.create({
      data: {
        tenantId: tenant.id,
        name: 'State Job',
        type: 'one_off',
        retryPolicy: { maxAttempts: 3, backoff: 'fixed', delay: 500 },
      },
    });

    const execution = await prisma.jobExecution.create({
      data: {
        tenantId: tenant.id,
        jobDefinitionId: def.id,
        status: 'scheduled',
        triggeredBy: 'api',
      },
    });

    expect(execution.status).toBe('scheduled');

    await prisma.jobExecution.update({
      where: { id: execution.id },
      data: { status: 'active', startedAt: new Date() },
    });

    const updated = await prisma.jobExecution.findUnique({
      where: { id: execution.id },
    });

    expect(updated?.status).toBe('active');
    expect(updated?.startedAt).not.toBeNull();
  });

  it('should enforce idempotency key uniqueness', async () => {
    const tenant = await prisma.tenant.create({
      data: { slug: 'idemp-tenant', name: 'Idemp Tenant' },
    });

    const def = await prisma.jobDefinition.create({
      data: {
        tenantId: tenant.id,
        name: 'Idempotent Job',
        type: 'one_off',
        retryPolicy: { maxAttempts: 1, backoff: 'fixed', delay: 100 },
      },
    });

    await prisma.jobExecution.create({
      data: {
        tenantId: tenant.id,
        jobDefinitionId: def.id,
        status: 'completed',
        idempotencyKey: 'unique-key-123',
        triggeredBy: 'api',
      },
    });

    await expect(
      prisma.jobExecution.create({
        data: {
          tenantId: tenant.id,
          jobDefinitionId: def.id,
          status: 'scheduled',
          idempotencyKey: 'unique-key-123',
          triggeredBy: 'api',
        },
      }),
    ).rejects.toThrow();
  });
});
