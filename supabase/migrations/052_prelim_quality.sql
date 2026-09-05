-- ============================================================================
-- 052_prelim_quality.sql · CoreDocs — document quality checks on Prelim Review
--
-- Morné, 2026-09-05. The vendor intake reads every incoming vendor document and flags
-- title-block, template and revision problems for Document Control to send back. Our own
-- drawings get no such read before they enter internal review. Prelim Review now runs the
-- same kind of check on OUR documents — against the SOURCE file in COLAB, so a helper can
-- fix the actual document, press Check quality again, and watch the list shrink until it
-- is clear. Hand-over carries any open issues into the formal review; it never blocks.
--
--   prelim_quality_run   one row per check per document — history, so what was fixed stays
--                        visible after it is fixed
--   prelim_document      gets the LATEST result denormalised for the session table
-- Idempotent.
-- ============================================================================

create table if not exists prelim_quality_run (
  id                  uuid primary key default gen_random_uuid(),
  prelim_document_id  uuid not null references prelim_document(id) on delete cascade,
  checked_at          timestamptz not null default now(),
  checked_by_email    text not null,
  source_file_url     text,                     -- what was read (the COLAB source at the time)
  source_modified_at  timestamptz,              -- the source's last-modified when read
  open_count          int not null default 0,
  report              jsonb not null,           -- the structured result (see lib/prelim/quality-check.ts)
  error               text                      -- why a read failed, visible not silent
);
create index if not exists prelim_quality_run_doc_idx on prelim_quality_run (prelim_document_id, checked_at desc);

alter table prelim_document
  add column if not exists quality_latest       jsonb,
  add column if not exists quality_open         int,
  add column if not exists quality_checked_at   timestamptz,
  add column if not exists quality_source_modified_at timestamptz;

alter table prelim_quality_run enable row level security;
