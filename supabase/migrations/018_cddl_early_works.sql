-- 018: Early Works CDDL (package K038) joins the register.
-- Two workbook fields Phase 1 doesn't have: the design Phase and Native Received.
alter table cddl_doc add column if not exists phase text;
alter table cddl_doc add column if not exists native_received text;
