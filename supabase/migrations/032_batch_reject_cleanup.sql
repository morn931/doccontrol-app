-- 032_batch_reject_cleanup.sql
-- Reject-cleanup tracking on batches.
--
-- Reject is being reworked into a single, server-orchestrated, idempotent unwind
-- (see app/api/batches/[id]/reject). Each boolean below records whether one step of
-- that unwind has succeeded, so:
--   • a partially-failed reject can be RETRIED and resume only the unfinished steps, and
--   • the batch page can show exactly what was and wasn't cleaned (no silent half-states).
-- reject_cleanup_error holds the last failure detail (null = clean) and drives the
-- "Retry cleanup" affordance.
--
-- This only ADDS COLUMNS to an existing table — no new table, so no new RLS policy is
-- required (batches already carries its RLS from 003_rls_policies.sql). Idempotent:
-- safe to run more than once.

alter table public.batches add column if not exists reject_bucket_deleted   boolean not null default false;
alter table public.batches add column if not exists reject_source_deleted   boolean not null default false;
alter table public.batches add column if not exists reject_picks_closed     boolean not null default false;
alter table public.batches add column if not exists reject_vendor_notified  boolean not null default false;
alter table public.batches add column if not exists reject_cleanup_error    text;

comment on column public.batches.reject_bucket_deleted  is 'Reject unwind: PPE DocumentControl "Documents for Approval" copies hard-deleted.';
comment on column public.batches.reject_source_deleted  is 'Reject unwind: vendor FROM VENDOR copies deleted (so a corrected re-upload re-triggers intake).';
comment on column public.batches.reject_picks_closed    is 'Reject unwind: Approver Picks SharePoint row soft-closed (status Rejected, hidden from the active view).';
comment on column public.batches.reject_vendor_notified is 'Reject unwind: rejection email sent to the vendor.';
comment on column public.batches.reject_cleanup_error   is 'Last reject-cleanup error detail (null = clean); drives the Retry Cleanup affordance.';
