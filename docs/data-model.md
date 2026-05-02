# Data Model

## PostgreSQL Schema

### tenants
Isolated customer boundary. Every other table references `tenant_id`.

### users
Tenant-scoped users with roles: `admin`, `operator`, `viewer`.

### job_definitions
Reusable templates describing job behavior, payload schema, retry policy, and optional cron schedule.

### job_executions
Runtime instances of job definitions. Tracks the full lifecycle:
`created → scheduled → waiting → active → completed | failed | cancelled | dead_lettered`

### execution_logs
Append-only structured logs for each execution. Stored separately to avoid row bloat on `job_executions`.

### job_steps
Workflow step tracking. Only populated for `type = 'workflow'` executions.

### audit_logs
Immutable audit trail of all mutating actions.

## Indexing Strategy

```sql
-- Execution querying by tenant and time
CREATE INDEX ON job_executions (tenant_id, created_at DESC);

-- Filter by status for dashboards
CREATE INDEX ON job_executions (tenant_id, status);

-- Filter by definition for job-specific views
CREATE INDEX ON job_executions (tenant_id, job_definition_id);

-- Idempotency enforcement (partial, only where key is set)
CREATE UNIQUE INDEX ON job_executions (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Log tailing for execution detail pages
CREATE INDEX ON execution_logs (execution_id, created_at DESC);

-- Audit log browsing
CREATE INDEX ON audit_logs (tenant_id, created_at DESC);
```

## Redis Key Patterns

```
bull:{queueName}:*           # BullMQ internal keys — never touch manually
tenant:{tenantId}:ratelimit:{window}   # Rate limit counters
execution:{executionId}:lock           # Distributed locks during processing
workflow:{workflowId}:state            # Flow step state cache
```
