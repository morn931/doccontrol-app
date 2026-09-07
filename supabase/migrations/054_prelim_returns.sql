-- ============================================================================
-- 054_prelim_returns.sql · CoreDocs — a corrected drawing comes back from the drawing
-- office or the lead engineer
--
-- Morné, 2026-09-07. A drawing sent out with "To drawing office" / "To Lead" (053) is
-- corrected and dropped on the Returns page. The dropped file becomes the drawing's
-- working copy (so the room reviews the corrected version), the old marks are archived
-- into routing_history, and the three before-tender buttons unlock so the reviewer can
-- make the next call — usually "Ready for tender". Idempotent.
-- ============================================================================

alter table prelim_document
  add column if not exists returned_at            timestamptz,
  add column if not exists returned_by_email      text,
  add column if not exists returned_from          text,        -- 'drawing_office' | 'lead' (what it was sent as)
  add column if not exists returned_file_name     text,
  add column if not exists returned_file_url      text,
  add column if not exists prior_working_file_url text,        -- the marked-up copy that was sent out
  add column if not exists routing_history        jsonb not null default '[]'::jsonb;

create index if not exists prelim_document_returned_idx on prelim_document (returned_at desc);
