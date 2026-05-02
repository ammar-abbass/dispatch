# ADR 005: Failure Classification Strategy

## Status
Accepted

## Context
Not all failures should be retried. We need a taxonomy to drive retry behavior and alerting.

## Decision
Classify every failure into one of five types:

| Type | Retry? | Example |
|------|--------|---------|
| `validation` | No | Bad input, schema mismatch |
| `transient` | Yes | Network blip, connection refused |
| `timeout` | Yes (with backoff) | Job exceeded duration limit |
| `permanent` | No | Business rule violation |
| `unknown` | Yes (with caution) | Unhandled exception |

## Consequences
- **Positive:** Prevents infinite retry loops on permanent failures. Enables targeted alerting.
- **Negative:** Classification is heuristic-based on error message strings.
- **Tradeoff:** Simple and effective for v1. Can be enhanced with structured error codes in v2.
