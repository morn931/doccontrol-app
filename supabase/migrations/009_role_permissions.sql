-- Role permissions table for CoreDocs.
-- Single-tenant (no company_id needed).
-- Developer role always bypasses all checks in code — DB values are ignored for developer.

CREATE TABLE IF NOT EXISTS role_permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key TEXT    NOT NULL,
  role        TEXT    NOT NULL,
  allowed     BOOLEAN NOT NULL DEFAULT false,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (feature_key, role)
);

-- Seed defaults: match the hardcoded matrix we built.
INSERT INTO role_permissions (feature_key, role, allowed) VALUES
  -- nav.batches
  ('nav.batches', 'admin',               true),
  ('nav.batches', 'document_controller', true),
  ('nav.batches', 'reviewer',            false),
  ('nav.batches', 'engineering_manager', false),
  ('nav.batches', 'project_manager',     false),
  ('nav.batches', 'vendor',              false),
  -- nav.reviews
  ('nav.reviews', 'admin',               true),
  ('nav.reviews', 'document_controller', true),
  ('nav.reviews', 'reviewer',            true),
  ('nav.reviews', 'engineering_manager', true),
  ('nav.reviews', 'project_manager',     false),
  ('nav.reviews', 'vendor',              false),
  -- nav.transmittals
  ('nav.transmittals', 'admin',               true),
  ('nav.transmittals', 'document_controller', true),
  ('nav.transmittals', 'reviewer',            false),
  ('nav.transmittals', 'engineering_manager', false),
  ('nav.transmittals', 'project_manager',     true),
  ('nav.transmittals', 'vendor',              false),
  -- nav.mddr
  ('nav.mddr', 'admin',               true),
  ('nav.mddr', 'document_controller', true),
  ('nav.mddr', 'reviewer',            false),
  ('nav.mddr', 'engineering_manager', true),
  ('nav.mddr', 'project_manager',     true),
  ('nav.mddr', 'vendor',              false),
  -- nav.reporting
  ('nav.reporting', 'admin',               true),
  ('nav.reporting', 'document_controller', true),
  ('nav.reporting', 'reviewer',            false),
  ('nav.reporting', 'engineering_manager', true),
  ('nav.reporting', 'project_manager',     true),
  ('nav.reporting', 'vendor',              false),
  -- nav.admin
  ('nav.admin', 'admin',               true),
  ('nav.admin', 'document_controller', false),
  ('nav.admin', 'reviewer',            false),
  ('nav.admin', 'engineering_manager', false),
  ('nav.admin', 'project_manager',     false),
  ('nav.admin', 'vendor',              false),
  -- action.assign_reviewers
  ('action.assign_reviewers', 'admin',               true),
  ('action.assign_reviewers', 'document_controller', true),
  ('action.assign_reviewers', 'reviewer',            false),
  ('action.assign_reviewers', 'engineering_manager', false),
  ('action.assign_reviewers', 'project_manager',     false),
  ('action.assign_reviewers', 'vendor',              false),
  -- action.reject_batch
  ('action.reject_batch', 'admin',               true),
  ('action.reject_batch', 'document_controller', true),
  ('action.reject_batch', 'reviewer',            false),
  ('action.reject_batch', 'engineering_manager', false),
  ('action.reject_batch', 'project_manager',     false),
  ('action.reject_batch', 'vendor',              false),
  -- action.generate_transmittal
  ('action.generate_transmittal', 'admin',               true),
  ('action.generate_transmittal', 'document_controller', true),
  ('action.generate_transmittal', 'reviewer',            false),
  ('action.generate_transmittal', 'engineering_manager', false),
  ('action.generate_transmittal', 'project_manager',     false),
  ('action.generate_transmittal', 'vendor',              false),
  -- action.submit_review
  ('action.submit_review', 'admin',               true),
  ('action.submit_review', 'document_controller', true),
  ('action.submit_review', 'reviewer',            true),
  ('action.submit_review', 'engineering_manager', true),
  ('action.submit_review', 'project_manager',     false),
  ('action.submit_review', 'vendor',              false),
  -- action.upload_register
  ('action.upload_register', 'admin',               true),
  ('action.upload_register', 'document_controller', true),
  ('action.upload_register', 'reviewer',            false),
  ('action.upload_register', 'engineering_manager', false),
  ('action.upload_register', 'project_manager',     false),
  ('action.upload_register', 'vendor',              false),
  -- action.mddr_sync
  ('action.mddr_sync', 'admin',               true),
  ('action.mddr_sync', 'document_controller', true),
  ('action.mddr_sync', 'reviewer',            false),
  ('action.mddr_sync', 'engineering_manager', false),
  ('action.mddr_sync', 'project_manager',     false),
  ('action.mddr_sync', 'vendor',              false)
ON CONFLICT (feature_key, role) DO NOTHING;

-- RLS: developer can read/write; others read-only
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "developers can manage permissions"
  ON role_permissions FOR ALL
  USING (
    EXISTS (SELECT 1 FROM users WHERE auth_user_id = auth.uid() AND role = 'developer')
  );

CREATE POLICY "authenticated users can read permissions"
  ON role_permissions FOR SELECT
  USING (auth.role() = 'authenticated');
