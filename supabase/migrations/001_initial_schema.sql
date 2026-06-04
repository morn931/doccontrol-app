-- ============================================================
-- PPE Tech Document Control App — Initial Schema
-- Migration: 001_initial_schema.sql
-- Run this in the Supabase SQL editor or via supabase db push
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── USERS ──────────────────────────────────────────────────
CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  email        TEXT NOT NULL UNIQUE,
  full_name    TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'reviewer'
               CHECK (role IN ('admin','document_controller','reviewer',
                               'engineering_manager','project_manager','vendor')),
  department   TEXT,
  discipline   TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── VENDORS ────────────────────────────────────────────────
CREATE TABLE vendors (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  code                  TEXT NOT NULL UNIQUE,
  primary_contact_email TEXT,
  active                BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── PACKAGES ───────────────────────────────────────────────
CREATE TABLE packages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_code TEXT NOT NULL UNIQUE,
  package_name TEXT NOT NULL,
  vendor_id    UUID REFERENCES vendors(id) ON DELETE SET NULL,
  project      TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── VENDOR SITES ───────────────────────────────────────────
CREATE TABLE vendor_sites (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id        UUID REFERENCES vendors(id) ON DELETE CASCADE,
  package_id       UUID REFERENCES packages(id) ON DELETE SET NULL,
  site_url         TEXT NOT NULL,
  dropoff_library  TEXT,
  return_library   TEXT,
  return_folder    TEXT,
  source_list_id   TEXT,
  target_list_id   TEXT,
  controller_email TEXT,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── BATCHES ────────────────────────────────────────────────
CREATE TABLE batches (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_guid         TEXT NOT NULL UNIQUE,
  vendor_id          UUID REFERENCES vendors(id) ON DELETE SET NULL,
  package_id         UUID REFERENCES packages(id) ON DELETE SET NULL,
  source_site_url    TEXT,
  source_library     TEXT,
  target_library     TEXT,
  controller_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  controller_email   TEXT,
  status             TEXT NOT NULL DEFAULT 'intake_received'
                     CHECK (status IN (
                       'intake_received','metadata_pending',
                       'ready_for_reviewer_assignment','review_ready_to_start',
                       'review_in_progress','review_complete',
                       'transmittal_generated','returned_to_vendor',
                       'rejected_before_review','cancelled','failed')),
  file_count         INTEGER NOT NULL DEFAULT 0,
  comments           TEXT,
  reject_reason      TEXT,
  vendor_email       TEXT,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  returned_at        TIMESTAMPTZ,
  rejected_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── DOCUMENTS ──────────────────────────────────────────────
CREATE TABLE documents (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_document_number TEXT,
  display_document_number    TEXT,
  title                      TEXT,
  vendor_id                  UUID REFERENCES vendors(id) ON DELETE SET NULL,
  package_id                 UUID REFERENCES packages(id) ON DELETE SET NULL,
  discipline                 TEXT,
  document_type              TEXT,
  topic                      TEXT,
  current_version_id         UUID, -- FK to document_versions, set after first insert
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── DOCUMENT VERSIONS ──────────────────────────────────────
CREATE TABLE document_versions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         UUID REFERENCES documents(id) ON DELETE CASCADE,
  batch_id            UUID REFERENCES batches(id) ON DELETE SET NULL,
  file_name           TEXT NOT NULL,
  revision            TEXT,
  revision_sort       TEXT,
  version_number      INTEGER,
  source_site_url     TEXT,
  source_file_url     TEXT,
  central_file_url    TEXT,
  reviewed_file_url   TEXT,
  returned_file_url   TEXT,
  storage_provider    TEXT NOT NULL DEFAULT 'sharepoint',
  storage_path        TEXT,
  file_hash           TEXT,
  file_size           BIGINT,
  mime_type           TEXT,
  doc_unique_id       TEXT UNIQUE,
  ai_text             TEXT,
  extracted_text      TEXT,
  doc_name            TEXT,
  discipline          TEXT,
  document_type       TEXT,
  topic               TEXT,
  ai_metadata_source  TEXT NOT NULL DEFAULT 'ai'
                      CHECK (ai_metadata_source IN ('ai','manually_confirmed','manually_overridden')),
  status              TEXT NOT NULL DEFAULT 'uploaded'
                      CHECK (status IN ('uploaded','processing','ready','under_review',
                                        'review_complete','returned','rejected','superseded')),
  is_latest           BOOLEAN NOT NULL DEFAULT true,
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  returned_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one latest version per logical document
CREATE UNIQUE INDEX document_versions_latest_uidx
  ON document_versions(document_id) WHERE is_latest = true;

-- Add FK from documents to document_versions (after both tables created)
ALTER TABLE documents
  ADD CONSTRAINT documents_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES document_versions(id) ON DELETE SET NULL;

-- ─── REVIEW TASKS ───────────────────────────────────────────
CREATE TABLE review_tasks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id              UUID REFERENCES batches(id) ON DELETE CASCADE,
  document_id           UUID REFERENCES documents(id) ON DELETE CASCADE,
  document_version_id   UUID REFERENCES document_versions(id) ON DELETE CASCADE,
  reviewer_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewer_email        TEXT NOT NULL,
  sequence_number       INTEGER NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                          'pending','sent','opened','in_progress',
                          'completed','skipped','cancelled',
                          'needs_more_review','overdue')),
  date_sent             TIMESTAMPTZ,
  date_opened           TIMESTAMPTZ,
  date_completed        TIMESTAMPTZ,
  due_date              DATE,
  review_outcome_code   TEXT CHECK (review_outcome_code IN
                          ('A1','B1','B2','C1','D1','Q1','V1','S1')),
  review_outcome_text   TEXT,
  internal_status       TEXT,
  comment               TEXT,
  markup_summary        TEXT,
  markup_status         TEXT NOT NULL DEFAULT 'not_started'
                        CHECK (markup_status IN (
                          'not_started','extracting','done','failed','manual_only')),
  markup_extracted_on   TIMESTAMPTZ,
  markup_source_doc_url TEXT,
  is_manager_override   BOOLEAN NOT NULL DEFAULT false,
  manager_override_by   TEXT,
  manager_override_date TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_version_id, reviewer_email, sequence_number)
);

