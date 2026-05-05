import { jobsDefaultQueue } from '@dispatch/queue';
import { DispatchError, tenantScope } from '@dispatch/shared';
import { nanoid } from 'nanoid';

import { ExecutionRepository } from './execution.repository.js';
import { auditLog } from '../audit/audit.service.js';

export class ExecutionService {
  constructor(private executionRepo: ExecutionRepository) {}

  async listExecutions(tenantId: string, limit: number, status?: string, definitionId?: string) {
    const where = {
      ...(status ? { status } : {}),
      ...(definitionId ? { jobDefinitionId: definitionId } : {}),
      tenantId, // added tenantId from ScopedRepository implicit scoping
    };

    const [items, total] = await Promise.all([
      this.executionRepo.findMany(where, limit),
      this.executionRepo.count(where),
    ]);

    return { items, total };
  }

  async getExecution(tenantId: string, id: string) {
    const execution = await this.executionRepo.findFirst(
      { id, ...tenantScope(tenantId) },
      {
        jobDefinition: { select: { name: true, type: true, retryPolicy: true } },
        jobSteps: true,
      },
    );
    if (!execution) throw new DispatchError('NOT_FOUND', 'Execution not found', 404);
    return execution;
  }

  async getExecutionLogs(tenantId: string, id: string, limit: number) {
    const execution = await this.executionRepo.findFirst({ id, tenantId });
    if (!execution) throw new DispatchError('NOT_FOUND', 'Execution not found', 404);

    const [items, total] = await Promise.all([
      this.executionRepo.findManyLogs({ executionId: id, tenantId }, limit),
      this.executionRepo.countLogs({ executionId: id, tenantId }),
    ]);

    return { items, total };
  }

  async cancelExecution(tenantId: string, userId: string, id: string) {
    const execution = await this.executionRepo.findFirst({ id, tenantId });
    if (!execution) throw new DispatchError('NOT_FOUND', 'Execution not found', 404);
    if (!['waiting', 'scheduled'].includes(execution.status)) {
      throw new DispatchError('CONFLICT_ERROR', 'Cannot cancel active or finished execution', 409);
    }

    if (execution.bullJobId) {
      const job = await jobsDefaultQueue.getJob(execution.bullJobId);
      if (job) await job.remove();
    }

    await this.executionRepo.update(id, {
      status: 'cancelled',
      finishedAt: new Date(),
    });

    await auditLog({
      tenantId,
      actorId: userId,
      action: 'job.cancelled',
      entityType: 'job_execution',
      entityId: id,
    });

    return { cancelled: true };
  }

  async retryExecution(tenantId: string, userId: string, id: string, requestId?: string) {
    const execution = await this.executionRepo.findFirst(
      { id, ...tenantScope(tenantId) },
      { jobDefinition: true },
    );
    if (!execution) throw new DispatchError('NOT_FOUND', 'Execution not found', 404);
    if (!['failed', 'dead_lettered'].includes(execution.status)) {
      throw new DispatchError(
        'CONFLICT_ERROR',
        'Only failed or dead-lettered executions can be retried',
        409,
      );
    }

    const newExecution = await this.executionRepo.create({
      tenantId,
      jobDefinitionId: execution.jobDefinitionId,
      status: 'scheduled',
      triggeredBy: 'manual_retry',
      scheduledFor: new Date(),
    });

    const bullJobId = `${tenantId}:${execution.jobDefinitionId}:${newExecution.id}`;

    await jobsDefaultQueue.add(
      execution.jobDefinition.name,
      {
        executionId: newExecution.id,
        tenantId,
        jobDefinitionId: execution.jobDefinitionId,
        payload: {},
        meta: {
          correlationId: requestId ?? nanoid(),
          triggeredBy: 'manual_retry',
        },
      },
      {
        jobId: bullJobId,
        attempts: (execution.jobDefinition.retryPolicy as { maxAttempts: number }).maxAttempts,
        backoff: {
          type: (execution.jobDefinition.retryPolicy as { backoff: string }).backoff,
          delay: (execution.jobDefinition.retryPolicy as { delay: number }).delay,
        },
        removeOnComplete: { count: 100 },
        removeOnFail: false,
      },
    );

    await this.executionRepo.update(newExecution.id, {
      bullJobId,
      status: 'waiting',
    });

    await auditLog({
      tenantId,
      actorId: userId,
      action: 'job.retried',
      entityType: 'job_execution',
      entityId: newExecution.id,
      metadata: { originalExecutionId: id },
    });

    return { retried: true, executionId: newExecution.id };
  }

  async getExecutionSteps(tenantId: string, id: string) {
    const execution = await this.executionRepo.findFirst({ id, ...tenantScope(tenantId) });
    if (!execution) throw new DispatchError('NOT_FOUND', 'Execution not found', 404);

    const steps = await this.executionRepo.findManySteps({ executionId: id, tenantId });

    return steps;
  }
}
