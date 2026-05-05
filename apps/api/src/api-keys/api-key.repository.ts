import { prisma, Prisma } from '@dispatch/db';

export class ApiKeyRepository {
  async create(data: Prisma.ApiKeyUncheckedCreateInput) {
    return prisma.apiKey.create({ data });
  }

  async findMany(tenantId: string, limit: number) {
    return prisma.apiKey.findMany({
      where: { tenantId },
      select: { id: true, name: true, lastUsedAt: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async count(tenantId: string) {
    return prisma.apiKey.count({
      where: { tenantId },
    });
  }

  async findFirst(tenantId: string, id: string) {
    return prisma.apiKey.findFirst({
      where: { id, tenantId },
    });
  }

  async delete(tenantId: string, id: string) {
    return prisma.apiKey.delete({
      where: { id, tenantId },
    });
  }
}
