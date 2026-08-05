# WebWings Sync Server

The sync server is a Fastify process backed by PostgreSQL. It owns Key validation, device sessions, the authoritative event log, snapshots, and realtime hints.

## Run with Docker Compose

1. Generate a random `SRKEY_PEPPER` of at least 16 characters and store it independently from the database backup.
2. Set a database password and, optionally, a valid `srk_admin_…` Key for the initial administrator.
3. Start the service:

```bash
WEBWINGS_DB_PASSWORD='replace-me' \
SRKEY_PEPPER='replace-with-a-long-random-secret' \
docker compose -f server/docker-compose.yml up -d --build
```

On its first start, the server applies the SQL migrations and creates one administrator Key. If `WEBWINGS_ADMIN_SRKEY` is unset, the generated Key appears once in the server logs; capture it immediately in a password manager. Restarts never create another default administrator.

Use `GET /healthz` for process liveness and `GET /readyz` for PostgreSQL readiness.

## Production deployment

Place the container behind an HTTPS reverse proxy. Terminate TLS at the proxy and forward WebSocket upgrades for `/v1/realtime`; expose the server port only to the proxy or private network. Browser clients reject non-loopback HTTP Server URLs.

Required environment variables:

- `DATABASE_URL`: PostgreSQL connection URL.
- `SRKEY_PEPPER`: secret HMAC pepper; never log it or store it in PostgreSQL.

Useful optional variables are `PORT`, `WEBWINGS_INSTANCE_ID`, `WEBWINGS_ADMIN_SRKEY`, `WEBWINGS_ACCESS_TOKEN_TTL_MINUTES`, `WEBWINGS_REFRESH_TOKEN_TTL_DAYS`, `WEBWINGS_BIND_SESSION_TTL_MINUTES`, `WEBWINGS_DELETE_RETENTION_DAYS`, `WEBWINGS_EVENT_RETENTION_COUNT`, `WEBWINGS_SNAPSHOT_INTERVAL_EVENTS`, `WEBWINGS_MAX_PUSH_OPS`, `WEBWINGS_MAX_NODES_PER_IMPORT`, `WEBWINGS_MAX_BODY_BYTES`, and `WEBWINGS_LOG_LEVEL`.

Back up PostgreSQL and `SRKEY_PEPPER` separately. A database backup without the same pepper cannot validate existing Keys; a pepper backup without the database cannot restore synchronized data.

## Administrator recovery

If the administrator Key is lost, run the controlled reset command against the same database and pepper:

```bash
DATABASE_URL='postgres://…' SRKEY_PEPPER='…' pnpm --filter webwings-server reset-admin
```

It prints one replacement administrator Key, preserves the administrator namespace, and revokes existing administrator sessions. Save the new Key immediately.

## Database integration test

With a disposable PostgreSQL instance available, run:

```bash
DATABASE_URL='postgres://webwings:password@localhost:5432/webwings' pnpm test:server:postgres
```
