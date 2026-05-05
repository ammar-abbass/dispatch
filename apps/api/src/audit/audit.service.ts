import { prisma } from '@dispatch/db';

export async function auditLog(params: {
  tenantId: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      tenantId: params.tenantId,
      actorId: params.actorId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: (params.metadata ?? {}) as any,
    },
  });
}
