-- 044_notification.sql
-- In-screen notifications for the Actions Cockpit / whole app — colour-coded,
-- so people are notified ON SCREEN (a bell in the header) instead of by email
-- for everything. A unified feed materialised from the work sources:
--   type 'routing' — a document/batch routed to me
--   type 'review'  — a review task waiting on me
--   type 'action'  — an engineering action assigned to me
--   type 'message' — (future) a chat mention
-- source_key is a STABLE per-event key ("review:<taskId>") so the materialise
-- step is idempotent (insert-or-ignore) and never disturbs a read notification.

create table if not exists public.notification (
  id          uuid primary key default gen_random_uuid(),
  user_email  text not null,          -- recipient
  type        text not null,          -- routing | review | action | message
  title       text not null,
  body        text,
  href        text,                    -- where clicking it goes
  source_key  text not null,           -- stable dedupe key per source event
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create unique index if not exists uq_notification_source on public.notification (user_email, source_key);
create index if not exists idx_notification_user on public.notification (user_email, read_at, created_at desc);

alter table public.notification enable row level security;  -- app uses service-role; anon gets nothing
