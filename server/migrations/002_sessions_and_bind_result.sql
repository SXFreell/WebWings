alter table device_sessions
  add column key_token_version integer not null default 1;

alter table bind_sessions
  add column completed_epoch integer,
  add column completed_seq bigint;
