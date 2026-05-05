import { Queue, FlowProducer } from 'bullmq';

import { redis } from './connection.js';

export const jobsDefaultQueue = new Queue('jobs-default', { connection: redis });
export const jobsWorkflowQueue = new Queue('jobs-workflow', { connection: redis });
export const jobsDlqQueue = new Queue('jobs-dlq', { connection: redis });

export const flowProducer = new FlowProducer({ connection: redis });

export const allQueues = [jobsDefaultQueue, jobsWorkflowQueue, jobsDlqQueue];
