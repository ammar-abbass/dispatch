import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestContainers, teardownTestContainers, prisma } from './setup.js';

describe('Job Definition Integration', () => {
  beforeAll(async () => {
    await setupTestContainers();
  });

  afterAll(async () => {
    await teardownTestContainers();
  });

  it('should create and retrieve a job definition', async () => {
    const tenant = await prisma.tenant.create({
      data: { slug: 'test-tenant', name: 'Test Tenant' },
    });

    const def = await prisma.jobDefinition.create({
      data: {
        tenantId: tenant.id,
        name: 'Test Job',
        type: 'one_off',
        retryPolicy: { maxAttempts: 3, backoff: 'exponential', delay: 1000 },
      },
    });

    const found = await prisma.jobDefinition.findFirst({
      where: { id: def.id, tenantId: tenant.id },
    });

    expect(found).not.toBeNull();
    expect(found?.name).toBe('Test Job');
    expect(found?.type).toBe('one_off');
  });

  it('should enforce tenant isolation', async () => {
    const tenantA = await prisma.tenant.create({
      data: { slug: 'tenant-a', name: 'Tenant A' },
    });
    const tenantB = await prisma.tenant.create({
      data: { slug: 'tenant-b', name: 'Tenant B' },
    });

    const def = await prisma.jobDefinition.create({
      data: {
        tenantId: tenantA.id,
        name: 'Isolated Job',
        type: 'one_off',
        retryPolicy: { maxAttempts: 1, backoff: 'fixed', delay: 100 },
      },
    });

    const foundByA = await prisma.jobDefinition.findFirst({
      where: { id: def.id, tenantId: tenantA.id },
    });
    const foundByB = await prisma.jobDefinition.findFirst({
      where: { id: def.id, tenantId: tenantB.id },
    });

    expect(foundByA).not.toBeNull();
    expect(foundByB).toBeNull();
  });
});
