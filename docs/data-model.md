# Data Model

## PostgreSQL Schema

### tenants
Isolated customer boundary. Every other table references `tenant_id`.

### users
Tenant-scoped users with roles: `admin`, `operator`, `viewer`. Includes optional `password_hash` (bcrypt) for email/password login. Nullable to support future SSO flows.

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

### api_keys
Tenant-scoped API keys for machine-to-machine authentication. Stores a SHA-256 hash of the raw token (`key_hash`) — never the plaintext key. The raw key is returned to the user only once at creation time. Supports optional `expires_at` and tracks `last_used_at`.

### refresh_tokens
Long-lived refresh tokens (7-day TTL) for JWT token rotation. Stores a SHA-256 hash of the raw token. Supports revocation via `revoked_at`. Each login creates a new token; each refresh rotates it (old one revoked, new one issued).

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

-- API key listing per tenant
CREATE INDEX ON api_keys (tenant_id, created_at DESC);

-- Refresh token lookup by user
CREATE INDEX ON refresh_tokens (user_id);
```

## Redis Key Patterns

```
bull:{queueName}:*                              # BullMQ internal keys — never touch manually
ratelimit:{subject}:{action}                    # Sliding window sorted set (ZADD/ZCARD)
execution:{executionId}:lock                    # Distributed locks during processing
workflow:{workflowId}:state                     # Flow step state cache
```

Rate limiting key subjects:
- JWT requests: `ratelimit:tenant:{tenantId}:{action}`
- API key requests: `ratelimit:apikey:{apiKeyId}:{action}`
