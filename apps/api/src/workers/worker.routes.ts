import { jobsDefaultQueue, jobsWorkflowQueue, jobsDlqQueue } from '@dispatch/queue';
import { FastifyInstance } from 'fastify';

export async function workerRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/',
    {
      schema: {
        tags: ['Workers'],
        summary: 'List active workers',
      },
      preHandler: app.authorize(['admin', 'operator', 'viewer']),
    },
    async () => {
      const defaultWorkers = await jobsDefaultQueue.getWorkers();
      const workflowWorkers = await jobsWorkflowQueue.getWorkers();
      const dlqWorkers = await jobsDlqQueue.getWorkers();

      const workers = [
        ...defaultWorkers.map((w) => ({ ...w, queue: 'jobs-default' })),
        ...workflowWorkers.map((w) => ({ ...w, queue: 'jobs-workflow' })),
        ...dlqWorkers.map((w) => ({ ...w, queue: 'jobs-dlq' })),
      ];

      return { workers };
    },
  );
}
