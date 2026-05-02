import { Counter, Gauge, Histogram, register } from 'prom-client';

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
