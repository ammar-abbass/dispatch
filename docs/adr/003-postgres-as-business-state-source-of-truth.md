# ADR 003: Postgres as Business State Source of Truth

## Status
Accepted

## Context
BullMQ stores job state in Redis. We need durable, queryable state for executions, logs, and audit trails.

## Decision
Use **PostgreSQL** as the source of truth for all business state. Redis/BullMQ is the execution runtime only.

## Consequences
- **Positive:** ACID transactions, rich querying, auditability, backup/restore simplicity.
- **Negative:** Slight latency overhead vs. keeping state in Redis.
- **Tradeoff:** Business state must be durable and relational. Redis is optimized for queue throughput, not long-term state storage.
