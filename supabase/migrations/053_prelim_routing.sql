-- ============================================================================
-- 053_prelim_routing.sql · CoreDocs — where a prelim-reviewed drawing goes next
--
-- Morné, 2026-09-07. For the K480/SWP-006 tender the prelim session IS the review before
-- the documents go out — there is no time for the internal review first (that follows
-- afterwards). So the reviewer, on the drawing itself, makes ONE of three calls:
--
--   drawing_office     the marked-up PDF is mailed to the drawing office to make the changes
--   lead               the marked-up PDF is mailed to the PPE responsible person (the CDDL
--                      doc owner where it can be resolved, otherwise the reviewer picks)
--   ready_for_tender   marked only — nothing is sent
--
-- One call per drawing: once made, the three buttons lock on that drawing. A manager can
-- undo it (clears these columns) if the wrong button was pressed. Idempotent.
-- ============================================================================

alter table prelim_document
  add column if not exists routing            text check (routing in ('drawing_office','lead','ready_for_tender')),
  add column if not exists routing_at         timestamptz,
  add column if not exists routing_by_email   text,
  add column if not exists routing_to_email   text,        -- who the mail went to (drawing office / lead)
  add column if not exists routing_to_name    text,
  add column if not exists routing_mailed_at  timestamptz, -- NULL on 'ready_for_tender', or if the send failed
  add column if not exists routing_attached   boolean,     -- was the PDF attached (false = too large, link sent instead)
  add column if not exists routing_error      text;        -- why the mail did not go, visible not silent

create index if not exists prelim_document_routing_idx on prelim_document (session_id, routing);
