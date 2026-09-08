-- ============================================================================
-- 056_prelim_document_control.sql · CoreDocs — a fourth before-tender call
--
-- Morné, 2026-09-08. "To Document Control" works exactly like "To drawing office" (the
-- marked-up PDF + notes + quality issues by email) but goes to Document Control
-- (bernicen@ppetech.co.za by default). Migration 053's check constraint listed three
-- values; this widens it. Idempotent.
-- ============================================================================

alter table prelim_document drop constraint if exists prelim_document_routing_check;
alter table prelim_document
  add constraint prelim_document_routing_check
  check (routing in ('drawing_office','document_control','lead','ready_for_tender'));
