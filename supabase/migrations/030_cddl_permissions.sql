-- Wire the standalone /cddl Register page's edit gate (previously hardcoded
-- EDIT_ROLES = admin/document_controller/developer in app/(app)/cddl/actions.ts)
-- into role_permissions, and give CDDL its own view permission (was piggy-
-- backing on nav.reporting in the sidebar).
--
-- Seeded to match current real-world behaviour, per Liezl 2026-08-01:
-- - View: mirrors nav.reporting's existing role set (admin, document_controller,
--   engineering_manager, project_manager).
-- - Edit (field edits, add/retire doc, switch Excel->Coreflow-managed mode):
--   admin, document_controller only (developer bypasses in code as always).

INSERT INTO role_permissions (feature_key, role, allowed) VALUES
  ('nav.cddl', 'admin',               true),
  ('nav.cddl', 'document_controller', true),
  ('nav.cddl', 'reviewer',            false),
  ('nav.cddl', 'engineering_manager', true),
  ('nav.cddl', 'manager',             false),
  ('nav.cddl', 'project_manager',     true),
  ('nav.cddl', 'vendor',              false),
  ('action.edit_cddl', 'admin',               true),
  ('action.edit_cddl', 'document_controller', true),
  ('action.edit_cddl', 'reviewer',            false),
  ('action.edit_cddl', 'engineering_manager', false),
  ('action.edit_cddl', 'manager',             false),
  ('action.edit_cddl', 'project_manager',     false),
  ('action.edit_cddl', 'vendor',              false)
ON CONFLICT (feature_key, role) DO NOTHING;
