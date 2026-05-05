import { PrismaClient, Prisma } from '@dispatch/db';

export class ExecutionRepository {
  constructor(private prisma: PrismaClient) {}

  async findMany(where: Prisma.JobExecutionWhereInput, limit: number) {
    return this.prisma.jobExecution.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { jobDefinition: { select: { name: true, type: true } } },
    });
  }

  async count(where: Prisma.JobExecutionWhereInput) {
    return this.prisma.jobExecution.count({ where });
  }

  async findFirst<T extends Prisma.JobExecutionInclude>(
    where: Prisma.JobExecutionWhereInput,
    include?: T
  ): Promise<Prisma.JobExecutionGetPayload<{ include: T }> | null> {
    const args: Prisma.JobExecutionFindFirstArgs = { where };
    if (include) args.include = include;
    return this.prisma.jobExecution.findFirst(args) as any;
  }

  async findManyLogs(where: Prisma.ExecutionLogWhereInput, limit: number) {
    return this.prisma.executionLog.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async countLogs(where: Prisma.ExecutionLogWhereInput) {
    return this.prisma.executionLog.count({ where });
  }

  async update(id: string, data: Prisma.JobExecutionUpdateInput) {
    return this.prisma.jobExecution.update({
      where: { id },
      data,
    });
  }

  async create(data: Prisma.JobExecutionUncheckedCreateInput) {
    return this.prisma.jobExecution.create({ data });
  }

  async findManySteps(where: Prisma.JobStepWhereInput) {
    return this.prisma.jobStep.findMany({
      where,
      orderBy: { startedAt: 'asc' },
    });
  }
}
