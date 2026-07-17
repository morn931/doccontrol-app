-- 019: SDDR Register — the vendors' Supplier Document & Data Registers,
-- mirrored daily from each package's SharePoint site. Vendors keep managing
-- these in Excel (no coreflow-master mode); the app is a read-only mirror.
create table if not exists sddr_doc (
  id uuid primary key default gen_random_uuid(),
  package_code text not null,
  docno text not null,
  wbs text,
  discipline text,
  doc_type text,
  seq_no text,
  revision text,
  sheet text,
  area_facility text,
  major_desc text,
  broad_type text,
  title text,
  due text,
  doc_owner text,
  ifr_transmittal text,
  ifc_transmittal text,
  ppe_doc_status text,
  pct_complete numeric,
  as_built text,
  cert_final text,
  tag_no text,
  comments text,
  issued_for text,
  sub_supplier text,
  activity_id text,
  vendor_doc_id text,
  synced_at timestamptz not null default now(),
  unique (package_code, docno)
);
alter table sddr_doc enable row level security;

create table if not exists sddr_sync (
  id uuid primary key default gen_random_uuid(),
  package_code text not null,
  doc_count int not null default 0,
  source_file text,
  note text,
  ran_at timestamptz not null default now()
);
alter table sddr_sync enable row level security;
