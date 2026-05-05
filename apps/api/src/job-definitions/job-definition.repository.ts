import { PrismaClient, Prisma } from '@dispatch/db';

export class JobDefinitionRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: Prisma.JobDefinitionUncheckedCreateInput) {
    return this.prisma.jobDefinition.create({ data });
  }

  async findMany(where: Prisma.JobDefinitionWhereInput, limit: number) {
    return this.prisma.jobDefinition.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async count(where: Prisma.JobDefinitionWhereInput) {
    return this.prisma.jobDefinition.count({ where });
  }

  async findFirst(where: Prisma.JobDefinitionWhereInput) {
    return this.prisma.jobDefinition.findFirst({ where });
  }

  async update(id: string, data: Prisma.JobDefinitionUpdateInput) {
    return this.prisma.jobDefinition.update({
      where: { id },
      data,
    });
  }

  async findExecutionByKeys(idempotencyKey: string) {
    return this.prisma.jobExecution.findUnique({
      where: { idempotencyKey },
    });
  }

  async createExecution(data: Prisma.JobExecutionUncheckedCreateInput) {
    return this.prisma.jobExecution.create({ data });
  }

  async updateExecution(id: string, data: Prisma.JobExecutionUpdateInput) {
    return this.prisma.jobExecution.update({
      where: { id },
      data,
    });
  }
}
