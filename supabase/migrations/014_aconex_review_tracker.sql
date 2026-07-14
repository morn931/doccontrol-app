-- Aconex Review Tracker (pilot: package K124).
-- A READ-ONLY mirror of the Aconex document register plus a derived "whose court"
-- for every document, synced from Aconex by a local script
-- (scripts/aconex_review_sync.py) using Morné's ~/.aconex OAuth credentials.
-- Powers the CoreDocs "Aconex Review Tracker" report. Nothing writes back to Aconex.
--
-- Why this exists: Aconex shows a review status of "Pending" but not whose court the
-- document is in. We reconstruct that from the transmittal correspondence (direction +
-- Aconex's own Responded/Overdue recipient status) — the same whose-court logic used
-- for the PDN register in CoreCost.

create table if not exists aconex_review_doc (
  id            uuid primary key default gen_random_uuid(),
  project_id    text not null,            -- Aconex project id (Reko Diq = 671090258)
  package_code  text not null,            -- e.g. K124
  doc_id        text not null,            -- Aconex DocumentId
  docno         text not null,
  title         text,
  doc_type      text,
  discipline    text,
  revision      text,
  author_org    text,
  doc_status    text,                     -- IFI / IFR / IFC / CAN ...
  review_status text,                     -- Pending / Reviewed / Rejected - Revise & Resubmit ...
  review_source text,
  date_modified timestamptz,

  -- derived whose-court
  court         text,                     -- 'RDMC' | 'PPE' | 'CLOSED' | 'NOT_TRANSMITTED' | 'UNKNOWN'
  court_label   text,                     -- human phrase, e.g. "RDMC — awaiting review"
  court_basis   text,                     -- explanation of how court was derived
  overdue       boolean default false,
  days_in_court int,

  -- last transmittal that carried this document
  last_mail_no        text,
  last_mail_dir       text,               -- 'OUT' (PPE→RDMC) | 'IN' (RDMC→PPE)
  last_mail_corr      text,
  last_mail_date      timestamptz,
  last_recipient_status text,             -- Responded / Overdue / N/A

  synced_at     timestamptz not null default now(),
  unique (project_id, doc_id)
);

create index if not exists aconex_review_doc_pkg   on aconex_review_doc (package_code);
create index if not exists aconex_review_doc_court on aconex_review_doc (court);

-- One row per sync run (lightweight audit / freshness indicator for the UI).
create table if not exists aconex_review_sync (
  id            uuid primary key default gen_random_uuid(),
  package_code  text,
  doc_count     int,
  matched_count int,
  ran_at        timestamptz not null default now(),
  note          text
);

-- RLS: writes happen via the service-role key (local sync script, bypasses RLS).
-- Reads happen server-side via the service client too, but enable RLS + allow any
-- authenticated CoreDocs user to select, so the data is never exposed to anon.
alter table aconex_review_doc  enable row level security;
alter table aconex_review_sync enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='aconex_review_doc' and policyname='aconex_review_doc_sel') then
    create policy aconex_review_doc_sel on aconex_review_doc for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='aconex_review_sync' and policyname='aconex_review_sync_sel') then
    create policy aconex_review_sync_sel on aconex_review_sync for select to authenticated using (true);
  end if;
end $$;
