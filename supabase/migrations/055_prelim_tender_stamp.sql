-- ============================================================================
-- 055_prelim_tender_stamp.sql · CoreDocs — the "ISSUED FOR TENDER ONLY" copy
--
-- Morné, 2026-09-07. Pressing "Ready for tender" now also produces a stamped copy of the
-- drawing — every page carries a red "ISSUED FOR TENDER ONLY / Not to be used for
-- Manufacturing, Detailed Design or Construction / Stamped <date>" box top right — saved
-- beside the source in COLAB under an "Issued for Tender" subfolder, named
-- "<source name> - ISSUED FOR TENDER.pdf". The working copy is untouched (it is what goes
-- into internal review afterwards). Undo deletes the stamped copy. Idempotent.
-- ============================================================================

alter table prelim_document
  add column if not exists tender_stamped_at        timestamptz,
  add column if not exists tender_stamped_file_name text,
  add column if not exists tender_stamped_file_url  text,
  add column if not exists tender_stamp_error       text;     -- why the copy could not be made, visible not silent
