# ADR 004: Idempotency Key Design

## Status
Accepted

## Context
Clients must be able to safely retry job triggers without creating duplicate executions.

## Decision
- Clients supply an `Idempotency-Key` header on mutating requests.
- BullMQ job IDs are deterministic: `{tenantId}:{jobDefinitionId}:{idempotencyKey}`.
- Postgres enforces uniqueness via `UNIQUE INDEX ON job_executions (idempotency_key)`.
- If a duplicate key is detected, the API returns `409 Conflict`.

## Consequences
- **Positive:** At-most-once enqueue guarantee. Simple to reason about.
- **Negative:** Idempotency keys must be chosen carefully by clients (recommend UUIDs).
- **Tradeoff:** BullMQ deduplicates by job ID, but handlers must still be idempotent (at-least-once delivery assumption).
