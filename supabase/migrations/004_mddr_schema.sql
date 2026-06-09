-- ============================================================
-- PPE Tech Document Control App — MDDR Schema
-- Migration: 004_mddr_schema.sql
-- ============================================================
-- Tables:
--   mddr_registers  — tracks each uploaded source register file
--   mddr_entries    — every document row across SDDR/CDDL/MDDR
-- ============================================================

-- ─── SOURCE REGISTER FILES ──────────────────────────────────
-- Tracks every uploaded SDDR, CDDL, or MDDR Excel file.
-- When a new file is uploaded it either appends (mode='merge')
-- or replaces all rows for that source (mode='override').

CREATE TABLE IF NOT EXISTS mddr_registers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  register_type   TEXT NOT NULL
                  CHECK (register_type IN ('SDDR','CDDL','MDDR')),
  file_name       TEXT NOT NULL,
  package_code    TEXT,                 -- e.g. K137, E102
  vendor_name     TEXT,                 -- free text from file
  vendor_id       UUID REFERENCES vendors(id) ON DELETE SET NULL,
  upload_mode     TEXT NOT NULL DEFAULT 'merge'
                  CHECK (upload_mode IN ('merge','override')),
  row_count       INTEGER NOT NULL DEFAULT 0,
  uploaded_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes           TEXT
);

-- ─── MASTER MDDR ENTRIES ────────────────────────────────────
-- One row per document line item across all registers.
-- document_number is the join key back to documents table.

