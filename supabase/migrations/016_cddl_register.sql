-- 016: CDDL register — the Phase-1 CDDL moved from the Excel management sheet
-- onto the platform. A full mirror of Document Control's workbook
-- (SharePoint: DocumentControl / "CDDL" / 6105AK124-0000-GDDR-0001 -Phase1 CDDL.xlsx),
-- synced daily by costflow-app scripts/cddl_sync.py (06:00 scan). READ-ONLY in the
-- app until Document Control moves management over permanently.

create table if not exists cddl_doc (
  id              uuid primary key default gen_random_uuid(),
  package_code    text not null,           -- K124 (Phase 1)
  docno           text not null,           -- RDMC Document Number (join key)
  ppe_docno       text,
  wbs             text,                    -- Area / WBS No.
  discipline      text,
  doc_type        text,
  seq_no          text,
  revision        text,
  sheet           text,
  area_facility   text,
  major_desc      text,
  broad_type      text,
  title           text,
  rev_a_transmittal  text,
  rev0_transmittal   text,
  aconex_doc_status  text,
  aconex_review_status text,
  pct_complete    numeric,
  doc_owner       text,                   -- resolved full name (initials in brackets)
  doc_owner_initials text,
  comments        text,
  due             text,                   -- freeform: dates or 'TENDER'
  main_group      text,
  sub_group       text,
  bh              text,
  drawing_pack    text,
  activity_id     text,
  schedule_status text,
  synced_at       timestamptz not null default now()
);

create unique index if not exists cddl_doc_docno_uq on cddl_doc (package_code, docno);
create index if not exists cddl_doc_owner_idx  on cddl_doc (doc_owner_initials);
create index if not exists cddl_doc_status_idx on cddl_doc (aconex_review_status);

create table if not exists cddl_sync (
  id         uuid primary key default gen_random_uuid(),
  ran_at     timestamptz not null default now(),
  package_code text,
  doc_count  int,
  note       text
);
