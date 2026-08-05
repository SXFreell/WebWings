## 1. Workspace and protocol foundation

- [x] 1.1 Add the pnpm workspace layout while keeping the existing extension at the repository root, and scaffold `server/` plus `packages/sync-protocol/` with independent build and test commands.
- [x] 1.2 Define versioned runtime schemas and TypeScript types for service discovery, errors, Key roles, device sessions, nodes, operations, receipts, events, snapshots and cursors.
- [x] 1.3 Define schemas for bind sessions, backup manifests, backup proofs and the `cloud`/`local` reconciliation strategies.
- [x] 1.4 Add shared protocol fixture tests that validate accepted payloads, reject unknown or malformed versions and run in both extension and server packages.
- [x] 1.5 Add server configuration loading for PostgreSQL, `SRKEY_PEPPER`, instance identity, token lifetimes, retention windows, payload limits and public API metadata.
- [x] 1.6 Add structured server logging with mandatory redaction for Authorization headers, srkeys, bind/access/refresh tokens and backup contents.

## 2. PostgreSQL data model and repositories

- [x] 2.1 Create migrations for `server_settings`, `access_keys` and `namespaces`, including stable instance ID, Key status, role, token version, sync epoch and current sequence constraints.
- [x] 2.2 Create migrations for `devices` and `device_sessions`, storing only token digests and supporting expiry and revocation.
- [x] 2.3 Create migrations for namespace-scoped `bookmark_nodes` with position, field-version and soft-delete metadata.
- [x] 2.4 Create migrations for `sync_events` and `operation_receipts` with unique namespace operation IDs and monotonically allocated namespace sequences.
- [x] 2.5 Create migrations for `snapshots` and `bind_sessions`, including immutable source versions, digests, state transitions and expiry.
- [x] 2.6 Implement transaction helpers that lock a namespace before allocating a sequence or changing its epoch.
- [x] 2.7 Implement namespace-scoped repositories whose public methods derive namespace from authenticated context rather than client input.
- [x] 2.8 Add database tests proving identical node IDs can exist in separate namespaces and no repository query, event stream or snapshot crosses namespaces.

## 3. srkey, administrator and device authentication

- [x] 3.1 Add failing tests and implement generation and parsing of 32-byte `srk_admin_` and `srk_sync_` secrets with safe display prefixes.
- [x] 3.2 Implement HMAC-based srkey lookup with constant-time comparison semantics, uniform invalid/revoked responses and binding rate limits.
- [x] 3.3 Implement first-start administrator bootstrap from `WEBWINGS_ADMIN_SRKEY` or one-time generation, ensuring restarts never create a second default administrator.
- [x] 3.4 Implement limited bind tokens and opaque device access/refresh sessions, including refresh, explicit revoke, expiry and token-version checks.
- [x] 3.5 Add authentication tests proving successful binding never returns stored raw srkey material and revoked or rotated Keys invalidate every existing device session.
- [x] 3.6 Implement administrator Key listing with prefix, label, status, device count, data count and last activity but no other namespace content.
- [x] 3.7 Implement administrator creation of normal Keys with an empty namespace and one-time full-secret response.
- [x] 3.8 Implement normal Key rotation that preserves Key ID and namespace while revoking the old secret, sessions and realtime connections.
- [x] 3.9 Implement Key deletion, configurable pending-delete retention, recovery with a new secret and permanent namespace cleanup after expiry.
- [x] 3.10 Prevent deletion of the only administrator and add authorization tests proving normal Keys cannot call management APIs.
- [x] 3.11 Add a controlled administrator reset command that updates the existing administrator digest and token version in one transaction without changing its namespace.

## 4. Server discovery and connection APIs

- [x] 4.1 Implement `GET /v1/info` with service name, protocol version, stable instance ID, server time, minimum client version and advertised capabilities.
- [x] 4.2 Add discovery compatibility tests covering invalid service identity, unsupported protocol versions and clients below the minimum version.
- [x] 4.3 Implement `POST /v1/bind/start` so srkey validation creates only a limited, expiring bind session and provisional device identity.
- [x] 4.4 Ensure bind, authentication and management endpoints never accept namespace overrides from request payloads.
- [x] 4.5 Add API security tests for malformed URLs in payloads, oversized requests, credential redaction and indistinguishable invalid-Key responses.

## 5. Authoritative bookmark operations

