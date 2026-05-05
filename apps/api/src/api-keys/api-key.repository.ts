import { PrismaClient, Prisma } from '@dispatch/db';

export class ApiKeyRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: Prisma.ApiKeyUncheckedCreateInput) {
    return this.prisma.apiKey.create({ data });
  }

  async findMany(tenantId: string, limit: number) {
    return this.prisma.apiKey.findMany({
      where: { tenantId },
      select: { id: true, name: true, lastUsedAt: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async count(tenantId: string) {
    return this.prisma.apiKey.count({
      where: { tenantId },
    });
  }

  async findFirst(tenantId: string, id: string) {
    return this.prisma.apiKey.findFirst({
      where: { id, tenantId },
    });
  }

  async delete(tenantId: string, id: string) {
    return this.prisma.apiKey.delete({
      where: { id, tenantId },
    });
  }
}
