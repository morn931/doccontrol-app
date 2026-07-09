-- Phase 1 — Internal Document Number Request (the design engineer's starting point).
-- The request routes to the Document Controller, who MANUALLY allocates the RDMC number
-- (auto-generation is a later phase). Mirrors the "Phase 1 Document Number Request Form"
-- workbook: a request header + document lines; engineer fills the inputs, Document Control
-- fills the allocated number/title. The review engine is untouched.

-- 1) Dropdown reference data for the request form (seeded in 013 from the workbook).
create table if not exists doc_lookup (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('document_type','discipline','wbs_area')),
  code text not null,
  name text not null,
  description text,
  meta jsonb,
  sort int default 0,
  active boolean default true,
  unique (kind, code)
);

-- 2) Request header — one per submitted form.
create table if not exists document_number_request (
  id uuid primary key default gen_random_uuid(),
  request_no text,                          -- human ref, e.g. DNR-2026-0001
  requestor_user_id uuid references users(id),
  requestor_email text,
  project_number text default '6105A',
  package_id uuid references packages(id),
  package_code text,
  response_required_by date,
  status text not null default 'draft'
    check (status in ('draft','submitted','in_progress','assigned','closed','cancelled')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3) Request lines — one per document to be numbered.
create table if not exists document_number_request_line (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references document_number_request(id) on delete cascade,
  line_no int,
  -- engineer inputs
  document_type_code text,                  -- doc_lookup(kind='document_type')
  discipline_code text,                     -- doc_lookup(kind='discipline')
  area_code text,                           -- doc_lookup(kind='wbs_area')  (the CCCC part)
  title1 text,                              -- Area / Facility
  title2 text,                              -- Major description
  title3 text,                              -- Equipment / drawing description
  revision text default 'A',
  due_date date,
  comments text,
  -- Document Control allocation (manual)
  rdmc_document_number text,                -- AAAAABBBB-CCCC-DEEE-NNNN
  ppe_doc_number text,
  full_title text,
  sequential_no text,                       -- NNNN, recorded for the register
  line_status text not null default 'pending'
    check (line_status in ('pending','assigned','rejected')),
  assigned_by uuid references users(id),
  assigned_at timestamptz,
  linked_document_id uuid references documents(id),  -- placeholder reserved on assign
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists dnr_line_request_idx on document_number_request_line(request_id);
create index if not exists dnr_status_idx on document_number_request(status);

-- 4) RLS — authenticated may read; all writes go through the service-role client (bypasses RLS).
alter table doc_lookup enable row level security;
alter table document_number_request enable row level security;
alter table document_number_request_line enable row level security;
drop policy if exists dl_read on doc_lookup;
create policy dl_read on doc_lookup for select to authenticated using (true);
drop policy if exists dnr_read on document_number_request;
create policy dnr_read on document_number_request for select to authenticated using (true);
drop policy if exists dnrl_read on document_number_request_line;
create policy dnrl_read on document_number_request_line for select to authenticated using (true);

-- 5) Permissions (feature matrix).
insert into role_permissions (feature_key, role, allowed) values
  ('nav.doc_requests','document_controller',true),
  ('nav.doc_requests','admin',true),
  ('nav.doc_requests','developer',true),
  ('nav.doc_requests','engineering_manager',true),
  ('nav.doc_requests','reviewer',true),
  ('action.request_document_number','reviewer',true),
  ('action.request_document_number','engineering_manager',true),
  ('action.request_document_number','document_controller',true),
  ('action.request_document_number','admin',true),
  ('action.request_document_number','developer',true),
  ('action.assign_document_number','document_controller',true),
  ('action.assign_document_number','admin',true),
  ('action.assign_document_number','developer',true)
on conflict do nothing;
