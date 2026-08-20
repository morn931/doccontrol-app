-- 046 — "Sign-off only" revisions (internal PPE docs returned from Aconex).
--
-- When a PPE document/drawing comes back from Aconex already reviewed and only needs a
-- revision bump (e.g. up to Rev 0), it should go straight to signatures WITHOUT re-running
-- the CoreDocs review cycle. Two entry paths, DC is always the authority:
--   A. DC-initiated (primary): the DC uploads the file she downloaded from Aconex against
--      the existing document and sends it straight to sign-off.
--   B. Owner request (secondary): the drawing owner ticks "request sign-off only" on a new
--      revision; the DC then flags it (or clears it back to normal review).
-- Both land the batch at status='review_complete' (already accepted by the sign-off gate),
-- carrying the signoff_only stamp below for the audit trail. No status_check change needed.

-- ── batches: sign-off-only markers ───────────────────────────────────────────
ALTER TABLE batches ADD COLUMN IF NOT EXISTS signoff_only              boolean NOT NULL DEFAULT false;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS signoff_only_reason       text;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS signoff_only_requested_by text;         -- owner who asked (null if DC-initiated)
ALTER TABLE batches ADD COLUMN IF NOT EXISTS signoff_only_requested_at timestamptz;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS signoff_only_approved_by  text;         -- DC who flagged / initiated
ALTER TABLE batches ADD COLUMN IF NOT EXISTS signoff_only_approved_at  timestamptz;

COMMENT ON COLUMN batches.signoff_only IS
  'This internal revision skipped the CoreDocs review cycle (returned from Aconex, already reviewed) and went straight to sign-off.';

-- A partial index so the DC queue "owner requested sign-off only, not yet actioned" is cheap.
CREATE INDEX IF NOT EXISTS idx_batches_signoff_only_pending
  ON batches (received_at)
  WHERE signoff_only_requested_by IS NOT NULL AND signoff_only = false;

-- ── permission: DC (and admin) may flag / initiate a sign-off-only revision ───
-- developer bypasses in code; grant to the same roles that hold action.assign_reviewers.
INSERT INTO role_permissions (feature_key, role, allowed) VALUES
  ('action.approve_signoff_only', 'admin',               true),
  ('action.approve_signoff_only', 'document_controller', true),
  ('action.approve_signoff_only', 'reviewer',            false),
  ('action.approve_signoff_only', 'engineering_manager', false),
  ('action.approve_signoff_only', 'project_manager',     false),
  ('action.approve_signoff_only', 'manager',             false),
  ('action.approve_signoff_only', 'vendor',              false)
ON CONFLICT (feature_key, role) DO NOTHING;
