-- 017: CDDL in-app management — lets Document Control manage the CDDL inside
-- Coreflow (the Excel-crash contingency / permanent cut-over path).
--
-- Two modes (cddl_settings.mode):
--   'excel_master'    — the workbook is the source of truth; the daily sync
--                       full-replaces cddl_doc from it (in-app editing disabled).
--   'coreflow_master' — Coreflow is the source of truth; Document Control edits
--                       in-app; the daily sync refreshes ONLY the Aconex-owned
--                       columns (doc status / review status / revision, and the
--                       computed % ladder) from the Aconex API and never touches
--                       the manually-managed fields.

alter table cddl_doc add column if not exists retired boolean not null default false;

create table if not exists cddl_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into cddl_settings (key, value) values ('mode', 'excel_master')
on conflict (key) do nothing;

create table if not exists cddl_edit_log (
  id         uuid primary key default gen_random_uuid(),
  docno      text not null,
  field      text not null,
  old_value  text,
  new_value  text,
  edited_by  text,
  edited_at  timestamptz not null default now()
);
create index if not exists cddl_edit_log_docno_idx on cddl_edit_log (docno);
