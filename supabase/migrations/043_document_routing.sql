-- 043_document_routing.sql
-- Engineer-to-engineer document/batch routing for the Actions Cockpit.
--
-- A routing is a lightweight COLLABORATION hand-off: "I'm passing this document
-- (or this whole batch) to you — please look at it." It surfaces on the
-- recipient's cockpit ("Routed to you") and does NOT alter the controller's
-- formal review sequence (review_tasks) — the official chain stays theirs.
-- People are identified by EMAIL (CoreDocs auth ids differ across projects).

create table if not exists public.document_routing (
  id                  uuid primary key default gen_random_uuid(),
  from_email          text not null,
  from_name           text,
  to_email            text not null,
  to_name             text,
  -- target: a specific document version, and/or a whole batch (at least one set)
  document_version_id uuid references public.document_versions(id) on delete cascade,
  batch_id            uuid references public.batches(id) on delete cascade,
  -- denormalised context so the cockpit renders without extra joins
  document_number     text,
  package_code        text,
  note                text,
  status              text not null default 'open'
                        check (status in ('open','accepted','done','dismissed')),
  created_at          timestamptz not null default now(),
  responded_at        timestamptz,
  responded_by_email  text
);

create index if not exists idx_document_routing_to   on public.document_routing (to_email, status);
create index if not exists idx_document_routing_from on public.document_routing (from_email, status);

-- App uses the service-role client; anon key gets nothing (standing RLS rule).
alter table public.document_routing enable row level security;
