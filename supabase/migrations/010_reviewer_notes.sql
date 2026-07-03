-- ============================================================================
-- 010_reviewer_notes.sql · CoreDocs — internal reviewer-to-reviewer handover notes
-- NOT part of the transmittal. Accumulate per document_version; every reviewer of
-- the document sees all notes at the top when they open it. Idempotent.
-- ============================================================================

create table if not exists reviewer_notes (
  id                  uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references document_versions(id) on delete cascade,
  batch_id            uuid references batches(id) on delete cascade,
  review_task_id      uuid references review_tasks(id) on delete set null,
  author_email        text not null,
  author_name         text,
  note_text           text not null,
  created_at          timestamptz not null default now()
);

create index if not exists reviewer_notes_dv_idx on reviewer_notes (document_version_id, created_at);

-- Interim data pattern = service-role client behind the auth gate. Enable RLS with no
-- policies so only the service role (our API) can read/write; direct client access denied.
alter table reviewer_notes enable row level security;
