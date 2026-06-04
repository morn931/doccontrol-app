-- ============================================================
-- PPE Tech Document Control App — Row Level Security
-- Migration: 003_rls_policies.sql
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors          ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_sites     ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches          ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_tasks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_comments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE transmittals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviewer_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE transmittal_sequences ENABLE ROW LEVEL SECURITY;

-- Helper: get current user's role from our users table
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT AS $$
  SELECT role FROM users WHERE auth_user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: get current user's id from our users table
CREATE OR REPLACE FUNCTION get_my_user_id()
RETURNS UUID AS $$
  SELECT id FROM users WHERE auth_user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ─── USERS: authenticated users can read; service role manages writes ───────
CREATE POLICY "users_select" ON users FOR SELECT
  USING (auth.role() = 'authenticated');

-- ─── VENDORS / PACKAGES / VENDOR_SITES: all authenticated can read ──────────
CREATE POLICY "vendors_select" ON vendors FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "packages_select" ON packages FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "vendor_sites_select" ON vendor_sites FOR SELECT USING (auth.role() = 'authenticated');

-- ─── BATCHES: controllers and admins see all; reviewers see assigned batches ─
CREATE POLICY "batches_select_controller" ON batches FOR SELECT
  USING (
    get_my_role() IN ('admin','document_controller','engineering_manager','project_manager')
  );

CREATE POLICY "batches_select_reviewer" ON batches FOR SELECT
  USING (
    get_my_role() = 'reviewer'
    AND id IN (
      SELECT batch_id FROM review_tasks WHERE reviewer_email = (
        SELECT email FROM users WHERE auth_user_id = auth.uid()
      )
    )
  );

-- ─── DOCUMENTS / VERSIONS: all authenticated users can read ─────────────────
CREATE POLICY "documents_select" ON documents FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "document_versions_select" ON document_versions FOR SELECT
  USING (auth.role() = 'authenticated');

-- ─── REVIEW TASKS: own tasks always visible; controllers/admins see all ──────
CREATE POLICY "review_tasks_select_own" ON review_tasks FOR SELECT
  USING (
    reviewer_email = (SELECT email FROM users WHERE auth_user_id = auth.uid())
    OR get_my_role() IN ('admin','document_controller','engineering_manager','project_manager')
  );

-- ─── SYSTEM SETTINGS: all authenticated can read ────────────────────────────
CREATE POLICY "system_settings_select" ON system_settings FOR SELECT
  USING (auth.role() = 'authenticated');

-- ─── AUDIT EVENTS: read-only for controllers/admins ─────────────────────────
CREATE POLICY "audit_events_select" ON audit_events FOR SELECT
  USING (get_my_role() IN ('admin','document_controller','engineering_manager'));

-- ─── IMPORT RUNS: admin only ─────────────────────────────────────────────────
CREATE POLICY "import_runs_select" ON import_runs FOR SELECT
  USING (get_my_role() = 'admin');

-- NOTE: All write operations use the service role key from API routes only.
-- The anon/authenticated key is read-only for the above tables.
