# ADR 002: Modular Monolith over Microservices

## Status
Accepted

## Context
Dispatch has three distinct runtime concerns: HTTP API, job execution, and schedule synchronization. These could be deployed as separate microservices.

## Decision
Use a **modular monolith** with three runnable processes (`api`, `worker`, `scheduler`) sharing a single codebase and internal packages.

## Consequences
- **Positive:** Shared types, simpler CI/CD, no network serialization overhead for internal communication, easier local development.
- **Negative:** Less runtime isolation than true microservices (mitigated by separate Docker images and process boundaries).
- **Tradeoff:** Demonstrates clean internal boundaries without the overhead of a full service mesh.
