-- 015: CDDL enrichment for the Aconex Review Tracker.
-- Document Control's daily CDDL (SharePoint: DocumentControl site / "CDDL" library /
-- 6105AK124-0000-GDDR-0001 -Phase1 CDDL.xlsx) carries per-document knowledge the
-- Aconex API lacks: the PPE Doc Owner (initials), the due date and % complete.
-- The daily sync (costflow-app scripts/aconex_review_sync.py) joins it on the
-- RDMC document number and fills these columns; blank until the sync runs post-migration.

alter table aconex_review_doc add column if not exists doc_owner text;
alter table aconex_review_doc add column if not exists cddl_due  text;     -- freeform: dates or 'TENDER'
alter table aconex_review_doc add column if not exists cddl_pct  numeric;  -- CDDL % complete (0-1)

create index if not exists aconex_review_doc_owner_idx on aconex_review_doc (doc_owner);
