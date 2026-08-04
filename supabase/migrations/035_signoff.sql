-- 035_signoff.sql
-- Phase 2 of the Internal Review stream: SIGN-OFF. After an internal-review document is
-- Review-complete, the controller sends it through an ordered, in-app signature chain.
-- The finalised native file is rendered to PDF (Graph), an approval block is appended, and
-- each signatory stamps their stored signature into their row — all inside CoreDocs, never
-- SharePoint. This migration adds the routing table + batch fields/statuses. PDF conversion,
-- stamping and Aconex issue are code (Phase 2b/2c) / Phase 3. Idempotent.

-- 1. Allow the new sign-off batch statuses (extend the check last set in 020).
alter table public.batches drop constraint if exists batches_status_check;
alter table public.batches add constraint batches_status_check check (status in (
  'intake_received','metadata_pending',
  'ready_for_reviewer_assignment','review_ready_to_start',
  'review_in_progress','review_complete',
  'transmittal_generated','returned_to_vendor',
  'rejected_before_review','cancelled','failed',
  'awaiting_aconex_issue','issued_to_aconex',
  'signoff_in_progress','signed','signoff_declined'      -- NEW (Phase 2)
));

-- 2. Batch-level sign-off state.
alter table public.batches add column if not exists signoff_pdf_url    text;
alter table public.batches add column if not exists signoff_started_at timestamptz;
alter table public.batches add column if not exists signed_at          timestamptz;

comment on column public.batches.signoff_pdf_url    is 'The generated, progressively-signed sign-off PDF (in the Internal Reviews library / Signed).';
comment on column public.batches.signoff_started_at is 'When the batch was sent for sign-off.';
comment on column public.batches.signed_at          is 'When the last signatory signed (batch fully signed).';

-- 3. The signature routing — one row per signatory, sequential like the review chain.
create table if not exists public.signoff_tasks (
  id               uuid primary key default gen_random_uuid(),
  batch_id         uuid not null references public.batches(id) on delete cascade,
  signatory_email  text not null,
  signatory_name   text,
  role_label       text,                       -- e.g. Prepared / Checked / Approved
  sequence_number  integer not null,
  status           text not null default 'pending'
                     check (status in ('pending','sent','opened','signed','declined')),
  block_row        integer,                    -- 0-based row in the appended approval block (stamp target)
  decline_reason   text,
  signed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_signoff_tasks_batch     on public.signoff_tasks (batch_id, sequence_number);
create index if not exists idx_signoff_tasks_signatory on public.signoff_tasks (lower(signatory_email), status);

-- RLS: the app reads/writes signoff_tasks via the service-role client (which bypasses RLS),
-- so enabling RLS with no permissive policy locks it to the anon key while costing nothing —
-- per the standing "RLS on every new table" rule.
alter table public.signoff_tasks enable row level security;

comment on table public.signoff_tasks is 'Sequential in-app signature routing for internal-review sign-off (Phase 2).';
