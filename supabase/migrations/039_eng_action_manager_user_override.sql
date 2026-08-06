-- 039_eng_action_manager_user_override.sql
-- Per-PERSON override for the Engineering Action Register "manager" surface (the AI-suggested
-- review tab, Manager view, confirm/dismiss/close/delete, and decision approval).
--
-- The role-level flag `role_definitions.eng_action_manager` (migration 036) stays the primary
-- grant. This column lets us appoint a specific assistant to help the Engineering Manager work
-- through the AI-generated actions WITHOUT changing their platform-wide role (e.g. keep Vossie a
-- reviewer everywhere else in CoreDocs). It is OR'd into the flag in page.tsx and the two
-- engineering-actions / engineering-decisions [id] API routes. Set false to revoke.
alter table public.users add column if not exists eng_action_manager boolean not null default false;

-- Vossie Vorster assists Marnus (Engineering Manager) on the AI-suggested actions.
update public.users set eng_action_manager = true where lower(email) = 'vossie@ppetech.co.za';
