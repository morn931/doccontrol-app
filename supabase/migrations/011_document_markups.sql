-- ============================================================================
-- 011_document_markups.sql · CoreDocs — persisted in-app markup layer + captured
-- text comments (structured), one row per reviewer per document. The editable layer
-- (fabric JSON) lets a reviewer resume their draft; `comments` is the structured text
-- capture that will feed the transmittal (replacing the Azure PDF-decipher step).
-- Idempotent.
-- ============================================================================

create table if not exists document_markups (
  id                  uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references document_versions(id) on delete cascade,
  review_task_id      uuid references review_tasks(id) on delete cascade,
  author_email        text not null,
  author_name         text,
  layer               jsonb,   -- per-page fabric JSON: { "0": {...}, "2": {...} }
  comments            jsonb,   -- [{ page, text }] extracted text annotations
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  unique (document_version_id, review_task_id)
);

create index if not exists document_markups_dv_idx on document_markups (document_version_id);

-- Interim data pattern = service-role client behind the auth gate.
alter table document_markups enable row level security;
