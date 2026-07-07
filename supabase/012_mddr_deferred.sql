-- ============================================================
-- CoreDocs — 012 deferred-scope flag on the document register
-- Run in the Supabase SQL Editor (CoreDocs project tjzeahdimbekuizegsky).
-- Idempotent: safe to re-run.
-- ============================================================
-- The RDMC review period deferred site mobilisation / construction-phase
-- scope, but those deliverables' planned dates still reflect the original
-- programme — mechanically widening the Progress Dashboard's planned-vs-
-- actual gap every week (2026-07: K124 CDDL alone = 20.5 of the 33.9-point
-- variance). This flag lets reporting present a CURRENT-BASIS view that
-- excludes deferred docs (visible, counted, never hidden) WITHOUT touching
-- planned_completion_date — the original baseline is preserved for future
-- planned-vs-actual analysis and for the eventual re-baseline.

ALTER TABLE mddr_entries ADD COLUMN IF NOT EXISTS is_deferred boolean NOT NULL DEFAULT false;
ALTER TABLE mddr_entries ADD COLUMN IF NOT EXISTS deferred_note text;

CREATE INDEX IF NOT EXISTS mddr_entries_deferred_idx ON mddr_entries(is_deferred) WHERE is_deferred;

-- ============================================================
-- End 012.
-- ============================================================
