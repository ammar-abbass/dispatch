import { prisma, Prisma } from '@dispatch/db';

export class JobDefinitionRepository {
  async create(data: Prisma.JobDefinitionUncheckedCreateInput) {
    return prisma.jobDefinition.create({ data });
  }

  async findMany(where: Prisma.JobDefinitionWhereInput, limit: number) {
    return prisma.jobDefinition.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async count(where: Prisma.JobDefinitionWhereInput) {
    return prisma.jobDefinition.count({ where });
  }

  async findFirst(where: Prisma.JobDefinitionWhereInput) {
    return prisma.jobDefinition.findFirst({ where });
  }

  async update(id: string, data: Prisma.JobDefinitionUpdateInput) {
    return prisma.jobDefinition.update({
      where: { id },
      data,
    });
  }

  async findExecutionByKeys(tenantId: string, idempotencyKey: string) {
    return prisma.jobExecution.findFirst({
      where: { idempotencyKey, tenantId },
    });
  }

  async createExecution(data: Prisma.JobExecutionUncheckedCreateInput) {
    return prisma.jobExecution.create({ data });
  }

  async updateExecution(id: string, data: Prisma.JobExecutionUpdateInput) {
    return prisma.jobExecution.update({
      where: { id },
      data,
    });
  }
}
