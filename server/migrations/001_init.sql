create table if not exists server_settings (
  id integer primary key check (id = 1),
  instance_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists namespaces (
  id text primary key,
  sync_epoch integer not null default 1 check (sync_epoch >= 1),
  current_seq bigint not null default 0 check (current_seq >= 0),
  initialized_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists access_keys (
  id text primary key,
  namespace_id text not null references namespaces(id) on delete cascade,
  key_prefix text not null,
  secret_hash text not null unique,
  role text not null check (role in ('admin', 'sync')),
  status text not null default 'active' check (status in ('active', 'pending_delete')),
  label text,
  token_version integer not null default 1,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  purge_at timestamptz,
  last_used_at timestamptz
);

create index if not exists access_keys_status_idx on access_keys (status);

create table if not exists devices (
  id text primary key,
  key_id text not null references access_keys(id) on delete cascade,
  name text,
  info text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create index if not exists devices_key_idx on devices (key_id);

create table if not exists device_sessions (
  id text primary key,
  device_id text not null references devices(id) on delete cascade,
  access_token_hash text not null unique,
  refresh_token_hash text not null unique,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists device_sessions_access_idx on device_sessions (access_token_hash);
create index if not exists device_sessions_refresh_idx on device_sessions (refresh_token_hash);

create table if not exists bookmark_nodes (
  namespace_id text not null references namespaces(id) on delete cascade,
  id text not null,
  type text not null check (type in ('folder', 'bookmark')),
  parent_id text not null default '',
  title text not null,
  url text,
  favicon text,
  position_key text not null,
  version integer not null default 1,
  field_versions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  delete_batch_id text,
  recovery_reason text,
  primary key (namespace_id, id)
);

create index if not exists bookmark_nodes_parent_idx on bookmark_nodes (namespace_id, parent_id);
create unique index if not exists bookmark_nodes_position_idx on bookmark_nodes (namespace_id, parent_id, position_key);

create table if not exists sync_events (
  namespace_id text not null references namespaces(id) on delete cascade,
  sync_epoch integer not null,
  seq bigint not null,
  op_id text not null,
  device_id text,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (namespace_id, seq)
);

create unique index if not exists sync_events_op_idx on sync_events (namespace_id, op_id);
create index if not exists sync_events_epoch_seq_idx on sync_events (namespace_id, sync_epoch, seq);

create table if not exists operation_receipts (
  namespace_id text not null references namespaces(id) on delete cascade,
  op_id text not null,
  seq bigint,
  status text not null check (status in ('accepted', 'rejected', 'epoch_mismatch')),
  error_code text,
  payload jsonb,
  created_at timestamptz not null default now(),
  primary key (namespace_id, op_id)
);

create table if not exists snapshots (
  namespace_id text not null references namespaces(id) on delete cascade,
  sync_epoch integer not null,
  seq bigint not null,
  digest text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (namespace_id, sync_epoch, seq)
);

create table if not exists bind_sessions (
  id text primary key,
  key_id text not null references access_keys(id) on delete cascade,
  device_id text not null references devices(id) on delete cascade,
  bind_token_hash text not null unique,
  sync_epoch integer not null,
  cloud_seq bigint not null,
  cloud_digest text,
  cloud_has_data boolean not null,
  cloud_snapshot jsonb,
  state text not null default 'created' check (state in ('created', 'backup_proven', 'completed', 'expired')),
  local_revision bigint,
  local_digest text,
  strategy text,
  operation_id text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists bind_sessions_key_idx on bind_sessions (key_id);
