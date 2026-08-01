-- Add a new 'manager' role (sits next to engineering_manager) and backfill
-- role_permissions so every feature key in lib/permissions.ts FK is represented
-- for every role. No behaviour changes: all new rows default to allowed=false,
-- matching the existing can() fallback for rows that don't exist yet.

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN (
    'admin', 'document_controller', 'reviewer',
    'engineering_manager', 'manager', 'project_manager', 'vendor',
    'developer'
  ));

-- 'manager' role: false for every feature key that already exists in role_permissions.
INSERT INTO role_permissions (feature_key, role, allowed)
SELECT DISTINCT feature_key, 'manager', false
FROM role_permissions
ON CONFLICT (feature_key, role) DO NOTHING;

-- Feature keys added since 009_role_permissions.sql that never got seed rows:
-- back-fill false for every non-developer role (developer bypasses in code).
INSERT INTO role_permissions (feature_key, role, allowed)
SELECT fk, role, false
FROM (VALUES
  ('nav.doc_requests'),
  ('action.request_document_number'),
  ('action.assign_document_number'),
  ('action.submit_internal_drawing'),
  ('nav.aconex_issue'),
  ('action.issue_to_aconex'),
  ('nav.rev0_intake'),
  ('action.rev0_stamp')
) AS keys(fk)
CROSS JOIN (VALUES
  ('admin'), ('document_controller'), ('reviewer'),
  ('engineering_manager'), ('manager'), ('project_manager'), ('vendor')
) AS roles(role)
ON CONFLICT (feature_key, role) DO NOTHING;