CREATE TABLE IF NOT EXISTS mddr_entries (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source tracking
  source_register_id       UUID REFERENCES mddr_registers(id) ON DELETE SET NULL,
  source_type              TEXT NOT NULL
                           CHECK (source_type IN ('SDDR','CDDL','MDDR')),

  -- ── Package / Contract ──────────────────────────────────
  package_code             TEXT,        -- e.g. K137, E102, E511B
  contract_number          TEXT,
  project_number           TEXT,        -- e.g. 6105A
  package_description      TEXT,         -- GMDR "Package Description"
  sub_package              TEXT,         -- GMDR "Sub Package"
  equipment_description    TEXT,         -- GMDR "Equipment Description"
  deliverable_name         TEXT,         -- GMDR "PPE CM & EPC - Deliverables"
  service_provider_pkg_no  TEXT,         -- GMDR "Service Provider Package Number"

  -- ── Vendor / Originator ─────────────────────────────────
  vendor_name              TEXT,        -- "ABB", "PPE", etc. (Appointed Service Provider / Originator)
  vendor_id                UUID REFERENCES vendors(id) ON DELETE SET NULL,
  doc_owner                TEXT,         -- person responsible (SDDR "Doc Owner")
  sub_supplier             TEXT,         -- SDDR "Sub-supplier"

  -- ── Document Identity ───────────────────────────────────
  document_number          TEXT,        -- Raw as-supplied doc number (RDMC number)
  normalized_document_number TEXT,      -- Normalised for matching
  ppe_doc_number           TEXT,         -- CDDL "PPE Doc Number" / vendor doc id
  vendor_doc_id            TEXT,         -- SDDR "ABB Document ID" etc.
  document_title           TEXT,
  document_description      TEXT,
  sheet_number              TEXT,        -- "Sht. # of #"

  -- ── Classification ──────────────────────────────────────
  discipline               TEXT,        -- Civil, Electrical, Mechanical …
  document_type            TEXT,        -- Drawing, Spec, Report, Calc …
  document_category        TEXT,        -- Primary / Secondary (for weighting)
  area                     TEXT,
  system                   TEXT,
  sub_system               TEXT,
  tag_number               TEXT,

  -- ── Revision & Status ───────────────────────────────────
  revision                 TEXT,        -- Latest known revision
  revision_status          TEXT,        -- IFR, IFC, IFI, AFD, etc.
  review_outcome_code      TEXT,        -- A1,B1,B2,C1,D1 from review system
  document_status          TEXT,        -- Overall status

  -- ── Dates ───────────────────────────────────────────────
  planned_start_date       DATE,
  planned_ifr_date         DATE,        -- Issued For Review
  planned_ifc_date         DATE,        -- Issued For Construction
  planned_completion_date  DATE,
  actual_submission_date   DATE,        -- Actual date vendor submitted
  actual_review_date       DATE,        -- Date PPE completed review
  actual_return_date       DATE,        -- Date returned to vendor
  actual_completion_date   DATE,

  -- ── P6 / Schedule Integration ───────────────────────────
  activity_id              TEXT,        -- Primavera P6 Activity ID
  wbs_code                 TEXT,        -- WBS element

  -- ── Weighting & Progress (Siemens Agreement) ────────────
  weighting_primary        NUMERIC(6,4),   -- Primary weighting factor
  weighting_secondary      NUMERIC(6,4),   -- Secondary weighting factor
  weighting_total          NUMERIC(6,4),   -- Combined weighting
  progress_percent         NUMERIC(5,2),   -- 0-100 (Rules of Credit credit)
  progress_milestone       SMALLINT,        -- 0..4 Rules-of-Credit milestone reached
  progress_source          TEXT,            -- 'review_system' | 'register' | 'manual'
  earned_value             NUMERIC(10,4),  -- progress × weighting

  -- ── Review Lifecycle Progress ───────────────────────────
  -- These capture the stage-based credit from the Siemens rules
  stage_submitted          BOOLEAN NOT NULL DEFAULT false,
  stage_under_review       BOOLEAN NOT NULL DEFAULT false,
  stage_reviewed           BOOLEAN NOT NULL DEFAULT false,
  stage_returned           BOOLEAN NOT NULL DEFAULT false,
  stage_resubmitted        BOOLEAN NOT NULL DEFAULT false,
  stage_approved           BOOLEAN NOT NULL DEFAULT false,

  -- ── Issue / requirement flags (SDDR) ────────────────────
  issued_for               TEXT,        -- "For Approval", "For Information"
  as_built_required        TEXT,        -- Y/N
  certified_final_required TEXT,        -- Y/N
  schedule_status          TEXT,        -- CDDL "Schedule Status"
  aconex_doc_status        TEXT,        -- CDDL "Aconex Doc Status"
  aconex_review_status     TEXT,        -- CDDL "Aconex Review Status"

  -- ── Remarks / Comments ──────────────────────────────────
  comments                 TEXT,
  remarks                  TEXT,
  vendor_comments          TEXT,

  -- ── Award state & provenance ────────────────────────────
  is_awarded               BOOLEAN NOT NULL DEFAULT true,  -- false = scope placeholder (no real doc yet)
  source_types             TEXT[] NOT NULL DEFAULT '{}',    -- every register that contributed (SDDR/CDDL/MDDR)
  raw                      JSONB  NOT NULL DEFAULT '{}',    -- every original column, keyed by "<TYPE>:<package>"

  -- ── Link to live doc management system ──────────────────
  -- Populated by matching document_number → documents.normalized_document_number
  linked_document_id       UUID REFERENCES documents(id) ON DELETE SET NULL,
  linked_version_id        UUID REFERENCES document_versions(id) ON DELETE SET NULL,
  status_synced_at         TIMESTAMPTZ,

  -- ── Meta ────────────────────────────────────────────────
  is_active                BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── INDEXES ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS mddr_entries_package_idx      ON mddr_entries(package_code);
CREATE INDEX IF NOT EXISTS mddr_entries_vendor_idx       ON mddr_entries(vendor_name);
CREATE INDEX IF NOT EXISTS mddr_entries_docnum_idx       ON mddr_entries(normalized_document_number);
CREATE INDEX IF NOT EXISTS mddr_entries_activity_idx     ON mddr_entries(activity_id);
CREATE INDEX IF NOT EXISTS mddr_entries_source_type_idx  ON mddr_entries(source_type);
CREATE INDEX IF NOT EXISTS mddr_entries_discipline_idx   ON mddr_entries(discipline);
CREATE INDEX IF NOT EXISTS mddr_entries_linked_doc_idx   ON mddr_entries(linked_document_id);
CREATE INDEX IF NOT EXISTS mddr_entries_source_reg_idx   ON mddr_entries(source_register_id);
CREATE INDEX IF NOT EXISTS mddr_entries_docnum_trgm      ON mddr_entries USING GIN(
  coalesce(normalized_document_number, '') gin_trgm_ops
);
CREATE INDEX IF NOT EXISTS mddr_entries_awarded_idx      ON mddr_entries(is_awarded);

-- One master row per real document number (enables merge-on-upload across registers).
-- Placeholder / unawarded rows (NULL doc number) are exempt and simply append.
CREATE UNIQUE INDEX IF NOT EXISTS mddr_entries_docnum_unique
  ON mddr_entries(normalized_document_number)
  WHERE normalized_document_number IS NOT NULL;

-- ─── UPDATED_AT TRIGGER ─────────────────────────────────────
DROP TRIGGER IF EXISTS mddr_entries_updated_at ON mddr_entries;
CREATE TRIGGER mddr_entries_updated_at
  BEFORE UPDATE ON mddr_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── RLS (mirror existing pattern — enable but allow service role full access) ─
ALTER TABLE mddr_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE mddr_entries   ENABLE ROW LEVEL SECURITY;

-- Service-role bypass (used by Next.js API routes)
DROP POLICY IF EXISTS "mddr_registers_service_all" ON mddr_registers;
CREATE POLICY "mddr_registers_service_all" ON mddr_registers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "mddr_entries_service_all" ON mddr_entries;
CREATE POLICY "mddr_entries_service_all" ON mddr_entries
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users can read
DROP POLICY IF EXISTS "mddr_registers_auth_read" ON mddr_registers;
CREATE POLICY "mddr_registers_auth_read" ON mddr_registers
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "mddr_entries_auth_read" ON mddr_entries;
CREATE POLICY "mddr_entries_auth_read" ON mddr_entries
  FOR SELECT TO authenticated USING (true);
