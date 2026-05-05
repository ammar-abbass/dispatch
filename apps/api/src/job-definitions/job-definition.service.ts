import { Prisma } from '@dispatch/db';
import { DispatchError } from '@dispatch/shared';
import { jobsDefaultQueue, flowProducer } from '@dispatch/queue';
import { nanoid } from 'nanoid';
import { auditLog } from '../audit/audit.service.js';
import { validateCron } from '../validation/cron-validator.js';
import { JobDefinitionRepository } from './job-definition.repository.js';

export class JobDefinitionService {
  constructor(private jobDefRepo: JobDefinitionRepository) {}

  async createJobDefinition(
    tenantId: string,
    userId: string,
    data: {
      name: string;
      type: 'one_off' | 'delayed' | 'recurring' | 'workflow';
      payloadSchema?: Record<string, unknown> | undefined;
      scheduleCron?: string | undefined;
      retryPolicy: { maxAttempts: number; backoff: 'fixed' | 'exponential'; delay: number };
    },
  ) {
    if (data.type === 'recurring' && data.scheduleCron) {
      validateCron(data.scheduleCron);
    }

    if (data.type === 'recurring' && !data.scheduleCron) {
      throw new DispatchError('VALIDATION_ERROR', 'Recurring jobs require scheduleCron', 400);
    }

    if (data.type === 'workflow' && data.payloadSchema) {
      const steps = data.payloadSchema?.steps;
      if (Array.isArray(steps) && steps.length > 10) {
        throw new DispatchError('VALIDATION_ERROR', 'Workflow depth capped at 10 steps', 400);
      }
    }

    const def = await this.jobDefRepo.create({
      tenantId,
      name: data.name,
      type: data.type,
      payloadSchema: data.payloadSchema
        ? (data.payloadSchema as Prisma.InputJsonValue)
        : Prisma.DbNull,
      scheduleCron: data.scheduleCron ?? null,
      retryPolicy: data.retryPolicy,
    });

    await auditLog({
      tenantId,
      actorId: userId,
      action: 'job_definition.created',
      entityType: 'job_definition',
      entityId: def.id,
    });

    return def;
  }

  async listJobDefinitions(tenantId: string, limit: number) {
    const [items, total] = await Promise.all([
      this.jobDefRepo.findMany({ tenantId, isActive: true }, limit),
      this.jobDefRepo.count({ tenantId, isActive: true }),
    ]);

    return { items, total };
  }

  async getJobDefinition(tenantId: string, id: string) {
    const def = await this.jobDefRepo.findFirst({ id, tenantId });
    if (!def) throw new DispatchError('NOT_FOUND', 'Job definition not found', 404);
    return def;
  }

  async updateJobDefinition(
    tenantId: string,
    userId: string,
    id: string,
    data: {
      name?: string | undefined;
      retryPolicy?:
        | { maxAttempts: number; backoff: 'fixed' | 'exponential'; delay: number }
        | undefined;
      scheduleCron?: string | undefined;
      isActive?: boolean | undefined;
    },
  ) {
    if (data.scheduleCron) {
      validateCron(data.scheduleCron);
    }

    const existing = await this.jobDefRepo.findFirst({ id, tenantId });
    if (!existing) throw new DispatchError('NOT_FOUND', 'Job definition not found', 404);

    const dataToUpdate: Prisma.JobDefinitionUpdateInput = { updatedAt: new Date() };
    if (data.name !== undefined) dataToUpdate.name = data.name;
    if (data.scheduleCron !== undefined) dataToUpdate.scheduleCron = data.scheduleCron;
    if (data.isActive !== undefined) dataToUpdate.isActive = data.isActive;
    if (data.retryPolicy !== undefined) dataToUpdate.retryPolicy = data.retryPolicy;

    const updated = await this.jobDefRepo.update(id, dataToUpdate);

    await auditLog({
      tenantId,
      actorId: userId,
      action: 'job_definition.updated',
      entityType: 'job_definition',
      entityId: updated.id,
    });

    return updated;
  }

  async deleteJobDefinition(tenantId: string, userId: string, id: string) {
    const existing = await this.jobDefRepo.findFirst({ id, tenantId });
    if (!existing) throw new DispatchError('NOT_FOUND', 'Job definition not found', 404);

    await this.jobDefRepo.update(id, { isActive: false, updatedAt: new Date() });

    await auditLog({
      tenantId,
      actorId: userId,
      action: 'job_definition.deleted',
      entityType: 'job_definition',
      entityId: id,
    });
  }

