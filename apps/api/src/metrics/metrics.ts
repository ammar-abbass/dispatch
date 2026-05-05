import { Counter, Gauge, Histogram, register } from 'prom-client';
import { jobsDefaultQueue, jobsWorkflowQueue, jobsDlqQueue } from '@dispatch/queue';

export const queueDepthGauge = new Gauge({
  name: 'atlas_queue_depth',
  help: 'Number of waiting jobs per queue',
  labelNames: ['queue'],
  registers: [register],
});

export const jobsActiveGauge = new Gauge({
  name: 'atlas_jobs_active',
  help: 'Number of currently processing jobs per queue',
  labelNames: ['queue'],
  registers: [register],
});

/**
 * Collect queue metrics in the background every 15 seconds.
 * This ensures Prometheus always has fresh data without requiring API calls.
 */
export function startMetricsCollection(): ReturnType<typeof setInterval> {
  const queues = [
    { name: 'jobs-default', queue: jobsDefaultQueue },
    { name: 'jobs-workflow', queue: jobsWorkflowQueue },
    { name: 'jobs-dlq', queue: jobsDlqQueue },
  ];

  return setInterval(async () => {
    for (const { name, queue } of queues) {
      try {
        const [waiting, active, delayed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getDelayedCount(),
        ]);
        queueDepthGauge.set({ queue: name }, waiting + delayed);
        jobsActiveGauge.set({ queue: name }, active);
      } catch {
        // Silently skip if Redis is temporarily unavailable
      }
    }
  }, 15_000);
}

export const jobsCompletedCounter = new Counter({
  name: 'atlas_jobs_completed_total',
  help: 'Total completed jobs per queue',
  labelNames: ['queue'],
  registers: [register],
});

export const jobsFailedCounter = new Counter({
  name: 'atlas_jobs_failed_total',
  help: 'Total failed jobs per queue by failure type',
  labelNames: ['queue', 'failure_type'],
  registers: [register],
});

export const jobsDeadLetteredCounter = new Counter({
  name: 'atlas_jobs_dead_lettered_total',
  help: 'Total dead-lettered jobs per queue',
  labelNames: ['queue'],
  registers: [register],
});

export const jobDurationHistogram = new Histogram({
  name: 'atlas_job_duration_seconds',
  help: 'Job execution duration in seconds',
  labelNames: ['queue'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [register],
});

export const workerHeartbeatGauge = new Gauge({
  name: 'atlas_worker_heartbeat_timestamp',
  help: 'Last worker heartbeat unix timestamp',
  labelNames: ['worker_id'],
  registers: [register],
});

export const apiRequestDurationHistogram = new Histogram({
  name: 'atlas_api_request_duration_seconds',
  help: 'API request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});
