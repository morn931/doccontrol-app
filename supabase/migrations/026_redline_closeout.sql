-- 026_redline_closeout.sql
-- Close the redline loop (ruled 2026-07-30): the accepting engineer owns the
-- As-Built; the redline waits visibly ("awaiting_asbuilt") however long the
-- drawing office takes; the uploaded As-Built is a linked batch that closes
-- the redline when its review completes.
alter table redline_submission
  add column if not exists review_state text not null default 'pending'
    check (review_state in ('pending','awaiting_asbuilt','rejected','closed')),
  add column if not exists asbuilt_engineer_email text,
  add column if not exists accepted_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists asbuilt_batch_id uuid references batches(id),
  add column if not exists closed_at timestamptz;

-- Let As-Built batches through the source gate.
alter table batches drop constraint if exists batches_source_check;
alter table batches add constraint batches_source_check
  check (source in ('vendor','internal','redline','asbuilt'));
