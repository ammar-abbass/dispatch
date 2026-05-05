import { prisma, Prisma } from '@dispatch/db';

export class ExecutionRepository {
  async findMany(where: Prisma.JobExecutionWhereInput, limit: number) {
    return prisma.jobExecution.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { jobDefinition: { select: { name: true, type: true } } },
    });
  }

  async count(where: Prisma.JobExecutionWhereInput) {
    return prisma.jobExecution.count({ where });
  }

  async findFirst<T extends Prisma.JobExecutionInclude>(
    where: Prisma.JobExecutionWhereInput,
    include?: T,
  ): Promise<Prisma.JobExecutionGetPayload<{ include: T }> | null> {
    const args: Prisma.JobExecutionFindFirstArgs = { where };
    if (include) args.include = include;
    return prisma.jobExecution.findFirst(args) as any;
  }

  async findManyLogs(where: Prisma.ExecutionLogWhereInput, limit: number) {
    return prisma.executionLog.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async countLogs(where: Prisma.ExecutionLogWhereInput) {
    return prisma.executionLog.count({ where });
  }

  async update(id: string, data: Prisma.JobExecutionUpdateInput) {
    return prisma.jobExecution.update({
      where: { id },
      data,
    });
  }

  async create(data: Prisma.JobExecutionUncheckedCreateInput) {
    return prisma.jobExecution.create({ data });
  }

  async findManySteps(where: Prisma.JobStepWhereInput) {
    return prisma.jobStep.findMany({
      where,
      orderBy: { startedAt: 'asc' },
    });
  }
}
