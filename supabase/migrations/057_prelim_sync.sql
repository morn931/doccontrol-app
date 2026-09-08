-- ============================================================================
-- 057_prelim_sync.sql · CoreDocs — sessions keep themselves in step with their COLAB folder
--
-- Morné, 2026-09-08. The sessions list and the session page now sync with the source folder
-- on load (new files pulled, moved files re-pointed), throttled per session. These two
-- columns hold the throttle and a one-line note of what the last sync did. Idempotent.
-- ============================================================================

alter table prelim_session
  add column if not exists last_synced_at  timestamptz,
  add column if not exists last_sync_note  text;
