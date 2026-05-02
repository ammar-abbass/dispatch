import { PrismaClient, Prisma } from './generated/client/client.js';

/**
 * Wraps Prisma queries to inject tenantId into every where clause.
 * This makes it impossible to forget the tenant filter at the type level.
 */
export class ScopedRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tenantId: string,
  ) {}

  jobDefinitions() {
    return {
      findMany: (
        args: Omit<Prisma.JobDefinitionFindManyArgs, 'where'> & {
          where?: Omit<Prisma.JobDefinitionWhereInput, 'tenantId'>;
        },
      ) =>
        this.prisma.jobDefinition.findMany({
          ...args,
          where: { ...args.where, tenantId: this.tenantId },
        }),
      findFirst: (
        args: Omit<Prisma.JobDefinitionFindFirstArgs, 'where'> & {
          where?: Omit<Prisma.JobDefinitionWhereInput, 'tenantId'>;
        },
      ) =>
        this.prisma.jobDefinition.findFirst({
          ...args,
          where: { ...args.where, tenantId: this.tenantId },
        }),
      create: (args: Omit<Prisma.JobDefinitionCreateArgs, 'data'> & { data: Omit<Prisma.JobDefinitionCreateInput, 'tenant'> }) =>
        this.prisma.jobDefinition.create({
          ...args,
          data: { ...args.data, tenant: { connect: { id: this.tenantId } } },
        }),
      update: (args: Omit<Prisma.JobDefinitionUpdateArgs, 'where'> & { where: { id: string } }) =>
        this.prisma.jobDefinition.update({
          ...args,
          where: { id: args.where.id },
        }),
      count: (
        args?: Omit<Prisma.JobDefinitionCountArgs, 'where'> & {
          where?: Omit<Prisma.JobDefinitionWhereInput, 'tenantId'>;
        },
      ) =>
        this.prisma.jobDefinition.count({
          ...args,
          where: { ...args?.where, tenantId: this.tenantId },
        }),
    };
  }

  jobExecutions() {
    return {
      findMany: (
        args: Omit<Prisma.JobExecutionFindManyArgs, 'where'> & {
          where?: Omit<Prisma.JobExecutionWhereInput, 'tenantId'>;
        },
      ) =>
        this.prisma.jobExecution.findMany({
          ...args,
          where: { ...args.where, tenantId: this.tenantId },
        }),
      findFirst: (
        args: Omit<Prisma.JobExecutionFindFirstArgs, 'where'> & {
          where?: Omit<Prisma.JobExecutionWhereInput, 'tenantId'>;
        },
      ) =>
        this.prisma.jobExecution.findFirst({
          ...args,
          where: { ...args.where, tenantId: this.tenantId },
        }),
      findUnique: (args: { where: { id: string } }) =>
        this.prisma.jobExecution.findFirst({
          where: { id: args.where.id, tenantId: this.tenantId },
        }),
      create: (args: Omit<Prisma.JobExecutionCreateArgs, 'data'> & { data: Omit<Prisma.JobExecutionCreateInput, 'tenant'> }) =>
        this.prisma.jobExecution.create({
          ...args,
          data: { ...args.data, tenant: { connect: { id: this.tenantId } } },
        }),
      update: (args: Omit<Prisma.JobExecutionUpdateArgs, 'where'> & { where: { id: string } }) =>
        this.prisma.jobExecution.update({
          ...args,
          where: { id: args.where.id },
          data: args.data,
        }),
      count: (
        args?: Omit<Prisma.JobExecutionCountArgs, 'where'> & {
          where?: Omit<Prisma.JobExecutionWhereInput, 'tenantId'>;
        },
      ) =>
        this.prisma.jobExecution.count({
          ...args,
          where: { ...args?.where, tenantId: this.tenantId },
        }),
    };
  }

  executionLogs() {
    return {
      findMany: (
        args: Omit<Prisma.ExecutionLogFindManyArgs, 'where'> & {
          where?: Omit<Prisma.ExecutionLogWhereInput, 'tenantId'>;
        },
      ) =>
        this.prisma.executionLog.findMany({
          ...args,
          where: { ...args.where, tenantId: this.tenantId },
        }),
      create: (args: Omit<Prisma.ExecutionLogCreateArgs, 'data'> & { data: Omit<Prisma.ExecutionLogCreateInput, 'tenant'> }) =>
        this.prisma.executionLog.create({
          ...args,
          data: { ...args.data, tenant: { connect: { id: this.tenantId } } },
        }),
      count: (
        args?: Omit<Prisma.ExecutionLogCountArgs, 'where'> & {
          where?: Omit<Prisma.ExecutionLogWhereInput, 'tenantId'>;
        },
      ) =>
        this.prisma.executionLog.count({
          ...args,
          where: { ...args?.where, tenantId: this.tenantId },
        }),
    };
  }

  apiKeys() {
    return {
      findMany: (
        args?: Omit<Prisma.ApiKeyFindManyArgs, 'where'> & {
          where?: Omit<Prisma.ApiKeyWhereInput, 'tenantId'>;
        },
      ) =>
        this.prisma.apiKey.findMany({
          ...args,
          where: { ...args?.where, tenantId: this.tenantId },
        }),
      findFirst: (
        args: Omit<Prisma.ApiKeyFindFirstArgs, 'where'> & {
          where?: Omit<Prisma.ApiKeyWhereInput, 'tenantId'>;
        },
      ) =>
        this.prisma.apiKey.findFirst({
          ...args,
          where: { ...args?.where, tenantId: this.tenantId },
        }),
      count: (
        args?: Omit<Prisma.ApiKeyCountArgs, 'where'> & {
          where?: Omit<Prisma.ApiKeyWhereInput, 'tenantId'>;
        },
      ) =>
        this.prisma.apiKey.count({
          ...args,
          where: { ...args?.where, tenantId: this.tenantId },
        }),
    };
  }

  auditLogs() {
    return {
      findMany: (
        args?: Omit<Prisma.AuditLogFindManyArgs, 'where'> & {
          where?: Omit<Prisma.AuditLogWhereInput, 'tenantId'>;
        },
      ) =>
        this.prisma.auditLog.findMany({
          ...args,
          where: { ...args?.where, tenantId: this.tenantId },
        }),
      count: (
        args?: Omit<Prisma.AuditLogCountArgs, 'where'> & {
          where?: Omit<Prisma.AuditLogWhereInput, 'tenantId'>;
        },
      ) =>
        this.prisma.auditLog.count({
          ...args,
          where: { ...args?.where, tenantId: this.tenantId },
        }),
    };
  }
}
