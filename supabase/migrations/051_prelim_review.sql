-- ============================================================================
-- 051_prelim_review.sql · CoreDocs — Prelim Review (group review before the formal chain)
--
-- Morné, 2026-09-04. Newly developed tender documents are looked at by the whole team in
-- the boardroom BEFORE they go through the formal internal review for the first time. The
-- formal engine takes one document at a time, gives it a reference the moment it enters,
-- and reviews in strict sequence — none of which fits a room full of engineers marking up
-- forty drawings together. So the preliminary pass gets its own tables, the way a site
-- redline basket does, and nothing reaches `batches` until a document is HANDED OVER.
--
--   prelim_session   one boardroom session: which source folder, when, who was there
--   prelim_document  one drawing pulled into the session, with its working copy in the
--                    Internal Reviews library, the room's markup layer + comments, the
--                    room's outcome, and — once handed over — the formal batch it became
--
-- Reusable by design (not a one-off): sessions are keyed on a source site/library/folder,
-- so any future push can run the same way. Idempotent.
-- ============================================================================

create table if not exists prelim_session (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  area               text,                                  -- e.g. "Main Consumer Substation"
  source_site_url    text not null,
  source_library     text not null,
  source_folder      text not null default '',              -- path inside the library
  held_on            date,
  attendees          text,                                  -- free text, who was in the room
  notes              text,
  status             text not null default 'open' check (status in ('open','closed')),
  created_by_email   text not null,
  created_by_name    text,
  created_at         timestamptz not null default now(),
  closed_at          timestamptz,
  closed_by_email    text
);

create table if not exists prelim_document (
  id                   uuid primary key default gen_random_uuid(),
  session_id           uuid not null references prelim_session(id) on delete cascade,
  -- identity: matched to the CDDL where the filename carries a number; otherwise title only
  cddl_doc_id          uuid references cddl_doc(id) on delete set null,
  document_number      text,
  revision             text,
  title                text,
  discipline           text,
  document_type        text,
  -- files: where it came from, and the working PDF the room marks up
  source_file_name     text not null,
  source_file_url      text not null,
  working_file_name    text not null,
  working_file_url     text not null,
  -- the room's markup (same shape as document_markups / redline_document)
  markup_layer         jsonb,
  markup_comments      jsonb,
  markup_committed_at  timestamptz,                         -- last "save to SharePoint" (flatten)
  -- the room's call
  outcome              text not null default 'pending' check (outcome in ('pending','ready','rework','withdrawn')),
  outcome_note         text,
  outcome_by_email     text,
  outcome_at           timestamptz,
  -- rework: who was asked to fix it
  rework_to_email      text,
  rework_sent_at       timestamptz,
  -- hand-over: the formal batch this became
  handed_over_batch_id uuid references batches(id) on delete set null,
  handed_over_dv_id    uuid references document_versions(id) on delete set null,
  handed_over_at       timestamptz,
  handed_over_by_email text,
  pulled_by_email      text not null,
  created_at           timestamptz not null default now(),
  unique (session_id, source_file_url)                      -- pulling twice is a no-op
);

create index if not exists prelim_document_session_idx on prelim_document (session_id, created_at);
create index if not exists prelim_document_docno_idx   on prelim_document (document_number);

-- Standing rule: every new table ships with RLS on. The app uses the service-role client
-- behind the auth gate; the anon key gets nothing.
alter table prelim_session  enable row level security;
alter table prelim_document enable row level security;

-- ── Permissions ─────────────────────────────────────────────────────────────
-- nav.prelim_review    see sessions, open documents, mark up, record the room's outcome
-- action.prelim_manage open a session, pull from the source folder, hand over, close
insert into role_permissions (feature_key, role, allowed) values
  ('nav.prelim_review',   'admin',               true),
  ('nav.prelim_review',   'document_controller', true),
  ('nav.prelim_review',   'reviewer',            true),
  ('nav.prelim_review',   'engineering_manager', true),
  ('nav.prelim_review',   'manager',             true),
  ('nav.prelim_review',   'project_manager',     true),
  ('nav.prelim_review',   'vendor',              false),
  ('action.prelim_manage','admin',               true),
  ('action.prelim_manage','document_controller', true),
  ('action.prelim_manage','reviewer',            false),
  ('action.prelim_manage','engineering_manager', true),
  ('action.prelim_manage','manager',             false),
  ('action.prelim_manage','project_manager',     true),
  ('action.prelim_manage','vendor',              false)
on conflict (feature_key, role) do nothing;
