# ADR 001: BullMQ over Alternatives

## Status
Accepted

## Context
We need a job queue that supports:
- One-off, delayed, and recurring jobs
- Multi-step workflows (parent-child job trees)
- Built-in retries and dead-letter queues
- Strong TypeScript support
- Low operational overhead

## Decision
Use **BullMQ** as the primary job queue engine.

## Consequences
- **Positive:** Native Flows, robust retry/DLQ, excellent TypeScript types, Redis-backed performance.
- **Negative:** Requires Redis (adds infrastructure component). Not a full orchestration engine like Temporal.
- **Tradeoff:** For v1 scope, BullMQ provides 90% of the value with 10% of the operational complexity.