- [x] 5.1 Add position-key utilities and tests for inserting between neighbors, deterministic ID tie-breaking and order-preserving rebalance.
- [x] 5.2 Implement server-side node and tree validation for types, URL protocols, parent existence, namespace ownership and directory cycles.
- [x] 5.3 Implement idempotent node creation with server sequence allocation, field versions and deterministic concurrent sibling ordering.
- [x] 5.4 Implement field-level node patch operations so unrelated concurrent fields merge and same-field writes resolve by server acceptance order.
- [x] 5.5 Implement node and directory move operations with cycle rejection and authoritative corrective results for rejected optimistic moves.
- [x] 5.6 Implement atomic directory-tree soft deletion, delete batches and rejection of stale updates that would resurrect tombstones.
- [x] 5.7 Implement explicit restore operations and the namespace `lost+found` behavior for creates whose target parent was already deleted.
- [x] 5.8 Implement atomic import operations that reuse existing validation and ID remapping semantics without URL/title deduplication.
- [x] 5.9 Implement idempotent `POST /v1/sync/push` batches with per-operation receipts for accepted and deterministic rejected results.
- [x] 5.10 Add concurrency tests for different-field edits, same-field edits, competing moves, delete-versus-edit, create-under-deleted-parent and concurrent inserts.

## 6. Events, pull, snapshots and realtime delivery

- [x] 6.1 Implement paginated `GET /v1/sync/pull` with epoch validation, strict sequence order and a `snapshot_required` response for expired cursors.
- [x] 6.2 Implement canonical snapshot creation and `GET /v1/sync/snapshot` with digest, epoch, sequence, active nodes and recoverable tombstones.
- [x] 6.3 Add snapshot scheduling and event-retention cleanup that never removes events before a usable later snapshot exists.
- [x] 6.4 Add tests proving retrying a push returns the original receipt and retrying a pull from the same cursor returns the same ordered events.
- [x] 6.5 Implement namespace-authenticated WebSocket connections that publish only epoch/latest-sequence hints and close immediately on Key or device revocation.
- [x] 6.6 Add PostgreSQL `LISTEN/NOTIFY` wakeups for multi-process realtime delivery while keeping pull as the authoritative data path.
- [x] 6.7 Implement advisory-lock protection for snapshot, retention and cleanup jobs so only one server process performs each scheduled run.

## 7. IndexedDB migration and local data boundary

- [x] 7.1 Add IndexedDB migration tests that start from the current version 1 database and preserve every existing folder and bookmark.
- [x] 7.2 Upgrade local nodes with position keys, sync versions and tombstone metadata, deriving stable initial positions from current `order`, title and ID.
- [x] 7.3 Add `outbox`, `meta`, `binding` and `bindSessions` object stores with indexes needed for retry, cursor and active-connection lookup.
- [x] 7.4 Implement an atomic local operation API that updates nodes, increments local revision and writes outbox only when an active binding exists.
- [x] 7.5 Implement atomic remote-event application that advances the cursor without generating new outbox operations.
- [x] 7.6 Implement atomic snapshot installation that preserves pending outbox until the reconciliation policy decides which operations remain valid.
- [x] 7.7 Refactor bookmark create, edit, move, delete-tree and import callers to use the local operation API while preserving existing unbound behavior.
- [x] 7.8 Keep manual `webwings-bookmarks` v1 full/folder export and merge import compatible, and extend regression tests around those flows.
- [x] 7.9 Add local change notifications so popup views reload after local writes, remote event commits and snapshot installation.

## 8. Extension connection configuration

- [x] 8.1 Update the Manifest with a module Service Worker, minimum Chrome version, storage/downloads/alarms permissions and runtime optional HTTPS plus loopback host patterns.
- [x] 8.2 Add Server URL normalization tests for HTTPS, loopback HTTP, subpaths, trailing slashes, credentials, query strings, fragments and non-loopback HTTP rejection.
- [x] 8.3 Implement exact-Origin runtime permission request and permission-revocation detection without contacting the server before permission is granted.
- [x] 8.4 Implement the service discovery client and ensure srkey submission cannot occur until identity and version validation succeeds.
- [x] 8.5 Implement the Server URL + srkey connection form with masked Key input, permission/error states and a single explicit connect action.
- [x] 8.6 Persist only normalized URL, Origin, instance ID, Key ID/prefix, role, device metadata, tokens, epoch and cursor; clear raw srkey after bind completion or cancellation.
- [x] 8.7 Implement connection identity checks for same-instance URL migration, different-Key rebinding and unexpected instance changes that suspend uploads.
- [x] 8.8 Add tests proving connection failures and candidate connections never replace the active binding or modify local bookmark data.

## 9. First-bind backups and reconciliation

