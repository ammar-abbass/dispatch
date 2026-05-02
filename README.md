# Atlas

> Production-grade distributed task scheduling and workflow orchestration platform built with Node.js, BullMQ, and PostgreSQL.

## What Problem Does Atlas Solve?

Atlas provides a robust, multi-tenant background job scheduling system. It handles one-off, delayed, recurring (cron), and multi-step workflow jobs with built-in retry policies, dead-letter queues, idempotency, and comprehensive observability.

## Why BullMQ Over Alternatives?

| Concern | BullMQ | Agenda | pg-boss | Temporal |
|---------|--------|--------|---------|----------|
| Redis-backed | Yes | No (Mongo) | Yes (Postgres) | Yes (Custom) |
| Flows/Workflows | Yes | No | Limited | Yes |
| Retry & DLQ | Native | Basic | Basic | Advanced |
| TypeScript | First-class | Good | Good | Good |
| Operational Complexity | Low | Low | Low | High |

BullMQ provides the best balance of features, performance, and operational simplicity for a v1 scheduling platform without requiring a dedicated orchestration cluster.

## How Are Failures Handled End to End?

1. **Classification:** Every failure is classified as `validation`, `transient`, `timeout`, `permanent`, or `unknown`.
2. **Retry:** Transient and unknown failures are retried with the policy defined on the job definition (fixed or exponential backoff).
3. **Dead-Letter:** After `maxAttempts` is exhausted, the job is moved to the `jobs-dlq` queue and its execution status is set to `dead_lettered`.
4. **Replay:** Failed or dead-lettered executions can be manually retried via `POST /v1/executions/:id/retry`.

## How Does Multi-Tenant Isolation Work?

- Every database query includes `tenantId` in the `where` clause via the `tenantScope` helper.
- The `ScopedRepository` pattern (demonstrated in `packages/shared`) ensures tenant filtering at the type level.
- BullMQ job IDs are prefixed with `{tenantId}:{jobDefinitionId}:{idempotencyKey}` to prevent cross-tenant collisions.
- JWT tokens carry `tenantId` and `role` claims; all API routes enforce authentication.

## How to Run Locally

```bash
# 1. Install dependencies
pnpm install

# 2. Start infrastructure
docker-compose up -d postgres redis

# 3. Set up database
pnpm db:migrate
pnpm db:seed

# 4. Start all services (in separate terminals)
pnpm --filter @atlas/api dev
pnpm --filter @atlas/worker dev
pnpm --filter @atlas/scheduler dev
```

Or start everything with Docker Compose:
```bash
docker-compose up --build
```

## How to Run Tests

```bash
# Unit tests
pnpm test

# Integration tests (requires Docker)
pnpm test:integration

# E2E tests (requires full Docker Compose stack)
pnpm test:e2e
```

## API Documentation

When the API is running locally, you can access the auto-generated Swagger UI documentation at:
**[http://127.0.0.1:3000/docs](http://127.0.0.1:3000/docs)**

### Common cURL Examples

Below are examples of the most common API flows. Note: You must replace `YOUR_JWT_TOKEN` with a valid JWT token that contains the `tenantId` claim.

#### 1. Create a Job Definition
Create a new one-off job definition with a specific retry policy.
```bash
curl -X POST http://127.0.0.1:3000/v1/job-definitions \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Send Welcome Email",
    "type": "one_off",
    "payloadSchema": { "email": "user@example.com" },
    "retryPolicy": {
      "maxAttempts": 3,
      "backoff": "exponential",
      "delay": 5000
    }
  }'
```

#### 2. Trigger a Job Manually
Trigger an execution for a specific job definition using its ID.
```bash
curl -X POST http://127.0.0.1:3000/v1/job-definitions/JOB_DEFINITION_ID/trigger \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: unique-key-123" \
  -d '{"email": "user@example.com"}'
```

#### 3. Check Execution Status
Retrieve the current status and details of a specific job execution.
```bash
curl -X GET http://127.0.0.1:3000/v1/executions/EXECUTION_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### 4. Replay a Failed or Dead-Lettered Job
Manually retry an execution that has failed or exhausted all retries.
```bash
curl -X POST http://127.0.0.1:3000/v1/executions/EXECUTION_ID/retry \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Environment Variable Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Runtime environment | `development` |
| `DATABASE_URL` | PostgreSQL connection string | — |
| `REDIS_URL` | Redis connection string | — |
| `JWT_SECRET` | HS256 signing secret | — |
| `API_PORT` | HTTP server port | `3000` |
| `API_HOST` | HTTP server host | `0.0.0.0` |
| `LOG_LEVEL` | Pino log level | `info` |
| `METRICS_PORT` | Prometheus metrics port | `9091` |
| `WORKER_CONCURRENCY` | Concurrent jobs per worker | `5` |
| `SCHEDULER_INTERVAL_MS` | Schedule sync interval | `60000` |

## Architecture

See [docs/architecture.md](docs/architecture.md) for the system diagram and component responsibilities.

## Data Model

See [docs/data-model.md](docs/data-model.md) for the PostgreSQL schema design and indexing strategy.

## ADRs

- [001 — BullMQ over Alternatives](docs/adr/001-bullmq-over-alternatives.md)
- [002 — Modular Monolith over Microservices](docs/adr/002-modular-monolith-over-microservices.md)
- [003 — Postgres as Business State Source of Truth](docs/adr/003-postgres-as-business-state-source-of-truth.md)
- [004 — Idempotency Key Design](docs/adr/004-idempotency-key-design.md)
- [005 — Failure Classification Strategy](docs/adr/005-failure-classification-strategy.md)

## License

MIT
