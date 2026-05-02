import { FastifyInstance } from 'fastify';
import { jobsDefaultQueue, jobsWorkflowQueue, jobsSchedulerQueue, jobsDlqQueue } from '@atlas/queue';
import { queueDepthGauge, jobsActiveGauge } from '../metrics/metrics.js';

export async function queueRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  app.get('/', {
    schema: {
      tags: ['Queues'],
      summary: 'List queue metrics',
    },
    preHandler: app.authorize(['admin', 'operator', 'viewer']),
  }, async () => {
    const queues = [
      { name: 'jobs-default', queue: jobsDefaultQueue },
      { name: 'jobs-workflow', queue: jobsWorkflowQueue },
      { name: 'jobs-scheduler', queue: jobsSchedulerQueue },
      { name: 'jobs-dlq', queue: jobsDlqQueue },
    ];

    const metrics = await Promise.all(
      queues.map(async ({ name, queue }) => {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getCompletedCount(),
          queue.getFailedCount(),
          queue.getDelayedCount(),
        ]);

        queueDepthGauge.set({ queue: name }, waiting + delayed);
        jobsActiveGauge.set({ queue: name }, active);

        return {
          name,
          depth: waiting + delayed,
          active,
          completed,
          failed,
          delayed,
        };
      }),
    );

    return { queues: metrics };
  });
}
