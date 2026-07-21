-- Migration 020 — CoreDocs: internal engineering driveway + shared "Issue to Aconex" exit
-- Run in the CoreDocs Supabase project: tjzeahdimbekuizegsky (SQL Editor).
-- Idempotent. Existing vendor rows default to source='vendor'; the review engine is unchanged.

-- 1) Origin tag on batches — "the tag around its neck".
alter table batches add column if not exists source text not null default 'vendor';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'batches_source_check') then
    alter table batches add constraint batches_source_check
      check (source in ('vendor','internal','redline'));
  end if;
end $$;

-- 2) Link an internal batch to the Document Request line that allocated its number.
alter table batches add column if not exists request_line_id uuid
  references document_number_request_line(id) on delete set null;

-- 3) Extend batch status with the issue-to-Aconex states (Rev 0+ bypasses review).
alter table batches drop constraint if exists batches_status_check;
alter table batches add constraint batches_status_check check (status in (
  'intake_received','metadata_pending',
  'ready_for_reviewer_assignment','review_ready_to_start',
  'review_in_progress','review_complete',
  'transmittal_generated','returned_to_vendor',
  'rejected_before_review','cancelled','failed',
  'awaiting_aconex_issue','issued_to_aconex'      -- NEW
));

-- 4) The shared "Issue to Aconex" exit — one tracked-manual record. Serves vendor + internal.
create table if not exists aconex_issue (
  id                   uuid primary key default gen_random_uuid(),
  batch_id             uuid references batches(id) on delete set null,
  document_version_id  uuid references document_versions(id) on delete set null,
  source               text not null default 'vendor'
                         check (source in ('vendor','internal','redline')),
  rdmc_document_number text,
  revision             text,
  aconex_document_ref  text,                       -- filled when uploaded to Aconex
  cddl_updated         boolean not null default false,  -- controller's "CDDL/MDDR updated" tick (the seam)
  issued_by            uuid references users(id) on delete set null,
  issued_by_email      text,
  issued_at            timestamptz,
  status               text not null default 'pending' check (status in ('pending','issued')),
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists aconex_issue_batch_idx  on aconex_issue(batch_id);
create index if not exists aconex_issue_status_idx on aconex_issue(status);

-- RLS (standing rule: every new table). Authenticated read; writes via the service-role client.
alter table aconex_issue enable row level security;
drop policy if exists aconex_issue_read on aconex_issue;
create policy aconex_issue_read on aconex_issue for select to authenticated using (true);

-- reuse the existing updated_at trigger function
drop trigger if exists aconex_issue_updated_at on aconex_issue;
create trigger aconex_issue_updated_at before update on aconex_issue
  for each row execute function update_updated_at();

-- 5) Permissions — the new actions + the exit-queue nav.
insert into role_permissions (feature_key, role, allowed) values
  ('action.submit_internal_drawing','reviewer',true),
  ('action.submit_internal_drawing','engineering_manager',true),
  ('action.submit_internal_drawing','document_controller',true),
  ('action.submit_internal_drawing','project_manager',true),
  ('action.submit_internal_drawing','admin',true),
  ('action.submit_internal_drawing','developer',true),
  ('nav.aconex_issue','document_controller',true),
  ('nav.aconex_issue','admin',true),
  ('nav.aconex_issue','developer',true),
  ('action.issue_to_aconex','document_controller',true),
  ('action.issue_to_aconex','admin',true),
  ('action.issue_to_aconex','developer',true)
on conflict do nothing;