  async triggerJobDefinition(
    tenantId: string,
    userId: string,
    id: string,
    requestId?: string,
    idempotencyKeyInput?: string,
    payloadInput?: Record<string, unknown>,
  ) {
    const idempotencyKey = idempotencyKeyInput ?? nanoid();

    const def = await this.jobDefRepo.findFirst({ id, tenantId, isActive: true });
    if (!def) throw new DispatchError('NOT_FOUND', 'Job definition not found', 404);

    const existingExecution = await this.jobDefRepo.findExecutionByKeys(tenantId, idempotencyKey);
    if (existingExecution) {
      throw new DispatchError(
        'CONFLICT_ERROR',
        'Execution already exists for this idempotency key',
        409,
      );
    }

    const execution = await this.jobDefRepo.createExecution({
      tenantId,
      jobDefinitionId: def.id,
      status: 'scheduled',
      idempotencyKey,
      triggeredBy: 'api',
      scheduledFor: new Date(),
    });

    const bullJobId = `${tenantId}:${def.id}:${idempotencyKey}`;
    const payload = payloadInput ?? {};
    const meta = { correlationId: requestId ?? nanoid(), triggeredBy: 'api' };

    const jobOpts = {
      jobId: bullJobId,
      attempts: (def.retryPolicy as { maxAttempts: number }).maxAttempts,
      backoff: {
        type: (def.retryPolicy as { backoff: string }).backoff,
        delay: (def.retryPolicy as { delay: number }).delay,
      },
      removeOnComplete: { count: 100 },
      removeOnFail: false,
    };

    if (def.type === 'workflow') {
      const steps = (def.payloadSchema as Record<string, unknown>)?.steps as string[] | undefined;

      let flowNode: any = {
        name: def.name,
        queueName: 'jobs-workflow',
        data: { executionId: execution.id, tenantId, jobDefinitionId: def.id, payload, meta },
        opts: jobOpts,
      };

      if (steps && Array.isArray(steps) && steps.length > 0) {
        // Build sequential chain (child -> parent)
        // BullMQ executes children first. So the first step is the leaf, and the workflow parent is the root.
        // So: root(workflow) -> child(step N) -> child(step N-1) ... -> leaf(step 1)
        for (let i = steps.length - 1; i >= 0; i--) {
          const stepName = steps[i];
          flowNode = {
            name: stepName,
            queueName: 'jobs-default', // execute steps on default queue
            data: {
              executionId: execution.id,
              tenantId,
              jobDefinitionId: def.id,
              stepName,
              stepIndex: i,
              payload,
              meta,
            },
            opts: { ...jobOpts, jobId: `${bullJobId}:step:${stepName}` },
            children: [flowNode],
          };
        }
      }
      await flowProducer.add(flowNode);
    } else {
      await jobsDefaultQueue.add(
        def.name,
        {
          executionId: execution.id,
          tenantId,
          jobDefinitionId: def.id,
          payload,
          meta,
        },
        jobOpts,
      );
    }

    await this.jobDefRepo.updateExecution(execution.id, { bullJobId, status: 'waiting' });

    await auditLog({
      tenantId,
      actorId: userId,
      action: 'job.triggered',
      entityType: 'job_execution',
      entityId: execution.id,
      metadata: { jobDefinitionId: def.id, idempotencyKey },
    });

    return execution;
  }

  async pauseJobDefinition(tenantId: string, userId: string, id: string) {
    const def = await this.jobDefRepo.findFirst({ id, tenantId, type: 'recurring' });
    if (!def) throw new DispatchError('NOT_FOUND', 'Recurring job definition not found', 404);

    await this.jobDefRepo.update(id, { isActive: false, updatedAt: new Date() });

    await auditLog({
      tenantId,
      actorId: userId,
      action: 'job.paused',
      entityType: 'job_definition',
      entityId: id,
    });
  }

  async resumeJobDefinition(tenantId: string, userId: string, id: string) {
    const def = await this.jobDefRepo.findFirst({ id, tenantId, type: 'recurring' });
    if (!def) throw new DispatchError('NOT_FOUND', 'Recurring job definition not found', 404);

    await this.jobDefRepo.update(id, { isActive: true, updatedAt: new Date() });

    await auditLog({
      tenantId,
      actorId: userId,
      action: 'job.resumed',
      entityType: 'job_definition',
      entityId: id,
    });
  }
}
