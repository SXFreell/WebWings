# Srkey Cloud Sync Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete OpenSpec change `add-srkey-cloud-sync` by adding final safety coverage, deployable server assets, operator/client documentation, CI, and release verification.

**Architecture:** Keep the existing Fastify/PostgreSQL service as the real integration boundary. Exercise it through `app.inject`, `pg-mem` repositories, and the existing operation/bind/session services; use Docker Compose only for production-like startup. Root scripts provide one canonical entry point for CI and local verification.

**Tech Stack:** TypeScript, Vitest, Fastify, PostgreSQL/pg-mem, pnpm workspaces, Docker, GitHub Actions, OpenSpec.

## Global Constraints

- Namespace is derived exclusively from authenticated context; no API accepts a caller-selected namespace.
- Sync transport is at-least-once; operation IDs must retain exactly-once effects.
- A usable snapshot must exist before event pruning; pending-delete Key data remains recoverable until retention expires.
- Production endpoints require HTTPS behind a reverse proxy; HTTP is development-only for loopback addresses.
- Never write raw srkeys, device tokens, or backup contents to logs, documentation examples, or artifacts.

---

## File map

- `server/test/integration.test.ts`: cross-namespace HTTP, WebSocket, snapshot, bind, and admin metadata isolation.
- `server/test/randomized.test.ts`: seeded multi-device operation permutations and convergence assertions.
- `server/test/jobs.test.ts`: event, snapshot, tombstone, pending-delete, and cleanup retention coverage.
- `server/test/security.test.ts`: credential redaction, authorization, token, bind-session, and Key-enumeration coverage.
- `server/test/limits.test.ts`, `server/src/config.ts`, `server/src/services/operations.ts`: payload/import/tree limits and validation.
- `server/Dockerfile`, `server/docker-compose.yml`, `.dockerignore`, `server/src/index.ts`: deployable image, database wiring, migration-on-start, and readiness.
- `README.md`, `server/README.md`: deployment and client-operation instructions.
- `.github/workflows/ci.yml`, root `package.json`: reproducible build, test, integration, and OpenSpec checks.
- `openspec/changes/add-srkey-cloud-sync/tasks.md`: completion evidence tracking only after verification.

## Task 1: Audit the current task-12 implementation

**Files:** Review the files in the map above and the OpenSpec design/task list.

- [x] Run `git diff --check` and each new task-12 test file before edits; record failures and avoid overwriting existing worktree changes.
- [x] Verify every task has a testable acceptance criterion and identify missing coverage before changing production code.

## Task 2: Finish safety and reliability coverage (12.1–12.5)

**Files:** Modify `server/test/integration.test.ts`, `server/test/randomized.test.ts`, `server/test/jobs.test.ts`, `server/test/security.test.ts`, and `server/test/limits.test.ts`; only modify service/config code when a failing test identifies a gap.

- [x] Add cross-namespace coverage for authenticated HTTP, realtime subscription, snapshots, bind sessions, and admin metadata.
- [x] Add a deterministic seeded property-style test that applies equivalent randomized operation histories to two devices, includes duplicate delivery, and asserts canonical active-node equality after replay.
- [x] Test retention using old and recent data: pruning requires a later usable snapshot, expires tombstones only after retention, and purges expired pending-delete namespaces.
- [x] Test security at observable boundaries: errors/log records/backups contain no credentials; invalid/expired bind tokens and revoked sessions fail uniformly; normal Keys cannot enumerate metadata or bypass namespace isolation.
- [x] Test configured body/import/node limits and paginated large events, including deep and cyclic tree validation.
- [x] Run the server test suite and require exit code 0.

## Task 3: Finish container deployment assets (12.6)

**Files:** Modify `server/Dockerfile`, `server/docker-compose.yml`, `.dockerignore`, and `server/src/index.ts` if a startup test shows a missing migration or readiness prerequisite.

- [x] Validate Docker build context copies only workspace dependencies required by the server, runs server typecheck, and starts the server through the workspace package.
- [x] Ensure Compose waits for PostgreSQL health, passes all required configuration, persists database data, and exposes only the service port.
- [x] Run `docker compose -f server/docker-compose.yml config` with non-secret disposable environment values; the Docker daemon could not pull the base image for a local image build.

## Task 4: Add operational and client documentation (12.7–12.8)

**Files:** Modify `README.md`; create or modify `server/README.md`.

- [x] Document reverse-proxy TLS termination, required environment variables, PostgreSQL and `SRKEY_PEPPER` backup/recovery, one-time default-admin capture, and controlled administrator reset.
- [x] Document extension Server URL validation and runtime permission prompts, first-bind backup choices, Key rotation/deletion/recovery behavior, and realtime limitations while Chrome is closed.
- [x] Validate every command against current `package.json` scripts and every environment variable against `server/src/config.ts`.

## Task 5: Add CI and release verification (12.9–12.10)

**Files:** Create `.github/workflows/ci.yml`; modify root `package.json`, `README.md`, and `openspec/changes/add-srkey-cloud-sync/tasks.md`.

- [x] Add CI that installs the pinned pnpm version, builds/tests extension, protocol, and server packages, runs PostgreSQL-backed integration tests using a service container, and validates this OpenSpec change.
- [x] Add a root script that runs the non-browser verification locally; execute it plus individual production builds and `openspec validate add-srkey-cloud-sync --strict`.
- [x] Provide a reproducible two-Chrome-profile verification checklist for initial bind, realtime changes, offline recovery, and administrator Key management.
- [ ] Mark the final OpenSpec task only after the two-profile manual verification is observed.
