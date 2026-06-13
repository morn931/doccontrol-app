-- ============================================================
-- MDDR sectors — bring the SharePoint "Document Index" balance into the master
-- Migration: 006_mddr_sectors.sql  (idempotent)
-- Apply in the DocControl Supabase project (tjzeahdimbekuizegsky).
-- ============================================================
-- Documents that aren't in the engineering registers (SDDR/CDDL/MDDR) but exist
-- in the site-wide Document Index are imported with source_type='INDEX' and a
-- `sector` label. They are EXCLUDED from the register MDDR page and the EVM
-- reports, but searchable in Document Search via a Sector filter.

ALTER TABLE mddr_entries ADD COLUMN IF NOT EXISTS sector    TEXT;   -- e.g. 'K038 - Early Works (E&I)'
ALTER TABLE mddr_entries ADD COLUMN IF NOT EXISTS file_link TEXT;   -- SharePoint URL to open the file

-- Allow the new source_type value.
ALTER TABLE mddr_entries DROP CONSTRAINT IF EXISTS mddr_entries_source_type_check;
ALTER TABLE mddr_entries ADD  CONSTRAINT mddr_entries_source_type_check
  CHECK (source_type IN ('SDDR','CDDL','MDDR','INDEX'));

CREATE INDEX IF NOT EXISTS mddr_entries_sector_idx ON mddr_entries(sector);
