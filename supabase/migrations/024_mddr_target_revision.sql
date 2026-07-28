-- 024: Option C — reconcile the register revision against the file on record.
--
-- `mddr_entries.revision` becomes the AS-ISSUED revision (the revision of the
-- document actually on file — what opens), and the register's forward/IFC-target
-- value (e.g. "0", set before an approved draft is re-issued for construction)
-- moves to `target_revision`. Populated by lib/mddr/sync.ts going forward and by
-- scripts/backfill-revisions.ts for existing rows.

alter table mddr_entries add column if not exists target_revision text;

comment on column mddr_entries.target_revision is
  'Forward / IFC-target revision from the uploaded SDDR/CDDL/MDDR register (e.g. 0) when the document on file is still the approved draft. `revision` holds the as-issued revision (what opens). Option C, 2026-07.';