-- ─── REVIEW COMMENTS ────────────────────────────────────────
CREATE TABLE review_comments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_task_id      UUID REFERENCES review_tasks(id) ON DELETE CASCADE,
  document_version_id UUID REFERENCES document_versions(id) ON DELETE CASCADE,
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  comment_text        TEXT NOT NULL,
  comment_type        TEXT NOT NULL DEFAULT 'review'
                      CHECK (comment_type IN ('review','draft','escalation','controller_note')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── REVIEW ESCALATIONS ─────────────────────────────────────
CREATE TABLE review_escalations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id            UUID REFERENCES batches(id) ON DELETE CASCADE,
  document_version_id UUID REFERENCES document_versions(id) ON DELETE CASCADE,
  requested_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  reason              TEXT,
  assigned_to         UUID REFERENCES users(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','in_review','resolved','cancelled')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ
);

-- ─── TRANSMITTALS ───────────────────────────────────────────
CREATE TABLE transmittals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transmittal_number    TEXT NOT NULL UNIQUE,
  batch_id              UUID REFERENCES batches(id) ON DELETE SET NULL,
  vendor_id             UUID REFERENCES vendors(id) ON DELETE SET NULL,
  package_id            UUID REFERENCES packages(id) ON DELETE SET NULL,
  final_outcome_code    TEXT,
  final_outcome_text    TEXT,
  docx_url              TEXT,
  pdf_url               TEXT,
  generated_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  returned_to_vendor_at TIMESTAMPTZ,
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','sent','superseded'))
);

CREATE TABLE transmittal_sequences (
  year     INTEGER PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0
);

-- ─── AUDIT EVENTS ───────────────────────────────────────────
CREATE TABLE audit_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   TEXT NOT NULL,
  entity_id     UUID NOT NULL,
  event_type    TEXT NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email   TEXT,
  event_data    JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── NOTIFICATION LOGS ──────────────────────────────────────
CREATE TABLE notification_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id       UUID REFERENCES batches(id) ON DELETE SET NULL,
  review_task_id UUID REFERENCES review_tasks(id) ON DELETE SET NULL,
  to_email       TEXT NOT NULL,
  cc_email       TEXT,
  subject        TEXT,
  template       TEXT,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','sent','failed')),
  sent_at        TIMESTAMPTZ,
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── IMPORT RUNS ────────────────────────────────────────────
CREATE TABLE import_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT,
  started_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','completed','failed','partial')),
  mode            TEXT NOT NULL DEFAULT 'full'
                  CHECK (mode IN ('dry_run','full','incremental','reprocess_metadata',
                                  'recalculate_latest','rebuild_search_index')),
  records_scanned INTEGER NOT NULL DEFAULT 0,
  records_created INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  records_failed  INTEGER NOT NULL DEFAULT 0,
  error_log       TEXT
);

-- ─── REVIEWER TEMPLATES ─────────────────────────────────────
CREATE TABLE reviewer_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  package_id    UUID REFERENCES packages(id) ON DELETE SET NULL,
  document_type TEXT,
  discipline    TEXT,
  reviewers     JSONB NOT NULL DEFAULT '[]',
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── SYSTEM SETTINGS ────────────────────────────────────────
CREATE TABLE system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default settings
INSERT INTO system_settings (key, value) VALUES
  ('engineering_manager_email',  'marnusm@ppetech.co.za'),
  ('transmittal_prefix',         'PPE-TRN'),
  ('default_review_days',        '5'),
  ('allow_parallel_review',      'false'),
  ('show_previous_comments',     'true');

-- ─── UPDATED_AT TRIGGER ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at        BEFORE UPDATE ON users        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER vendors_updated_at      BEFORE UPDATE ON vendors      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER batches_updated_at      BEFORE UPDATE ON batches      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER documents_updated_at    BEFORE UPDATE ON documents    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER doc_versions_updated_at BEFORE UPDATE ON document_versions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER review_tasks_updated_at BEFORE UPDATE ON review_tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
