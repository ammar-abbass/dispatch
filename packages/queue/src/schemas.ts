import { z } from 'zod';

export const jobPayloadSchema = z.object({
  executionId: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobDefinitionId: z.string().uuid(),
  payload: z.record(z.unknown()).default({}),
  meta: z.object({
    correlationId: z.string(),
    triggeredBy: z.enum(['api', 'scheduler', 'manual_retry']),
  }),
});

export type JobPayload = z.infer<typeof jobPayloadSchema>;

export const workflowStepPayloadSchema = jobPayloadSchema.extend({
  stepName: z.string(),
  stepIndex: z.number().int().min(0),
});

export type WorkflowStepPayload = z.infer<typeof workflowStepPayloadSchema>;
