-- 025: DB-backed public share links ("anyone with the link", no login).
--
-- A row unlocks one read-only surface (e.g. the document search) for external
-- parties who don't have a login or SharePoint access. The token is long &
-- unguessable; revoke instantly by flipping `revoked` (no redeploy), or let it
-- lapse with `expires_at`. Only the service-role client reads/writes this table
-- (RLS on with no policies → anon/authenticated get nothing).

create table if not exists share_link (
  id               uuid primary key default gen_random_uuid(),
  token            text not null unique,
  kind             text not null default 'documents',   -- which surface (extensible)
  label            text,
  shared_with      text,                                 -- who it was sent to (audit)
  created_by       text,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz,                          -- null = no expiry
  revoked          boolean not null default false,
  last_accessed_at timestamptz,
  access_count     integer not null default 0
);

alter table share_link enable row level security;

create index if not exists share_link_token_idx on share_link (token);
