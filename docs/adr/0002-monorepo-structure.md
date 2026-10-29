# ADR 2: Monorepo Architecture

- **Status:** Accepted
- **Deciders:** Tuition Escrow Core Architecture
- **Date:** 2026-10-14

## Context

Tuition Escrow consists of smart contracts (Rust/WASM), generated TypeScript bindings, shared validation libraries, web frontends, backend REST APIs, event indexers, and an attester signing service. All components share domain models, status enums, error codes, and deployment artifacts.

## Decision

Organize the repository as a monorepo managed with pnpm workspaces, Turborepo for TypeScript/Next.js services, and Cargo workspace for Soroban smart contracts.

## Rationale

1. **Anti-Drift:** Any contract change (public functions, errors, events) can update bindings, shared enums, and consumer services in the same atomic commit and PR.
2. **Shared Tooling:** Centralizes linting, formatting, type checking, and CI workflows.
3. **Single Source of Truth:** Contracts, tests, documentation, and infrastructure definitions reside together, preventing version skew.

## Consequences

- CI must run both Rust and Node.js toolchains.
- Strict workspace boundaries must be maintained (e.g., `web` and `api` never import directly from each other; code sharing occurs strictly through `packages/shared`).
