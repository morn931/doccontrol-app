-- 025_redline_submissions.sql
-- Driveway C front door: draft redline submissions (site → doc control).
-- A submission is a basket the uploader fills before submitting; on submit it
-- becomes a normal batches row with source='redline' (value exists since 020).
-- Files live in the Internal Reviews library under "Site Redlines/<submission>/".
create table if not exists redline_submission (
  id               uuid primary key default gen_random_uuid(),
  created_by_email text not null,
  submitter_name   text,
  status           text not null default 'draft'
                   check (status in ('draft','submitted','cancelled')),
  batch_id         uuid references batches(id),
  created_at       timestamptz not null default now(),
  submitted_at     timestamptz
);

create table if not exists redline_document (
  id                 uuid primary key default gen_random_uuid(),
  submission_id      uuid not null references redline_submission(id) on delete cascade,
  drawing_number     text not null,
  description        text,
  change_description text,
  marked_by          text,
  marked_date        date,
  file_name          text,
  sp_file_url        text,
  source_kind        text default 'scan' check (source_kind in ('scan','photo')),
  markup_layer       jsonb,          -- draft in-app markup (fabric layer) before submit
  markup_comments    jsonb,          -- captured text annotations [{page,text}]
  created_at         timestamptz not null default now()
);

alter table redline_submission enable row level security;
alter table redline_document  enable row level security;