- [ ] 9.1 Implement server creation of immutable bind-session cloud snapshots locked to instance, Key, cloud sequence and sync epoch.
- [ ] 9.2 Implement client capture of a consistent local snapshot and local revision without blocking ordinary local-only data reads.
- [ ] 9.3 Implement `webwings-sync-backup` ZIP serialization with `manifest.json`, `cloud.json`, `local.json`, SHA-256 digests and credential exclusion tests.
- [ ] 9.4 Integrate the downloads API and keep reconciliation actions disabled until the generated archive reaches completed download state.
- [ ] 9.5 Implement backup-proof recording and bind-session state transitions, expiry and persistence across popup or Service Worker termination.
- [ ] 9.6 Implement cloud-empty completion that atomically initializes the namespace from local data after both empty/non-empty backups exist.
- [ ] 9.7 Implement “使用云端” by atomically installing the locked cloud snapshot locally and then pulling events after the snapshot sequence.
- [ ] 9.8 Implement “使用本地” with compare-and-swap replacement, epoch increment, reset notification and rejection of old-epoch device operations.
- [ ] 9.9 Implement “合并” as an atomic cloud-preserving import with ID remapping, tree preservation, stable root append order and no semantic deduplication.
- [ ] 9.10 Make bind completion idempotent by operation ID and invalidate the session when instance, Key, cloud sequence, epoch or local revision changes.
- [ ] 9.11 Build the resumable first-bind wizard for backup, cloud-empty initialization, three-strategy selection, progress, cancellation and version-invalidated restart.
- [ ] 9.12 Add end-to-end tests for empty/empty, empty/local, cloud/local, all three choices, download failure, version race, retry after lost response and Key revocation mid-bind.

## 10. Background sync engine

- [ ] 10.1 Register the extension Service Worker and implement startup reconstruction exclusively from persisted binding, cursor, epoch and outbox state.
- [ ] 10.2 Implement access-token refresh, terminal authentication failure handling and safe pause when host permission or service identity changes.
- [ ] 10.3 Implement the sync loop to pull first, atomically apply events, then batch and push outbox operations with jittered exponential backoff.
- [ ] 10.4 Implement receipt processing that removes confirmed outbox entries and applies authoritative corrections for rejected optimistic operations.
- [ ] 10.5 Implement snapshot-required recovery that installs the current snapshot and replays only operations valid for the current epoch.
- [ ] 10.6 Implement WebSocket connection, heartbeat, reconnect and latest-sequence-triggered pull without treating notification payloads as data.
- [ ] 10.7 Trigger recovery on Service Worker startup, browser startup, popup open, network restoration, successful token refresh and periodic alarms.
- [ ] 10.8 Add crash-boundary tests for termination before send, after send, before receipt persistence and during remote batch application.
- [ ] 10.9 Add two-device offline/reconnect tests proving eventual convergence without duplicate nodes or lost local edits.

## 11. Sync and administrator user experience

- [ ] 11.1 Add a connection summary showing Server URL, Key prefix, role, device and last successful synchronization without exposing raw credentials.
- [ ] 11.2 Add a low-interruption sync status component for sustained offline, permission, authentication, instance-change, epoch and stalled-outbox states.
- [ ] 11.3 Keep normal successful synchronization visually silent and verify bookmark browsing and editing remain usable during retries.
- [ ] 11.4 Add the administrator-only Key management view and load only management metadata from the connected server.
- [ ] 11.5 Add normal Key creation with copy/download affordance and an explicit warning that the full secret is shown once.
- [ ] 11.6 Add rotation, delete, pending-delete recovery and permanent-delete confirmations, including protection for the only administrator.
- [ ] 11.7 Add UI authorization tests proving normal Keys never render management actions and administrator actions cannot navigate into other Key contents.

## 12. Verification, deployment and operations

- [ ] 12.1 Add cross-namespace integration tests covering HTTP endpoints, WebSocket channels, snapshots, bind sessions and administrator metadata.
- [ ] 12.2 Add randomized multi-device operation tests that permute field patches, moves, deletes, creates, imports and duplicate deliveries and assert convergence.
- [ ] 12.3 Add retention tests for event pruning, snapshot fallback, tombstone expiry, Key pending-delete recovery and permanent cleanup.
- [ ] 12.4 Add security tests for credential leakage in logs/errors/backups, Key enumeration, expired bind tokens, revoked sessions and unauthorized namespace IDs.
- [ ] 12.5 Add payload and tree-size limits with tests for oversized imports, deep/cyclic trees and paginated large delete/import events.
- [ ] 12.6 Add server Dockerfile, PostgreSQL-backed Docker Compose setup, health/readiness endpoints and migration startup procedure.
- [ ] 12.7 Document HTTPS reverse-proxy deployment, required environment variables, database and pepper backup, default administrator capture and administrator reset recovery.
- [ ] 12.8 Document client connection, permission prompts, first-bind backup choices, Key rotation/deletion behavior and the limits of realtime while Chrome is closed.
- [ ] 12.9 Add CI commands that build and test the extension, shared protocol package and server, run database integration tests and validate the OpenSpec change.
- [ ] 12.10 Run the full test suite and production builds, then perform a manual two-profile Chrome verification covering first bind, realtime sync, offline recovery and administrator Key management.
