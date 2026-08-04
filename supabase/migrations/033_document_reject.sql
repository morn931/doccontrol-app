-- 033_document_reject.sql
-- Per-document reject state, so a controller can reject only some documents in a batch
-- (not just the whole batch). The batch stays open for its remaining good documents;
-- rejecting the last live document escalates to a full-batch reject (handled in
-- app/api/batches/[id]/reject). Each rejected document carries its own cleanup flags so
-- the hard-delete unwind is idempotent/retryable per document, mirroring the batch-level
-- flags from migration 032.
--
-- Adds columns to an existing table only — no new RLS policy needed (document_versions
-- already carries its RLS). Idempotent: safe to run more than once.

alter table public.document_versions add column if not exists is_rejected            boolean not null default false;
alter table public.document_versions add column if not exists reject_reason           text;
alter table public.document_versions add column if not exists rejected_at             timestamptz;
alter table public.document_versions add column if not exists reject_bucket_deleted   boolean not null default false;
alter table public.document_versions add column if not exists reject_source_deleted   boolean not null default false;

comment on column public.document_versions.is_rejected           is 'Document rejected before review — excluded from assignment/review/transmittal; its files are hard-deleted.';
comment on column public.document_versions.reject_reason         is 'Why this document was rejected (per-document; may differ across a batch).';
comment on column public.document_versions.rejected_at           is 'When this document was rejected.';
comment on column public.document_versions.reject_bucket_deleted is 'This document''s PPE approval-bucket copy has been hard-deleted.';
comment on column public.document_versions.reject_source_deleted is 'This document''s vendor FROM VENDOR copy has been deleted (so a corrected re-upload re-triggers intake).';

-- Fast lookup of a batch's still-active (non-rejected) documents.
create index if not exists idx_document_versions_active
  on public.document_versions (batch_id)
  where is_rejected = false;
